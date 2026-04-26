"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { bisChoice } from "@/lib/db/schema";

import { type BisUpsertInput, bisUpsertSchema } from "./schemas";

/**
 * Result envelope for the BiS upsert action.
 *
 * The BiS tracker calls this on every dropdown change, so a single
 * boolean is sufficient — the UI shows toasts only on failure.
 */
export type SaveBisResult =
  | { ok: true }
  | { ok: false; reason: "validation"; errors: Record<string, string> };

/**
 * Upsert a single BiS slot row for a player.
 *
 * The action is idempotent: on first save the row is inserted, on
 * subsequent saves it's updated in place via SQLite's `ON CONFLICT`
 * clause.
 *
 * `received_at` is set automatically the first time the row is
 * created with a non-NotPlanned currentSource — that timestamp
 * drives the spreadsheet's "Date" column. The follow-up update
 * clears it back to NULL if the user "unequips" the slot (rare).
 *
 * Unlike the player-CRUD actions this one accepts a typed payload
 * instead of `FormData`, because the BiS tracker fires the action on
 * every dropdown change. A typed payload keeps the call sites
 * lightweight and lets the form skip the `useActionState` boilerplate.
 */
export async function saveBisChoice(
  input: BisUpsertInput,
): Promise<SaveBisResult> {
  const parsed = bisUpsertSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    const errors: Record<string, string> = {};
    for (const [key, value] of Object.entries(flat.fieldErrors)) {
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (typeof first === "string") errors[key] = first;
      }
    }
    return { ok: false, reason: "validation", errors };
  }

  const data = parsed.data;
  const wearsSomething = data.currentSource !== "NotPlanned";

  await db
    .insert(bisChoice)
    .values({
      playerId: data.playerId,
      slot: data.slot,
      desiredSource: data.desiredSource,
      currentSource: data.currentSource,
      marker: data.marker ?? null,
      receivedAt: wearsSomething ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [bisChoice.playerId, bisChoice.slot],
      set: {
        desiredSource: data.desiredSource,
        currentSource: data.currentSource,
        marker: data.marker ?? null,
      },
    });

  if (!wearsSomething) {
    await db
      .update(bisChoice)
      .set({ receivedAt: null })
      .where(
        and(
          eq(bisChoice.playerId, data.playerId),
          eq(bisChoice.slot, data.slot),
        ),
      );
  }

  // BiS edits feed straight into the algorithm's `desired_source` /
  // `current_source` lookups, so every tier-scoped surface
  // (`/tiers/[id]` Plan / Track / Players / History tabs, the
  // dashboard tier card stats, the player detail page) needs to
  // re-render. `revalidatePath("/", "layout")` invalidates every
  // route below the root layout in one call — broader than strictly
  // necessary, but the cost is negligible and the alternative is a
  // brittle list of explicit per-route paths.
  revalidatePath("/", "layout");
  return { ok: true };
}
