import { z } from "zod";

import { JOB_CODES } from "@/lib/ffxiv/jobs";

/**
 * Validation schemas for player create / update payloads.
 *
 * Both client (`react-hook-form` or just submit) and server (Server
 * Actions) consume the same schema, so what's allowed in the form is
 * exactly what's allowed in the database. Optional fields use
 * `optional()` rather than `nullable()` because empty strings are
 * coerced to `undefined` first — the database column then stores
 * `NULL`, not the empty string, which keeps `IS NULL` queries useful.
 */

const trimmedString = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, { message: "required" });

const optionalTrimmedString = z
  .string()
  .transform((value) => {
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  .optional();

/**
 * Job codes are only validated against the `JobCode` union — whitespace
 * trimming, case normalisation, and the dropdown UI handle the rest.
 */
const jobCode = z.enum(JOB_CODES);

/**
 * Alt jobs come from the form as a comma-separated string for ergonomics
 * (typing "AST, SCH" is faster than a multi-select). The transformer
 * normalises whitespace, uppercases the codes, dedupes, and validates
 * each entry against the job-code enum. The output is a clean string
 * array suitable for the JSON column.
 */
const altJobsList = z
  .string()
  .transform((value) =>
    value
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toUpperCase())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(jobCode))
  .transform((jobs) => Array.from(new Set(jobs)));

export const playerCreateSchema = z.object({
  name: trimmedString,
  mainJob: jobCode,
  altJobs: altJobsList.optional().default([]),
  gearLink: optionalTrimmedString,
  notes: optionalTrimmedString,
});

export const playerUpdateSchema = playerCreateSchema.extend({
  id: z.coerce.number().int().positive(),
});

export const playerDeleteSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type PlayerCreateInput = z.infer<typeof playerCreateSchema>;
export type PlayerUpdateInput = z.infer<typeof playerUpdateSchema>;
export type PlayerDeleteInput = z.infer<typeof playerDeleteSchema>;
