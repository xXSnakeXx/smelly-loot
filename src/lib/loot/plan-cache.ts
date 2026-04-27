import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { bossKill, floor as floorTable, tierPlanCache } from "@/lib/db/schema";
import type { ItemKey } from "@/lib/ffxiv/slots";

import { computeGreedyPlan, type FloorPlan } from "./greedy-planner";
import {
  findCurrentRaidWeek,
  loadPlayerSnapshots,
  loadTierSnapshot,
} from "./snapshots";

/**
 * Plan-tab cache layer (v4.0.0).
 *
 * The Plan tab on the tier-detail page caches its planner output
 * here and only recomputes when the user clicks the Refresh
 * button (or a Track-tab action invalidates the cache). Other
 * tabs render live; Plan is intentionally sticky so casual BiS
 * edits or drop recordings don't reshuffle the next few weeks
 * of plans under the operator's feet.
 *
 * Since v4.0.0 the underlying algorithm is the bottleneck-aware
 * greedy planner in `greedy-planner.ts`. The cache content shape
 * (`FloorPlan[]` — drops + page-buys per floor) is unchanged
 * from v3.x so the UI components keep working as-is. Migration
 * 0015 flushes pre-v4 caches on container start so the new
 * algorithm always seeds the cache on first render.
 */

export interface CachedPlan {
  floorPlans: FloorPlan[];
  computedAt: Date;
}

/**
 * Recompute the Plan-tab simulation and write it back to the
 * cache. Returns the freshly computed plan for the caller's
 * convenience.
 */
export async function refreshPlan(
  tierId: number,
  floors: ReadonlyArray<{
    floorNumber: number;
    itemKeys: ItemKey[];
    trackedForAlgorithm: boolean;
  }>,
): Promise<CachedPlan> {
  const [snapshots, tierSnapshot, currentWeek] = await Promise.all([
    loadPlayerSnapshots(tierId),
    loadTierSnapshot(tierId),
    findCurrentRaidWeek(tierId),
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

  const floorPlans = computeGreedyPlan(floors, snapshots, tierSnapshot, {
    startingWeekNumber,
    alreadyKilledFloors,
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
      // Sanity-check the shape — same fields v3.x had so any
      // pre-v4 cache that survived migration 0015 still parses
      // cleanly. If a future schema change breaks this, fall
      // through and recompute from current state.
      if (Array.isArray(parsed) && parsed.every(isFloorPlanShape)) {
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

function isFloorPlanShape(value: unknown): value is FloorPlan {
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
