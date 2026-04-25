import { sql } from "drizzle-orm";

import { deriveSourceIlvs } from "@/lib/ffxiv/slots";
import { DEFAULT_BUY_COSTS, DEFAULT_FLOORS } from "@/lib/ffxiv/tier-defaults";

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

const DEFAULT_TEAM_NAME = "Mannschaft Smelly";
const DEFAULT_TEAM_LOCALE = "en";

const HEAVYWEIGHT_TIER_NAME = "Arcadion Heavyweight Savage";
// 790 is the general Savage gear iLv — only the floor-4 weapon goes
// to 795. Since floor 4 is `tracked_for_algorithm = false` (the team
// distributes the weapon outside the page-cost system), the
// algorithm-relevant max is 790; we cascade every other source iLv
// off that.
const HEAVYWEIGHT_MAX_ILV = 790;

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

  await db.insert(floor).values(
    DEFAULT_FLOORS.map((f) => ({
      tierId,
      number: f.number,
      drops: [...f.drops],
      pageTokenLabel: `HW ${f.pageTokenLabel}`,
      trackedForAlgorithm: f.trackedForAlgorithm,
    })),
  );

  await db.insert(tierBuyCost).values(
    DEFAULT_BUY_COSTS.map((c) => ({
      tierId,
      itemKey: c.itemKey,
      floorNumber: c.floorNumber,
      cost: c.cost,
    })),
  );

  console.log(
    `[seed] created team "${DEFAULT_TEAM_NAME}" with tier "${HEAVYWEIGHT_TIER_NAME}"`,
  );
}
