import { and, eq } from "drizzle-orm";

import { db } from "./client";
import { bisChoice, player } from "./schema";

/**
 * Read-only helpers around the BiS tracker.
 *
 * BiS choices are scoped to (player, tier, slot) since v2.0 — the
 * same player on different tiers has different plans because each
 * tier's `max_ilv` and source iLvs differ.
 */

export async function findPlayer(playerId: number) {
  const rows = await db
    .select()
    .from(player)
    .where(eq(player.id, playerId))
    .limit(1);
  return rows[0];
}

export async function listBisChoicesForPlayer(
  playerId: number,
  tierId: number,
) {
  return db
    .select()
    .from(bisChoice)
    .where(and(eq(bisChoice.playerId, playerId), eq(bisChoice.tierId, tierId)));
}
