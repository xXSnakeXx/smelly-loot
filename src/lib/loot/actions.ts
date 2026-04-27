"use server";

import { and, desc, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  bossKill,
  floor as floorTable,
  lootDrop,
  raidWeek as raidWeekTable,
} from "@/lib/db/schema";
import type { ItemKey } from "@/lib/ffxiv/slots";

import { refreshPlan } from "./plan-cache";
import {
  awardLootDropSchema,
  createRaidWeekSchema,
  recordBossKillSchema,
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

  await db.insert(lootDrop).values({
    raidWeekId: data.raidWeekId,
    floorId: data.floorId,
    itemKey: data.itemKey,
    recipientId: data.recipientId,
    paidWithPages: data.paidWithPages,
    pickedByAlgorithm: data.pickedByAlgorithm,
    scoreSnapshot: snapshot,
    notes: data.notes ?? null,
  });

  revalidatePath("/loot");
  revalidatePath("/players");
  return { ok: true };
}

/**
 * Delete a loot-drop row. Used for the "Undo last assignment"
 * button. Cascades restore the player's page balance / drop count
 * automatically because every snapshot read recomputes from the
 * source rows.
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

  await db.delete(lootDrop).where(eq(lootDrop.id, lootDropId));

  revalidatePath("/loot");
  revalidatePath("/players");
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
    return { ok: false, reason: "validation", errors: fieldErrors(parsed.error) };
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
