import { setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { getCurrentContext } from "@/lib/db/queries";

// Live data per request — see the dashboard page for the rationale.
export const dynamic = "force-dynamic";

/**
 * Backwards-compatible redirect from the legacy `/tier` route.
 *
 * Tier configuration moved into the Settings tab of the tier-detail
 * page. We resolve the active tier per request and redirect into
 * its detail view; users land on the Plan tab by default and can
 * jump to Settings from there.
 */
export default async function TierRedirect({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { tier } = await getCurrentContext();
  redirect({ href: `/tiers/${tier.id}`, locale });
}
