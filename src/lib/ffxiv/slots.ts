/**
 * FF XIV gear-slot and BiS-source catalogue.
 *
 * Two enums live here:
 *
 * - `SLOTS` is the player-facing slot set. Each player has one row per
 *   slot in their BiS plan. `Ring1` and `Ring2` are listed separately
 *   so each ring slot gets its own desired source — but the drop
 *   itself is just "Ring" (one ring drops, the player picks left or
 *   right).
 *
 * - `BIS_SOURCES` mirrors the spreadsheet's full legend, including the
 *   in-jokes (Topic 5 decision: keep all 8 plus a `NotPlanned`
 *   sentinel). Each source resolves to an item level via the active
 *   tier's per-source iLv (see `src/lib/db/schema.ts`'s `tier` table).
 *
 * - `ITEM_KEYS` is the algorithm-facing item identifier used in
 *   `tier_buy_cost` lookups and `floor.drops`. It collapses Ring1/Ring2
 *   into a single `Ring` item.
 */

export const SLOTS = [
  "Weapon",
  "Offhand",
  "Head",
  "Chestpiece",
  "Gloves",
  "Pants",
  "Boots",
  "Earring",
  "Necklace",
  "Bracelet",
  "Ring1",
  "Ring2",
] as const;

export type Slot = (typeof SLOTS)[number];

export const BIS_SOURCES = [
  "Savage",
  "TomeUp",
  "Catchup",
  "Tome",
  "Extreme",
  "Relic",
  "Crafted",
  "WHYYYY",
  "JustNo",
  "NotPlanned",
] as const;

export type BisSource = (typeof BIS_SOURCES)[number];

export const ITEM_KEYS = [
  "Weapon",
  "Offhand",
  "Head",
  "Chestpiece",
  "Gloves",
  "Pants",
  "Boots",
  "Earring",
  "Necklace",
  "Bracelet",
  "Ring",
  "Glaze",
  "Twine",
  "Ester",
] as const;

export type ItemKey = (typeof ITEM_KEYS)[number];

/**
 * Default iLv deltas applied on top of a tier's `max_ilv` to populate
 * the per-source iLvs. Operators can override individual values during
 * tier creation if a future patch breaks the pattern.
 *
 * Pairs intentionally land on the same iLv:
 * - `Savage` and `TomeUp` are both at the cap (the upgraded tome
 *   piece reaches the same iLv as the raw Savage drop).
 * - `Catchup` and `Tome` share `max - 10` — augmented crafted /
 *   alliance-raid / mid-tier extreme drops at the same iLv as the
 *   raw, non-upgraded weekly tome cap.
 * - `Crafted` and `Relic` share `max - 20` — the high-end crafted
 *   set lands at the same iLv as the relic weapon's mid-tier step.
 */
export const DEFAULT_ILV_DELTAS: Record<BisSource, number> = {
  Savage: 0,
  TomeUp: 0,
  Catchup: -10,
  Tome: -10,
  Extreme: -15,
  Relic: -20,
  Crafted: -20,
  WHYYYY: -30,
  JustNo: -40,
  // Synthetic entry — not really an iLv, but kept here so the lookup
  // never returns undefined. The application treats `NotPlanned` as
  // "no opinion on this slot" and skips it during scoring.
  NotPlanned: 0,
};

/**
 * Compute every per-source iLv from a single `max_ilv` input. Used by
 * the tier-creation form to populate the defaults panel.
 */
export function deriveSourceIlvs(maxIlv: number): Record<BisSource, number> {
  const result = {} as Record<BisSource, number>;
  for (const source of BIS_SOURCES) {
    result[source] = maxIlv + DEFAULT_ILV_DELTAS[source];
  }
  return result;
}

/**
 * Default per-slot priority multipliers for the loot planner.
 *
 * The min-cost-flow optimiser uses these to prefer filling
 * higher-stat-budget slots first when multiple needs compete
 * for the same drop or material:
 *   - **Chestpiece + Pants** = 0.85 (highest stat budget on FFXIV
 *     gear; biggest DPS / mit gain per upgrade).
 *   - **Weapon** = 0.80 (per-slot, weapon makes the biggest
 *     single-piece difference; defaults reflect that).
 *   - **Head** = 0.95 (mid-tier).
 *   - **Gloves / Boots / accessories / Offhand** = 1.00.
 *
 * Stored on the `tier` row as JSON in `tier.slot_weights`; the
 * planner reads from there with this map as fallback for legacy
 * tiers that haven't been migrated yet.
 */
export const DEFAULT_SLOT_WEIGHTS: Record<Slot, number> = {
  Weapon: 0.8,
  Offhand: 1.0,
  Head: 0.95,
  Chestpiece: 0.85,
  Gloves: 1.0,
  Pants: 0.85,
  Boots: 1.0,
  Earring: 1.0,
  Necklace: 1.0,
  Bracelet: 1.0,
  Ring1: 1.0,
  Ring2: 1.0,
};

/**
 * Tiny shape the BiS tracker uses to look up a source's iLv on the
 * active tier. Mirrors the columns on the `tier` table; storing
 * verbose camelCase names per source instead of an array keeps the
 * lookup type-safe at compile time.
 */
export interface SourceIlvLookup {
  ilvSavage: number;
  ilvTomeUp: number;
  ilvCatchup: number;
  ilvTome: number;
  ilvExtreme: number;
  ilvRelic: number;
  ilvCrafted: number;
  ilvWhyyyy: number;
  ilvJustNo: number;
  /**
   * `max_ilv` is duplicated here so callers can show the headline
   * number without a separate prop. The tier always carries it.
   */
  maxIlv: number;
}

/**
 * Look up the iLv for a given source on a tier-shaped object.
 *
 * Returns `null` for `NotPlanned` (the sentinel source) so the caller
 * can render an em dash instead of a misleading number.
 */
export function ilvForSource(
  tier: SourceIlvLookup,
  source: BisSource,
): number | null {
  switch (source) {
    case "Savage":
      return tier.ilvSavage;
    case "TomeUp":
      return tier.ilvTomeUp;
    case "Catchup":
      return tier.ilvCatchup;
    case "Tome":
      return tier.ilvTome;
    case "Extreme":
      return tier.ilvExtreme;
    case "Relic":
      return tier.ilvRelic;
    case "Crafted":
      return tier.ilvCrafted;
    case "WHYYYY":
      return tier.ilvWhyyyy;
    case "JustNo":
      return tier.ilvJustNo;
    case "NotPlanned":
      return null;
  }
}
