import { defineRouting } from "next-intl/routing";

/**
 * Locale configuration shared between the proxy, the request config, and
 * any consumer that needs to know the supported locales.
 *
 * - `locales`: every UI language the app ships with. Adding a new entry
 *   requires (a) creating `messages/<code>.json` and (b) extending the
 *   shared `messages/<code>.json` schema, but no further plumbing.
 * - `defaultLocale`: returned when the user's preference doesn't match
 *   any supported locale. English is chosen as the broader baseline; per
 *   the project rules both DE and EN must be supported from day one.
 * - `localePrefix`: "always" so URLs are unambiguous (`/en/...`,
 *   `/de/...`). The root `/` then redirects to the negotiated locale,
 *   which is the cleanest setup for SEO and shareable links.
 */
export const routing = defineRouting({
  locales: ["en", "de"],
  defaultLocale: "en",
  localePrefix: "always",
});

/**
 * Convenience type for the supported locales. Components that branch on
 * the active language should reach for this rather than hard-coding the
 * union, so adding a new locale only touches `routing.locales` above.
 */
export type Locale = (typeof routing.locales)[number];
