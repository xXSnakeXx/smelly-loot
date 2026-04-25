import { setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { getCurrentContext } from "@/lib/db/queries";

// Live data per request — see the dashboard page for the rationale.
export const dynamic = "force-dynamic";

/**
 * Backwards-compatible redirect from the legacy `/history` route.
 *
 * Loot history is now the History tab on the tier-detail page,
 * scoped to the tier you're viewing. We redirect into the active
 * tier so direct `/history` links land on the matching view.
 */
export default async function HistoryRedirect({
  params,
}: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { tier } = await getCurrentContext();
  redirect({ href: `/tiers/${tier.id}`, locale });
}
