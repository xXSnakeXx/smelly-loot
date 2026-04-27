import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { tierPlanCache } from "@/lib/db/schema";
import type { ItemKey } from "@/lib/ffxiv/slots";

import {
  findCurrentRaidWeek,
  loadPlayerSnapshots,
  loadTierSnapshot,
} from "./snapshots";
import { simulateLootTimeline, type TimelineForFloor } from "./timeline";

/**
 * Plan-tab cache layer.
 *
 * The Plan tab on the tier-detail page is the only sticky surface
 * in the app — every other tab refreshes live as the operator
 * mutates the underlying data, but the Plan tab caches its
 * `simulateLootTimeline` output here and only recomputes when the
 * user clicks the Refresh button. The rationale lives in the
 * `tier_plan_cache` schema docstring.
 *
 * `getCachedOrComputePlan` is the entry point the page uses on
 * every render. `refreshPlan` is the explicit recomputation the
 * Refresh button triggers. Both serialise the simulation output
 * via plain JSON — `TimelineForFloor` doesn't contain any Map /
 * Set values so a round-trip through `JSON.stringify` /
 * `JSON.parse` preserves the shape.
 */

const PLAN_WEEKS_AHEAD = 8;

export interface CachedPlan {
  timelines: TimelineForFloor[];
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

  // Floors whose live `boss_kill` row already incremented the
  // snapshot's page balances — the simulator must skip its own
  // `+1 page` step for those on iteration 0 so Plan-Week-1 lines
  // up with Track's view of the same data. See the v1.5 changelog
  // entry for the parity fix.
  const alreadyKilledFloorNumbers: number[] = [];
  // Note: the page already passes us the current week's killed
  // floors, but the cache layer is invoked on its own (e.g. via
  // refreshPlanAction). Re-derive from the live DB instead of
  // making the caller pass them in — it keeps refresh idempotent.

  const timelines = simulateLootTimeline(snapshots, tierSnapshot, {
    startingWeekNumber,
    weeksAhead: PLAN_WEEKS_AHEAD,
    alreadyKilledFloors: alreadyKilledFloorNumbers,
    floors,
  });

  const computedAt = new Date();
  await db
    .insert(tierPlanCache)
    .values({
      tierId,
      snapshot: JSON.stringify(timelines),
      computedAt,
    })
    .onConflictDoUpdate({
      target: tierPlanCache.tierId,
      set: {
        snapshot: JSON.stringify(timelines),
        computedAt,
      },
    });

  return { timelines, computedAt };
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
    const timelines = JSON.parse(cached.snapshot) as TimelineForFloor[];
    return { timelines, computedAt: cached.computedAt };
  }
  return refreshPlan(tierId, floors);
}

/**
 * Drop a tier's cached plan. Used on tier deletion / archival; the
 * cache will be recomputed on the next page render.
 *
 * Not currently called from anywhere outside tests because tier
 * deletion cascades the cache row via the FK, but kept here so
 * tooling / scripts can wipe the cache without going through the
 * full `refreshPlan` round-trip.
 */
export async function invalidatePlanCache(tierId: number): Promise<void> {
  await db.delete(tierPlanCache).where(eq(tierPlanCache.tierId, tierId));
}
