import { and, count, desc, eq, inArray, max, sum } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  bisChoice,
  bossKill,
  floor as floorTable,
  lootDrop,
  pageAdjust,
  player as playerTable,
  raidWeek as raidWeekTable,
  tierBuyCost,
  tier as tierTable,
} from "@/lib/db/schema";
import { jobToGearRole } from "@/lib/ffxiv/jobs";
import type { BisSource, ItemKey, Slot } from "@/lib/ffxiv/slots";

import type { MaterialKey, PlayerSnapshot, TierSnapshot } from "./algorithm";

/**
 * DB → algorithm-input adapters.
 *
 * The scoring engine (`algorithm.ts`) operates on plain `PlayerSnapshot`
 * and `TierSnapshot` objects. The two loaders here translate the
 * relational model into those shapes.
 *
 * Loaders intentionally fan out into multiple small queries instead of
 * one mega-join. SQLite handles eight queries against a single-digit-MB
 * database in well under a millisecond, and the read code stays
 * dramatically easier to follow than a 50-line CTE.
 *
 * `loadPlayerSnapshots(teamId, tierId)` is the only public entry; it
 * returns every player on the team plus the data the algorithm needs
 * to score a drop for that player on the active tier.
 */

const FLOOR_NUMBERS = [1, 2, 3, 4] as const;
const MATERIAL_KEYS: ReadonlyArray<MaterialKey> = ["Glaze", "Twine", "Ester"];

function indexBy<T, K>(
  rows: ReadonlyArray<T>,
  key: (row: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const existing = out.get(k);
    if (existing) existing.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/**
 * Build a `PlayerSnapshot` for every player on the tier's roster.
 *
 * The snapshot is computed against the given tier — page balances,
 * Savage drop counts, "last drop from this floor", and material
 * tallies all consider only loot from `tier_id = tierId`.
 *
 * Players whose `mainJob` doesn't map to a known gear role are
 * defaulted to `caster` (no role-weight bonus). The job dropdown only
 * lets users pick known jobs, so this fallback is purely defensive.
 */
export async function loadPlayerSnapshots(
  tierId: number,
): Promise<PlayerSnapshot[]> {
  // 1. Players + their BiS choices.
  const players = await db
    .select()
    .from(playerTable)
    .where(eq(playerTable.tierId, tierId))
    .orderBy(playerTable.sortOrder, playerTable.id);

  if (players.length === 0) return [];

  const playerIds = players.map((p) => p.id);
  const bisRows = await db
    .select()
    .from(bisChoice)
    .where(inArray(bisChoice.playerId, playerIds));
  const bisByPlayer = indexBy(bisRows, (r) => r.playerId);

  // 2. Boss kills per floor (tier-wide; every player on the team gets
  //    +1 page of that floor's token per kill).
  const killCounts = await db
    .select({
      floorNumber: floorTable.number,
      kills: count(),
    })
    .from(bossKill)
    .innerJoin(raidWeekTable, eq(bossKill.raidWeekId, raidWeekTable.id))
    .innerJoin(floorTable, eq(bossKill.floorId, floorTable.id))
    .where(eq(raidWeekTable.tierId, tierId))
    .groupBy(floorTable.number);
  const killsByFloor = new Map<number, number>();
  for (const row of killCounts) {
    killsByFloor.set(row.floorNumber, row.kills);
  }

  // 3. Page adjustments (per player + floor).
  const adjustRows = await db
    .select()
    .from(pageAdjust)
    .where(eq(pageAdjust.tierId, tierId));
  const adjustsByPlayerFloor = new Map<string, number>();
  for (const row of adjustRows) {
    adjustsByPlayerFloor.set(`${row.playerId}|${row.floorNumber}`, row.delta);
  }

  // 4. Tokens spent per (player, floor). A token-paid loot_drop
  //    consumes `tier_buy_cost.cost` of `tier_buy_cost.floor_number`
  //    tokens. We sum that per (recipient, floor).
  const spentRows = await db
    .select({
      recipientId: lootDrop.recipientId,
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
      and(eq(raidWeekTable.tierId, tierId), eq(lootDrop.paidWithPages, true)),
    )
    .groupBy(lootDrop.recipientId, tierBuyCost.floorNumber);
  const spentByPlayerFloor = new Map<string, number>();
  for (const row of spentRows) {
    if (row.recipientId === null) continue;
    // SQLite returns SUM as a string; coerce explicitly.
    const total = Number(row.total ?? 0);
    spentByPlayerFloor.set(`${row.recipientId}|${row.floorNumber}`, total);
  }

  // 5. Savage drops per player (gear, not material, not paid via pages).
  const savageRows = await db
    .select({
      recipientId: lootDrop.recipientId,
      drops: count(),
    })
    .from(lootDrop)
    .innerJoin(raidWeekTable, eq(lootDrop.raidWeekId, raidWeekTable.id))
    .where(
      and(eq(raidWeekTable.tierId, tierId), eq(lootDrop.paidWithPages, false)),
    )
    .groupBy(lootDrop.recipientId);
  const savageByPlayer = new Map<number, number>();
  for (const row of savageRows) {
    if (row.recipientId === null) continue;
    savageByPlayer.set(row.recipientId, row.drops);
  }
  // Subtract material drops from the savage count — the algorithm
  // wants gear-only fairness, and materials shouldn't deflate the
  // factor.
  const materialDropRows = await db
    .select({
      recipientId: lootDrop.recipientId,
      drops: count(),
    })
    .from(lootDrop)
    .innerJoin(raidWeekTable, eq(lootDrop.raidWeekId, raidWeekTable.id))
    .where(
      and(
        eq(raidWeekTable.tierId, tierId),
        eq(lootDrop.paidWithPages, false),
        inArray(lootDrop.itemKey, MATERIAL_KEYS as unknown as ItemKey[]),
      ),
    )
    .groupBy(lootDrop.recipientId);
  for (const row of materialDropRows) {
    if (row.recipientId === null) continue;
    const current = savageByPlayer.get(row.recipientId) ?? 0;
    savageByPlayer.set(row.recipientId, Math.max(0, current - row.drops));
  }

  // 6. Last drop week per (player, floor).
  const lastDropRows = await db
    .select({
      recipientId: lootDrop.recipientId,
      floorNumber: floorTable.number,
      lastWeek: max(raidWeekTable.weekNumber),
    })
    .from(lootDrop)
    .innerJoin(raidWeekTable, eq(lootDrop.raidWeekId, raidWeekTable.id))
    .innerJoin(floorTable, eq(lootDrop.floorId, floorTable.id))
    .where(eq(raidWeekTable.tierId, tierId))
    .groupBy(lootDrop.recipientId, floorTable.number);
  const lastDropByPlayerFloor = new Map<string, number>();
  for (const row of lastDropRows) {
    if (row.recipientId === null || row.lastWeek === null) continue;
    lastDropByPlayerFloor.set(
      `${row.recipientId}|${row.floorNumber}`,
      row.lastWeek,
    );
  }

  // 7. Materials received per player.
  const materialRows = await db
    .select({
      recipientId: lootDrop.recipientId,
      itemKey: lootDrop.itemKey,
      received: count(),
    })
    .from(lootDrop)
    .innerJoin(raidWeekTable, eq(lootDrop.raidWeekId, raidWeekTable.id))
    .where(
      and(
        eq(raidWeekTable.tierId, tierId),
        inArray(lootDrop.itemKey, MATERIAL_KEYS as unknown as ItemKey[]),
      ),
    )
    .groupBy(lootDrop.recipientId, lootDrop.itemKey);
  const materialsByPlayer = new Map<number, Map<MaterialKey, number>>();
  for (const row of materialRows) {
    if (row.recipientId === null) continue;
    const inner =
      materialsByPlayer.get(row.recipientId) ?? new Map<MaterialKey, number>();
    inner.set(row.itemKey as MaterialKey, row.received);
    materialsByPlayer.set(row.recipientId, inner);
  }

  // 8. Stitch the snapshot per player.
  return players.map((player) => {
    const bis = bisByPlayer.get(player.id) ?? [];
    const role = jobToGearRole(player.mainJob) ?? "caster";

    const pages = new Map<number, number>();
    for (const floorNumber of FLOOR_NUMBERS) {
      const kills = killsByFloor.get(floorNumber) ?? 0;
      const adjust =
        adjustsByPlayerFloor.get(`${player.id}|${floorNumber}`) ?? 0;
      const spent = spentByPlayerFloor.get(`${player.id}|${floorNumber}`) ?? 0;
      pages.set(floorNumber, Math.max(0, kills + adjust - spent));
    }

    const lastDropWeekByFloor = new Map<number, number | null>();
    for (const floorNumber of FLOOR_NUMBERS) {
      const last = lastDropByPlayerFloor.get(`${player.id}|${floorNumber}`);
      lastDropWeekByFloor.set(floorNumber, last ?? null);
    }

    return {
      id: player.id,
      name: player.name,
      gearRole: role,
      bisDesired: new Map(
        bis.map((row) => [row.slot as Slot, row.desiredSource as BisSource]),
      ),
      bisCurrent: new Map(
        bis.map((row) => [row.slot as Slot, row.currentSource as BisSource]),
      ),
      pages,
      materialsReceived:
        materialsByPlayer.get(player.id) ?? new Map<MaterialKey, number>(),
      savageDropsThisTier: savageByPlayer.get(player.id) ?? 0,
      lastDropWeekByFloor,
    };
  });
}

/**
 * Convert a tier row + its `tier_buy_cost` rows into the
 * `TierSnapshot` shape the algorithm expects.
 */
export async function loadTierSnapshot(tierId: number): Promise<TierSnapshot> {
  const tierRows = await db
    .select()
    .from(tierTable)
    .where(eq(tierTable.id, tierId))
    .limit(1);
  const t = tierRows[0];
  if (!t) throw new Error(`[snapshots] tier ${tierId} not found`);

  const buyRows = await db
    .select()
    .from(tierBuyCost)
    .where(eq(tierBuyCost.tierId, tierId));
  const buyCostByItem = new Map<ItemKey, { floor: number; cost: number }>();
  for (const row of buyRows) {
    buyCostByItem.set(row.itemKey as ItemKey, {
      floor: row.floorNumber,
      cost: row.cost,
    });
  }

  return {
    maxIlv: t.maxIlv,
    ilvSavage: t.ilvSavage,
    ilvTomeUp: t.ilvTomeUp,
    ilvCatchup: t.ilvCatchup,
    ilvTome: t.ilvTome,
    ilvExtreme: t.ilvExtreme,
    ilvRelic: t.ilvRelic,
    ilvCrafted: t.ilvCrafted,
    ilvWhyyyy: t.ilvWhyyyy,
    ilvJustNo: t.ilvJustNo,
    buyCostByItem,
  };
}

/**
 * Convenience: most-recent raid week for a tier, or `null` if no week
 * exists yet.
 */
export async function findCurrentRaidWeek(tierId: number) {
  const rows = await db
    .select()
    .from(raidWeekTable)
    .where(eq(raidWeekTable.tierId, tierId))
    .orderBy(desc(raidWeekTable.weekNumber))
    .limit(1);
  return rows[0] ?? null;
}
