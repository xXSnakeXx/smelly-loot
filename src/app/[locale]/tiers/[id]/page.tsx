import { format } from "date-fns";
import { de as deLocale, enUS as enLocale } from "date-fns/locale";
import { Archive, ArrowLeft, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { NewWeekButton } from "@/app/[locale]/loot/_components/new-week-button";
import { TimelinePlan } from "@/app/[locale]/loot/_components/timeline-plan";
import { TierEditForm } from "@/app/[locale]/tier/_components/tier-edit-form";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getCurrentTeam } from "@/lib/db/queries";
import {
  listBossKillsForWeek,
  listFloorsForTier,
  listLootDropsForWeek,
} from "@/lib/db/queries-loot";
import { listPlayersInTier } from "@/lib/db/queries-players";
import { findTierById } from "@/lib/db/queries-tiers";
import type { ItemKey } from "@/lib/ffxiv/slots";
import { findCurrentWeek } from "@/lib/loot/actions";
import { getCachedOrComputePlan } from "@/lib/loot/plan-cache";

import { HistoryView } from "./_components/history-view";
import { RosterView } from "./_components/roster-view";
import { TierDetailTabs } from "./_components/tier-detail-tabs";
import { TrackView } from "./_components/track-view";

// Live data per request — see the dashboard page for the rationale.
export const dynamic = "force-dynamic";

/**
 * How far ahead the Plan tab simulates by default.
 *
 * Eight weeks roughly matches a typical "two months out" planning
 * horizon and is more than enough for the team to play out their
 * BiS plans in the simulator.
 */
const DEFAULT_WEEKS_AHEAD = 8;

/**
 * Tier-detail page.
 *
 * The single canonical home for everything tier-scoped — Plan,
 * Track, History, and Settings live here as tabs. Replaces the
 * older split between `/loot`, `/history`, and `/tier`, all of
 * which now redirect into this page.
 *
 * The header shows the tier name, max iLv, the active/archived
 * status, and a "back to dashboard" link. The four tabs are wrapped
 * in a small client component (`TierDetailTabs`) that owns the
 * active-tab state; their contents are server-rendered React nodes
 * so the algorithm + DB lookups run once per request.
 */
export default async function TierDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const tierId = Number.parseInt(id, 10);
  if (!Number.isInteger(tierId) || tierId <= 0) notFound();

  const team = await getCurrentTeam();
  const tier = await findTierById(team.id, tierId);
  if (!tier) notFound();

  const t = await getTranslations("loot");
  const dateLocale = (await getLocale()) === "de" ? deLocale : enLocale;
  const isArchived = tier.archivedAt !== null;

  // Plan + Track need the per-tier floor list + roster; the
  // forward-planning Plan cache encapsulates everything else
  // (player snapshots, page balances, BiS state) inside its
  // computation, so the page itself only fetches what it
  // renders directly.
  const [floors, players, currentWeek] = await Promise.all([
    listFloorsForTier(tier.id),
    listPlayersInTier(tier.id),
    findCurrentWeek(tier.id),
  ]);

  // Track tab needs the active-week's kills + drops too.
  const [kills, drops] = currentWeek
    ? await Promise.all([
        listBossKillsForWeek(currentWeek.id),
        listLootDropsForWeek(currentWeek.id),
      ])
    : [[], []];

  // Plan tab: read from the persistent cache. The cache is only
  // refreshed when the user clicks the Refresh button on the Plan
  // tab; routine kill toggles, drop awards, BiS edits, and roster
  // changes deliberately do NOT advance it. That way casual Track
  // interactions don't reshuffle the next-N-week recommendations
  // while the operator is mid-conversation about who gets what.
  //
  // When the cache is empty (fresh tier)
  // computes once and writes it back, so the page never blocks on
  // a cold cache.
  const { floorPlans, computedAt: planComputedAt } =
    await getCachedOrComputePlan(
      tier.id,
      floors.map((f) => ({
        floorNumber: f.number,
        itemKeys: f.drops as string[] as ItemKey[],
        trackedForAlgorithm: f.trackedForAlgorithm,
      })),
    );

  const planNode = (
    <TimelinePlan
      floorPlans={floorPlans}
      weeksAhead={DEFAULT_WEEKS_AHEAD}
      hasPlayers={players.length > 0}
      tierId={tier.id}
      computedAt={planComputedAt}
    />
  );

  const trackNode = currentWeek ? (
    <TrackView
      currentWeek={currentWeek}
      floors={floors}
      kills={kills}
      drops={drops}
      players={players}
      floorPlans={floorPlans}
      tierId={tier.id}
    />
  ) : (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <h2 className="text-lg font-medium">{t("noWeeks.title")}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("noWeeks.description")}
        </p>
        <NewWeekButton tierId={tier.id} variant="primary" />
      </CardContent>
    </Card>
  );

  const historyNode = <HistoryView tierId={tier.id} />;

  const settingsNode = (
    <Card>
      <CardContent className="py-6">
        <TierEditForm tier={tier} />
      </CardContent>
    </Card>
  );

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 px-6 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Dashboard
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {isArchived ? (
              <Archive className="size-4 text-muted-foreground" />
            ) : (
              <Sparkles className="size-4 text-primary" />
            )}
            <h1 className="text-2xl font-semibold tracking-tight">
              {tier.name}
            </h1>
            {isArchived ? (
              <span
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border"
                title={
                  tier.archivedAt
                    ? format(tier.archivedAt, "PP", { locale: dateLocale })
                    : undefined
                }
              >
                Archived
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/30">
                Active
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            Max iLv {tier.maxIlv}
            <span className="mx-2">·</span>
            Savage <span className="text-foreground">{tier.ilvSavage}</span>
            <span className="mx-2">·</span>
            Tome Up <span className="text-foreground">{tier.ilvTomeUp}</span>
            {currentWeek ? (
              <>
                <span className="mx-2">·</span>
                {t("header.weekLabel", { number: currentWeek.weekNumber })}
              </>
            ) : null}
          </p>
        </div>
        {currentWeek ? <NewWeekButton tierId={tier.id} /> : null}
      </header>

      <TierDetailTabs
        roster={<RosterView tierId={tier.id} teamId={team.id} />}
        plan={planNode}
        track={trackNode}
        history={historyNode}
        settings={settingsNode}
      />
    </main>
  );
}
