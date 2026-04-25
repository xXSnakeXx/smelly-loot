import { sql } from "drizzle-orm";

import { deriveSourceIlvs } from "@/lib/ffxiv/slots";

import { db } from "./client";
import { floor, team, tier, tierBuyCost } from "./schema";

/**
 * First-boot seed data.
 *
 * Two responsibilities:
 *
 * 1. Create a placeholder team so the application has something to
 *    render before the user touches the settings UI. The name is a
 *    locale-agnostic stub — the team-settings page (Phase 1.1) lets
 *    them rename it in one click.
 *
 * 2. Seed the current Arcadion Heavyweight Savage tier with the
 *    floor layout, per-source iLvs, and the `tier_buy_cost` lookup
 *    so the app is immediately useful for the team that asked for
 *    it. Future tier rollovers go through the in-app tier-creation
 *    form (Phase 1.3) and don't depend on this seed.
 *
 * The function is idempotent: it bails out as soon as it sees any
 * existing team, so re-running it on a populated database is a no-op.
 * That makes it safe to call from the instrumentation hook on every
 * server boot.
 */

const DEFAULT_TEAM_NAME = "My Static";
const DEFAULT_TEAM_LOCALE = "en";

const HEAVYWEIGHT_TIER_NAME = "Arcadion Heavyweight Savage";
const HEAVYWEIGHT_MAX_ILV = 795;

/**
 * Floor layout for the Heavyweight tier.
 *
 * Drops match the Mannschaft-Smelly spreadsheet exactly: Floor 1 has
 * the four accessory pieces, Floor 2 adds the Glaze upgrade material,
 * Floor 3 the Twine and Ester, Floor 4 the weapon. Floor 4 has
 * `tracked_for_algorithm = false` per Topic 3 (track but no scoring).
 */
const HEAVYWEIGHT_FLOORS: ReadonlyArray<{
  number: number;
  drops: string[];
  pageTokenLabel: string;
  trackedForAlgorithm: boolean;
}> = [
  {
    number: 1,
    drops: ["Earring", "Necklace", "Bracelet", "Ring"],
    pageTokenLabel: "HW Edition I",
    trackedForAlgorithm: true,
  },
  {
    number: 2,
    drops: ["Head", "Gloves", "Boots", "Glaze"],
    pageTokenLabel: "HW Edition II",
    trackedForAlgorithm: true,
  },
  {
    number: 3,
    drops: ["Chestpiece", "Pants", "Twine", "Ester"],
    pageTokenLabel: "HW Edition III",
    trackedForAlgorithm: true,
  },
  {
    number: 4,
    drops: ["Weapon"],
    pageTokenLabel: "HW Edition IV",
    trackedForAlgorithm: false,
  },
];

/**
 * Token costs for everything the Heavyweight item-exchange vendor
 * sells, transcribed from the FF XIV wiki on 2026-04-25. Numbers are
 * intentionally redundant with the floor-layout above so the buy
 * lookup is denormalised and trivially queried.
 */
const HEAVYWEIGHT_BUY_COSTS: ReadonlyArray<{
  itemKey: string;
  floorNumber: number;
  cost: number;
}> = [
  // Floor 1 token (HW Edition I) — accessories cost 3 each.
  { itemKey: "Earring", floorNumber: 1, cost: 3 },
  { itemKey: "Necklace", floorNumber: 1, cost: 3 },
  { itemKey: "Bracelet", floorNumber: 1, cost: 3 },
  { itemKey: "Ring", floorNumber: 1, cost: 3 },
  // Floor 2 token (HW Edition II) — small armor + Glaze.
  { itemKey: "Head", floorNumber: 2, cost: 4 },
  { itemKey: "Gloves", floorNumber: 2, cost: 4 },
  { itemKey: "Boots", floorNumber: 2, cost: 4 },
  { itemKey: "Glaze", floorNumber: 2, cost: 3 },
  // Floor 3 token (HW Edition III) — large armor + Twine + Ester.
  { itemKey: "Chestpiece", floorNumber: 3, cost: 6 },
  { itemKey: "Pants", floorNumber: 3, cost: 6 },
  { itemKey: "Twine", floorNumber: 3, cost: 4 },
  { itemKey: "Ester", floorNumber: 3, cost: 4 },
  // Floor 4 token (HW Edition IV) — main-hand weapon.
  { itemKey: "Weapon", floorNumber: 4, cost: 8 },
];

/**
 * Idempotently install the seed data described above.
 *
 * The check uses `count(*) > 0` on `team` rather than "does the
 * default-named team exist" so a renamed team still satisfies the
 * "already seeded" condition. This avoids the seed quietly recreating
 * itself if the user clears their team's name to an empty string and
 * back, for instance.
 */
export async function ensureSeedData(): Promise<void> {
  const teamCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(team);

  if ((teamCount[0]?.count ?? 0) > 0) {
    return;
  }

  // Insert in dependency order: team → tier → floor → tier_buy_cost.
  // Drizzle's transactional API would be tighter, but the seed runs
  // exactly once and partial failure is recoverable by truncating the
  // database — keeping the code straightforward is the better trade.

  const insertedTeam = await db
    .insert(team)
    .values({ name: DEFAULT_TEAM_NAME, locale: DEFAULT_TEAM_LOCALE })
    .returning({ id: team.id });
  const teamId = insertedTeam[0]?.id;
  if (teamId === undefined) {
    throw new Error("[seed] team insert returned no id");
  }

  const ilvs = deriveSourceIlvs(HEAVYWEIGHT_MAX_ILV);
  const insertedTier = await db
    .insert(tier)
    .values({
      teamId,
      name: HEAVYWEIGHT_TIER_NAME,
      maxIlv: HEAVYWEIGHT_MAX_ILV,
      ilvSavage: ilvs.Savage,
      ilvTomeUp: ilvs.TomeUp,
      ilvCatchup: ilvs.Catchup,
      ilvTome: ilvs.Tome,
      ilvExtreme: ilvs.Extreme,
      ilvRelic: ilvs.Relic,
      ilvCrafted: ilvs.Crafted,
      ilvWhyyyy: ilvs.WHYYYY,
      ilvJustNo: ilvs.JustNo,
    })
    .returning({ id: tier.id });
  const tierId = insertedTier[0]?.id;
  if (tierId === undefined) {
    throw new Error("[seed] tier insert returned no id");
  }

  await db
    .insert(floor)
    .values(HEAVYWEIGHT_FLOORS.map((f) => ({ tierId, ...f })));

  await db
    .insert(tierBuyCost)
    .values(HEAVYWEIGHT_BUY_COSTS.map((c) => ({ tierId, ...c })));

  console.log(
    `[seed] created team "${DEFAULT_TEAM_NAME}" with tier "${HEAVYWEIGHT_TIER_NAME}"`,
  );
}
