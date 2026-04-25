import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Locale-aware navigation primitives.
 *
 * Re-export typed wrappers around Next.js's Link / redirect / usePathname /
 * useRouter / getPathname so that any internal navigation automatically
 * respects the active locale prefix. Components should import from
 * `@/i18n/navigation` rather than from `next/link` or `next/navigation`
 * directly.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
