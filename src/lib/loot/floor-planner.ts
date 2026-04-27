import { DEFAULT_ROLE_WEIGHTS, type GearRole } from "@/lib/ffxiv/jobs";
import {
  type BisSource,
  DEFAULT_SLOT_WEIGHTS,
  type ItemKey,
  SLOTS,
  type Slot,
} from "@/lib/ffxiv/slots";

import {
  type PlayerSnapshot,
  slotsForItem as slotsCoveredByItem,
  sourceForItem,
  type TierSnapshot,
} from "./algorithm";
import { MinCostFlow } from "./mcmf";

/**
 * Per-floor optimal loot planner (v3.1).
 *
 * Solves a single min-cost max-flow problem per boss floor that
 * decides every drop assignment AND page-buy in one pass. The
 * solver returns:
 *
 *   - Drop assignments: which player gets which item dropping in
 *     which week, and which of their slots it fills.
 *   - Buy plan: which player should buy which item (gear or
 *     material) with their pages and from what week onward.
 *
 * The optimisation objective is min-max time-to-BiS — minimise
 * the latest week any player completes their Savage / TomeUp BiS
 * for slots owned by this floor. Edge costs are squared
 * completion-week, which approximates min-of-max via min-of-
 * sum-of-squares.
 *
 * v3.1 adds material handling on top of v3.0's gear-only flow:
 *
 *   - Glaze (drops on F2) fills accessory TomeUp needs (Earring /
 *     Necklace / Bracelet / Ring1 / Ring2 desired = TomeUp).
 *   - Twine (drops on F3) fills clothing TomeUp needs (Head /
 *     Chestpiece / Gloves / Pants / Boots).
 *   - Ester (drops on F3) fills weapon TomeUp needs (Weapon /
 *     Offhand).
 *
 * Mixed-cost items on the same floor (F2 has gear at 4 pages,
 * Glaze at 3) require capacity scaling: every flow unit
 * represents one page, so 1 drop = `item.cost` units of supply
 * and 1 fulfilled need = `item.cost` units of demand. Conservation
 * works automatically; the per-fulfilment edge cost is normalised
 * to keep min-max behaviour uniform across cost classes.
 *
 * One floor at a time: pages are floor-specific in FF XIV (HW-I
 * tokens only buy F1 gear, etc.) so per-floor decomposition
 * loses no global optimality. Each (player, slot) need is owned
 * by exactly one floor — the floor where the filling item drops.
 */

/** A drop assignment in the optimal plan. */
export interface PlannedDrop {
  /** Week within the horizon, 1-based against `startingWeekNumber`. */
  week: number;
  /** Item key dropping that week (e.g., "Earring", "Glaze"). */
  itemKey: ItemKey;
  /** Player who should receive the drop. */
  recipientId: number;
  recipientName: string;
  /**
   * Slot the drop fills for the recipient. For Ring it's either
   * Ring1 or Ring2; for materials it's whichever upgradeable slot
   * the optimiser picked (e.g., a Glaze drop fills one of the
   * recipient's TomeUp accessory needs).
   */
  slot: Slot;
  /**
   * Whether this drop fills a Savage need (gear) or a TomeUp
   * need (material). Useful for the UI to differentiate the
   * two flows visually.
   */
  source: BisSource;
}

/**
 * A page-buy in the optimal plan: the player should spend pages
 * to acquire `slot` themselves, available from `completionWeek`
 * onward (the earliest week their cumulative page balance hits
 * the buy cost for the k-th time, accounting for previous buys).
 */
export interface PlannedBuy {
  playerId: number;
  playerName: string;
  /** Item key being bought. */
  itemKey: ItemKey;
  /** Slot this buy fills. */
  slot: Slot;
  /** Earliest week the player can afford this buy. */
  completionWeek: number;
  /** Pages spent on this buy. */
  pagesUsed: number;
  /** Whether the buy fills a Savage need (gear) or TomeUp need (material). */
  source: BisSource;
}

/**
 * A drop the optimiser couldn't assign: e.g. an item dropping in
 * a week where every still-wanting recipient has already taken a
 * cheaper drop or buy. Surfaced separately so the UI can flag
 * "no recipient" cells without losing them in the drops list.
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
  /**
   * Optional per-slot priority multipliers. Lower value = cheaper
   * edge cost = the optimiser prefers filling that slot first.
   * Falls back to `DEFAULT_SLOT_WEIGHTS` from `slots.ts` when
   * unset — see that constant for sensible defaults (chest /
   * pants discounted to bias high-stat-budget upgrades first).
   */
  slotWeights?: Partial<Record<Slot, number>>;
  /**
   * Optional per-role priority multipliers. Lower value = cheaper
   * edge cost to that role's NeedNodes. Falls back to
   * `DEFAULT_ROLE_WEIGHTS` from `jobs.ts`. Setting `melee = 0.9`
   * (vs default 0.95) bias drops more strongly toward melee DPS;
   * setting them all to 1.0 disables the role bias entirely.
   */
  roleWeights?: Partial<Record<GearRole, number>>;
}

/** Pages earned per boss kill in FF XIV — currently always 1. */
const PAGES_PER_KILL = 1;

/**
 * Multiplier added to page-buy edge costs so that a tied
 * (drop, buy) fulfilment for the same need + week always
 * resolves in the drop's favour. Real raids prefer drops because
 * pages are spendable on other things too; the small ε keeps
 * that preference without distorting the min-max objective.
 *
 * Stored as a fraction of (item.cost) so it scales with the
 * unit-of-flow choice — see `addItemEdges` below.
 */
const PAGE_PREFERENCE_EPS = 0.25;

const NEUTRAL_SOURCE: BisSource = "NotPlanned";

/**
 * Build the flow network for a single floor and solve it. Returns
 * the recipient/buy assignments derived from the flow values.
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

  // Resolve the priority weights, falling back to the
  // hard-coded defaults when the tier-settings UI hasn't been
  // touched. Stored in `effectiveSlotWeights` and
  // `effectiveRoleWeights` so the cost-edge code can multiply
  // through without an extra null-check on every iteration.
  const effectiveSlotWeights: Record<Slot, number> = {
    ...DEFAULT_SLOT_WEIGHTS,
    ...(options.slotWeights ?? {}),
  };
  const effectiveRoleWeights: Record<GearRole, number> = {
    ...DEFAULT_ROLE_WEIGHTS,
    ...(options.roleWeights ?? {}),
  };

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

  // Cost and source lookup per item on this floor. Items not in
  // the tier's buy_cost table (or wired to a different floor) are
  // skipped — the network has no edges for them.
  const itemMeta = new Map<
    ItemKey,
    { cost: number; source: BisSource; slots: readonly Slot[] }
  >();
  for (const itemKey of floor.itemKeys) {
    const entry = tier.buyCostByItem.get(itemKey);
    if (!entry || entry.floor !== floor.floorNumber) continue;
    itemMeta.set(itemKey, {
      cost: entry.cost,
      source: sourceForItem(itemKey),
      slots: slotsCoveredByItem(itemKey),
    });
  }

  // The flow solver lives in mcmf.ts. We add nodes/edges then
  // solve once. Every edge's "unit of flow" is one page — that's
  // the only way to model a shared page budget when items on
  // the same floor have different per-buy costs (F2 has gear at
  // cost 4 and Glaze at cost 3). 1 drop = item.cost units of
  // flow; 1 buy = item.cost units; 1 fulfilled need = item.cost
  // units. Edge costs are normalised by item.cost so each
  // fulfilment contributes a uniform `weekOffset²` to the
  // objective, not biased by item cost class.
  const mcmf = new MinCostFlow();
  const source = mcmf.addNode();
  const sink = mcmf.addNode();

  // Need nodes: one per (player, slot) where the player wants a
  // BiS source filled by an item dropping on THIS floor.
  // Map key: `${playerId}|${slot}`. Each need has exactly one
  // matching item type (and source).
  interface NeedInfo {
    nodeId: number;
    itemCost: number;
    itemKey: ItemKey;
    source: BisSource;
    sinkEdgeId: number;
  }
  const needs = new Map<string, NeedInfo>();

  for (const [itemKey, meta] of itemMeta) {
    for (const player of players) {
      for (const slot of meta.slots) {
        const desired = player.bisDesired.get(slot) ?? NEUTRAL_SOURCE;
        const current = player.bisCurrent.get(slot) ?? NEUTRAL_SOURCE;
        if (desired !== meta.source || current === meta.source) continue;
        const key = needKey(player.id, slot);
        // A given (player, slot) can match at most one item on
        // this floor — gear items map to a unique slot, materials
        // map to disjoint slot families, and only one source
        // (Savage / TomeUp) is desired per slot. Skip if already
        // wired (defensive; shouldn't happen with valid data).
        if (needs.has(key)) continue;
        const nodeId = mcmf.addNode();
        const sinkEdgeId = mcmf.addEdge(nodeId, sink, meta.cost, 0);
        needs.set(key, {
          nodeId,
          itemCost: meta.cost,
          itemKey,
          source: meta.source,
          sinkEdgeId,
        });
      }
    }
  }

  // -- Drop nodes + edges to needs ------------------------------
  // Drop edge id refs so we can read off (week, item, recipient,
  // slot) post-solve.
  const dropEdgeRefs: Array<{
    edgeId: number;
    week: number;
    itemKey: ItemKey;
    playerId: number;
    slot: Slot;
    source: BisSource;
  }> = [];

  for (let wi = 0; wi < weekNumbers.length; wi += 1) {
    const week = weekNumbers[wi];
    if (week === undefined) continue;
    const weekOffset = wi + 1; // 1-based for the cost function.
    const weekCostNumerator = weekOffset * weekOffset;

    for (const [itemKey, meta] of itemMeta) {
      const dropNode = mcmf.addNode();
      mcmf.addEdge(source, dropNode, meta.cost, 0);
      // Cost-per-unit-flow = weekOffset² × slotWeight ×
      // roleWeight / item.cost so that total contribution per
      // fulfilled need = item.cost × cost = weekOffset² ×
      // slotWeight × roleWeight. The week² term keeps min-max-
      // time-to-BiS as the primary objective; slotWeight bias
      // the optimiser toward high-priority slots (Chestpiece /
      // Pants over Boots when both are TomeUp-needed); role
      // weight gives DPS a 5% discount so they get first pick
      // in tie-breaks. The cap "DPS prioritisieren bis nur
      // noch 2 Items übrig" falls out automatically because
      // page-buy edges carry their own (cheaper-than-late-
      // drop) cost — once a DPS' remaining needs are coverable
      // by buys, drops naturally route elsewhere.
      const baseEdgeCost = weekCostNumerator / meta.cost;
      for (const player of players) {
        const roleWeight = effectiveRoleWeights[player.gearRole] ?? 1;
        for (const slot of meta.slots) {
          const need = needs.get(needKey(player.id, slot));
          if (!need || need.itemKey !== itemKey) continue;
          const slotWeight = effectiveSlotWeights[slot] ?? 1;
          const edgeCost = baseEdgeCost * slotWeight * roleWeight;
          const edgeId = mcmf.addEdge(
            dropNode,
            need.nodeId,
            meta.cost,
            edgeCost,
          );
          dropEdgeRefs.push({
            edgeId,
            week,
            itemKey,
            playerId: player.id,
            slot,
            source: meta.source,
          });
        }
      }
    }
  }

  // -- Page-buy nodes + edges to needs --------------------------
  // Buys are modelled per (player, floor, cost-class, k-th-buy-
  // of-that-class) so flow conservation never produces partial
  // item fulfilments. A "cost class" is one item.cost value on
  // the floor — F2 has classes 3 (Glaze) and 4 (gear); F3 has
  // classes 4 (Twine, Ester) and 6 (Chestpiece, Pants). Each
  // class has its own k-counter, so two cost-3 buys on F2 (e.g.
  // two Glazes) become "Glaze k=1 at W3" and "Glaze k=2 at W6"
  // — accurate completion weeks even when both Glazes route to
  // the same cost class. The PageBudget cap (= total pages over
  // the horizon) enforces the cross-class shared-budget
  // constraint: 2 gear (8 pages) + 1 Glaze (3 pages) is 11 > 8
  // and the optimiser is blocked from picking that combination.
  //
  // Within a class, BuySlot has cap = class.cost in BOTH
  // directions, so flow is integer-valued at exactly 0 or
  // class.cost — no partial item fulfilments. Across classes
  // BuySlots are independent; the budget cap is the only thing
  // tying them together.
  const buyEdgeRefs: Array<{
    edgeId: number;
    playerId: number;
    slot: Slot;
    completionWeek: number;
    itemKey: ItemKey;
    source: BisSource;
    pagesUsed: number;
  }> = [];

  // Group items on this floor by their per-buy cost.
  const itemsByCost = new Map<
    number,
    Array<[ItemKey, typeof itemMeta extends Map<unknown, infer V> ? V : never]>
  >();
  for (const entry of itemMeta) {
    const [, meta] = entry;
    const list = itemsByCost.get(meta.cost) ?? [];
    list.push(entry);
    itemsByCost.set(meta.cost, list);
  }
  if (itemsByCost.size === 0) {
    return finalisePlan({
      floor,
      mcmf,
      source,
      sink,
      players,
      weekNumbers,
      itemMeta,
      dropEdgeRefs,
      buyEdgeRefs,
    });
  }

  for (const player of players) {
    let hasNeeds = false;
    for (const slot of SLOTS) {
      if (needs.has(needKey(player.id, slot))) {
        hasNeeds = true;
        break;
      }
    }
    if (!hasNeeds) continue;

    const initialPages = player.pages.get(floor.floorNumber) ?? 0;
    const firstWeekAlreadyKilled = alreadyKilledFloors.has(floor.floorNumber);
    const horizonKillIncrements = firstWeekAlreadyKilled
      ? (weeksAhead - 1) * PAGES_PER_KILL
      : weeksAhead * PAGES_PER_KILL;
    const totalPages = initialPages + horizonKillIncrements;
    if (totalPages <= 0) continue;

    const pageBudgetNode = mcmf.addNode();
    mcmf.addEdge(source, pageBudgetNode, totalPages, 0);

    // Per cost class, model up to max_buys_in_class progressive
    // buys. Completion week is k * cost (cumulative spend ON
    // THIS CLASS) minus initial pages and any kill that already
    // happened this week.
    for (const [costClass, items] of itemsByCost) {
      // Filter items in this class to those at least one player
      // need can use — keeps the network tight when only some
      // items in a class are demanded.
      const relevantItems = items.filter(([, meta]) =>
        meta.slots.some((slot) => needs.has(needKey(player.id, slot))),
      );
      if (relevantItems.length === 0) continue;

      const maxBuysInClass = Math.floor(totalPages / costClass);
      for (let k = 1; k <= maxBuysInClass; k += 1) {
        const offset =
          k * costClass -
          initialPages -
          (firstWeekAlreadyKilled ? 0 : PAGES_PER_KILL);
        const completionWeekOffset = Math.max(0, offset);
        if (completionWeekOffset >= weeksAhead) break;
        const completionWeek = startingWeekNumber + completionWeekOffset;

        const slotNode = mcmf.addNode();
        // Cap = costClass in both directions: flow can only be 0
        // or exactly costClass at this slot, never partial.
        mcmf.addEdge(pageBudgetNode, slotNode, costClass, 0);

        const baseBuyCost =
          ((completionWeekOffset + 1) * (completionWeekOffset + 1)) / costClass;
        const playerRoleWeight = effectiveRoleWeights[player.gearRole] ?? 1;
        for (const [itemKey, meta] of relevantItems) {
          for (const slot of meta.slots) {
            const need = needs.get(needKey(player.id, slot));
            if (!need || need.itemKey !== itemKey) continue;
            // Same slot+role weighting as drops, plus the
            // PAGE_PREFERENCE_EPS so a tied (drop, buy) pair
            // always picks the drop. Multiplying ε with
            // costClass keeps the bias proportional to the
            // unit-of-flow scale.
            const slotWeight = effectiveSlotWeights[slot] ?? 1;
            const buyEdgeCost =
              baseBuyCost * slotWeight * playerRoleWeight + PAGE_PREFERENCE_EPS;
            const edgeId = mcmf.addEdge(
              slotNode,
              need.nodeId,
              costClass,
              buyEdgeCost,
            );
            buyEdgeRefs.push({
              edgeId,
              playerId: player.id,
              slot,
              completionWeek,
              itemKey,
              source: meta.source,
              pagesUsed: meta.cost,
            });
          }
        }
      }
    }
  }

  return finalisePlan({
    floor,
    mcmf,
    source,
    sink,
    players,
    weekNumbers,
    itemMeta,
    dropEdgeRefs,
    buyEdgeRefs,
  });
}

/**
 * Run the solver and assemble the FloorPlan response. Pulled out
 * of `computeFloorPlan` so the early-return when there are no
 * buyable items doesn't have to duplicate the read-off logic.
 *
 * The read-off is per-NeedNode aggregating: SSP can split flow
 * between multiple equally-cheap incoming edges (e.g., a Glaze
 * drop in W1 may put 1.5 units into S'ndae's Necklace and 1.5
 * into Brad's Ring2 — both edges show non-zero flow but neither
 * "fully" delivers a fulfilment on its own). To avoid surfacing
 * these split flows as duplicate fulfilments, we group all
 * incoming edges per NeedNode, pick the dominant one (highest
 * flow, tie-broken by edge insertion order for determinism), and
 * report ONLY that source as the responsible drop / buy.
 *
 * This loses information when a need is genuinely split-filled
 * across multiple sources, but every NeedNode has integer
 * `Sink` capacity so the total fulfilment is binary (filled or
 * not). The dominant-source attribution gives a clean
 * "this drop / buy filled this need" relationship that matches
 * what a raid leader cares about.
 */
function finalisePlan({
  floor,
  mcmf,
  source,
  sink,
  players,
  weekNumbers,
  itemMeta,
  dropEdgeRefs,
  buyEdgeRefs,
}: {
  floor: { floorNumber: number; itemKeys: ItemKey[] };
  mcmf: MinCostFlow;
  source: number;
  sink: number;
  players: ReadonlyArray<PlayerSnapshot>;
  weekNumbers: number[];
  itemMeta: Map<
    ItemKey,
    { cost: number; source: BisSource; slots: readonly Slot[] }
  >;
  dropEdgeRefs: Array<{
    edgeId: number;
    week: number;
    itemKey: ItemKey;
    playerId: number;
    slot: Slot;
    source: BisSource;
  }>;
  buyEdgeRefs: Array<{
    edgeId: number;
    playerId: number;
    slot: Slot;
    completionWeek: number;
    itemKey: ItemKey;
    source: BisSource;
    pagesUsed: number;
  }>;
}): FloorPlan {
  mcmf.solve(source, sink);

  // Group all incoming-edge refs (drops + buys) by their target
  // NeedNode (player, slot) so we can pick a dominant source per
  // need. `kind` distinguishes drop vs buy in the type-discriminated
  // union; `originalIndex` is used for deterministic tie-break.
  type CandidateSource =
    | {
        kind: "drop";
        flow: number;
        originalIndex: number;
        ref: (typeof dropEdgeRefs)[number];
      }
    | {
        kind: "buy";
        flow: number;
        originalIndex: number;
        ref: (typeof buyEdgeRefs)[number];
      };

  const candidatesPerNeed = new Map<string, CandidateSource[]>();
  for (let i = 0; i < dropEdgeRefs.length; i += 1) {
    const ref = dropEdgeRefs[i];
    if (!ref) continue;
    const flow = mcmf.flowOf(ref.edgeId);
    if (flow <= 0) continue;
    const key = `${ref.playerId}|${ref.slot}`;
    const list = candidatesPerNeed.get(key) ?? [];
    list.push({ kind: "drop", flow, originalIndex: i, ref });
    candidatesPerNeed.set(key, list);
  }
  for (let i = 0; i < buyEdgeRefs.length; i += 1) {
    const ref = buyEdgeRefs[i];
    if (!ref) continue;
    const flow = mcmf.flowOf(ref.edgeId);
    if (flow <= 0) continue;
    const key = `${ref.playerId}|${ref.slot}`;
    const list = candidatesPerNeed.get(key) ?? [];
    list.push({
      kind: "buy",
      flow,
      // Offset by drop count so dropEdgeRefs come first in tie-
      // breaks (drops are preferred over buys for any given need).
      originalIndex: dropEdgeRefs.length + i,
      ref,
    });
    candidatesPerNeed.set(key, list);
  }

  const drops: PlannedDrop[] = [];
  const buys: PlannedBuy[] = [];
  const filledDropKeys = new Set<string>();

  for (const candidates of candidatesPerNeed.values()) {
    candidates.sort((a, b) => {
      if (a.flow !== b.flow) return b.flow - a.flow; // higher flow wins
      // Drops outrank buys in a tie (drops were enumerated first;
      // their originalIndex is < buyEdgeRefs offset).
      return a.originalIndex - b.originalIndex;
    });
    const winner = candidates[0];
    if (!winner) continue;
    if (winner.kind === "drop") {
      const ref = winner.ref;
      const player = players.find((p) => p.id === ref.playerId);
      if (!player) continue;
      drops.push({
        week: ref.week,
        itemKey: ref.itemKey,
        recipientId: ref.playerId,
        recipientName: player.name,
        slot: ref.slot,
        source: ref.source,
      });
      filledDropKeys.add(`${ref.week}|${ref.itemKey}`);
    } else {
      const ref = winner.ref;
      const player = players.find((p) => p.id === ref.playerId);
      if (!player) continue;
      buys.push({
        playerId: ref.playerId,
        playerName: player.name,
        itemKey: ref.itemKey,
        slot: ref.slot,
        completionWeek: ref.completionWeek,
        pagesUsed: ref.pagesUsed,
        source: ref.source,
      });
    }
  }

  const unassignedDrops: UnassignedDrop[] = [];
  for (const week of weekNumbers) {
    for (const itemKey of floor.itemKeys) {
      const meta = itemMeta.get(itemKey);
      if (!meta) {
        unassignedDrops.push({ week, itemKey });
        continue;
      }
      if (!filledDropKeys.has(`${week}|${itemKey}`)) {
        unassignedDrops.push({ week, itemKey });
      }
    }
  }

  drops.sort((a, b) => {
    if (a.week !== b.week) return a.week - b.week;
    const ai = floor.itemKeys.indexOf(a.itemKey);
    const bi = floor.itemKeys.indexOf(b.itemKey);
    if (ai !== bi) return ai - bi;
    return SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);
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
