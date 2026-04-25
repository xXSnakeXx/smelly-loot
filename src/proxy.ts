import createMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";

/**
 * Next.js 16 proxy entry point (formerly `middleware.ts`).
 *
 * next-intl's middleware handles locale detection (URL prefix, cookie,
 * `Accept-Language` header) and rewrites incoming requests so that
 * unprefixed paths are redirected to the negotiated `/locale/...`
 * URL. Application routes live below `app/[locale]/` accordingly.
 *
 * The matcher excludes Next.js internals and static asset routes so the
 * proxy doesn't touch them. Anything else is funneled through next-intl
 * — including future API routes, which simply need to live under a
 * locale-agnostic path if they shouldn't be redirected.
 */
export default createMiddleware(routing);

export const config = {
  matcher: [
    // Match all paths except Next.js internals and common static assets.
    "/((?!api|_next|_vercel|.*\\..*).*)",
  ],
};
