import { z } from "zod";

import { ITEM_KEYS } from "@/lib/ffxiv/slots";

/**
 * Validation schemas for the loot-distribution Server Actions.
 *
 * Coercion is used liberally because the form payloads come straight
 * from `<form action>` submissions where every value starts as a
 * string.
 */

export const createRaidWeekSchema = z.object({
  tierId: z.coerce.number().int().positive(),
});

export const recordBossKillSchema = z.object({
  raidWeekId: z.coerce.number().int().positive(),
  floorId: z.coerce.number().int().positive(),
});

export const undoBossKillSchema = recordBossKillSchema;

export const awardLootDropSchema = z.object({
  raidWeekId: z.coerce.number().int().positive(),
  floorId: z.coerce.number().int().positive(),
  itemKey: z.enum(ITEM_KEYS),
  recipientId: z.coerce.number().int().positive(),
  paidWithPages: z
    .union([z.literal("on"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "on" || value === "true"),
  pickedByAlgorithm: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "true"),
  /**
   * Stringified JSON snapshot of the algorithm output at decision time.
   * The UI passes this along so the persisted record matches exactly
   * what the user saw, even if the algorithm is tweaked later.
   */
  scoreSnapshot: z.string().optional(),
  notes: z
    .string()
    .transform((value) => {
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    })
    .optional(),
});

export const undoLootDropSchema = z.object({
  lootDropId: z.coerce.number().int().positive(),
});

export const resetRaidWeekSchema = z.object({
  raidWeekId: z.coerce.number().int().positive(),
});

export type CreateRaidWeekInput = z.infer<typeof createRaidWeekSchema>;
export type RecordBossKillInput = z.infer<typeof recordBossKillSchema>;
export type AwardLootDropInput = z.infer<typeof awardLootDropSchema>;
export type UndoLootDropInput = z.infer<typeof undoLootDropSchema>;
export type ResetRaidWeekInput = z.infer<typeof resetRaidWeekSchema>;
