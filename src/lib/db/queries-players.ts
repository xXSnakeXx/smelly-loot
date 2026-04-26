import { eq } from "drizzle-orm";

import { db } from "./client";
import { player } from "./schema";

/**
 * Read-only helpers around the `player` table.
 *
 * Lives in its own slice so feature pages can import a thin function
 * without pulling in the whole schema namespace.
 *
 * Players are tier-scoped (v1.4) — each tier owns its own roster, so
 * the canonical list is `listPlayersForTier(tierId)`. Cross-tier
 * lookups (e.g. "find Brad's previous-tier counterpart") need an
 * explicit name-based join because the v1.4 migration deliberately
 * does not preserve a stable identity across tiers.
 */

export async function listPlayersForTier(tierId: number) {
  return db
    .select()
    .from(player)
    .where(eq(player.tierId, tierId))
    .orderBy(player.sortOrder, player.id);
}
