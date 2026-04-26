import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "./client";
import { bisChoice, player, tier as tierTable } from "./schema";

/**
 * Read-only helpers around the `player` table.
 *
 * Players are team-scoped (v2.0). The roster of stable identities
 * lives once on a team — Brad is the same row whether the team is
 * mid-tier on Heavyweight or already prepping Cruiserweight. Tier
 * membership is implicit: a player IS in a tier iff at least one
 * `bis_choice` row exists for that (player, tier) pair.
 *
 * The two main reads here are:
 *
 *   - `listPlayersForTeam(teamId)` — every player on the team's
 *     master roster, used by the `/team` page.
 *   - `listPlayersInTier(tierId)` — every player that has at least
 *     one `bis_choice` row for the tier, used by the tier-detail
 *     Roster tab.
 *
 * `listTeamPlayersNotInTier(teamId, tierId)` rounds out the picture
 * for the "add player to tier" dialog.
 */

export async function listPlayersForTeam(teamId: number) {
  return db
    .select()
    .from(player)
    .where(eq(player.teamId, teamId))
    .orderBy(player.sortOrder, player.id);
}

/**
 * List players that participate in the given tier — i.e. have at
 * least one `bis_choice` row for that tier.
 *
 * Implemented as a subquery rather than a JOIN+DISTINCT to keep the
 * Drizzle types simple and avoid pulling the bis_choice columns
 * back unnecessarily. SQLite optimises the `IN (SELECT ...)` form
 * the same way as the equivalent semi-join.
 */
export async function listPlayersInTier(tierId: number) {
  const rosterIds = db
    .select({ id: bisChoice.playerId })
    .from(bisChoice)
    .where(eq(bisChoice.tierId, tierId))
    .groupBy(bisChoice.playerId);

  return db
    .select()
    .from(player)
    .where(inArray(player.id, rosterIds))
    .orderBy(player.sortOrder, player.id);
}

/**
 * List the team's players that are NOT currently in the given
 * tier's roster. Powers the "add player to tier" dialog so the
 * raid-leader only sees candidates they haven't already added.
 */
export async function listTeamPlayersNotInTier(teamId: number, tierId: number) {
  const rosterIds = db
    .select({ id: bisChoice.playerId })
    .from(bisChoice)
    .where(eq(bisChoice.tierId, tierId))
    .groupBy(bisChoice.playerId);

  return db
    .select()
    .from(player)
    .where(and(eq(player.teamId, teamId), notInArray(player.id, rosterIds)))
    .orderBy(player.sortOrder, player.id);
}

/**
 * Convenience: count players in each tier of the given team via a
 * single grouped query. Used by the dashboard tier-grid; one query
 * is cheaper than fanning out a `listPlayersInTier` call per tier.
 */
export async function countPlayersByTier(
  teamId: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      tierId: bisChoice.tierId,
      count: sql<number>`count(distinct ${bisChoice.playerId})`,
    })
    .from(bisChoice)
    .innerJoin(player, eq(player.id, bisChoice.playerId))
    .where(eq(player.teamId, teamId))
    .groupBy(bisChoice.tierId);
  return new Map(rows.map((r) => [r.tierId, r.count]));
}

/**
 * List the tiers a single player participates in — i.e. every tier
 * for which there's at least one `bis_choice` row pinning the
 * player to it. Used by the player-detail page on `/team/[id]` to
 * render the per-tier "open this player's BiS plan in tier X"
 * navigation list.
 *
 * The result joins through `tier` so callers get the full tier row
 * (name, archived flag, etc.) without a second round-trip. Results
 * are ordered with the active tier first and then archived tiers
 * in reverse-creation order, mirroring the dashboard's tier-grid
 * sort.
 */
export async function listTiersForPlayer(playerId: number) {
  const tierIdsForPlayer = db
    .select({ id: bisChoice.tierId })
    .from(bisChoice)
    .where(eq(bisChoice.playerId, playerId))
    .groupBy(bisChoice.tierId);

  const tiers = await db
    .select()
    .from(tierTable)
    .where(inArray(tierTable.id, tierIdsForPlayer));

  // Active tier first, then most-recently archived. Comparable to
  // the dashboard sort so the navigation order is consistent.
  return tiers.sort((a, b) => {
    const archivedDelta =
      Number(a.archivedAt !== null) - Number(b.archivedAt !== null);
    if (archivedDelta !== 0) return archivedDelta;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}
