"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentTeam } from "@/lib/db/queries";
import {
  floor,
  player as playerTable,
  tierBuyCost,
  tier as tierTable,
} from "@/lib/db/schema";
import { deriveSourceIlvs } from "@/lib/ffxiv/slots";
import { DEFAULT_BUY_COSTS, DEFAULT_FLOORS } from "@/lib/ffxiv/tier-defaults";

/**
 * Tier-edit and tier-create Server Actions.
 *
 * `updateTierAction` ships the minimum-viable tier configuration
 * UX: name + max_ilv, with the per-source iLvs cascading from the
 * new max via `deriveSourceIlvs`. Per-source overrides and editable
 * buy costs are still on the v1.x wishlist.
 *
 * `createTierAction` provisions a brand-new tier alongside the
 * canonical Heavyweight floor + buy-cost defaults
 * (`tier-defaults.ts`). It also archives every previously-active
 * tier on the same team so there's exactly one active tier at any
 * point in time — that matches Topic 7's "tier rollover" decision
 * in the roadmap and keeps every legacy `getActiveTier` caller
 * pointing at the freshly-created tier without further work.
 */

const updateTierSchema = z.object({
  tierId: z.coerce.number().int().positive(),
  name: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "required" }),
  maxIlv: z.coerce.number().int().min(100).max(2000),
});

const createTierSchema = z.object({
  name: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "required" }),
  maxIlv: z.coerce.number().int().min(100).max(2000),
});

export type ActionState =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

export type CreateTierActionState =
  | { ok: true; tierId: number }
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

/**
 * Create a new tier on the active team and make it the only active
 * tier on that team.
 *
 * Steps:
 *
 * 1. Archive every other non-archived tier on the team by setting
 *    `archived_at = now()`. Existing weeks, drops, and BiS choices
 *    are kept intact — only the active flag flips.
 * 2. Insert the new tier with the cascaded per-source iLvs.
 * 3. Insert the four-floor layout from `DEFAULT_FLOORS` and the
 *    matching `DEFAULT_BUY_COSTS` rows so the freshly-created tier
 *    is immediately usable for loot tracking.
 * 4. Revalidate every loot-related route.
 *
 * The four DB writes are issued sequentially because libSQL doesn't
 * fail-fast on overlapping inserts and the dataset is tiny (~20
 * rows total). If a future tier ships with a more elaborate floor
 * layout this would be a candidate for `db.transaction(...)`.
 */
export async function createTierAction(
  _previous: CreateTierActionState,
  formData: FormData,
): Promise<CreateTierActionState> {
  const parsed = createTierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }
  const { name, maxIlv } = parsed.data;
  const team = await getCurrentTeam();
  const ilvs = deriveSourceIlvs(maxIlv);

  // 1. Identify the previously-active tier (if any) so we can copy
  // its roster across. Captured BEFORE the archive step below
  // because once the row is archived `getActiveTier` would return a
  // different tier (or throw).
  const previouslyActive = await db
    .select()
    .from(tierTable)
    .where(and(eq(tierTable.teamId, team.id), isNull(tierTable.archivedAt)))
    .orderBy(tierTable.createdAt);
  const sourceTier = previouslyActive.at(-1);

  // 2. Archive any currently-active tier on this team.
  await db
    .update(tierTable)
    .set({ archivedAt: new Date() })
    .where(and(eq(tierTable.teamId, team.id), isNull(tierTable.archivedAt)));

  // 3. Insert the new tier and capture its id.
  const inserted = await db
    .insert(tierTable)
    .values({
      teamId: team.id,
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
    .returning({ id: tierTable.id });
  const newTierId = inserted[0]?.id;
  if (newTierId === undefined) {
    return { ok: false, errors: { name: "createFailed" } };
  }

  // 4. Floor layout + buy costs.
  await db.insert(floor).values(
    DEFAULT_FLOORS.map((f) => ({
      tierId: newTierId,
      number: f.number,
      drops: [...f.drops],
      pageTokenLabel: f.pageTokenLabel,
      trackedForAlgorithm: f.trackedForAlgorithm,
    })),
  );
  await db.insert(tierBuyCost).values(
    DEFAULT_BUY_COSTS.map((c) => ({
      tierId: newTierId,
      itemKey: c.itemKey,
      floorNumber: c.floorNumber,
      cost: c.cost,
    })),
  );

  // 5. Copy the previous tier's roster onto the new tier (Topic
  // "tier-rollover keeps the static together" — players are
  // tier-scoped, so creating a new tier without copying would leave
  // the new tier completely empty). BiS / page balances / loot
  // history deliberately don't copy: each tier starts fresh on
  // those fronts so the team can replan around new gear options.
  if (sourceTier) {
    const previousRoster = await db
      .select()
      .from(playerTable)
      .where(eq(playerTable.tierId, sourceTier.id))
      .orderBy(playerTable.sortOrder, playerTable.id);

    if (previousRoster.length > 0) {
      await db.insert(playerTable).values(
        previousRoster.map((p) => ({
          tierId: newTierId,
          name: p.name,
          mainJob: p.mainJob,
          altJobs: p.altJobs,
          gearLink: p.gearLink ?? null,
          notes: p.notes ?? null,
          sortOrder: p.sortOrder,
        })),
      );
    }
  }

  // 6. Refresh every page that reads tiers or loot context.
  revalidatePath("/", "layout");
  return { ok: true, tierId: newTierId };
}
