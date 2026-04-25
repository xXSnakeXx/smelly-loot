"use server";

import { eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentTeam } from "@/lib/db/queries";
import { player } from "@/lib/db/schema";

import {
  playerCreateSchema,
  playerDeleteSchema,
  playerUpdateSchema,
} from "./schemas";

export type ActionState =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

/**
 * Convert a Zod validation failure into the per-field error map the
 * UI renders next to each input. Zod 4's `flattenError` helper does
 * the heavy lifting; we just take the first message per field.
 */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const flat = z.flattenError(error);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(flat.fieldErrors)) {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (typeof first === "string") out[key] = first;
    }
  }
  return out;
}

/**
 * Create a player on the active team.
 *
 * Sort order is set to `max(sort_order) + 1` so newly added players
 * land at the end of the table; the team-overview page later exposes
 * drag handles to reorder.
 */
export async function createPlayerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = playerCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  const team = await getCurrentTeam();

  const orderRow = await db
    .select({ nextOrder: max(player.sortOrder) })
    .from(player)
    .where(eq(player.teamId, team.id));
  const nextOrder = (orderRow[0]?.nextOrder ?? 0) + 1;

  await db.insert(player).values({
    teamId: team.id,
    name: parsed.data.name,
    mainJob: parsed.data.mainJob,
    altJobs: parsed.data.altJobs,
    gearLink: parsed.data.gearLink ?? null,
    notes: parsed.data.notes ?? null,
    sortOrder: nextOrder,
  });

  revalidatePath("/players");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Update an existing player. Only the editable fields touch the row;
 * `team_id`, `sort_order`, and `created_at` are intentionally
 * preserved.
 */
export async function updatePlayerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = playerUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  await db
    .update(player)
    .set({
      name: parsed.data.name,
      mainJob: parsed.data.mainJob,
      altJobs: parsed.data.altJobs,
      gearLink: parsed.data.gearLink ?? null,
      notes: parsed.data.notes ?? null,
    })
    .where(eq(player.id, parsed.data.id));

  revalidatePath("/players");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Delete a player. The schema's cascade settings handle dependent
 * BiS choices automatically; loot drops the player previously
 * received are kept (the FK has `ON DELETE SET NULL`) so the history
 * stays accurate even after a player leaves the static.
 */
export async function deletePlayerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = playerDeleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  await db.delete(player).where(eq(player.id, parsed.data.id));

  revalidatePath("/players");
  revalidatePath("/");
  return { ok: true };
}
