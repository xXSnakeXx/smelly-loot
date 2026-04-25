"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentTeam } from "@/lib/db/queries";
import { team } from "@/lib/db/schema";

import { teamSettingsSchema } from "./schemas";

export type ActionState =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

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
 * Update the active team's name and default locale.
 *
 * Phase 1 has exactly one team per deployment; the call resolves the
 * row via `getCurrentTeam()` rather than trusting an `id` field from
 * the form, which avoids a cross-team-write footgun once Phase 3
 * lands the multi-team feature.
 *
 * The path revalidations cover every route that reads the team — the
 * dashboard, the players page, the upcoming tier page — so renaming
 * the static reflects everywhere immediately.
 */
export async function updateTeamSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = teamSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  const current = await getCurrentTeam();
  await db
    .update(team)
    .set({ name: parsed.data.name, locale: parsed.data.locale })
    .where(eq(team.id, current.id));

  revalidatePath("/", "layout");
  return { ok: true };
}
