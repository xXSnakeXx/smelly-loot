"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { pageAdjust } from "@/lib/db/schema";

/**
 * Server Action: persist a single per-(player, tier, floor)
 * page-adjust delta.
 *
 * The schema's composite PK on (player_id, tier_id, floor_number)
 * makes this an upsert — `ON CONFLICT DO UPDATE` lets us avoid a
 * pre-flight SELECT.
 *
 * Lives in `src/lib/stats` rather than `src/lib/loot` because page
 * tracking is a per-player accounting concern, separate from the
 * weekly loot-distribution flow.
 */

const updatePageAdjustSchema = z.object({
  playerId: z.coerce.number().int().positive(),
  tierId: z.coerce.number().int().positive(),
  floorNumber: z.coerce.number().int().min(1).max(4),
  delta: z.coerce.number().int().min(-99).max(99),
});

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

export async function updatePageAdjustAction(
  formData: FormData,
): Promise<ActionState> {
  const parsed = updatePageAdjustSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }
  const data = parsed.data;

  if (data.delta === 0) {
    // Drop the row entirely on zero so the editor stays clean.
    await db
      .delete(pageAdjust)
      .where(
        and(
          eq(pageAdjust.playerId, data.playerId),
          eq(pageAdjust.tierId, data.tierId),
          eq(pageAdjust.floorNumber, data.floorNumber),
        ),
      );
  } else {
    await db
      .insert(pageAdjust)
      .values({
        playerId: data.playerId,
        tierId: data.tierId,
        floorNumber: data.floorNumber,
        delta: data.delta,
      })
      .onConflictDoUpdate({
        target: [
          pageAdjust.playerId,
          pageAdjust.tierId,
          pageAdjust.floorNumber,
        ],
        set: { delta: data.delta },
      });
  }

  // Page-balance adjustments change the algorithm's
  // `effective_need` for every future drop — so every tier-scoped
  // surface (`/tiers/[id]` Plan tab in particular) needs to
  // re-render. `revalidatePath("/", "layout")` invalidates every
  // route below the root layout in one call. The previous
  // per-route invalidation (`/players/${id}` + `/loot`) was
  // narrower than the data dependency and missed the post-v1.2.0
  // `/tiers/[id]` page entirely (the legacy `/loot` route is now
  // just a redirect).
  revalidatePath("/", "layout");
  return { ok: true };
}
