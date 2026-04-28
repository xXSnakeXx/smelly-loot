import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  bossKill,
  floor as floorTable,
  lootDrop,
  raidWeek,
} from "@/lib/db/schema";

/**
 * Read-only helpers for the /loot page.
 *
 * The page needs three things per week: the floor config, which
 * floors have been cleared, and which drops have been assigned. Each
 * lookup is a single query; the page composes them into a render-
 * friendly shape.
 */

export async function listFloorsForTier(tierId: number) {
  return db
    .select()
    .from(floorTable)
    .where(eq(floorTable.tierId, tierId))
    .orderBy(floorTable.number);
}

export async function listBossKillsForWeek(raidWeekId: number) {
  return db.select().from(bossKill).where(eq(bossKill.raidWeekId, raidWeekId));
}

export async function listLootDropsForWeek(raidWeekId: number) {
  return db.select().from(lootDrop).where(eq(lootDrop.raidWeekId, raidWeekId));
}

export async function findLootDropForFloorItem(
  raidWeekId: number,
  floorId: number,
  itemKey: string,
) {
  const rows = await db
    .select()
    .from(lootDrop)
    .where(
      and(
        eq(lootDrop.raidWeekId, raidWeekId),
        eq(lootDrop.floorId, floorId),
        eq(lootDrop.itemKey, itemKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * For each floor in this tier, count how many `boss_kill` rows
 * exist in raid weeks whose `week_number` is strictly less than
 * `currentWeekNumber`. Drives the v4.2 Track-tab `bossKillIndex`
 * lookup: the operator's W3 kill of Boss 2 might be the plan's
 * "Boss-2 kill 2" if Boss 2 was already cleared in W1 but
 * skipped in W2.
 *
 * Returns a `Map<floorId, count>` — empty/zero entries are
 * omitted, so callers should default missing keys to 0.
 */
export async function countPriorBossKillsByFloorForTier(
  tierId: number,
  currentWeekNumber: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      floorId: bossKill.floorId,
      count: sql<number>`count(*)`,
    })
    .from(bossKill)
    .innerJoin(raidWeek, eq(raidWeek.id, bossKill.raidWeekId))
    .where(
      and(
        eq(raidWeek.tierId, tierId),
        lt(raidWeek.weekNumber, currentWeekNumber),
      ),
    )
    .groupBy(bossKill.floorId);
  return new Map(rows.map((r) => [r.floorId, Number(r.count)]));
}
