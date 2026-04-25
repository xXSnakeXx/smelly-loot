import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

/**
 * Server-side request configuration consumed by next-intl's plugin.
 *
 * Resolves the active locale from the request URL (or falls back to the
 * default if the segment is missing/invalid) and dynamically imports
 * the matching JSON message bundle. The `messages` directory lives at
 * the project root so it stays language-agnostic; each file is
 * code-split automatically by the dynamic import.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
