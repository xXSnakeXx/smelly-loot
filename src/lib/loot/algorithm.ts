import type { GearRole } from "@/lib/ffxiv/jobs";
import type {
  BisSource,
  ItemKey,
  Slot,
  SourceIlvLookup,
} from "@/lib/ffxiv/slots";

/**
 * Loot-distribution shared types and item→slot mapping.
 *
 * Up to v2.5 this file also held the per-drop scoring engine
 * (`scoreDrop`, `scoreGear`, `scoreMaterial`, the page-aware
 * purchase simulator). v3.0 replaces all of that with the
 * min-cost-flow planner in `floor-planner.ts`, which solves a
 * single optimisation problem per floor instead of running a
 * score-then-greedy pass per item per week. The flow approach
 * removed every artefact of sequential awarding (Bracelet
 * spillover, in-week recency double-penalty, item-order
 * sensitivity) so the old scoring code is no longer reachable.
 *
 * What remains here is the type surface — `PlayerSnapshot`,
 * `TierSnapshot` — and the gear-item ↔ slot mapping every other
 * loot file imports. Pure data structures; no behaviour to test.
 */

/** Slots that compete for a given item drop. */
export const SLOTS_BY_ITEM_KEY = {
  Weapon: ["Weapon"],
  Offhand: ["Offhand"],
  Head: ["Head"],
  Chestpiece: ["Chestpiece"],
  Gloves: ["Gloves"],
  Pants: ["Pants"],
  Boots: ["Boots"],
  Earring: ["Earring"],
  Necklace: ["Necklace"],
  Bracelet: ["Bracelet"],
  Ring: ["Ring1", "Ring2"],
} as const satisfies Record<GearItemKey, readonly Slot[]>;

/** Item keys that map to gear slots. The remaining keys are materials. */
export type GearItemKey = Exclude<ItemKey, "Glaze" | "Twine" | "Ester">;
export type MaterialKey = Extract<ItemKey, "Glaze" | "Twine" | "Ester">;

/**
 * Snapshot of one player at scoring time. All collections are read
 * (the engine never mutates them).
 */
export interface PlayerSnapshot {
  id: number;
  name: string;
  gearRole: GearRole;
  /** Map of slot → desired BiS source. Slots not in the map default to NotPlanned. */
  bisDesired: Map<Slot, BisSource>;
  /** Map of slot → currently equipped source. Slots not in the map default to NotPlanned. */
  bisCurrent: Map<Slot, BisSource>;
  /** Map of floor number → page balance the player can spend on that floor's vendor. */
  pages: Map<number, number>;
  /** Materials already received: Map of material → count. */
  materialsReceived: Map<MaterialKey, number>;
  /** Total Savage gear drops the player has received this tier. Drives the fairness factor. */
  savageDropsThisTier: number;
  /**
   * Week number of the last drop the player got from each floor, or
   * `null` if they never got one. Used by the recency penalty.
   */
  lastDropWeekByFloor: Map<number, number | null>;
}

export interface TierSnapshot extends SourceIlvLookup {
  /**
   * Per-item buy cost lookup. Floor number is the token currency
   * (HW Edition I/II/III/IV in the Heavyweight tier).
   */
  buyCostByItem: Map<ItemKey, { floor: number; cost: number }>;
}
