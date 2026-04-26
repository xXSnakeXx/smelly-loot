"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { bisChoice, player as playerTable } from "@/lib/db/schema";
import { defaultBisChoicesForJob } from "@/lib/ffxiv/bis-defaults";

/**
 * Server actions for tier-roster membership.
 *
 * Tier membership is implicit since v2.0: a player IS in a tier iff
 * at least one `bis_choice` row exists for the (player, tier) pair.
 * Adding a player to a tier therefore stamps the 12-slot
 * Crafted-baseline default BiS plan; removing them deletes every
 * `bis_choice` row for that pair.
 *
 * Both actions live in their own file so the heavier
 * `createTierAction` / `updateTierAction` server actions don't have
 * to drag in the BiS-defaults helper unless they need it.
 */

const addPlayerToTierSchema = z.object({
  tierId: z.coerce.number().int().positive(),
  playerId: z.coerce.number().int().positive(),
});

const removePlayerFromTierSchema = z.object({
  tierId: z.coerce.number().int().positive(),
  playerId: z.coerce.number().int().positive(),
});

export type RosterActionState =
  | { ok: true }
  | { ok: false; reason: "validation" | "not_found" | "already_member" };

/**
 * Add a player to a tier's roster.
 *
 * Looks up the player's `mainJob` to pick the right offhand default
 * (PLD = Crafted, everyone else = NotPlanned) and then inserts the
 * 12 default BiS rows in a single batched insert. The implicit
 * uniqueness constraint on `(player_id, tier_id, slot)` short-circuits
 * the insert if the player is already a member; we surface that as
 * an `already_member` reason rather than a hard error.
 */
export async function addPlayerToTierAction(
  _previous: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  const parsed = addPlayerToTierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, reason: "validation" };

  const { tierId, playerId } = parsed.data;

  const playerRow = await db
    .select({ id: playerTable.id, mainJob: playerTable.mainJob })
    .from(playerTable)
    .where(eq(playerTable.id, playerId))
    .limit(1);
  const p = playerRow[0];
  if (!p) return { ok: false, reason: "not_found" };

  // Cheap pre-check: if even one bis_choice row already exists for
  // (player, tier), the player is already in the roster. The
  // alternative is to rely on `ON CONFLICT DO NOTHING`, but signalling
  // the no-op explicitly lets the UI render an idempotent toast
  // ("already in roster") instead of a generic "added".
  const existing = await db
    .select({ playerId: bisChoice.playerId })
    .from(bisChoice)
    .where(and(eq(bisChoice.playerId, playerId), eq(bisChoice.tierId, tierId)))
    .limit(1);
  if (existing[0]) return { ok: false, reason: "already_member" };

  await db.insert(bisChoice).values(
    defaultBisChoicesForJob(p.mainJob).map((d) => ({
      playerId,
      tierId,
      slot: d.slot,
      desiredSource: d.desiredSource,
      currentSource: d.currentSource,
    })),
  );

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Remove a player from a tier's roster.
 *
 * Deletes every `bis_choice` row for the (player, tier) pair, which
 * implicitly removes them from the roster. Loot drops the player
 * received in this tier are kept intact — they're tier-scoped via
 * `raid_week.tier_id`, not via roster membership, and dropping
 * historical loot when someone leaves a roster mid-tier would erase
 * legitimate history.
 */
export async function removePlayerFromTierAction(
  _previous: RosterActionState,
  formData: FormData,
): Promise<RosterActionState> {
  const parsed = removePlayerFromTierSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success) return { ok: false, reason: "validation" };

  const { tierId, playerId } = parsed.data;

  await db
    .delete(bisChoice)
    .where(and(eq(bisChoice.playerId, playerId), eq(bisChoice.tierId, tierId)));

  revalidatePath("/", "layout");
  return { ok: true };
}
