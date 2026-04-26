import { type GearRole, ROLE_WEIGHTS } from "@/lib/ffxiv/jobs";
import {
  type BisSource,
  type ItemKey,
  ilvForSource,
  type Slot,
  type SourceIlvLookup,
} from "@/lib/ffxiv/slots";

/**
 * Loot-distribution scoring engine.
 *
 * The function below computes a per-player score for a single drop
 * given an immutable snapshot of the static + tier. All inputs are
 * plain data (no Drizzle, no React) so the engine is trivially
 * unit-testable and can run anywhere — Server Action, REPL, or a
 * historical replay tool.
 *
 * Decisions encoded here come straight from the seven Phase-1
 * topics resolved on 2026-04-25; see ROADMAP.md for the full
 * rationale of each term.
 *
 * Formula (gear):
 *
 *   buy_power      = floor(player_pages_for_floor / item_page_cost)
 *   effective_need = max(0, slots_wanting_drop_source
 *                            - slots_already_at_source
 *                            - buy_power)
 *   base_priority  = effective_need * 100
 *   role_weight    = ROLE_WEIGHTS[gear_role]              (Topic 1)
 *   ilv_gain       = clamp((desired_ilv - current_ilv) / 10, 0.5, 3)
 *   fairness       = 1 / (1 + savage_drops_received_this_tier)
 *   recency        = max(0, 4 - weeks_since_last_drop_from_floor) * 5
 *   score          = base_priority * role_weight * ilv_gain * fairness
 *                    - recency
 *
 * Materials use the same shape but with a different `base_priority`:
 *
 *   effective_need_material = max(0, materials_needed
 *                                      - materials_received
 *                                      - buy_power_material)
 *   base_priority_material  = effective_need_material * 100
 *
 * Both flows tiebreak first by oldest "last drop" timestamp, then by
 * a deterministic seed (raid week id + floor id + item) so reruns of
 * the same input produce the same recommendation.
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

export interface DropContext {
  itemKey: ItemKey;
  /** Floor the drop comes from (for recency penalty + page bookkeeping). */
  floorNumber: number;
  /** The week being scored. Used for the recency penalty. */
  currentWeek: number;
  tier: TierSnapshot;
  /**
   * Optional: when scoring a Savage gear drop, the source the
   * algorithm should treat the drop as. Defaults to `"Savage"`.
   * Currently no other paths exist, but this leaves room for, e.g.,
   * scoring a Tome-Up reward distribution later.
   */
  drop_source?: BisSource;
}

export interface ScoreBreakdown {
  basePriority: number;
  effectiveNeed: number;
  buyPower: number;
  roleWeight: number;
  ilvGainFactor: number;
  fairnessFactor: number;
  recencyPenalty: number;
  total: number;
}

export interface PlayerScore {
  player: PlayerSnapshot;
  score: number;
  breakdown: ScoreBreakdown;
}

const NEUTRAL_SOURCE: BisSource = "NotPlanned";

const MATERIAL_KEYS: ReadonlySet<MaterialKey> = new Set([
  "Glaze",
  "Twine",
  "Ester",
]);

/**
 * Compute a stable, deterministic deterministic-but-uniform-looking
 * tiebreaker score from a string. Used as the final tiebreaker so
 * scoring the same context twice yields the same ranking, but the
 * order isn't always alphabetical.
 *
 * Implementation: 32-bit FNV-1a. Good enough for an 8-player static.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Score every player for a single drop and return the list sorted
 * highest-first. Players with `effective_need === 0` keep their row
 * but receive a `total` of 0 — the UI shows them disabled in the
 * "Other player" override list.
 */
export function scoreDrop(
  players: ReadonlyArray<PlayerSnapshot>,
  context: DropContext,
): PlayerScore[] {
  const isMaterial = MATERIAL_KEYS.has(context.itemKey as MaterialKey);

  const scores = players.map((player) => {
    const breakdown = isMaterial
      ? scoreMaterial(player, context)
      : scoreGear(player, context);
    return { player, score: breakdown.total, breakdown };
  });

  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tiebreaker 1: oldest "last drop" wins (lower week number = waited longer)
    const aLast = a.player.lastDropWeekByFloor.get(context.floorNumber);
    const bLast = b.player.lastDropWeekByFloor.get(context.floorNumber);
    const aWeek = aLast ?? -Infinity;
    const bWeek = bLast ?? -Infinity;
    if (aWeek !== bWeek) return aWeek - bWeek;
    // Tiebreaker 2: deterministic hash of (week, floor, item, player.id).
    const seed = `${context.currentWeek}|${context.floorNumber}|${context.itemKey}|`;
    return fnv1a(seed + a.player.id) - fnv1a(seed + b.player.id);
  });

  return scores;
}

function scoreGear(
  player: PlayerSnapshot,
  context: DropContext,
): ScoreBreakdown {
  const dropSource = context.drop_source ?? "Savage";
  const slotsForItem = SLOTS_BY_ITEM_KEY[context.itemKey as GearItemKey];
  const cost = context.tier.buyCostByItem.get(context.itemKey);

  // `buyPower` is computed and reported in the breakdown so the UI
  // can still surface it as context, but as of v2.2 it is *not*
  // subtracted from `effectiveNeed` for gear drops. Two reasons:
  //
  //   1. The previous behaviour double-counted page balances across
  //      a player's multiple needed items: a player with 3 Floor-1
  //      pages who needed three different Floor-1 accessories would
  //      see `buyPower = 1` reapplied to each item independently,
  //      so each one's `effectiveNeed` dropped to 0 even though they
  //      could only buy *one* accessory total.
  //   2. Pages on Floors 2/3 are spent primarily on the Glaze /
  //      Twine vendors (TomeUp upgrades), not on gear pieces, so
  //      reducing gear-drop priority by Floor-2/3 pages mis-models
  //      the team's actual page economy.
  //
  // The simpler correct rule is "drops are free; pages are a
  // separate purchase track". The `buyPower` factor still applies
  // to material drops in `scoreMaterial` (where pages *are* the
  // canonical sink).
  const buyPower = cost
    ? Math.floor((player.pages.get(cost.floor) ?? 0) / cost.cost)
    : 0;

  // How many of the relevant slots want this drop's source?
  const slotsWanting = slotsForItem.filter(
    (slot) => (player.bisDesired.get(slot) ?? NEUTRAL_SOURCE) === dropSource,
  ).length;

  // How many of those slots already wear the drop's source?
  const slotsAlready = slotsForItem.filter(
    (slot) =>
      (player.bisDesired.get(slot) ?? NEUTRAL_SOURCE) === dropSource &&
      (player.bisCurrent.get(slot) ?? NEUTRAL_SOURCE) === dropSource,
  ).length;

  const effectiveNeed = Math.max(0, slotsWanting - slotsAlready);

  const desiredIlv = ilvForSource(context.tier, dropSource) ?? 0;
  const currentIlvOfFirstNeedingSlot = slotsForItem
    .map((slot) => player.bisCurrent.get(slot) ?? NEUTRAL_SOURCE)
    .map((source) => ilvForSource(context.tier, source) ?? 0)
    .filter((ilv) => ilv > 0)[0];
  const currentIlv = currentIlvOfFirstNeedingSlot ?? 0;
  const ilvGain = currentIlv > 0 ? (desiredIlv - currentIlv) / 10 : 1.5;
  const ilvGainFactor = Math.max(0.5, Math.min(3, ilvGain));

  const fairnessFactor = 1 / (1 + player.savageDropsThisTier);

  const lastWeek = player.lastDropWeekByFloor.get(context.floorNumber);
  const weeksSince =
    lastWeek === undefined || lastWeek === null
      ? Infinity
      : context.currentWeek - lastWeek;
  const recencyPenalty = Math.max(0, 4 - weeksSince) * 5;

  const roleWeight = ROLE_WEIGHTS[player.gearRole];
  const basePriority = effectiveNeed * 100;

  const total =
    effectiveNeed === 0
      ? 0
      : basePriority * roleWeight * ilvGainFactor * fairnessFactor -
        recencyPenalty;

  return {
    basePriority,
    effectiveNeed,
    buyPower,
    roleWeight,
    ilvGainFactor,
    fairnessFactor,
    recencyPenalty,
    total,
  };
}

function scoreMaterial(
  player: PlayerSnapshot,
  context: DropContext,
): ScoreBreakdown {
  const material = context.itemKey as MaterialKey;
  const cost = context.tier.buyCostByItem.get(context.itemKey);
  const buyPower = cost
    ? Math.floor((player.pages.get(cost.floor) ?? 0) / cost.cost)
    : 0;

  // Slots whose desired source is "TomeUp" need exactly one Glaze (or
  // Twine, or Ester) per slot. The mapping from material to slot
  // class is fixed by the tier:
  //   Glaze  → accessory slots (Earring, Necklace, Bracelet, Ring1, Ring2)
  //   Twine  → clothing slots  (Head, Chestpiece, Gloves, Pants, Boots)
  //   Ester  → weapon slots    (Weapon, Offhand)
  const slotsForMaterial = SLOTS_FOR_MATERIAL[material];
  const slotsNeedingUpgrade = slotsForMaterial.filter(
    (slot) => (player.bisDesired.get(slot) ?? NEUTRAL_SOURCE) === "TomeUp",
  ).length;
  const alreadyHave = player.materialsReceived.get(material) ?? 0;
  const effectiveNeed = Math.max(
    0,
    slotsNeedingUpgrade - alreadyHave - buyPower,
  );

  // Materials are pure economy; default role weight is neutral. The
  // `tier` table can override per-tier in a future migration.
  const roleWeight = 1;

  // ilv_gain doesn't apply cleanly to materials; default to 1 so it
  // doesn't move the score.
  const ilvGainFactor = 1;

  const fairnessFactor = 1 / (1 + player.savageDropsThisTier);

  const lastWeek = player.lastDropWeekByFloor.get(context.floorNumber);
  const weeksSince =
    lastWeek === undefined || lastWeek === null
      ? Infinity
      : context.currentWeek - lastWeek;
  const recencyPenalty = Math.max(0, 4 - weeksSince) * 5;

  const basePriority = effectiveNeed * 100;
  const total =
    effectiveNeed === 0
      ? 0
      : basePriority * roleWeight * ilvGainFactor * fairnessFactor -
        recencyPenalty;

  return {
    basePriority,
    effectiveNeed,
    buyPower,
    roleWeight,
    ilvGainFactor,
    fairnessFactor,
    recencyPenalty,
    total,
  };
}

const SLOTS_FOR_MATERIAL: Record<MaterialKey, readonly Slot[]> = {
  Glaze: ["Earring", "Necklace", "Bracelet", "Ring1", "Ring2"],
  Twine: ["Head", "Chestpiece", "Gloves", "Pants", "Boots"],
  Ester: ["Weapon", "Offhand"],
};
