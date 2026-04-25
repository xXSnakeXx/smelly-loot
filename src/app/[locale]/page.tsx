import { format } from "date-fns";
import { de as deLocale, enUS as enLocale } from "date-fns/locale";
import { Archive, ChevronRight, Sparkles } from "lucide-react";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getCurrentTeam } from "@/lib/db/queries";
import { listTiersForTeam, type TierWithStats } from "@/lib/db/queries-tiers";
import { cn } from "@/lib/utils";

import { NewTierDialog } from "./_components/new-tier-dialog";

// The dashboard reads live data from the database every request. Without
// this directive Next.js 16 prerenders the page using the seed values
// captured at build time, which would silently go stale the moment the
// user renames the team or rolls a new tier.
export const dynamic = "force-dynamic";

/**
 * Dashboard landing page.
 *
 * The dashboard is a single grid: every tier the static has ever
 * raided becomes a clickable card, sorted active-first then archived
 * tiers in reverse-creation order. The last cell is a dashed
 * "plus card" that opens the tier-creation dialog — clicking it is
 * the canonical "roll over to a new tier" workflow.
 *
 * Each tier-card surfaces three rollups (weeks / kills / drops) so a
 * raid leader can read off the cadence at a glance without opening
 * the tier. Hover lifts the border to the indigo primary so the
 * cards feel actionable.
 *
 * Players, history, settings and individual tier surfaces all hang
 * off this page (the top nav is intentionally tiny — Players + the
 * settings cog).
 */
export default async function DashboardPage({
  params,
}: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("dashboard");
  const team = await getCurrentTeam();
  const tiers = await listTiersForTeam(team.id);
  const dateLocale = (await getLocale()) === "de" ? deLocale : enLocale;

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("welcome")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold tracking-tight">
            {t("tiers.title")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("tiers.description")}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tiers.map((tier) => (
            <TierCard key={tier.id} tier={tier} dateLocale={dateLocale} />
          ))}
          <NewTierDialog asPlusCard />
        </div>
      </section>
    </main>
  );
}

/**
 * Single tier-card rendered inside the dashboard grid.
 *
 * The whole card is a `Link` so any pointer/keyboard interaction
 * navigates into the tier-detail page (`/tiers/<id>`). Cards keep
 * their border-color in their default state and lift to the primary
 * indigo on hover; archived tiers also get a subtle desaturation so
 * they read as "secondary" without being completely greyed out.
 *
 * Layout mirrors the FFLogs Analyzer dashboard cards:
 *   - Title + sub-line (max iLv) on the left
 *   - Big "headline" stat on the right (drops awarded — the most
 *     "this tier was busy" signal we have)
 *   - Footer line with the smaller stats (weeks / kills) and the
 *     archive timestamp where applicable.
 */
function TierCard({
  tier,
  dateLocale,
}: {
  tier: TierWithStats;
  dateLocale: typeof enLocale;
}) {
  const isArchived = tier.archivedAt !== null;
  return (
    <Link
      href={`/tiers/${tier.id}`}
      className={cn(
        "group block",
        // Hover ring only on the link wrapper so the card itself can
        // keep its own border styling.
        "rounded-lg outline-none ring-2 ring-transparent ring-offset-2 ring-offset-background focus-visible:ring-primary",
      )}
    >
      <Card
        className={cn(
          "h-full border transition-all",
          "group-hover:border-primary",
          isArchived ? "opacity-80 grayscale-[20%]" : "",
        )}
      >
        <CardContent className="flex h-full flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                {isArchived ? (
                  <Archive
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <Sparkles
                    className="size-3.5 text-primary"
                    aria-hidden="true"
                  />
                )}
                <span className="truncate text-base font-semibold">
                  {tier.name}
                </span>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                Max iLv {tier.maxIlv}
              </span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <p className="font-mono text-2xl font-semibold tracking-tight text-primary">
                {tier.stats.drops}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {tier.stats.drops === 1 ? "Drop" : "Drops"}
              </p>
            </div>
          </div>

          <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
            <Stat
              label="Status"
              value={
                tier.archivedAt ? (
                  <ArchivedBadge
                    dateLocale={dateLocale}
                    archivedAt={tier.archivedAt}
                  />
                ) : (
                  <ActiveBadge />
                )
              }
            />
            <Stat
              label={"Weeks"}
              value={
                <span className="font-mono text-sm text-foreground">
                  {tier.stats.weeks}
                </span>
              }
            />
            <Stat
              label={"Kills"}
              value={
                <span className="font-mono text-sm text-foreground">
                  {tier.stats.kills}
                </span>
              }
            />
          </dl>

          <div className="flex items-center justify-end text-xs text-muted-foreground transition-colors group-hover:text-primary">
            <ChevronRight className="size-4" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="leading-none">{value}</dd>
    </div>
  );
}

function ActiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/30">
      Active
    </span>
  );
}

function ArchivedBadge({
  archivedAt,
  dateLocale,
}: {
  archivedAt: Date;
  dateLocale: typeof enLocale;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border"
      title={format(archivedAt, "PP", { locale: dateLocale })}
    >
      Archived
    </span>
  );
}
