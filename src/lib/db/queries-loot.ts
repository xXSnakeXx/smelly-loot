import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { bossKill, floor as floorTable, lootDrop } from "@/lib/db/schema";

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
