import { z } from "zod";

import { routing } from "@/i18n/routing";

/**
 * Schema for the team-settings form.
 *
 * `name` is trimmed and required; `locale` must be one of the
 * supported UI locales (see `src/i18n/routing.ts`). Loose membership
 * checks are intentionally avoided — the dropdown caps the input.
 */
export const teamSettingsSchema = z.object({
  name: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "required" }),
  locale: z.enum(routing.locales),
});

export type TeamSettingsInput = z.infer<typeof teamSettingsSchema>;
