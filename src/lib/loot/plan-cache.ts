import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  bossKill,
  floor as floorTable,
  tierPlanCache,
  tier as tierTable,
} from "@/lib/db/schema";
import type { GearRole } from "@/lib/ffxiv/jobs";
import type { ItemKey, Slot } from "@/lib/ffxiv/slots";

import { computeFloorPlan, type FloorPlan } from "./floor-planner";
import {
  findCurrentRaidWeek,
  loadPlayerSnapshots,
  loadTierSnapshot,
} from "./snapshots";

/**
 * Plan-tab cache layer (v3.0.0).
 *
 * The Plan tab on the tier-detail page caches its
 * `computeFloorPlan` output here and only recomputes when the
 * user clicks the Refresh button. The rationale lives in the
 * `tier_plan_cache` schema docstring: every other tab is live,
 * but Plan is intentionally sticky so casual BiS edits or drop
 * recordings on Track don't reshuffle the next few weeks of
 * plans under the operator's feet.
 *
 * Since v3.0.0 the cache content is `FloorPlan[]` (drops +
 * page-buys per floor) instead of v2's `TimelineForFloor[]`.
 * Migration 0007 flushes pre-v3.0 caches on container start so
 * the new shape is always what the Plan UI sees.
 */

const PLAN_WEEKS_AHEAD = 8;

export interface CachedPlan {
  floorPlans: FloorPlan[];
  computedAt: Date;
}

/**
 * Recompute the Plan-tab simulation and write it back to the
 * cache. Returns the freshly computed plan for the caller's
 * convenience.
 *
 * Each floor is solved as an independent min-cost max-flow
 * problem — pages are floor-specific in FF XIV so per-floor
 * decomposition loses no global optimality. See `floor-planner.ts`
 * for the network construction.
 */
export async function refreshPlan(
  tierId: number,
  floors: ReadonlyArray<{
    floorNumber: number;
    itemKeys: ItemKey[];
    trackedForAlgorithm: boolean;
  }>,
): Promise<CachedPlan> {
  const [snapshots, tierSnapshot, currentWeek, tierRow] = await Promise.all([
    loadPlayerSnapshots(tierId),
    loadTierSnapshot(tierId),
    findCurrentRaidWeek(tierId),
    db
      .select({
        slotWeights: tierTable.slotWeights,
        roleWeights: tierTable.roleWeights,
      })
      .from(tierTable)
      .where(eq(tierTable.id, tierId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);

  const startingWeekNumber = currentWeek?.weekNumber ?? 1;

  // Floors whose active-week kill is already counted in the input
  // snapshots' page balances — `loadPlayerSnapshots` walks
  // `boss_kill` rows when building each player's per-floor page
  // map, so the planner must skip its own +1 step for those
  // floors at the first horizon week. Otherwise the W1
  // recommendation would assume one more page than Track sees and
  // diverge from "what does the algorithm say should happen for
  // this kill?" right after it's recorded.
  const alreadyKilledFloors = new Set<number>();
  if (currentWeek) {
    const killedRows = await db
      .select({ floorNumber: floorTable.number })
      .from(bossKill)
      .innerJoin(floorTable, eq(bossKill.floorId, floorTable.id))
      .where(eq(bossKill.raidWeekId, currentWeek.id));
    for (const row of killedRows) alreadyKilledFloors.add(row.floorNumber);
  }

  // Per-tier weight overrides — the action layer's tier-settings
  // form writes to these JSON columns. Falls through to the
  // hard-coded DEFAULT_*_WEIGHTS when null (legacy tiers).
  const slotWeights = tierRow?.slotWeights as
    | Partial<Record<Slot, number>>
    | undefined;
  const roleWeights = tierRow?.roleWeights as
    | Partial<Record<GearRole, number>>
    | undefined;

  const floorPlans: FloorPlan[] = floors.map((f) => {
    // exactOptionalPropertyTypes: only include the weight keys
    // when the tier row actually has them, so the FloorPlanOptions
    // shape sees `undefined` only as "not set" not "explicitly set
    // to undefined".
    const opts: Parameters<typeof computeFloorPlan>[3] = {
      startingWeekNumber,
      weeksAhead: PLAN_WEEKS_AHEAD,
      alreadyKilledFloors,
      ...(slotWeights ? { slotWeights } : {}),
      ...(roleWeights ? { roleWeights } : {}),
    };
    return computeFloorPlan(f, snapshots, tierSnapshot, opts);
  });

  const computedAt = new Date();
  await db
    .insert(tierPlanCache)
    .values({
      tierId,
      snapshot: JSON.stringify(floorPlans),
      computedAt,
    })
    .onConflictDoUpdate({
      target: tierPlanCache.tierId,
      set: {
        snapshot: JSON.stringify(floorPlans),
        computedAt,
      },
    });

  return { floorPlans, computedAt };
}

/**
 * Read the cached plan for a tier, or recompute and cache one if
 * none exists yet. Used on every server render of the tier-detail
 * page so opening the page never blocks on a missing cache while
 * still avoiding spurious re-simulations on unrelated mutations.
 */
export async function getCachedOrComputePlan(
  tierId: number,
  floors: ReadonlyArray<{
    floorNumber: number;
    itemKeys: ItemKey[];
    trackedForAlgorithm: boolean;
  }>,
): Promise<CachedPlan> {
  const rows = await db
    .select()
    .from(tierPlanCache)
    .where(eq(tierPlanCache.tierId, tierId))
    .limit(1);
  const cached = rows[0];
  if (cached) {
    try {
      const parsed = JSON.parse(cached.snapshot) as FloorPlan[];
      // Sanity-check: v3.0 entries have a `drops` array AND a
      // `buys` array. v2.x cached `TimelineForFloor` had `weeks`
      // instead. If the shape doesn't match, fall through and
      // recompute (migration 0007 should have caught this on
      // container start, but defensive check helps for any DB
      // copied between versions out-of-band).
      if (Array.isArray(parsed) && parsed.every(isV3FloorPlan)) {
        return { floorPlans: parsed, computedAt: cached.computedAt };
      }
    } catch {
      // Fall through to recompute on parse error.
    }
  }
  return refreshPlan(tierId, floors);
}

/**
 * Drop a tier's cached plan. Called on Track-tab actions that
 * meaningfully change the input (drop awarded, kill recorded,
 * etc.) so the next Plan render reflects the new state without
 * the operator having to manually click Refresh.
 *
 * BiS edits do NOT trigger invalidation — Plan is intentionally
 * sticky against routine roster tweaks; the operator decides
 * when to recompute.
 */
export async function invalidatePlanCache(tierId: number): Promise<void> {
  await db.delete(tierPlanCache).where(eq(tierPlanCache.tierId, tierId));
}

function isV3FloorPlan(value: unknown): value is FloorPlan {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.floorNumber === "number" &&
    Array.isArray(v.itemKeys) &&
    Array.isArray(v.drops) &&
    Array.isArray(v.buys) &&
    Array.isArray(v.weekNumbers)
  );
}
