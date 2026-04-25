"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { tier as tierTable } from "@/lib/db/schema";
import { deriveSourceIlvs } from "@/lib/ffxiv/slots";

/**
 * Tier-edit Server Action.
 *
 * Phase 1.3 ships the minimum viable tier configuration UX: name +
 * max_ilv, and we cascade the per-source iLvs from the new max via
 * `deriveSourceIlvs`. Per-source overrides and editable buy costs are
 * out of scope for v1.0.0; they're tracked under "Pending for v1.1"
 * in CHANGELOG.md.
 */

const updateTierSchema = z.object({
  tierId: z.coerce.number().int().positive(),
  name: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "required" }),
  maxIlv: z.coerce.number().int().min(100).max(2000),
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

export async function updateTierAction(
  formData: FormData,
): Promise<ActionState> {
  const parsed = updateTierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }
  const { tierId, name, maxIlv } = parsed.data;
  const ilvs = deriveSourceIlvs(maxIlv);

  await db
    .update(tierTable)
    .set({
      name,
      maxIlv,
      ilvSavage: ilvs.Savage,
      ilvTomeUp: ilvs.TomeUp,
      ilvCatchup: ilvs.Catchup,
      ilvTome: ilvs.Tome,
      ilvExtreme: ilvs.Extreme,
      ilvRelic: ilvs.Relic,
      ilvCrafted: ilvs.Crafted,
      ilvWhyyyy: ilvs.WHYYYY,
      ilvJustNo: ilvs.JustNo,
    })
    .where(eq(tierTable.id, tierId));

  revalidatePath("/", "layout");
  return { ok: true };
}
