import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getCurrentContext } from "@/lib/db/queries";

/**
 * Dashboard landing page.
 *
 * Renders the team + active-tier overview and a quick-actions card.
 * The actual feature pages (players, tier, loot, history) live one
 * level deeper; this page is the "where am I" anchor that summarizes
 * what the deployment is configured for and offers shortcuts into
 * the most common workflows.
 */
export default async function DashboardPage({
  params,
}: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations();
  const { team, tier } = await getCurrentContext();

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("dashboard.welcome")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("dashboard.activeTier")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-lg font-semibold tracking-tight">{tier.name}</p>
            <p className="text-sm text-muted-foreground">
              {t("dashboard.maxIlv")}{" "}
              <span className="font-mono text-foreground">{tier.maxIlv}</span>
              <span className="mx-2">·</span>
              Savage <span className="font-mono">{tier.ilvSavage}</span>
              <span className="mx-2">·</span>
              Tome Up <span className="font-mono">{tier.ilvTomeUp}</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("dashboard.quickActions.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Link
              href="/loot"
              className="text-foreground underline-offset-4 hover:underline"
            >
              → {t("dashboard.quickActions.newWeek")}
            </Link>
            <Link
              href="/players"
              className="text-foreground underline-offset-4 hover:underline"
            >
              → {t("dashboard.quickActions.addPlayer")}
            </Link>
            <Link
              href="/tier"
              className="text-foreground underline-offset-4 hover:underline"
            >
              → {t("dashboard.quickActions.editTier")}
            </Link>
            <Link
              href="/team"
              className="text-foreground underline-offset-4 hover:underline"
            >
              → {t("dashboard.quickActions.manageTeam")}
            </Link>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
