import { and, count, eq, inArray, sum } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  bossKill,
  floor as floorTable,
  lootDrop,
  pageAdjust,
  raidWeek as raidWeekTable,
  tierBuyCost,
} from "@/lib/db/schema";

const FLOOR_NUMBERS = [1, 2, 3, 4] as const;
const MATERIAL_KEYS = ["Glaze", "Twine", "Ester"] as const;

export interface PerFloorPageStats {
  floorNumber: number;
  kills: number;
  adjust: number;
  spent: number;
  current: number;
}

export interface PlayerStats {
  playerId: number;
  pagesByFloor: PerFloorPageStats[];
  /**
   * Materials *received* this tier as direct drops or token purchases.
   */
  materialsReceived: Record<"Glaze" | "Twine" | "Ester", number>;
  /**
   * Savage gear drops awarded to this player this tier (excludes
   * materials and token-paid items).
   */
  savageDropsThisTier: number;
}

/**
 * Compute per-player page balances + drop counts for the given tier.
 *
 * Mirrors the same auto-derivation rules the algorithm uses inside
 * `loadPlayerSnapshots`, but reshapes the output for the per-player
 * UI ("Pages & Materials" card on /players/[id]).
 */
export async function loadPlayerStats(
  playerId: number,
  tierId: number,
): Promise<PlayerStats> {
  // 1. Boss kills per floor on the tier (team-wide; everyone earns
  //    them in lockstep).
  const killRows = await db
    .select({
      floorNumber: floorTable.number,
      kills: count(),
    })
    .from(bossKill)
    .innerJoin(raidWeekTable, eq(bossKill.raidWeekId, raidWeekTable.id))
    .innerJoin(floorTable, eq(bossKill.floorId, floorTable.id))
    .where(eq(raidWeekTable.tierId, tierId))
    .groupBy(floorTable.number);
  const killsByFloor = new Map<number, number>(
    killRows.map((r) => [r.floorNumber, r.kills]),
  );

  // 2. This player's page-adjust rows.
  const adjustRows = await db
    .select()
    .from(pageAdjust)
    .where(
      and(eq(pageAdjust.tierId, tierId), eq(pageAdjust.playerId, playerId)),
    );
  const adjustsByFloor = new Map<number, number>(
    adjustRows.map((r) => [r.floorNumber, r.delta]),
  );

  // 3. Tokens this player spent (paid_with_pages = true) per floor.
  const spentRows = await db
    .select({
      floorNumber: tierBuyCost.floorNumber,
      total: sum(tierBuyCost.cost),
    })
    .from(lootDrop)
    .innerJoin(raidWeekTable, eq(lootDrop.raidWeekId, raidWeekTable.id))
    .innerJoin(
      tierBuyCost,
      and(
        eq(tierBuyCost.tierId, raidWeekTable.tierId),
        eq(tierBuyCost.itemKey, lootDrop.itemKey),
      ),
    )
    .where(
      and(
        eq(raidWeekTable.tierId, tierId),
        eq(lootDrop.paidWithPages, true),
        eq(lootDrop.recipientId, playerId),
      ),
    )
    .groupBy(tierBuyCost.floorNumber);
  const spentByFloor = new Map<number, number>(
    spentRows.map((r) => [r.floorNumber, Number(r.total ?? 0)]),
  );

  // 4. Materials received as direct drops (not paid_with_pages
  //    token-purchases — those don't count as "received" in the
  //    spreadsheet's tally either).
  const materialRows = await db
    .select({
      itemKey: lootDrop.itemKey,
      received: count(),
    })
    .from(lootDrop)
    .innerJoin(raidWeekTable, eq(lootDrop.raidWeekId, raidWeekTable.id))
    .where(
      and(
        eq(raidWeekTable.tierId, tierId),
        eq(lootDrop.recipientId, playerId),
        inArray(lootDrop.itemKey, MATERIAL_KEYS as unknown as string[]),
      ),
    )
    .groupBy(lootDrop.itemKey);
  const materialsReceived: Record<"Glaze" | "Twine" | "Ester", number> = {
    Glaze: 0,
    Twine: 0,
    Ester: 0,
  };
  for (const row of materialRows) {
    if (
      row.itemKey === "Glaze" ||
      row.itemKey === "Twine" ||
      row.itemKey === "Ester"
    ) {
      materialsReceived[row.itemKey] = row.received;
    }
  }

  // 5. Savage gear drops this tier (everything that isn't a material
  //    and wasn't paid via pages).
  const savageRow = await db
    .select({ drops: count() })
    .from(lootDrop)
    .innerJoin(raidWeekTable, eq(lootDrop.raidWeekId, raidWeekTable.id))
    .where(
      and(
        eq(raidWeekTable.tierId, tierId),
        eq(lootDrop.recipientId, playerId),
        eq(lootDrop.paidWithPages, false),
      ),
    );
  const savageRaw = savageRow[0]?.drops ?? 0;
  const savageOfMaterialsRow = await db
    .select({ drops: count() })
    .from(lootDrop)
    .innerJoin(raidWeekTable, eq(lootDrop.raidWeekId, raidWeekTable.id))
    .where(
      and(
        eq(raidWeekTable.tierId, tierId),
        eq(lootDrop.recipientId, playerId),
        eq(lootDrop.paidWithPages, false),
        inArray(lootDrop.itemKey, MATERIAL_KEYS as unknown as string[]),
      ),
    );
  const savageDropsThisTier = Math.max(
    0,
    savageRaw - (savageOfMaterialsRow[0]?.drops ?? 0),
  );

  // Stitch the per-floor view.
  const pagesByFloor: PerFloorPageStats[] = FLOOR_NUMBERS.map((n) => {
    const kills = killsByFloor.get(n) ?? 0;
    const adjust = adjustsByFloor.get(n) ?? 0;
    const spent = spentByFloor.get(n) ?? 0;
    const current = Math.max(0, kills + adjust - spent);
    return { floorNumber: n, kills, adjust, spent, current };
  });

  return {
    playerId,
    pagesByFloor,
    materialsReceived,
    savageDropsThisTier,
  };
}
