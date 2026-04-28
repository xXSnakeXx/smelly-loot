import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  bossKill,
  floor as floorTable,
  tierPlanCache,
  tier as tierTable,
} from "@/lib/db/schema";
import type { ItemKey } from "@/lib/ffxiv/slots";

import {
  computeGreedyPlan,
  type FloorPlan,
  type PlannedBuy,
} from "./greedy-planner";
import {
  findCurrentRaidWeek,
  loadPlayerSnapshots,
  loadTierSnapshot,
} from "./snapshots";

/**
 * Plan-tab cache layer (v4.1.0).
 *
 * The Plan tab on the tier-detail page caches its planner output
 * here and only recomputes when the user clicks the Refresh
 * button (or a Track-tab action invalidates the cache). Other
 * tabs render live; Plan is intentionally sticky so casual BiS
 * edits or drop recordings don't reshuffle the next few weeks
 * of plans under the operator's feet.
 *
 * v4.1.0 introduces **frozen buys**: the page-buy schedule is
 * computed once on the first plan run for a tier and persisted
 * to `tier.frozen_buys`. Subsequent refreshes only recompute the
 * drop schedule; the buy list stays stable. The operator can
 * trigger a buy-recalculation explicitly via the "refreeze
 * buys" action in Tier-Settings.
 *
 * The plan-cache content shape (`FloorPlan[]`) is unchanged
 * from v3/v4.0 so the UI components keep working.
 */

export interface CachedPlan {
  floorPlans: FloorPlan[];
  computedAt: Date;
}

/**
 * Recompute the Plan-tab simulation and write it back to the
 * cache. Returns the freshly computed plan for the caller's
 * convenience.
 *
 * Frozen-buy semantics:
 *   - If `tier.frozen_buys` is NULL, run the planner end-to-end
 *     and persist the resulting buy set.
 *   - If `tier.frozen_buys` is set, run the planner anyway (we
 *     need the fresh drop schedule) but **overwrite the buy set**
 *     with the persisted one before caching. Drops drift with
 *     state, buys don't.
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
      .select({ frozenBuys: tierTable.frozenBuys })
      .from(tierTable)
      .where(eq(tierTable.id, tierId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);

  const startingWeekNumber = currentWeek?.weekNumber ?? 1;

  const alreadyKilledFloors = new Set<number>();
  if (currentWeek) {
    const killedRows = await db
      .select({ floorNumber: floorTable.number })
      .from(bossKill)
      .innerJoin(floorTable, eq(bossKill.floorId, floorTable.id))
      .where(eq(bossKill.raidWeekId, currentWeek.id));
    for (const row of killedRows) alreadyKilledFloors.add(row.floorNumber);
  }

  const fresh = computeGreedyPlan(floors, snapshots, tierSnapshot, {
    startingWeekNumber,
    alreadyKilledFloors,
  });

  // Frozen-buy logic. Three cases:
  //
  //   1. `tier.frozen_buys` is NULL → first plan run for this
  //      tier (or after a refreeze). Persist the fresh buy set.
  //
  //   2. `tier.frozen_buys` is set → use the persisted buys,
  //      filter out any whose recipient already has the slot
  //      filled (= already-awarded buys are cleared, since
  //      `bisCurrent` was updated by `awardLootDropAction`).
  //
  // The filtering in (2) is critical so the Plan tab doesn't
  // keep recommending a buy the operator already executed.
  let frozenBuys: ReadonlyArray<PlannedBuy & { floorNumber: number }> | null =
    null;
  if (tierRow?.frozenBuys) {
    try {
      const parsed = JSON.parse(tierRow.frozenBuys) as Array<
        PlannedBuy & { floorNumber: number }
      >;
      if (Array.isArray(parsed)) frozenBuys = parsed;
    } catch {
      // Malformed JSON — treat as no frozen buys, will be
      // re-frozen below.
    }
  }

  let floorPlans: FloorPlan[];
  if (frozenBuys === null) {
    // First run — freeze whatever the planner produced.
    floorPlans = fresh;
    const buysFlat: Array<PlannedBuy & { floorNumber: number }> = [];
    for (const plan of fresh) {
      for (const buy of plan.buys) {
        buysFlat.push({ ...buy, floorNumber: plan.floorNumber });
      }
    }
    await db
      .update(tierTable)
      .set({ frozenBuys: JSON.stringify(buysFlat) })
      .where(eq(tierTable.id, tierId));
  } else {
    // Subsequent run — keep frozen buys, swap in fresh drops.
    // We need to filter out frozen buys whose recipient already
    // owns the slot (= the operator awarded the buy already, or
    // a drop filled it instead).
    const filledByPlayerSlot = new Set<string>();
    for (const snap of snapshots) {
      for (const [slot, current] of snap.bisCurrent.entries()) {
        const desired = snap.bisDesired.get(slot);
        if (desired && current === desired && desired !== "NotPlanned") {
          filledByPlayerSlot.add(`${snap.id}|${slot}`);
        }
      }
    }
    floorPlans = fresh.map((plan) => {
      const persistedForFloor = frozenBuys.filter(
        (b) =>
          b.floorNumber === plan.floorNumber &&
          !filledByPlayerSlot.has(`${b.playerId}|${b.slot}`),
      );
      return {
        ...plan,
        buys: persistedForFloor.map(({ floorNumber: _f, ...rest }) => rest),
      };
    });
  }

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
 * none exists yet.
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
 * Drop a tier's cached plan. Called on operator-explicit
 * actions (Refresh button, week reset). v4.1+ does NOT call
 * this on routine award/undo/edit — Plan is sticky during
 * loot distribution.
 */
export async function invalidatePlanCache(tierId: number): Promise<void> {
  await db.delete(tierPlanCache).where(eq(tierPlanCache.tierId, tierId));
}

/**
 * Clear the persisted frozen-buy schedule for a tier so the
 * next `refreshPlan` recomputes it from the current state.
 * Used by `refreezeBuysAction` from the Tier-Settings tab.
 */
export async function clearFrozenBuys(tierId: number): Promise<void> {
  await db
    .update(tierTable)
    .set({ frozenBuys: null })
    .where(eq(tierTable.id, tierId));
}

function isFloorPlanShape(value: unknown): value is FloorPlan {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.floorNumber !== "number") return false;
  if (!Array.isArray(v.itemKeys)) return false;
  if (!Array.isArray(v.drops)) return false;
  if (!Array.isArray(v.buys)) return false;
  if (!Array.isArray(v.weekNumbers)) return false;
  // v4.2: every drop must carry a `bossKillIndex` — older
  // caches predating this field fail validation and are
  // recomputed transparently on the next page load.
  for (const d of v.drops as unknown[]) {
    if (typeof d !== "object" || d === null) return false;
    if (typeof (d as Record<string, unknown>).bossKillIndex !== "number") {
      return false;
    }
  }
  return true;
}
