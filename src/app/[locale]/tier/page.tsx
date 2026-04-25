import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { getCurrentContext } from "@/lib/db/queries";

import { TierEditForm } from "./_components/tier-edit-form";

// Live data per request — see the dashboard page for the full rationale.
export const dynamic = "force-dynamic";

/**
 * Tier-edit page.
 *
 * Phase 1.3 lands the smallest viable cut: rename the tier and pick
 * a `max_ilv`. The nine per-source iLvs cascade automatically via the
 * standard deltas. Per-source overrides and editable buy costs are on
 * the v1.1 wishlist; for now the seed defaults match the Heavyweight
 * tier exactly so this rarely needs to be touched.
 */
export default async function TierPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("tierEdit");
  const { tier } = await getCurrentContext();

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <Card>
        <CardContent className="py-6">
          <TierEditForm tier={tier} />
        </CardContent>
      </Card>
    </main>
  );
}
