import type { GearRole } from "@/lib/ffxiv/jobs";
import type { BisSource, ItemKey, Slot } from "@/lib/ffxiv/slots";

import {
  type PlayerSnapshot,
  slotsForItem,
  sourceForItem,
  type TierSnapshot,
} from "./algorithm";

/**
 * Greedy bottleneck-aware loot planner (v4.3).
 *
 * Replaces the v3.x min-cost-flow planner with a deterministic
 * week-by-week simulator. Three structural design points:
 *
 *   1. **Bottleneck per boss is computed once at plan start** as
 *      the item with the highest roster-wide open need on that
 *      floor, and held constant for the entire run. Stable,
 *      explainable plans: "boss 1's bottleneck is and stays Ring".
 *
 *   2. **Two distinct score functions** for drop allocation —
 *      one for the bottleneck item, one for the rest:
 *
 *        bottleneck_score(p)     = open_count_for_item(p) * 100
 *                                 + initial_need_at_floor(p)
 *        nonbottleneck_score(p)  = -K_COUNTER * tier_drop_count(p)
 *
 *      The `open_count_for_item * 100` term decays as the player
 *      gets served — a 3-Glaze player scores 300 in W1, 200 after
 *      winning W1's Glaze, 100 in W3 — producing the diagonal
 *      distribution operators expect (no 3-in-a-row monopolies).
 *
 *      The additive `initial_need_at_floor` term acts as a tie-
 *      breaker for single-slot items (Earring/Necklace/Bracelet
 *      and the Ring slots in TT3 where Ring1+Ring2 are split
 *      Savage/TomeUp). Without it, a 4-need-at-Boss-1 player and
 *      a 2-need-at-Boss-1 player would tie at 100 on the Ring
 *      drop because both have a single open Ring-Savage slot;
 *      with it, the higher-need player wins (140 vs 120). The
 *      term is small enough that openCount differences (× 100)
 *      always dominate, preserving the diagonal property.
 *
 *      Non-bottleneck drops are pure-fairness-driven by the tier
 *      counter. Need-count is irrelevant; the player with the
 *      lowest counter wins, ties broken by iteration order.
 *
 *   3. **Drop counter is persistent and tracked in
 *      `tier_player_stats.drop_count`.** It increments only
 *      on `paid_with_pages = false` rows, i.e. real drops, not
 *      buys. Buys are paid for with the player's own pages and
 *      don't count as a fairness-relevant gift from the boss.
 *      Bottleneck-drop winners DO get their counter incremented;
 *      the asymmetry ("influences counter, not influenced by it")
 *      is what makes cross-floor fairness work for top-need
 *      players who win scarce-resource items.
 *
 *   4. **Item iteration order: sorted by roster need
 *      descending.** The bottleneck item naturally lands first
 *      every week (highest need by definition); ties among
 *      non-bottleneck items fall back to `floor.itemKeys` order
 *      for determinism.
 *
 *   5. **No fixed `weeksAhead` horizon.** The simulation runs
 *      until every player has zero open slots, or a 50-week
 *      safety cap fires. The Plan-tab UI shows up to the last
 *      week any drop or buy lands.
 *
 *   6. **Buy schedule uses the same priority rules**: bottleneck
 *      first if the player still needs it, otherwise the next
 *      highest-roster-need item the player still needs.
 *
 *   7. **Each drop carries a `bossKillIndex`** — 1-based count
 *      of "this is the Nth time this boss is being scheduled".
 *      The Track tab uses this to map the operator's actual
 *      kill order onto the plan's recommendations: if Boss 2 was
 *      skipped in W1 and first killed in W2, Track shows the
 *      plan's Boss-2-kill-1 recommendation in W2, not the
 *      kill-2 one. See track-view.tsx for the lookup logic.
 *
 * The output shape (`FloorPlan[]`) is deliberately the same as
 * the v3 floor-planner so the existing UI components don't need
 * any changes.
 */

/** A drop assignment in the plan. */
export interface PlannedDrop {
  /** Week number (matches `raid_week.week_number`, not horizon-relative). */
  week: number;
  /**
   * 1-based ordinal of the boss-kill this drop belongs to: 1 =
   * the first time the boss appears in the plan, 2 = the second,
   * etc. Track-tab uses this to map the operator's actual
   * boss-kill order onto plan recommendations (skipped weeks
   * don't shift the index).
   */
  bossKillIndex: number;
  itemKey: ItemKey;
  recipientId: number;
  recipientName: string;
  slot: Slot;
  source: BisSource;
}

/** A page-buy in the plan. */
export interface PlannedBuy {
  playerId: number;
  playerName: string;
  itemKey: ItemKey;
  slot: Slot;
  completionWeek: number;
  pagesUsed: number;
  source: BisSource;
}

/** A drop the simulator couldn't place (no remaining wanter). */
export interface UnassignedDrop {
  week: number;
  /** See {@link PlannedDrop.bossKillIndex}. */
  bossKillIndex: number;
  itemKey: ItemKey;
}

/** Per-floor view of the plan, suitable for the UI grid. */
export interface FloorPlan {
  floorNumber: number;
  itemKeys: ItemKey[];
  tracked: boolean;
  drops: PlannedDrop[];
  unassignedDrops: UnassignedDrop[];
  buys: PlannedBuy[];
  /** All week numbers the plan touches, ascending. */
  weekNumbers: number[];
}

export interface FloorMeta {
  floorNumber: number;
  itemKeys: ItemKey[];
  /**
   * Whether this floor participates in the algorithm. Untracked
   * floors are echoed back as `unassignedDrops` only — useful for
   * extreme-mode farming where the operator handles loot manually.
   */
  trackedForAlgorithm: boolean;
}

export interface GreedyPlanOptions {
  /**
   * Week number to label the first simulated week. Usually the
   * current raid week's number; the simulator increments from
   * here so the displayed weeks line up with what Track shows.
   */
  startingWeekNumber: number;
  /**
   * Floors whose first-week kill is already counted in the input
   * snapshots' page balances. The simulator skips its own +1
   * page step on those floors at week == startingWeekNumber so
   * the plan matches the live page view.
   */
  alreadyKilledFloors: ReadonlySet<number>;
  /**
   * Maximum number of weeks the simulator will run before
   * giving up. Defaults to 50 — generous for any realistic
   * tier, low enough to bail on roster configurations whose
   * needs can't actually be satisfied (e.g. a player whose BiS
   * target is for a slot no item drops at).
   */
  safetyCap?: number;
}

const SAFETY_CAP_DEFAULT = 50;

/**
 * Penalty per drop in the non-bottleneck score. Each drop a
 * player has received reduces their score for the next
 * non-bottleneck drop by this amount. With K=50 a one-drop
 * difference is enough to flip the winner among otherwise tied
 * candidates; a four-drop difference effectively excludes a
 * player until others have caught up.
 */
const K_COUNTER = 50;

/**
 * Mutable per-player state during the simulation. Built from a
 * `PlayerSnapshot` once and then mutated as drops/buys land.
 */
interface PlayerState {
  id: number;
  name: string;
  gearRole: GearRole;
  desired: Map<Slot, BisSource>;
  /** Mutated as drops/buys complete slots. */
  current: Map<Slot, BisSource>;
  /** Map of floor-number → page balance, mutated. */
  pages: Map<number, number>;
  /**
   * Drop counter for the v4.1 fairness mechanism. Increments on
   * every drop (NOT buy) the player receives during the
   * simulation. Initialised from `PlayerSnapshot.savageDropsThisTier`,
   * which itself is loaded from `tier_player_stats.drop_count`
   * by the snapshot loader.
   */
  dropCount: number;
  /**
   * Initial Savage-need slot count per floor at plan-start.
   * Computed once from `bisDesired` ∩ `bisCurrent` and never
   * mutated. Acts as a tie-breaker in the v4.3 bottleneck score
   * for single-slot items (Ring/Earring/Necklace/Bracelet)
   * where every candidate has the same `openCountForItem`. The
   * 4-need-at-Boss-1 player wins the Ring before the 2-need
   * player even though both have a single open Ring slot.
   */
  initialNeedByFloor: Map<number, number>;
}

function initPlayerState(
  s: PlayerSnapshot,
  floors: ReadonlyArray<FloorMeta>,
): PlayerState {
  const initialNeedByFloor = new Map<number, number>();
  for (const floor of floors) {
    if (!floor.trackedForAlgorithm) {
      initialNeedByFloor.set(floor.floorNumber, 0);
      continue;
    }
    let count = 0;
    for (const item of floor.itemKeys) {
      const itemSource = sourceForItem(item);
      for (const slot of slotsForItem(item)) {
        const desired = s.bisDesired.get(slot);
        if (!desired || desired === "NotPlanned") continue;
        if (desired !== itemSource) continue;
        const current = s.bisCurrent.get(slot);
        if (current === desired) continue;
        count += 1;
      }
    }
    initialNeedByFloor.set(floor.floorNumber, count);
  }
  return {
    id: s.id,
    name: s.name,
    gearRole: s.gearRole,
    desired: new Map(s.bisDesired),
    current: new Map(s.bisCurrent),
    pages: new Map(s.pages),
    dropCount: s.savageDropsThisTier,
    initialNeedByFloor,
  };
}

/**
 * Does this player still have an open slot that the given item
 * can fill?
 */
function hasOpenSlotForItem(state: PlayerState, item: ItemKey): boolean {
  return pickSlotForItem(state, item) !== null;
}

/**
 * Walk the item's candidate slots in canonical order and return
 * the first one this player still has open. Returns null if none.
 */
function pickSlotForItem(state: PlayerState, item: ItemKey): Slot | null {
  const itemSource = sourceForItem(item);
  for (const slot of slotsForItem(item)) {
    const desired = state.desired.get(slot);
    if (!desired || desired === "NotPlanned") continue;
    if (desired !== itemSource) continue;
    const current = state.current.get(slot);
    if (current === desired) continue;
    return slot;
  }
  return null;
}

/** Open slots at this floor right now (decreases as drops land). */
function openSlotsAtFloor(state: PlayerState, floor: FloorMeta): number {
  let count = 0;
  for (const item of floor.itemKeys) {
    count += openCountForItem(state, item);
  }
  return count;
}

/**
 * How many slots the given item can still fill for this player.
 * Drives the v4.2 bottleneck score: a player with 3 open Glaze
 * slots scores 300, dropping to 200 / 100 / 0 as they get served.
 */
function openCountForItem(state: PlayerState, item: ItemKey): number {
  const itemSource = sourceForItem(item);
  let count = 0;
  for (const slot of slotsForItem(item)) {
    const desired = state.desired.get(slot);
    if (!desired || desired === "NotPlanned") continue;
    if (desired !== itemSource) continue;
    const current = state.current.get(slot);
    if (current === desired) continue;
    count += 1;
  }
  return count;
}

/**
 * Roster-wide count of open slots a given item can fill. Used
 * by the bottleneck calculation, by the buy-item picker, and to
 * sort the per-week item iteration order.
 */
function totalRosterOpenForItem(
  states: ReadonlyArray<PlayerState>,
  item: ItemKey,
): number {
  let count = 0;
  for (const s of states) {
    for (const slot of slotsForItem(item)) {
      const desired = s.desired.get(slot);
      if (!desired || desired === "NotPlanned") continue;
      if (desired !== sourceForItem(item)) continue;
      const current = s.current.get(slot);
      if (current === desired) continue;
      count += 1;
    }
  }
  return count;
}

/**
 * Bottleneck for a floor = the item the roster needs the most.
 * Computed once at plan start, held constant for the run.
 */
function computeBottleneckForFloor(
  floor: FloorMeta,
  states: ReadonlyArray<PlayerState>,
): ItemKey | null {
  if (!floor.trackedForAlgorithm) return null;
  let best: { item: ItemKey; need: number } | null = null;
  for (const item of floor.itemKeys) {
    const need = totalRosterOpenForItem(states, item);
    if (need <= 0) continue;
    if (!best || need > best.need) best = { item, need };
  }
  return best?.item ?? null;
}

/**
 * Drop-recipient score. Two regimes:
 *
 *   - **Bottleneck item**: open count for THIS specific item,
 *     times 100, plus the player's initial Savage-need-at-floor
 *     as a tie-breaker. The product `openCount * 100` drives the
 *     diagonal distribution (a 3-Glaze player decays from 300 to
 *     200 to 100 as they get served), and the additive
 *     `initialNeedAtFloor` term breaks the tie for single-slot
 *     items where every candidate has the same `openCount`. A
 *     4-need-at-Boss-1 player wins the Ring drop over a 2-need
 *     player even though both have one open Ring slot.
 *
 *   - **Non-bottleneck item**: pure tier-counter penalty.
 *     `score = -K_COUNTER * drop_count(p)`. Need-count is
 *     irrelevant; the only role of need is the candidate filter.
 */
function dropScore(
  state: PlayerState,
  item: ItemKey,
  isBottleneck: boolean,
  floor: FloorMeta,
): number {
  if (isBottleneck) {
    const open = openCountForItem(state, item);
    const initial = state.initialNeedByFloor.get(floor.floorNumber) ?? 0;
    return open * 100 + initial;
  }
  return -K_COUNTER * state.dropCount;
}

/**
 * Pick which player receives a given drop. Returns null when
 * nobody at the table needs the item.
 */
function pickDropWinner(
  item: ItemKey,
  bottleneck: ItemKey | null,
  floor: FloorMeta,
  states: ReadonlyArray<PlayerState>,
): PlayerState | null {
  const isBottleneck = bottleneck === item;
  let best: PlayerState | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const state of states) {
    if (!hasOpenSlotForItem(state, item)) continue;
    const score = dropScore(state, item, isBottleneck, floor);
    if (score > bestScore) {
      best = state;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Pick which item a player should buy at this floor right now.
 *
 *   Priority 1: the bottleneck item, if the player still needs it.
 *   Priority 2: the item with the highest current roster-wide
 *               open need that the player still needs.
 */
function pickBuyItem(
  state: PlayerState,
  floor: FloorMeta,
  bottleneck: ItemKey | null,
  states: ReadonlyArray<PlayerState>,
): ItemKey | null {
  const candidates: ItemKey[] = [];
  for (const item of floor.itemKeys) {
    if (hasOpenSlotForItem(state, item)) candidates.push(item);
  }
  if (candidates.length === 0) return null;
  if (bottleneck && candidates.includes(bottleneck)) return bottleneck;
  let best: { item: ItemKey; need: number } | null = null;
  for (const item of candidates) {
    const need = totalRosterOpenForItem(states, item);
    if (!best || need > best.need) best = { item, need };
  }
  return best?.item ?? candidates[0] ?? null;
}

/**
 * Run the planner.
 */
export function computeGreedyPlan(
  floors: ReadonlyArray<FloorMeta>,
  snapshots: ReadonlyArray<PlayerSnapshot>,
  tier: TierSnapshot,
  options: GreedyPlanOptions,
): FloorPlan[] {
  const states = snapshots.map((s) => initPlayerState(s, floors));
  const safetyCap = options.safetyCap ?? SAFETY_CAP_DEFAULT;

  // Bottleneck per tracked floor — computed once on the initial
  // need profile, held constant for the entire simulation.
  const bottleneckByFloor = new Map<number, ItemKey | null>();
  for (const floor of floors) {
    bottleneckByFloor.set(
      floor.floorNumber,
      computeBottleneckForFloor(floor, states),
    );
  }

  const allDrops: Array<PlannedDrop & { floorNumber: number }> = [];
  const allBuys: Array<PlannedBuy & { floorNumber: number }> = [];
  const allUnassigned: Array<UnassignedDrop & { floorNumber: number }> = [];

  let weekIdx = 0;
  // Per-floor "Nth scheduled kill" counter. Increments every
  // simulation iteration where this floor produces drops (or
  // unassigned slots). Drops carry this index so the Track tab
  // can reconstruct the operator's actual kill order.
  const bossKillIndexByFloor = new Map<number, number>();
  while (anyPlayerStillOpen(states, floors) && weekIdx < safetyCap) {
    weekIdx += 1;
    const weekNumber = options.startingWeekNumber + weekIdx - 1;

    for (const floor of floors) {
      const bossKillIndex =
        (bossKillIndexByFloor.get(floor.floorNumber) ?? 0) + 1;
      bossKillIndexByFloor.set(floor.floorNumber, bossKillIndex);
      // ───────────────── Drop phase ─────────────────
      if (!floor.trackedForAlgorithm) {
        for (const item of floor.itemKeys) {
          allUnassigned.push({
            floorNumber: floor.floorNumber,
            week: weekNumber,
            bossKillIndex,
            itemKey: item,
          });
        }
      } else {
        const bottleneck = bottleneckByFloor.get(floor.floorNumber) ?? null;
        // Iterate items in roster-need order (descending). Stable
        // sort preserves the floor.itemKeys order on ties.
        const itemsInOrder = [...floor.itemKeys]
          .map((item, idx) => ({
            item,
            idx,
            need: totalRosterOpenForItem(states, item),
          }))
          .sort((a, b) => {
            const diff = b.need - a.need;
            return diff !== 0 ? diff : a.idx - b.idx;
          })
          .map(({ item }) => item);

        for (const item of itemsInOrder) {
          const winner = pickDropWinner(item, bottleneck, floor, states);
          if (!winner) {
            allUnassigned.push({
              floorNumber: floor.floorNumber,
              week: weekNumber,
              bossKillIndex,
              itemKey: item,
            });
            continue;
          }
          const slot = pickSlotForItem(winner, item);
          if (!slot) {
            allUnassigned.push({
              floorNumber: floor.floorNumber,
              week: weekNumber,
              bossKillIndex,
              itemKey: item,
            });
            continue;
          }
          winner.current.set(slot, sourceForItem(item));
          // Drop counter increments on every drop, including
          // bottleneck drops — see schema.ts and the v4.1 design
          // note above. Cross-floor fairness depends on this.
          winner.dropCount += 1;
          allDrops.push({
            floorNumber: floor.floorNumber,
            week: weekNumber,
            bossKillIndex,
            itemKey: item,
            recipientId: winner.id,
            recipientName: winner.name,
            slot,
            source: sourceForItem(item),
          });
        }
      }

      // ───────────────── Page accrual ─────────────────
      const skipFirstWeekKill =
        weekIdx === 1 && options.alreadyKilledFloors.has(floor.floorNumber);
      if (!skipFirstWeekKill && floor.trackedForAlgorithm) {
        for (const state of states) {
          state.pages.set(
            floor.floorNumber,
            (state.pages.get(floor.floorNumber) ?? 0) + 1,
          );
        }
      }

      // ───────────────── Buy phase ─────────────────
      if (!floor.trackedForAlgorithm) continue;
      const bottleneck = bottleneckByFloor.get(floor.floorNumber) ?? null;

      // Sort players by descending open-slot count at this floor —
      // whoever benefits most from a buy goes first. Ties are
      // broken by id for determinism.
      const sortedStates = [...states].sort((a, b) => {
        const diff = openSlotsAtFloor(b, floor) - openSlotsAtFloor(a, floor);
        return diff !== 0 ? diff : a.id - b.id;
      });
      for (const state of sortedStates) {
        let safety = 0;
        while (safety < 12) {
          safety += 1;
          const item = pickBuyItem(state, floor, bottleneck, states);
          if (!item) break;
          const cost = tier.buyCostByItem.get(item)?.cost;
          if (cost === undefined) break;
          const balance = state.pages.get(floor.floorNumber) ?? 0;
          if (balance < cost) break;
          const slot = pickSlotForItem(state, item);
          if (!slot) break;
          state.pages.set(floor.floorNumber, balance - cost);
          state.current.set(slot, sourceForItem(item));
          // Buys do NOT increment the drop counter — the v4.1
          // counter only tracks free drops, not page-paid buys.
          allBuys.push({
            floorNumber: floor.floorNumber,
            playerId: state.id,
            playerName: state.name,
            itemKey: item,
            slot,
            completionWeek: weekNumber,
            pagesUsed: cost,
            source: sourceForItem(item),
          });
        }
      }
    }
  }

  // Compute the displayed week range: from the starting week to
  // the last week any drop or buy landed, or `startingWeekNumber`
  // if the plan is empty (no needs).
  let lastWeek = options.startingWeekNumber;
  for (const d of allDrops) if (d.week > lastWeek) lastWeek = d.week;
  for (const b of allBuys)
    if (b.completionWeek > lastWeek) lastWeek = b.completionWeek;
  for (const u of allUnassigned) if (u.week > lastWeek) lastWeek = u.week;
  const weekNumbers: number[] = [];
  for (let w = options.startingWeekNumber; w <= lastWeek; w += 1) {
    weekNumbers.push(w);
  }

  return floors.map((floor) => {
    const floorDrops = allDrops
      .filter((d) => d.floorNumber === floor.floorNumber)
      .map(({ floorNumber: _floorNumber, ...rest }) => rest);
    const floorBuys = allBuys
      .filter((b) => b.floorNumber === floor.floorNumber)
      .map(({ floorNumber: _floorNumber, ...rest }) => rest);
    const floorUnassigned = allUnassigned
      .filter((u) => u.floorNumber === floor.floorNumber)
      .map(({ floorNumber: _floorNumber, ...rest }) => rest);
    return {
      floorNumber: floor.floorNumber,
      itemKeys: [...floor.itemKeys],
      tracked: floor.trackedForAlgorithm,
      drops: floorDrops,
      unassignedDrops: floorUnassigned,
      buys: floorBuys,
      weekNumbers,
    };
  });
}

function anyPlayerStillOpen(
  states: ReadonlyArray<PlayerState>,
  floors: ReadonlyArray<FloorMeta>,
): boolean {
  for (const state of states) {
    for (const floor of floors) {
      if (!floor.trackedForAlgorithm) continue;
      if (openSlotsAtFloor(state, floor) > 0) return true;
    }
  }
  return false;
}
