"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentTeam } from "@/lib/db/queries";
import {
  bisChoice,
  floor,
  player as playerTable,
  tierBuyCost,
  tier as tierTable,
} from "@/lib/db/schema";
import { defaultBisChoicesForJob } from "@/lib/ffxiv/bis-defaults";
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
 *
 * v4.0.0 dropped the `updateTierWeightsAction` that exposed the
 * v3.3 min-cost-flow planner's slot/role weights — the greedy
 * planner that replaced MCMF computes its bottleneck dynamically
 * from the roster's need profile so there's no operator-tunable
 * weight knob anymore.
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

  // 1. Archive any currently-active tier on this team. v2.0 doesn't
  // need to track the previous tier to copy its roster from — the
  // new tier's roster comes from the team-level player list, not
  // from the previous tier — so we can drop the lookup that v1.x
  // used to do here.
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

  // 5. Auto-add every team player to the new tier's roster (v2.0 —
  // tier membership is implicit via `bis_choice` rows). Each
  // player gets the 12-slot Crafted-baseline default BiS plan so
  // the BiS table renders meaningfully from the moment the tier is
  // created. The team can then prune the roster via the tier-detail
  // Roster tab if a particular tier won't include everyone.
  //
  // The previous-tier's BiS plans deliberately don't carry over (a
  // new tier means a new max iLv — the team replans), but the
  // membership does. The `sourceTier` parameter is now informational
  // only; the auto-roster comes from the team, not the source tier.
  const teamRoster = await db
    .select({ id: playerTable.id, mainJob: playerTable.mainJob })
    .from(playerTable)
    .where(eq(playerTable.teamId, team.id))
    .orderBy(playerTable.sortOrder, playerTable.id);

  if (teamRoster.length > 0) {
    await db.insert(bisChoice).values(
      teamRoster.flatMap((p) =>
        defaultBisChoicesForJob(p.mainJob).map((d) => ({
          playerId: p.id,
          tierId: newTierId,
          slot: d.slot,
          desiredSource: d.desiredSource,
          currentSource: d.currentSource,
        })),
      ),
    );
  }

  // 6. Refresh every page that reads tiers or loot context.
  revalidatePath("/", "layout");
  return { ok: true, tierId: newTierId };
}
