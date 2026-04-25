import { eq } from "drizzle-orm";

import { db } from "./client";
import { player } from "./schema";

/**
 * Read-only helpers around the `player` table.
 *
 * Lives in its own slice so feature pages can import a thin function
 * without pulling in the whole schema namespace.
 */

export async function listPlayersForTeam(teamId: number) {
  return db
    .select()
    .from(player)
    .where(eq(player.teamId, teamId))
    .orderBy(player.sortOrder, player.id);
}
