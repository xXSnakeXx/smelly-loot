import { type GearRole, ROLE_WEIGHTS } from "@/lib/ffxiv/jobs";
import {
  type BisSource,
  type ItemKey,
  ilvForSource,
  SLOTS,
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
      : scoreGear(player, players, context);
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
  allPlayers: ReadonlyArray<PlayerSnapshot>,
  context: DropContext,
): ScoreBreakdown {
  const dropSource = context.drop_source ?? "Savage";
  const slotsForItem = SLOTS_BY_ITEM_KEY[context.itemKey as GearItemKey];
  const cost = context.tier.buyCostByItem.get(context.itemKey);

  // Page-aware purchase simulation (v2.2.1): we assume that every
  // week each player has used their accumulated pages to buy the
  // cheapest-acquirable slots they still need, and only the
  // un-purchased slots compete for actual drops.
  //
  // This solves two earlier issues simultaneously:
  //
  //   1. Pre-v2.2 the algorithm subtracted `buyPower` from each
  //      item's `effectiveNeed` independently, so 3 Floor-1 pages
  //      across 3 needed accessories zeroed out all three (the
  //      Fara case) — even though the player can only buy ONE
  //      accessory total.
  //   2. v2.2 ignored pages entirely, so a page-rich player
  //      (9 Floor-1 pages, 1 needed item) still got the drop
  //      recommended even though they could trivially have bought
  //      the slot themselves.
  //
  // The new rule pre-computes a per-(player, floor) set of
  // "purchased" slots: pages divided by the floor's per-item cost
  // gives the number of slots covered by self-purchase, picked in
  // a deterministic floor-item order. The score for any specific
  // item then only counts slots that are NOT in that set.
  const { purchased: purchasedSlots, totalUnmet: floorTotalUnmet } =
    computePurchasedSlots(
      player,
      allPlayers,
      context.tier,
      context.floorNumber,
      dropSource,
    );
  // "Fully self-served": the player wanted at least one slot on
  // this floor, and every single one is covered by simulated
  // self-purchase. They drop out of the competition for any drop
  // on this floor — giving them the drop would just leak a
  // recommendation away from a teammate who genuinely still needs
  // it. Drops only land on this player if no-one else needs it
  // either (in which case the deterministic tiebreaker fills in).
  const fullySelfServed =
    floorTotalUnmet > 0 && purchasedSlots.size === floorTotalUnmet;
  const buyPower = cost
    ? Math.floor((player.pages.get(cost.floor) ?? 0) / cost.cost)
    : 0;

  // Slots wanting the drop, not already wearing it, AND simulated
  // as bought via pages — these still contribute to effectiveNeed,
  // just at half weight. This keeps a drop recommendation alive
  // even when every potential recipient could theoretically buy
  // the slot themselves: the algorithm gives the drop to the
  // highest-priority player among those still wanting it, but
  // ranks them below page-poor competitors who would otherwise
  // have to wait.
  const PURCHASE_DISCOUNT = 0.5;
  const slotsWantingPurchased = slotsForItem.filter(
    (slot) =>
      (player.bisDesired.get(slot) ?? NEUTRAL_SOURCE) === dropSource &&
      (player.bisCurrent.get(slot) ?? NEUTRAL_SOURCE) !== dropSource &&
      purchasedSlots.has(slot),
  ).length;
  const slotsWantingNotPurchased = slotsForItem.filter(
    (slot) =>
      (player.bisDesired.get(slot) ?? NEUTRAL_SOURCE) === dropSource &&
      (player.bisCurrent.get(slot) ?? NEUTRAL_SOURCE) !== dropSource &&
      !purchasedSlots.has(slot),
  ).length;
  // Raw "slots needing the drop" minus the discount applied to the
  // self-purchased ones. Float-valued so a 1-slot Earring drop with
  // the slot in purchasedSlots gives 0.5 (not 0); a fresh Ring drop
  // with both slots un-purchased gives 2. If the player is fully
  // self-served on this floor (every want covered), zero out the
  // effective need so the algorithm doesn't bother recommending
  // them — every drop they'd theoretically receive should go to a
  // teammate with genuine remaining need instead.
  const effectiveNeed = fullySelfServed
    ? 0
    : slotsWantingNotPurchased +
      slotsWantingPurchased * (1 - PURCHASE_DISCOUNT);

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

/**
 * Pre-computes the set of slots a player is assumed to "buy"
 * with their accumulated pages on a given floor.
 *
 * The simulation assumes every player spends their pages every
 * week on the slots they still need — purchases are first-come in
 * the order items appear on the floor (Earring → Necklace →
 * Bracelet → Ring1 → Ring2 for Floor 1, etc.). The set returned
 * here is then excluded from any item's `effectiveNeed` during
 * scoring, so a page-rich player who could trivially buy a slot
 * is no longer recommended for the matching drop.
 *
 * Implementation detail: floors mix gear and materials in their
 * `buyCostByItem` entries (Floor 2 has Head/Gloves/Boots gear and
 * Glaze material). Only gear items are eligible for slot
 * purchase; materials feed `scoreMaterial` separately.
 *
 * The function is exported for unit-tests and the scoring engine.
 */
export interface PurchaseSimulation {
  /** Slots assumed to have been bought with pages. */
  purchased: Set<Slot>;
  /**
   * Total number of slots the player wanted on this floor. Used by
   * the scorer to decide if the player is "fully self-served" for
   * the floor (every want covered by self-purchase → score 0 on
   * any drop).
   */
  totalUnmet: number;
}

export function computePurchasedSlots(
  player: PlayerSnapshot,
  allPlayers: ReadonlyArray<PlayerSnapshot>,
  tier: TierSnapshot,
  floorNumber: number,
  dropSource: BisSource,
): PurchaseSimulation {
  // Build a slot → item lookup so we can map a slot back to the item
  // it belongs to (and thus to its floor and cost). Pre-computed
  // per call because SLOTS_BY_ITEM_KEY is small (12 slots) — no
  // worth caching above the function scope.
  const slotToItem = new Map<Slot, GearItemKey>();
  for (const [itemKey, slots] of Object.entries(SLOTS_BY_ITEM_KEY)) {
    for (const slot of slots) {
      slotToItem.set(slot as Slot, itemKey as GearItemKey);
    }
  }

  // Walk the SLOTS list in its canonical declared order (Weapon →
  // Offhand → Head → ... → Ring1 → Ring2) and capture every slot
  // that:
  //   1. belongs to a gear item on the requested floor,
  //   2. the player wants the drop source for, and
  //   3. they don't already wear the drop source in.
  //
  // Iterating SLOTS rather than `tier.buyCostByItem` makes the
  // walk deterministic regardless of Drizzle's row order.
  const playerUnmet: Slot[] = [];
  let perItemCost: number | undefined;
  for (const slot of SLOTS) {
    const itemKey = slotToItem.get(slot);
    if (!itemKey) continue;
    const costEntry = tier.buyCostByItem.get(itemKey);
    if (!costEntry || costEntry.floor !== floorNumber) continue;
    // First gear item we hit on this floor seeds the per-item cost.
    // FF XIV invariant: every gear piece on a single floor costs the
    // same number of pages, so any one item's cost is the canonical
    // floor price.
    if (perItemCost === undefined) perItemCost = costEntry.cost;
    if (
      (player.bisDesired.get(slot) ?? NEUTRAL_SOURCE) === dropSource &&
      (player.bisCurrent.get(slot) ?? NEUTRAL_SOURCE) !== dropSource
    ) {
      playerUnmet.push(slot);
    }
  }
  if (playerUnmet.length === 0 || perItemCost === undefined)
    return { purchased: new Set(), totalUnmet: 0 };

  // Compute the team-wide demand per slot — the number of
  // OTHER players that also still want the drop source in that
  // slot. The simulation assumes each player spends their pages
  // on the team's tightest bottleneck first: if six raiders need
  // a Savage Ring1 but only one needs a Savage Earring, every
  // page-rich raider buys a Ring (clearing the bottleneck) before
  // anything else, leaving the rare Earring drop for the one
  // raider that still needs it.
  //
  // The player's OWN unmet count counts towards the demand so
  // every shared slot at least registers as 1, and ties tend
  // towards the canonical SLOTS order (lower index first) for
  // determinism.
  const teamDemandBySlot = new Map<Slot, number>();
  for (const slot of playerUnmet) {
    let demand = 0;
    for (const p of allPlayers) {
      if (
        (p.bisDesired.get(slot) ?? NEUTRAL_SOURCE) === dropSource &&
        (p.bisCurrent.get(slot) ?? NEUTRAL_SOURCE) !== dropSource
      ) {
        demand += 1;
      }
    }
    teamDemandBySlot.set(slot, demand);
  }
  playerUnmet.sort((a, b) => {
    const demandDiff =
      (teamDemandBySlot.get(b) ?? 0) - (teamDemandBySlot.get(a) ?? 0);
    if (demandDiff !== 0) return demandDiff;
    return SLOTS.indexOf(a) - SLOTS.indexOf(b);
  });

  const pages = player.pages.get(floorNumber) ?? 0;
  const buyPower = Math.floor(pages / perItemCost);
  if (buyPower === 0)
    return { purchased: new Set(), totalUnmet: playerUnmet.length };

  // Take the first `buyPower` slots from the demand-sorted list —
  // i.e. the player's contribution to the team's tightest
  // bottlenecks. Capped at the player's own unmet count because
  // pages can't conjure need that doesn't exist.
  const purchaseCount = Math.min(buyPower, playerUnmet.length);
  return {
    purchased: new Set(playerUnmet.slice(0, purchaseCount)),
    totalUnmet: playerUnmet.length,
  };
}
