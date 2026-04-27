import type { GearRole } from "@/lib/ffxiv/jobs";
import type { BisSource, ItemKey, Slot } from "@/lib/ffxiv/slots";

import {
  type PlayerSnapshot,
  slotsForItem,
  sourceForItem,
  type TierSnapshot,
} from "./algorithm";

/**
 * Greedy bottleneck-aware loot planner (v4.0).
 *
 * Replaces the v3.x min-cost-flow planner with a deterministic
 * week-by-week simulator. The change in design rationale, briefly:
 *
 *   - v3 modelled the whole horizon as a single optimisation
 *     problem and let an MCMF solver pick the assignment that
 *     minimised min-max time-to-BiS. That guaranteed mathematical
 *     optimality but produced schedules where one player could
 *     receive 4–5 drops in a single week (every floor's optimum
 *     pointed to the same player), which doesn't match how real
 *     statics distribute loot.
 *
 *   - v4 takes the operator's heuristic at face value: per boss
 *     there is a *bottleneck item* — the slot the roster needs
 *     the most. Page-buys are spent on the bottleneck (or, if a
 *     player already has it, on the next-most-needed item).
 *     Drops are awarded to the player with the highest open-slot
 *     count at the boss, with intra-week and intra-tier fairness
 *     penalties to spread the love.
 *
 * Two structural properties of the algorithm are worth pinning:
 *
 *   1. **Bottleneck is computed once per (boss) at the start of
 *      the simulation and held constant.** It does NOT recompute
 *      mid-week or mid-simulation. This makes the plan stable
 *      and explainable: "boss 1's bottleneck is and stays Ring".
 *
 *   2. **The simulation runs until every player has zero open
 *      slots, OR a safety cap is hit.** There's no fixed
 *      `weeksAhead` horizon — the algorithm tells you how many
 *      weeks the tier will take. The Plan-tab UI shows up to the
 *      last week any drop or buy lands.
 *
 * The output shape (`FloorPlan[]`) is deliberately the same as
 * the v3 floor-planner so the existing UI components don't need
 * any changes.
 */

/** A drop assignment in the plan. */
export interface PlannedDrop {
  /** Week number (matches `raid_week.week_number`, not horizon-relative). */
  week: number;
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
  /** Cumulative drops in this tier, used by the anti-streak penalty. */
  receivedThisTier: number;
}

function initPlayerState(s: PlayerSnapshot): PlayerState {
  return {
    id: s.id,
    name: s.name,
    gearRole: s.gearRole,
    desired: new Map(s.bisDesired),
    current: new Map(s.bisCurrent),
    pages: new Map(s.pages),
    receivedThisTier: s.savageDropsThisTier,
  };
}

/**
 * Does this player still have an open slot that the given item
 * can fill?
 *
 * "Open" means: the desired source for some slot the item covers
 * is set (not NotPlanned), the source matches the item's source
 * (Savage gear vs. TomeUp material), and the player hasn't
 * already filled that slot from any source.
 */
function hasOpenSlotForItem(state: PlayerState, item: ItemKey): boolean {
  return pickSlotForItem(state, item) !== null;
}

/**
 * Walk the item's candidate slots in canonical order and return
 * the first one this player still has open. Returns null if none.
 *
 * Canonical order matters for Ring (Ring1 before Ring2) and for
 * materials (Glaze fills Earring before Necklace, etc.) — keeps
 * recommendations stable across reruns.
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

/**
 * Count the player's open slots at this floor — the primary
 * input to both the drop-recipient score and the buy-priority
 * sort.
 */
function openSlotsAtFloor(state: PlayerState, floor: FloorMeta): number {
  let count = 0;
  for (const item of floor.itemKeys) {
    for (const slot of slotsForItem(item)) {
      const desired = state.desired.get(slot);
      if (!desired || desired === "NotPlanned") continue;
      if (desired !== sourceForItem(item)) continue;
      const current = state.current.get(slot);
      if (current === desired) continue;
      count += 1;
    }
  }
  return count;
}

/**
 * Roster-wide count of open slots a given item can fill. Used by
 * the bottleneck calculation and by the buy-item picker to
 * prefer items that are still scarce across the team.
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
 *
 * Computed once at the start of the simulation, BEFORE any
 * drops are applied, and held constant for the entire run. This
 * is the design point that makes the plan explainable: when the
 * operator asks "why is the algorithm pushing pages onto Ring
 * over Earring?", the answer is "because at the start of the
 * tier 8 players needed a Ring and only 5 needed an Earring".
 *
 * Returns null when no item at the floor has any roster need
 * (e.g. an extreme floor whose drops aren't part of anyone's
 * BiS), or when the floor is untracked.
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
 * Drop-recipient score. Higher = more deserving of this drop.
 *
 *   +100 per open slot at this floor          (need primary)
 *    -50 per drop the player got this week    (intra-week fairness)
 *     -5 per drop the player got this tier    (anti-streak)
 *
 * No bottleneck-bonus term. Drop allocation is intentionally
 * uniform across items at a floor — we want fairness, not
 * centralisation. The bottleneck only steers pages.
 */
function dropScore(
  state: PlayerState,
  floor: FloorMeta,
  receivedThisWeek: number,
): number {
  return (
    100 * openSlotsAtFloor(state, floor) -
    50 * receivedThisWeek -
    5 * state.receivedThisTier
  );
}

/**
 * Pick which player receives a given drop. Returns null when
 * nobody at the table needs the item.
 */
function pickDropWinner(
  item: ItemKey,
  floor: FloorMeta,
  states: ReadonlyArray<PlayerState>,
  receivedThisWeek: Map<number, number>,
): PlayerState | null {
  let best: PlayerState | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const state of states) {
    if (!hasOpenSlotForItem(state, item)) continue;
    const score = dropScore(state, floor, receivedThisWeek.get(state.id) ?? 0);
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
 *
 * Returns null when the player has no open slot at this floor
 * or when no candidate is affordable (caller checks pages).
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

  // Priority 1: bottleneck if the player needs it AND the roster
  // still needs it (the player's own contribution counts so this
  // is just `>= 1`).
  if (bottleneck && candidates.includes(bottleneck)) return bottleneck;

  // Priority 2: highest-current-need item the player needs.
  let best: { item: ItemKey; need: number } | null = null;
  for (const item of candidates) {
    const need = totalRosterOpenForItem(states, item);
    if (!best || need > best.need) best = { item, need };
  }
  return best?.item ?? candidates[0] ?? null;
}

/**
 * Run the planner.
 *
 * Iterates week by week, simulating boss kills + drop assignments
 * + page accrual + page-buys until every player has zero open
 * slots OR the safety cap is hit. Returns one `FloorPlan` per
 * floor for the UI.
 */
export function computeGreedyPlan(
  floors: ReadonlyArray<FloorMeta>,
  snapshots: ReadonlyArray<PlayerSnapshot>,
  tier: TierSnapshot,
  options: GreedyPlanOptions,
): FloorPlan[] {
  const states = snapshots.map(initPlayerState);
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

  // Per-floor result accumulators. Tagging with `floorNumber` lets
  // us interleave floor processing within a week and split back
  // out at the end.
  const allDrops: Array<PlannedDrop & { floorNumber: number }> = [];
  const allBuys: Array<PlannedBuy & { floorNumber: number }> = [];
  const allUnassigned: Array<UnassignedDrop & { floorNumber: number }> = [];

  let weekIdx = 0;
  while (anyPlayerStillOpen(states, floors) && weekIdx < safetyCap) {
    weekIdx += 1;
    const weekNumber = options.startingWeekNumber + weekIdx - 1;
    const receivedThisWeek = new Map<number, number>();

    for (const floor of floors) {
      // ───────────────── Drop phase ─────────────────
      if (!floor.trackedForAlgorithm) {
        for (const item of floor.itemKeys) {
          allUnassigned.push({
            floorNumber: floor.floorNumber,
            week: weekNumber,
            itemKey: item,
          });
        }
      } else {
        for (const item of floor.itemKeys) {
          const winner = pickDropWinner(item, floor, states, receivedThisWeek);
          if (!winner) {
            allUnassigned.push({
              floorNumber: floor.floorNumber,
              week: weekNumber,
              itemKey: item,
            });
            continue;
          }
          const slot = pickSlotForItem(winner, item);
          if (!slot) {
            // Defensive — pickDropWinner already filtered to
            // players with an open slot, but TS doesn't know.
            allUnassigned.push({
              floorNumber: floor.floorNumber,
              week: weekNumber,
              itemKey: item,
            });
            continue;
          }
          winner.current.set(slot, sourceForItem(item));
          winner.receivedThisTier += 1;
          receivedThisWeek.set(
            winner.id,
            (receivedThisWeek.get(winner.id) ?? 0) + 1,
          );
          allDrops.push({
            floorNumber: floor.floorNumber,
            week: weekNumber,
            itemKey: item,
            recipientId: winner.id,
            recipientName: winner.name,
            slot,
            source: sourceForItem(item),
          });
        }
      }

      // ───────────────── Page accrual ─────────────────
      // +1 page for everyone on this floor — except in the very
      // first simulated week, when the floor's kill is already
      // counted in the input snapshot (the operator killed the
      // boss before opening the Plan tab).
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
        // Inner safety cap: a single player can plausibly afford
        // multiple buys per week if they've banked pages, but we
        // cap at 12 (= the slot count) to bound any pathology.
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
          state.receivedThisTier += 1;
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
