import { eq } from "drizzle-orm";

import { db } from "./client";
import { bisChoice, player } from "./schema";

/**
 * Read-only helpers around the BiS tracker.
 */

export async function findPlayer(playerId: number) {
  const rows = await db
    .select()
    .from(player)
    .where(eq(player.id, playerId))
    .limit(1);
  return rows[0];
}

export async function listBisChoicesForPlayer(playerId: number) {
  return db.select().from(bisChoice).where(eq(bisChoice.playerId, playerId));
}
