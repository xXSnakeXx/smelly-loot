import type { ItemKey, Slot } from "@/lib/ffxiv/slots";
import {
  type GearItemKey,
  type MaterialKey,
  type PlayerScore,
  type PlayerSnapshot,
  SLOTS_BY_ITEM_KEY,
  scoreDrop,
  type TierSnapshot,
} from "./algorithm";

/**
 * Forward-planning loot simulator.
 *
 * Where `scoreDrop` answers "who *should* get this drop right now?",
 * `simulateLootTimeline` answers "if every weekly drop went to the
 * algorithm's top pick, who would end up with what across the next
 * N weeks?" — the same sort of look-ahead the spreadsheet's loot tab
 * does manually.
 *
 * The simulator runs a clone of the snapshot list through a virtual
 * timeline:
 *
 *   for each future week:
 *     for each tracked floor in tier order:
 *       1. every player gets +1 page of that floor's token (the kill)
 *       2. for each item dropping from that floor:
 *          a. score the snapshot
 *          b. award the top scorer
 *          c. update their snapshot (pages, drop count, BiS, …)
 *
 * The function is pure: it never touches the live database. The UI is
 * expected to call it with the same `loadPlayerSnapshots` /
 * `loadTierSnapshot` output it uses for the live `/loot` page, so the
 * timeline reflects the current real state.
 *
 * "Real" decisions feed back automatically: as soon as a `loot_drop`
 * row is recorded in `/loot`'s Track view, `loadPlayerSnapshots`
 * picks it up and the next render of the Plan view recomputes
 * accordingly.
 */

export interface TimelineDrop {
  itemKey: ItemKey;
  floorNumber: number;
  recipientId: number | null;
  recipientName: string | null;
  score: number;
}

export interface TimelineWeek {
  weekNumber: number;
  drops: TimelineDrop[];
}

export interface TimelineForFloor {
  floorNumber: number;
  itemKeys: ItemKey[];
  tracked: boolean;
  weeks: TimelineWeek[];
}

export interface SimulateOptions {
  /**
   * The week number the simulator starts at.
   *
   * For the Plan tab this is the active week — `currentWeek` from
   * `findCurrentWeek` — *not* `currentWeek + 1`. Combined with
   * `alreadyKilledFloors` below, that makes the first iteration
   * score against the same snapshot Track's `scoreDrop` does, so
   * the Plan and Track tabs stay in sync for the active week's
   * drops.
   */
  startingWeekNumber: number;
  weeksAhead: number;
  /**
   * Floors whose active-week kill is already reflected in the
   * input snapshot's `pages` map (because the live database has
   * recorded the `boss_kill` row). The simulator skips its own
   * `+1 page` step for these floors on the first iteration only —
   * incrementing again would double-count the kill and inflate
   * `buyPower` past Track's view of the same data.
   *
   * Defaults to an empty list so existing call sites and tests keep
   * the pre-v1.5.0 "increment every week" semantics.
   */
  alreadyKilledFloors?: ReadonlyArray<number>;
  floors: ReadonlyArray<{
    floorNumber: number;
    itemKeys: ItemKey[];
    trackedForAlgorithm: boolean;
  }>;
}

const MATERIAL_KEYS: ReadonlySet<MaterialKey> = new Set([
  "Glaze",
  "Twine",
  "Ester",
]);

/**
 * Run the simulator and return one row per tracked floor with the
 * weekly drop assignments.
 */
export function simulateLootTimeline(
  initialSnapshots: ReadonlyArray<PlayerSnapshot>,
  tier: TierSnapshot,
  options: SimulateOptions,
): TimelineForFloor[] {
  // Deep-clone the snapshot list so the caller's data isn't mutated.
  let snapshots = initialSnapshots.map(cloneSnapshot);

  const result: TimelineForFloor[] = options.floors.map((f) => ({
    floorNumber: f.floorNumber,
    itemKeys: f.itemKeys,
    tracked: f.trackedForAlgorithm,
    weeks: [],
  }));

  const resultByFloor = new Map(result.map((r) => [r.floorNumber, r]));

  // Floors whose active-week kill is already counted in the input
  // snapshot — the simulator should NOT add another page for them on
  // the first iteration. Stored as a Set for O(1) lookup.
  const alreadyKilledOnFirstWeek = new Set<number>(
    options.alreadyKilledFloors ?? [],
  );

  for (let i = 0; i < options.weeksAhead; i += 1) {
    const weekNumber = options.startingWeekNumber + i;

    for (const floor of options.floors) {
      // Boss kill: every player gets +1 page of this floor's token.
      // For the first iteration we skip floors the caller flagged as
      // already-killed so the snapshot the simulator scores matches
      // the snapshot Track's `scoreDrop` scores for the same data.
      // From the second iteration onward there's no ambiguity — the
      // kill is purely simulated and we always increment.
      const skipIncrement =
        i === 0 && alreadyKilledOnFirstWeek.has(floor.floorNumber);
      if (!skipIncrement) {
        snapshots = snapshots.map((s) => incrementPages(s, floor.floorNumber));
      }

      const weekDrops: TimelineDrop[] = [];
      if (floor.trackedForAlgorithm) {
        for (const itemKey of floor.itemKeys) {
          const ranked = scoreDrop(snapshots, {
            itemKey,
            floorNumber: floor.floorNumber,
            currentWeek: weekNumber,
            tier,
          });
          const top = ranked[0];
          if (top !== undefined && top.score > 0) {
            weekDrops.push({
              itemKey,
              floorNumber: floor.floorNumber,
              recipientId: top.player.id,
              recipientName: top.player.name,
              score: top.score,
            });
            snapshots = snapshots.map((s) =>
              s.id === top.player.id
                ? applyAward(s, itemKey, floor.floorNumber, weekNumber, ranked)
                : s,
            );
          } else {
            weekDrops.push({
              itemKey,
              floorNumber: floor.floorNumber,
              recipientId: null,
              recipientName: null,
              score: 0,
            });
          }
        }
      } else {
        // Floor 4 (or any tracked_for_algorithm = false floor): list
        // the drops without picking a recipient. The Track tab still
        // logs them manually.
        for (const itemKey of floor.itemKeys) {
          weekDrops.push({
            itemKey,
            floorNumber: floor.floorNumber,
            recipientId: null,
            recipientName: null,
            score: 0,
          });
        }
      }

      const floorResult = resultByFloor.get(floor.floorNumber);
      if (floorResult) {
        floorResult.weeks.push({ weekNumber, drops: weekDrops });
      }
    }
  }

  return result;
}

/**
 * Deep-clone a snapshot so the simulator can mutate freely without
 * leaking changes back to the caller.
 */
function cloneSnapshot(s: PlayerSnapshot): PlayerSnapshot {
  return {
    ...s,
    bisDesired: new Map(s.bisDesired),
    bisCurrent: new Map(s.bisCurrent),
    pages: new Map(s.pages),
    materialsReceived: new Map(s.materialsReceived),
    lastDropWeekByFloor: new Map(s.lastDropWeekByFloor),
  };
}

/** Increment a player's page balance for a given floor by 1. */
function incrementPages(
  s: PlayerSnapshot,
  floorNumber: number,
): PlayerSnapshot {
  const pages = new Map(s.pages);
  pages.set(floorNumber, (pages.get(floorNumber) ?? 0) + 1);
  return { ...s, pages };
}

/**
 * Update the player's snapshot to reflect them having received the
 * given drop:
 *
 *  - If the drop is gear, mark the highest-priority slot's
 *    `bisCurrent` as the drop source and bump the Savage-drop count.
 *  - If the drop is a material, increment the material counter.
 *  - Always update `lastDropWeekByFloor` so the recency penalty
 *    kicks in.
 *
 * `_ranked` is accepted but unused for now; we may use it in the
 * future to record the score snapshot per simulated drop.
 */
function applyAward(
  s: PlayerSnapshot,
  itemKey: ItemKey,
  floorNumber: number,
  weekNumber: number,
  _ranked: PlayerScore[],
): PlayerSnapshot {
  const isMaterial = MATERIAL_KEYS.has(itemKey as MaterialKey);

  const bisCurrent = new Map(s.bisCurrent);
  let savageDelta = 0;
  if (!isMaterial) {
    const slotsForItem = SLOTS_BY_ITEM_KEY[itemKey as GearItemKey];
    // Pick the first slot the player wants from the drop's source
    // and currently doesn't already wear at that source.
    const dropSource = "Savage" as const;
    for (const slot of slotsForItem) {
      const desired = bisCurrent.get(slot as Slot);
      const targets = s.bisDesired.get(slot as Slot);
      if (targets === dropSource && desired !== dropSource) {
        bisCurrent.set(slot as Slot, dropSource);
        savageDelta = 1;
        break;
      }
    }
  }

  const materialsReceived = new Map(s.materialsReceived);
  if (isMaterial) {
    const key = itemKey as MaterialKey;
    materialsReceived.set(key, (materialsReceived.get(key) ?? 0) + 1);
  }

  const lastDropWeekByFloor = new Map(s.lastDropWeekByFloor);
  lastDropWeekByFloor.set(floorNumber, weekNumber);

  return {
    ...s,
    bisCurrent,
    materialsReceived,
    savageDropsThisTier: s.savageDropsThisTier + savageDelta,
    lastDropWeekByFloor,
  };
}
