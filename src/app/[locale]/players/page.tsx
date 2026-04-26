import { setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";

// Live data per request — see the dashboard page for the rationale.
export const dynamic = "force-dynamic";

/**
 * Backwards-compatible redirect from the legacy `/players` route.
 *
 * Players became team-scoped again in v2.0; the canonical roster
 * lives on `/team`. The redirect is kept so anyone with a bookmark
 * to the old URL (or a stale browser tab) lands somewhere useful.
 */
export default async function PlayersRedirect({
  params,
}: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect({ href: "/team", locale });
}
