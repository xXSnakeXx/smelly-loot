import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "./client";
import {
  bossKill,
  lootDrop,
  player,
  raidWeek,
  tier as tierTable,
} from "./schema";

/**
 * Tier-list helpers used by the dashboard's tier-grid view.
 *
 * Each "tier card" in the UI needs a tiny rollup of stats so the
 * raid leader can read off where the static stands at a glance —
 * how many weeks the static has played in this tier, how many drops
 * have been awarded, how many bosses have been killed in total.
 *
 * The denormalised `bossKill` and `lootDrop` rows are scoped to a
 * tier via their `raid_week.tier_id` foreign key, so we use a
 * single `inArray` lookup off a per-tier list of week ids rather
 * than a left-join. libSQL is fast enough that the overhead of two
 * extra round-trips is invisible relative to the network latency
 * of a typical dashboard render.
 */

/**
 * Per-tier rollup attached to each entry returned from
 * `listTiersForTeam`.
 *
 * `weeks` counts every `raid_week` row attached to the tier
 * (including weeks where no boss was killed yet). `kills` counts
 * `boss_kill` rows; `drops` counts `loot_drop` rows.
 */
export interface TierStats {
  players: number;
  weeks: number;
  kills: number;
  drops: number;
}

export type TierWithStats = typeof tierTable.$inferSelect & {
  stats: TierStats;
};

/**
 * List every tier owned by the given team, sorted with the active
 * tier first and then archived tiers in reverse-creation order.
 *
 * The "active" tier is the one whose `archived_at` is `NULL`. There
 * can in principle be more than one (the schema does not enforce a
 * single-active invariant), but in practice the application only
 * ever creates one active tier at a time and archives the previous
 * one as part of tier rollover.
 */
export async function listTiersForTeam(
  teamId: number,
): Promise<TierWithStats[]> {
  const tiers = await db
    .select()
    .from(tierTable)
    .where(eq(tierTable.teamId, teamId))
    .orderBy(tierTable.createdAt);

  if (tiers.length === 0) return [];

  const tierIds = tiers.map((t) => t.id);

  // One query per stat keeps the SQL simple. We could collapse this
  // into a single CTE, but the per-tier counts are tiny and the
  // separate queries make the result types easier to reason about.
  const weekRows = await db
    .select({
      tierId: raidWeek.tierId,
      count: sql<number>`count(*)`,
    })
    .from(raidWeek)
    .where(inArray(raidWeek.tierId, tierIds))
    .groupBy(raidWeek.tierId);

  const killRows = await db
    .select({
      tierId: raidWeek.tierId,
      count: sql<number>`count(*)`,
    })
    .from(bossKill)
    .innerJoin(raidWeek, eq(raidWeek.id, bossKill.raidWeekId))
    .where(inArray(raidWeek.tierId, tierIds))
    .groupBy(raidWeek.tierId);

  const dropRows = await db
    .select({
      tierId: raidWeek.tierId,
      count: sql<number>`count(*)`,
    })
    .from(lootDrop)
    .innerJoin(raidWeek, eq(raidWeek.id, lootDrop.raidWeekId))
    .where(inArray(raidWeek.tierId, tierIds))
    .groupBy(raidWeek.tierId);

  const playerRows = await db
    .select({
      tierId: player.tierId,
      count: sql<number>`count(*)`,
    })
    .from(player)
    .where(inArray(player.tierId, tierIds))
    .groupBy(player.tierId);

  const weekByTier = new Map(weekRows.map((r) => [r.tierId, r.count]));
  const killByTier = new Map(killRows.map((r) => [r.tierId, r.count]));
  const dropByTier = new Map(dropRows.map((r) => [r.tierId, r.count]));
  const playerByTier = new Map(playerRows.map((r) => [r.tierId, r.count]));

  // Sort active tier(s) first, then archived tiers in reverse-creation
  // order so the most recently archived tier comes second. This matches
  // the "what am I raiding now? what was I raiding last?" reading.
  const sorted = [...tiers].sort((a, b) => {
    const archivedDelta =
      Number(a.archivedAt !== null) - Number(b.archivedAt !== null);
    if (archivedDelta !== 0) return archivedDelta;
    if (a.archivedAt === null)
      return b.createdAt.getTime() - a.createdAt.getTime();
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return sorted.map((t) => ({
    ...t,
    stats: {
      players: playerByTier.get(t.id) ?? 0,
      weeks: weekByTier.get(t.id) ?? 0,
      kills: killByTier.get(t.id) ?? 0,
      drops: dropByTier.get(t.id) ?? 0,
    },
  }));
}

/**
 * Look up a single tier by id, scoped to the given team for safety.
 *
 * Returns `null` instead of throwing so callers can decide between
 * `notFound()` and a graceful empty state. The team-scope means the
 * URL `/tiers/<id>` can never leak another team's data even if the
 * application gains multi-team support later.
 */
export async function findTierById(
  teamId: number,
  tierId: number,
): Promise<typeof tierTable.$inferSelect | null> {
  const rows = await db
    .select()
    .from(tierTable)
    .where(and(eq(tierTable.teamId, teamId), eq(tierTable.id, tierId)))
    .limit(1);
  return rows[0] ?? null;
}
