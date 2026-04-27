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
 * Up to v2.5 this file held the per-drop scoring engine. v3.0
 * replaced that with the min-cost-flow planner in `floor-planner.ts`.
 * v4.0 replaces *that* with the bottleneck-aware greedy planner
 * in `greedy-planner.ts` — see its file header for the design
 * rationale. Both replacements were drop-ins for the consumer
 * (the Plan / Track tabs) thanks to the stable shape of the
 * snapshot types declared below.
 *
 * What lives here are the type surface — `PlayerSnapshot`,
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

/**
 * Slots upgraded to TomeUp when a given material is consumed.
 *
 * In FF XIV's loot economy each TomeUp slot needs exactly one
 * matching material item (Glaze for accessories, Twine for
 * clothing, Ester for weapons) plus the base Tome equipment
 * (which is bought outside the raid loop with weekly
 * tomestones — not modelled here). The planner treats one
 * material as one fulfilment of any compatible TomeUp need.
 */
export const SLOTS_BY_MATERIAL = {
  Glaze: ["Earring", "Necklace", "Bracelet", "Ring1", "Ring2"],
  Twine: ["Head", "Chestpiece", "Gloves", "Pants", "Boots"],
  Ester: ["Weapon", "Offhand"],
} as const satisfies Record<MaterialKey, readonly Slot[]>;

/** Item keys that map to gear slots. The remaining keys are materials. */
export type GearItemKey = Exclude<ItemKey, "Glaze" | "Twine" | "Ester">;
export type MaterialKey = Extract<ItemKey, "Glaze" | "Twine" | "Ester">;

/**
 * Type guard: does this item key refer to a TomeUp upgrade
 * material rather than a gear piece?
 */
export function isMaterial(itemKey: ItemKey): itemKey is MaterialKey {
  return itemKey === "Glaze" || itemKey === "Twine" || itemKey === "Ester";
}

/**
 * Slots filled by an item — gear items return their gear slots,
 * material items return the slots they upgrade to TomeUp.
 */
export function slotsForItem(itemKey: ItemKey): readonly Slot[] {
  if (isMaterial(itemKey)) {
    return SLOTS_BY_MATERIAL[itemKey];
  }
  return SLOTS_BY_ITEM_KEY[itemKey as GearItemKey];
}

/**
 * The BiS source an item fills. Gear items deliver the Savage
 * source; material items deliver the TomeUp source.
 */
export function sourceForItem(itemKey: ItemKey): BisSource {
  return isMaterial(itemKey) ? "TomeUp" : "Savage";
}

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
