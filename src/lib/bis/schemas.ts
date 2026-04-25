import { z } from "zod";

import { BIS_SOURCES, SLOTS } from "@/lib/ffxiv/slots";

/**
 * Validation schema for upserting a single BiS choice.
 *
 * The form submits one row at a time (auto-save on dropdown change),
 * so this schema is intentionally per-cell rather than per-player.
 *
 * `marker` accepts a small fixed set of emoji shortcodes plus the
 * empty value (no marker). Storing the emoji directly is fine — they
 * are stable across SQLite versions and consume only a handful of
 * bytes.
 */
export const BIS_MARKERS = ["📃", "🔨", "◀️", "💾", "💰"] as const;
export type BisMarker = (typeof BIS_MARKERS)[number];

export const bisUpsertSchema = z.object({
  playerId: z.coerce.number().int().positive(),
  slot: z.enum(SLOTS),
  desiredSource: z.enum(BIS_SOURCES),
  currentSource: z.enum(BIS_SOURCES),
  marker: z
    .string()
    .transform((value) => {
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    })
    .refine(
      (value) =>
        value === undefined ||
        (BIS_MARKERS as readonly string[]).includes(value),
      { message: "invalid marker" },
    )
    .optional(),
});

export type BisUpsertInput = z.infer<typeof bisUpsertSchema>;
