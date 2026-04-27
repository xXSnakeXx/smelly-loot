import {
  type BisSource,
  type ItemKey,
  SLOTS,
  type Slot,
} from "@/lib/ffxiv/slots";

import type { PlayerSnapshot, TierSnapshot } from "./algorithm";
import { SLOTS_BY_ITEM_KEY } from "./algorithm";
import { MinCostFlow } from "./mcmf";

/**
 * Per-floor optimal loot planner.
 *
 * Replaces the score-then-greedy `simulateLootTimeline` (v1-v2) with
 * a min-cost max-flow formulation. The high-level idea is:
 *
 *   - Supply: one unit per dropping item per week, plus the
 *     simulated page-buy capacity per player.
 *   - Demand: one unit per (player, slot) that's still wanted at
 *     Savage but not yet equipped.
 *   - Edge cost: the squared completion-week the assignment
 *     implies, so the solver minimises a sum-of-squares
 *     approximation of "minmax time-to-BiS".
 *
 * The single-pass solve removes every artefact of v2's
 * sequential awarding (Bracelet spillover, recency double-
 * penalty, item-order sensitivity). It also exposes a *buy
 * plan*: for each player, which slot they should buy with their
 * pages and in which week — visible alongside the drop plan on
 * the Plan tab.
 *
 * One floor at a time: pages are floor-specific in FF XIV (HW-I
 * tokens only buy F1 gear, etc.), so the per-floor decomposition
 * loses no global optimality.
 */

/** A drop assignment in the optimal plan. */
export interface PlannedDrop {
  /** Week within the horizon, 1-based against `startingWeekNumber`. */
  week: number;
  /** Item key dropping that week (e.g., "Earring"). */
  itemKey: ItemKey;
  /** Player who should receive the drop. */
  recipientId: number;
  recipientName: string;
  /**
   * Slot the drop fills for the recipient. For most items this is
   * uniquely determined by the item key; for Ring it's either
   * Ring1 or Ring2 depending on which one the player still wants.
   */
  slot: Slot;
}

/**
 * A page-buy in the optimal plan: the player should spend X pages
 * to acquire `slot` themselves, available from `completionWeek`
 * onward (the earliest week their cumulative page balance hits
 * the buy cost for the k-th time).
 */
export interface PlannedBuy {
  playerId: number;
  playerName: string;
  slot: Slot;
  /** Earliest week the player can afford this buy. */
  completionWeek: number;
  /** Pages spent on this buy (= `tier.buyCostByItem[item].cost`). */
  pagesUsed: number;
}

/**
 * A drop the optimiser couldn't assign: for example, an item
 * dropping in a week where every still-wanting recipient has
 * already taken a (cheaper) drop or buy. Surfaced separately so
 * the UI can flag "no recipient" cells without losing them in
 * the drops list.
 */
export interface UnassignedDrop {
  week: number;
  itemKey: ItemKey;
}

export interface FloorPlan {
  floorNumber: number;
  itemKeys: ItemKey[];
  /** Whether the floor is tracked for algorithmic recommendations. */
  tracked: boolean;
  /** Drops the optimiser assigned to a recipient. */
  drops: PlannedDrop[];
  /** Drops the optimiser left unassigned (no remaining wanter). */
  unassignedDrops: UnassignedDrop[];
  /** Recommended page-buys per player. */
  buys: PlannedBuy[];
  /** All weeks in the horizon, in order. Useful for the UI grid. */
  weekNumbers: number[];
}

export interface FloorPlanOptions {
  /** First week of the horizon (inclusive). */
  startingWeekNumber: number;
  /** Number of weeks to plan. */
  weeksAhead: number;
  /**
   * Floors whose first-week kill is already counted in the input
   * snapshots' page balances. The simulator skips its own +1 page
   * step for those floors at week == startingWeekNumber so the
   * plan lines up with what Track sees for the same data.
   */
  alreadyKilledFloors: ReadonlySet<number>;
}

/**
 * Penalty added to page-buy edges so that a tied (drop, buy) pair
 * gets the drop. Real raids prefer drops because pages are also
 * usable for materials / currencies; if the algorithm can fill a
 * slot via drop, do so. Set well below the squared-week cost so
 * it only breaks ties.
 */
const PAGE_PREFERENCE_EPS = 0.25;

/** Pages earned per boss kill in FF XIV — currently always 1. */
const PAGES_PER_KILL = 1;

const NEUTRAL_SOURCE: BisSource = "NotPlanned";

/**
 * Build the flow network for a single floor and solve it. Returns
 * the recipient/buy assignments derived from the flow values.
 *
 * The solver is deterministic: same inputs → same network → same
 * solution. (SPFA itself is stable under FIFO queueing and the
 * edge-add order is fixed by SLOTS / itemKeys / players order.)
 */
export function computeFloorPlan(
  floor: {
    floorNumber: number;
    itemKeys: ItemKey[];
    trackedForAlgorithm: boolean;
  },
  players: ReadonlyArray<PlayerSnapshot>,
  tier: TierSnapshot,
  options: FloorPlanOptions,
): FloorPlan {
  const { startingWeekNumber, weeksAhead, alreadyKilledFloors } = options;
  const weekNumbers = Array.from(
    { length: weeksAhead },
    (_, i) => startingWeekNumber + i,
  );

  if (!floor.trackedForAlgorithm) {
    // Untracked floors (e.g. F4 weapon coffers) show their drops
    // in the UI but the optimiser doesn't pick recipients.
    return {
      floorNumber: floor.floorNumber,
      itemKeys: floor.itemKeys.slice(),
      tracked: false,
      drops: [],
      unassignedDrops: weekNumbers.flatMap((week) =>
        floor.itemKeys.map((itemKey) => ({ week, itemKey })),
      ),
      buys: [],
      weekNumbers,
    };
  }

  // Resolve buy cost from the tier — every gear item on a single
  // floor shares the same per-item page cost in FF XIV, so we can
  // pick any of the floor's items to read the canonical cost.
  let costPerBuy = 0;
  for (const itemKey of floor.itemKeys) {
    const entry = tier.buyCostByItem.get(itemKey);
    if (entry && entry.floor === floor.floorNumber) {
      costPerBuy = entry.cost;
      break;
    }
  }

  // The MinCostFlow solver is graph-shape agnostic; we wire the
  // loot-specific topology here:
  //
  //   Source ─ cap=1, cost=0 ─→ DropNode(w, item)
  //                                │ cap=1, cost=(weekOffset+1)²
  //                                ▼
  //                          NeedNode(player, slot) ─ cap=1, cost=0 ─→ Sink
  //                                ▲
  //   Source ─ cap=1, cost=0 ─→ PageBuy(player, k) cost adds completion²
  //
  // (PageBuy → NeedNode edges are only added for slots the player
  // actually wants on this floor.)
  const mcmf = new MinCostFlow();
  const source = mcmf.addNode();
  const sink = mcmf.addNode();

  // Drop nodes, indexed by (week, item).
  const dropNodeIds = new Map<string, number>();
  // Drop-to-Need edge ids, indexed by (week, item, playerId, slot).
  // We need these to read off which (week, item) maps to which
  // (player, slot) post-solve.
  const dropEdgeRefs: Array<{
    edgeId: number;
    week: number;
    itemKey: ItemKey;
    playerId: number;
    slot: Slot;
  }> = [];
  // Page-buy edge ids, similarly indexed for read-off.
  const buyEdgeRefs: Array<{
    edgeId: number;
    playerId: number;
    slot: Slot;
    completionWeek: number;
  }> = [];

  // -- Need nodes -----------------------------------------------
  // For each (player, slot) where slot is on this floor, the
  // player wants Savage, and they don't already have it: create a
  // NeedNode. The set of "slots on this floor" is the union of
  // SLOTS_BY_ITEM_KEY for every item in floor.itemKeys.
  const slotsOnThisFloor = new Set<Slot>();
  for (const itemKey of floor.itemKeys) {
    const slots = SLOTS_BY_ITEM_KEY[itemKey as keyof typeof SLOTS_BY_ITEM_KEY];
    if (!slots) continue;
    for (const s of slots) slotsOnThisFloor.add(s as Slot);
  }

  // (player.id, slot) → need node id
  const needNodeIds = new Map<string, number>();
  // Per-player count of needs on this floor; drives how many
  // page-buys we wire up (no point letting a player buy more
  // slots than they want).
  const needsPerPlayer = new Map<number, number>();

  for (const player of players) {
    for (const slot of slotsOnThisFloor) {
      const desired = player.bisDesired.get(slot) ?? NEUTRAL_SOURCE;
      const current = player.bisCurrent.get(slot) ?? NEUTRAL_SOURCE;
      if (desired !== "Savage" || current === "Savage") continue;
      const nodeId = mcmf.addNode();
      needNodeIds.set(needKey(player.id, slot), nodeId);
      mcmf.addEdge(nodeId, sink, 1, 0);
      needsPerPlayer.set(player.id, (needsPerPlayer.get(player.id) ?? 0) + 1);
    }
  }

  // -- Drop nodes + edges to needs ------------------------------
  for (let wi = 0; wi < weekNumbers.length; wi += 1) {
    const week = weekNumbers[wi];
    if (week === undefined) continue;
    const weekOffset = wi + 1; // 1-based for the cost function.
    // Squared so late assignments are punished super-linearly:
    // approximates "minmax time-to-BiS" with a sum-of-squares.
    const dropCost = weekOffset * weekOffset;

    for (const itemKey of floor.itemKeys) {
      const slots =
        SLOTS_BY_ITEM_KEY[itemKey as keyof typeof SLOTS_BY_ITEM_KEY];
      if (!slots) continue;
      const dropNode = mcmf.addNode();
      dropNodeIds.set(dropKey(week, itemKey), dropNode);
      mcmf.addEdge(source, dropNode, 1, 0);
      // Wire the drop to every need it could satisfy.
      for (const player of players) {
        for (const slot of slots) {
          const needNode = needNodeIds.get(needKey(player.id, slot as Slot));
          if (needNode === undefined) continue;
          const edgeId = mcmf.addEdge(dropNode, needNode, 1, dropCost);
          dropEdgeRefs.push({
            edgeId,
            week,
            itemKey,
            playerId: player.id,
            slot: slot as Slot,
          });
        }
      }
    }
  }

  // -- Page-buy nodes + edges to needs --------------------------
  if (costPerBuy > 0) {
    for (const player of players) {
      const need = needsPerPlayer.get(player.id) ?? 0;
      if (need === 0) continue;
      const initialPages = player.pages.get(floor.floorNumber) ?? 0;
      const firstWeekAlreadyKilled = alreadyKilledFloors.has(floor.floorNumber);
      // Compute completion week for each progressively-more-
      // expensive buy. Stop once the completion week exceeds the
      // horizon: such a buy is infeasible within the planning
      // window and adding it would just bloat the network.
      for (let k = 1; k <= need; k += 1) {
        // pages_after_week_w = initial + (w - start) + (alreadyKilled ? 0 : PAGES_PER_KILL)
        // affordable when pages_after_week_w >= k * costPerBuy
        const offset =
          k * costPerBuy -
          initialPages -
          (firstWeekAlreadyKilled ? 0 : PAGES_PER_KILL);
        const completionWeekOffset = Math.max(0, offset);
        if (completionWeekOffset >= weeksAhead) break;
        const completionWeek = startingWeekNumber + completionWeekOffset;
        const buyNode = mcmf.addNode();
        mcmf.addEdge(source, buyNode, 1, 0);
        // Cost: same squared-week-offset as a drop in this
        // completion week, with a small constant ε so a
        // tied (drop, buy) pair always picks the drop.
        const buyEdgeCost =
          (completionWeekOffset + 1) * (completionWeekOffset + 1) +
          PAGE_PREFERENCE_EPS;
        for (const slot of slotsOnThisFloor) {
          const needNode = needNodeIds.get(needKey(player.id, slot));
          if (needNode === undefined) continue;
          // Buyable: any wanted slot the player has on this
          // floor (the slot itself doesn't matter to the page
          // economy; pages buy any single F1 gear piece for
          // their floor cost).
          const edgeId = mcmf.addEdge(buyNode, needNode, 1, buyEdgeCost);
          buyEdgeRefs.push({
            edgeId,
            playerId: player.id,
            slot,
            completionWeek,
          });
        }
      }
    }
  }

  // -- Solve and read off ---------------------------------------
  mcmf.solve(source, sink);

  const drops: PlannedDrop[] = [];
  const assignedDropKeys = new Set<string>();
  for (const ref of dropEdgeRefs) {
    if (mcmf.flowOf(ref.edgeId) <= 0) continue;
    const player = players.find((p) => p.id === ref.playerId);
    if (!player) continue;
    drops.push({
      week: ref.week,
      itemKey: ref.itemKey,
      recipientId: ref.playerId,
      recipientName: player.name,
      slot: ref.slot,
    });
    assignedDropKeys.add(dropKey(ref.week, ref.itemKey));
  }

  const unassignedDrops: UnassignedDrop[] = [];
  for (const week of weekNumbers) {
    for (const itemKey of floor.itemKeys) {
      if (!assignedDropKeys.has(dropKey(week, itemKey))) {
        unassignedDrops.push({ week, itemKey });
      }
    }
  }

  const buys: PlannedBuy[] = [];
  for (const ref of buyEdgeRefs) {
    if (mcmf.flowOf(ref.edgeId) <= 0) continue;
    const player = players.find((p) => p.id === ref.playerId);
    if (!player) continue;
    buys.push({
      playerId: ref.playerId,
      playerName: player.name,
      slot: ref.slot,
      completionWeek: ref.completionWeek,
      pagesUsed: costPerBuy,
    });
  }

  // Sort outputs deterministically for stable UI rendering.
  drops.sort((a, b) => {
    if (a.week !== b.week) return a.week - b.week;
    return (
      floor.itemKeys.indexOf(a.itemKey) - floor.itemKeys.indexOf(b.itemKey)
    );
  });
  buys.sort((a, b) => {
    if (a.completionWeek !== b.completionWeek) {
      return a.completionWeek - b.completionWeek;
    }
    if (a.playerName !== b.playerName) {
      return a.playerName.localeCompare(b.playerName);
    }
    return SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);
  });

  return {
    floorNumber: floor.floorNumber,
    itemKeys: floor.itemKeys.slice(),
    tracked: true,
    drops,
    unassignedDrops,
    buys,
    weekNumbers,
  };
}

function needKey(playerId: number, slot: Slot): string {
  return `${playerId}|${slot}`;
}

function dropKey(week: number, itemKey: ItemKey): string {
  return `${week}|${itemKey}`;
}
