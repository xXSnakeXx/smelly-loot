import { setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { getCurrentContext } from "@/lib/db/queries";

// Live data per request — see the dashboard page for the rationale.
export const dynamic = "force-dynamic";

/**
 * Backwards-compatible redirect from the legacy `/players` route.
 *
 * Players are tier-scoped from v1.4 onwards; the Players tab inside
 * the tier-detail page (`/tiers/<id>`) is the canonical home for
 * the roster. We resolve the active tier per request and redirect
 * into its detail view, where the Players tab is the default.
 */
export default async function PlayersRedirect({
  params,
}: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { tier } = await getCurrentContext();
  redirect({ href: `/tiers/${tier.id}`, locale });
}
