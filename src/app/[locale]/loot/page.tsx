import { setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { getCurrentContext } from "@/lib/db/queries";

// Live data per request — see the dashboard page for the rationale.
export const dynamic = "force-dynamic";

/**
 * Backwards-compatible redirect from the legacy `/loot` route.
 *
 * The canonical home for loot tracking is now the tier-detail page
 * (`/tiers/<id>`); the Plan + Track tabs there subsume what `/loot`
 * used to render. We resolve the active tier on each request and
 * issue a server-side redirect, so direct links and bookmarks keep
 * working.
 *
 * `redirect` is the locale-aware variant from `@/i18n/navigation`,
 * so the prefix is preserved automatically.
 */
export default async function LootRedirect({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { tier } = await getCurrentContext();
  redirect({ href: `/tiers/${tier.id}`, locale });
}
