"use server";

import { and, desc, eq, inArray, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  bisChoice,
  bossKill,
  floor as floorTable,
  lootDrop,
  raidWeek as raidWeekTable,
} from "@/lib/db/schema";
import { type BisSource, type ItemKey, type Slot } from "@/lib/ffxiv/slots";
import { sourceForItem, slotsForItem } from "./algorithm";

import { invalidatePlanCache, refreshPlan } from "./plan-cache";
import {
  awardLootDropSchema,
  createRaidWeekSchema,
  recordBossKillSchema,
  resetRaidWeekSchema,
  undoBossKillSchema,
  undoLootDropSchema,
} from "./schemas";

/**
 * Server Actions for the loot-distribution flow.
 *
 * Each action is idempotent on input and returns a small typed
 * envelope so the UI can decide between toast + revalidate or
 * surface an error. The actions intentionally don't run the scoring
 * algorithm — that's done in the Server Component for the page so
 * the user always sees the same recommendation that the persisted
 * `score_snapshot` reflects.
 */

export type LootActionResult =
  | { ok: true }
  | { ok: false; reason: "validation"; errors: Record<string, string> }
  | { ok: false; reason: "conflict"; message: string };

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
 * Start a new raid week on the given tier.
 *
 * The new `weekNumber` is `max(weekNumber) + 1` for that tier — the
 * unique index on (tierId, weekNumber) catches concurrent inserts as
 * a constraint failure, which we surface as a `conflict` result so
 * the UI can prompt for a refresh instead of crashing.
 */
export async function createRaidWeekAction(
  formData: FormData,
): Promise<LootActionResult> {
  const parsed = createRaidWeekSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      errors: fieldErrors(parsed.error),
    };
  }
  const { tierId } = parsed.data;

  const lastRow = await db
    .select({ last: max(raidWeekTable.weekNumber) })
    .from(raidWeekTable)
    .where(eq(raidWeekTable.tierId, tierId));
  const nextNumber = (lastRow[0]?.last ?? 0) + 1;

  try {
    await db.insert(raidWeekTable).values({
      tierId,
      weekNumber: nextNumber,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "conflict",
      message:
        error instanceof Error ? error.message : "raid_week insert failed",
    };
  }

  revalidatePath("/loot");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Record a boss kill — the floor was cleared this week, so every
 * member of the team gains 1 page of that floor's token.
 *
 * Idempotent: running the action twice for the same (raidWeek, floor)
 * is treated as a no-op rather than a constraint failure.
 */
export async function recordBossKillAction(
  formData: FormData,
): Promise<LootActionResult> {
  const parsed = recordBossKillSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      errors: fieldErrors(parsed.error),
    };
  }
  const { raidWeekId, floorId } = parsed.data;

  await db
    .insert(bossKill)
    .values({ raidWeekId, floorId })
    .onConflictDoNothing();

  revalidatePath("/loot");
  return { ok: true };
}

/**
 * Undo a previously-recorded boss kill. Deletes the row outright;
 * the foreign-key cascade does not delete `loot_drop` rows because
 * loot is keyed on (raidWeek, floor) directly. Operators are
 * expected to undo drops manually first if needed.
 */
export async function undoBossKillAction(
  formData: FormData,
): Promise<LootActionResult> {
  const parsed = undoBossKillSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      errors: fieldErrors(parsed.error),
    };
  }
  const { raidWeekId, floorId } = parsed.data;

  await db
    .delete(bossKill)
    .where(
      and(eq(bossKill.raidWeekId, raidWeekId), eq(bossKill.floorId, floorId)),
    );

  revalidatePath("/loot");
  return { ok: true };
}

/**
 * Award a single drop to a player.
 *
 * The action is invoked from two paths:
 *
 *  1. "Accept" on the recommendation card — passes the algorithm's
 *     suggested recipient and `pickedByAlgorithm = true`.
 *  2. "Other player" → flat list pick — passes the chosen recipient
 *     and `pickedByAlgorithm = false`.
 *
 * Since v3.2 the action also AUTO-EQUIPS the item: it picks the
 * first slot the recipient still wants the drop's source on, sets
 * `bis_choice.current_source = sourceForItem(itemKey)` for that
 * slot, and records both `target_slot` + `previous_current_source`
 * on the loot_drop row so undo / week-reset can roll back.
 *
 * Auto-equip skips silently if no compatible slot is found (rare:
 * the player already has the source on every relevant slot, or
 * the item drops on a floor whose tier didn't import a buy_cost
 * row for it).
 *
 * The persisted `score_snapshot` is whatever the UI passed in, so
 * historical recommendations remain reproducible even if the
 * algorithm is tweaked.
 */
export async function awardLootDropAction(
  formData: FormData,
): Promise<LootActionResult> {
  const parsed = awardLootDropSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      errors: fieldErrors(parsed.error),
    };
  }
  const data = parsed.data;

  let snapshot: unknown;
  if (data.scoreSnapshot && data.scoreSnapshot.trim().length > 0) {
    try {
      snapshot = JSON.parse(data.scoreSnapshot);
    } catch {
      // Malformed JSON shouldn't block the award — store nothing
      // rather than the raw string. The UI never shows the snapshot
      // raw anyway.
    }
  }

  // Compute target_slot + previous_current_source for the
  // auto-equip side of the award. v3.2.2 design: the action
  // ALWAYS records the drop (operator freedom — the loot was
  // distributed in real life and we want a faithful history),
  // but auto-equip only fires when the recipient actually needs
  // the slot at the drop's source. Manual overrides to non-BiS
  // recipients keep their bisCurrent untouched, which means the
  // Plan optimiser keeps recommending the same slot for them
  // (correct behaviour; they still need it).
  //
  // Plan-Tab side: the algorithm is what enforces "fastest path
  // to BiS" by only generating NeedNodes for BiS-eligible
  // (player, slot) pairs. The action layer's job is just to
  // honour the operator's pick; gate-keeping there created a
  // confusing UX where stale Plan caches could surface "rejected"
  // toasts for legitimate-looking Award buttons.
  const equip = await resolveAutoEquip(data.recipientId, data.itemKey);
  // The tier this raid_week belongs to, needed for the bis_choice
  // upsert (bis_choice is keyed on (player_id, tier_id, slot)).
  const tierIdRow = await db
    .select({ tierId: raidWeekTable.tierId })
    .from(raidWeekTable)
    .where(eq(raidWeekTable.id, data.raidWeekId))
    .limit(1);
  const tierId = tierIdRow[0]?.tierId;

  if (equip && tierId !== undefined) {
    // Update bis_choice.current_source for the equipped slot.
    await db
      .update(bisChoice)
      .set({ currentSource: equip.newSource })
      .where(
        and(
          eq(bisChoice.playerId, data.recipientId),
          eq(bisChoice.tierId, tierId),
          eq(bisChoice.slot, equip.targetSlot),
        ),
      );
  }

  await db.insert(lootDrop).values({
    raidWeekId: data.raidWeekId,
    floorId: data.floorId,
    itemKey: data.itemKey,
    recipientId: data.recipientId,
    paidWithPages: data.paidWithPages,
    pickedByAlgorithm: data.pickedByAlgorithm,
    targetSlot: equip?.targetSlot ?? null,
    previousCurrentSource: equip?.previousCurrentSource ?? null,
    scoreSnapshot: snapshot,
    notes: data.notes ?? null,
  });

  // Auto-equip changes the input the Plan optimiser sees, so the
  // cached plan from before this drop is now stale. Invalidate so
  // the next render recomputes against the new state.
  if (tierId !== undefined) {
    await invalidatePlanCache(tierId);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Resolve which slot the awarded item should land on for the
 * recipient and which `bis_choice.current_source` value the row
 * had before. Returns `null` if no eligible slot exists.
 *
 * "Eligible" = the recipient has `bisDesired = sourceForItem(itemKey)`
 * on at least one of the candidate slots AND doesn't already have
 * that source equipped. v3.2.1 tightens the original loose check
 * (which only required `bisCurrent !== source`) so that a manual
 * override can't accidentally promote a slot the player explicitly
 * does NOT want at the drop's source — the algorithm's promise is
 * "fastest path to BiS", not "promote any slot just because the
 * recipient took the loot".
 */
async function resolveAutoEquip(
  playerId: number,
  itemKey: ItemKey,
): Promise<{
  targetSlot: Slot;
  previousCurrentSource: BisSource;
  newSource: BisSource;
} | null> {
  const newSource = sourceForItem(itemKey);
  const candidateSlots = slotsForItem(itemKey);
  if (candidateSlots.length === 0) return null;

  const rows = await db
    .select({
      slot: bisChoice.slot,
      desiredSource: bisChoice.desiredSource,
      currentSource: bisChoice.currentSource,
    })
    .from(bisChoice)
    .where(
      and(
        eq(bisChoice.playerId, playerId),
        inArray(bisChoice.slot, candidateSlots as unknown as string[]),
      ),
    );
  // Walk candidate slots in their canonical SLOTS_BY_ITEM_KEY order
  // (Ring1 before Ring2, Earring before Necklace before Bracelet,
  // etc.) so a Ring drop fills Ring1 first when both are open.
  for (const slot of candidateSlots) {
    const row = rows.find((r) => r.slot === slot);
    if (!row) continue;
    if (row.desiredSource !== newSource) continue; // not BiS-desired
    if (row.currentSource === newSource) continue; // already at source
    return {
      targetSlot: slot,
      previousCurrentSource: row.currentSource as BisSource,
      newSource,
    };
  }
  return null;
}

/**
 * Delete a loot-drop row. Used for the "Undo last assignment"
 * button. Reverts auto-equip when applicable: if the dropped row
 * has `target_slot + previous_current_source` recorded, the
 * recipient's `bis_choice.current_source` is rolled back to the
 * pre-award value before the row is deleted.
 *
 * Pre-v3.2 drops have NULL in both columns; for those the action
 * skips the revert and just deletes (matching legacy semantics).
 */
export async function undoLootDropAction(
  formData: FormData,
): Promise<LootActionResult> {
  const parsed = undoLootDropSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      errors: fieldErrors(parsed.error),
    };
  }
  const { lootDropId } = parsed.data;

  const dropRows = await db
    .select({
      raidWeekId: lootDrop.raidWeekId,
      recipientId: lootDrop.recipientId,
      targetSlot: lootDrop.targetSlot,
      previousCurrentSource: lootDrop.previousCurrentSource,
      tierId: raidWeekTable.tierId,
    })
    .from(lootDrop)
    .innerJoin(raidWeekTable, eq(lootDrop.raidWeekId, raidWeekTable.id))
    .where(eq(lootDrop.id, lootDropId))
    .limit(1);
  const drop = dropRows[0];
  if (!drop) {
    // Already gone — treat as success so retries are idempotent.
    revalidatePath("/", "layout");
    return { ok: true };
  }

  if (
    drop.recipientId !== null &&
    drop.targetSlot !== null &&
    drop.previousCurrentSource !== null
  ) {
    await db
      .update(bisChoice)
      .set({ currentSource: drop.previousCurrentSource })
      .where(
        and(
          eq(bisChoice.playerId, drop.recipientId),
          eq(bisChoice.tierId, drop.tierId),
          eq(bisChoice.slot, drop.targetSlot),
        ),
      );
  }

  await db.delete(lootDrop).where(eq(lootDrop.id, lootDropId));

  await invalidatePlanCache(drop.tierId);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Reset an entire raid week: delete every boss kill and loot drop
 * tied to it AND roll back the bis_choice rows each drop touched
 * via auto-equip. Idempotent; running on an already-empty week is
 * a no-op.
 *
 * Used by the History tab's "Reset week" button. Useful when the
 * raid leader entered the week with the wrong roster, or when
 * BiS choices were updated mid-week and the awards no longer
 * make sense.
 */
export async function resetRaidWeekAction(
  formData: FormData,
): Promise<LootActionResult> {
  const parsed = resetRaidWeekSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      errors: fieldErrors(parsed.error),
    };
  }
  const { raidWeekId } = parsed.data;

  const weekRows = await db
    .select({ tierId: raidWeekTable.tierId })
    .from(raidWeekTable)
    .where(eq(raidWeekTable.id, raidWeekId))
    .limit(1);
  const tierId = weekRows[0]?.tierId;
  if (tierId === undefined) {
    return { ok: true };
  }

  // Roll back every auto-equipped drop's bisCurrent before
  // deleting the rows. Walk in id-descending order so if two
  // drops touched the same slot in the same week (e.g. a drop
  // followed by a re-drop), the OLDEST previous_current_source
  // wins — matching what an operator-level "undo this week"
  // would expect.
  const drops = await db
    .select({
      id: lootDrop.id,
      recipientId: lootDrop.recipientId,
      targetSlot: lootDrop.targetSlot,
      previousCurrentSource: lootDrop.previousCurrentSource,
    })
    .from(lootDrop)
    .where(eq(lootDrop.raidWeekId, raidWeekId))
    .orderBy(desc(lootDrop.id));

  for (const drop of drops) {
    if (
      drop.recipientId === null ||
      drop.targetSlot === null ||
      drop.previousCurrentSource === null
    ) {
      continue;
    }
    await db
      .update(bisChoice)
      .set({ currentSource: drop.previousCurrentSource })
      .where(
        and(
          eq(bisChoice.playerId, drop.recipientId),
          eq(bisChoice.tierId, tierId),
          eq(bisChoice.slot, drop.targetSlot),
        ),
      );
  }

  await db.delete(lootDrop).where(eq(lootDrop.raidWeekId, raidWeekId));
  await db.delete(bossKill).where(eq(bossKill.raidWeekId, raidWeekId));

  await invalidatePlanCache(tierId);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Find the currently-active raid week (latest weekNumber on the tier). */
export async function findCurrentWeek(tierId: number) {
  const rows = await db
    .select()
    .from(raidWeekTable)
    .where(eq(raidWeekTable.tierId, tierId))
    .orderBy(desc(raidWeekTable.weekNumber))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Recompute the Plan-tab simulation for a tier and refresh the
 * cache. The Refresh button on the Plan tab calls this directly;
 * other server actions intentionally don't (the Plan tab is sticky
 * by design — only an explicit refresh advances it).
 */
const refreshPlanSchema = z.object({
  tierId: z.coerce.number().int().positive(),
});

export async function refreshPlanAction(
  formData: FormData,
): Promise<LootActionResult> {
  const parsed = refreshPlanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      errors: fieldErrors(parsed.error),
    };
  }
  const { tierId } = parsed.data;

  // Reload the floor list from the DB so the simulation matches
  // whatever the tier's seed currently looks like (also covers
  // future tiers whose floor layout differs from Heavyweight).
  const floors = await db
    .select()
    .from(floorTable)
    .where(eq(floorTable.tierId, tierId))
    .orderBy(floorTable.number);

  await refreshPlan(
    tierId,
    floors.map((f) => ({
      floorNumber: f.number,
      itemKeys: f.drops as string[] as ItemKey[],
      trackedForAlgorithm: f.trackedForAlgorithm,
    })),
  );

  // Only the tier-detail page needs to re-render — the cache write
  // is the actual mutation here.
  revalidatePath("/", "layout");
  return { ok: true };
}
