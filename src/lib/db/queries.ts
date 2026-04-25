import { eq } from "drizzle-orm";

import { db } from "./client";
import { team as teamTable, tier as tierTable } from "./schema";

/**
 * Read-only helpers for the most common data lookups across the app.
 *
 * Phase 1 routes the entire deployment through a single team and a
 * single active tier; these helpers encapsulate that assumption so the
 * Phase 3 multi-team rework only needs to touch this file plus the
 * routing layer that picks the active team.
 */

/**
 * Return the only team in the database (Phase 1 invariant).
 *
 * The seed step (`ensureSeedData`) guarantees a team exists by the
 * time any page renders, so this returns `Team` rather than
 * `Team | undefined`. If the invariant is ever violated the server
 * crashes, which is a louder failure mode than rendering a half-blank
 * dashboard.
 */
export async function getCurrentTeam() {
  const rows = await db.select().from(teamTable).limit(1);
  const team = rows[0];
  if (!team) {
    throw new Error(
      "[queries] expected a team row to exist after seeding; got none",
    );
  }
  return team;
}

/**
 * Return the active (non-archived) tier for a given team.
 *
 * `archivedAt IS NULL` filters out tiers that were closed during
 * tier-rollover. If multiple non-archived tiers exist (which the UI
 * shouldn't allow, but the schema does), we return the most recently
 * created one — that matches the user's intent of "the tier I'm
 * currently raiding".
 */
export async function getActiveTier(teamId: number) {
  const rows = await db
    .select()
    .from(tierTable)
    .where(eq(tierTable.teamId, teamId))
    .orderBy(tierTable.createdAt);

  // Drizzle doesn't expose a clean "filter with IS NULL on the same
  // chain" yet for this typed builder, so we filter in JS. The list
  // is bounded by the number of tiers a single team has ever played,
  // which is always single-digit.
  const activeTiers = rows.filter((tier) => tier.archivedAt === null);
  const tier = activeTiers.at(-1);
  if (!tier) {
    throw new Error(
      `[queries] no active tier for team ${teamId}; the seed should have created one`,
    );
  }
  return tier;
}

/**
 * Convenience: return both the current team and its active tier in one
 * round-trip-y call. Most dashboard routes need both, and pairing the
 * lookups here avoids repeating the same boilerplate. The two queries
 * still execute sequentially because the second depends on the first.
 */
export async function getCurrentContext() {
  const team = await getCurrentTeam();
  const tier = await getActiveTier(team.id);
  return { team, tier };
}
