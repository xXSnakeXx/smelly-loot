import { setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";

// Live data per request — see the dashboard page for the rationale.
export const dynamic = "force-dynamic";

/**
 * Backwards-compatible redirect from the legacy `/players/[id]`
 * route.
 *
 * Player-detail pages live under `/team/[id]` from v2.0 onwards
 * because players are team-scoped: the `id` doesn't change between
 * tiers, so it's properly an attribute of the team, not the active
 * tier. This redirect keeps any pre-v2 deep links functioning
 * after the route move.
 */
export default async function PlayerRedirect({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  redirect({ href: `/team/${id}`, locale });
}
