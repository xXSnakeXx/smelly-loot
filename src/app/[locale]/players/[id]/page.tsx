import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getCurrentContext } from "@/lib/db/queries";
import { findPlayer, listBisChoicesForPlayer } from "@/lib/db/queries-bis";
import { loadPlayerStats } from "@/lib/db/queries-stats";
import { jobToGearRole } from "@/lib/ffxiv/jobs";

import { BisTable } from "./_components/bis-table";
import { PageStatsTable } from "./_components/page-stats-table";

// Live data per request — see the dashboard page for the full rationale.
export const dynamic = "force-dynamic";

/**
 * Player detail page.
 *
 * Three stacked sections:
 *
 * 1. Pages & Materials — auto-derived per-floor balance, plus the
 *    Glaze / Twine / Ester tally and the Savage-drop count for the
 *    fairness factor. The Adjust column is the one editable seam in
 *    the entire page-accounting layer (Topic 2).
 * 2. BiS tracker — the twelve-slot gear table.
 *
 * The route segment uses a numeric id (the `player.id` primary key);
 * an explicit Promise type is used here instead of Next.js 16's
 * generated `PageProps<...>` helper because the latter only resolves
 * after a successful build that has touched this route.
 */
export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const playerId = Number.parseInt(id, 10);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    notFound();
  }

  const tBis = await getTranslations("bis");
  const tPlayers = await getTranslations("players");
  const tRoles = await getTranslations("players.roles");
  const tStats = await getTranslations("stats");

  const player = await findPlayer(playerId);
  if (!player) {
    notFound();
  }

  const { tier } = await getCurrentContext();
  const [choices, stats] = await Promise.all([
    listBisChoicesForPlayer(playerId),
    loadPlayerStats(playerId, tier.id),
  ]);
  const role = jobToGearRole(player.mainJob);

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/players"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          {tPlayers("detail.back")}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {player.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{player.mainJob}</span>
              {role ? <span className="mx-1">·</span> : null}
              {role ? tRoles(role) : null}
              {player.altJobs.length > 0 ? (
                <>
                  <span className="mx-1">·</span>
                  <span className="text-xs">
                    {tPlayers("table.altJobs")}: {player.altJobs.join(", ")}
                  </span>
                </>
              ) : null}
            </p>
            {player.gearLink ? (
              <p className="text-sm">
                <a
                  href={player.gearLink}
                  className="text-foreground underline-offset-4 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {tPlayers("detail.gearLink")} →
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              {tStats("pages.title")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {tStats("pages.description")}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <PageStatsTable
              playerId={player.id}
              tierId={tier.id}
              rows={stats.pagesByFloor}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">
              {tStats("materials.title")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {tStats("materials.description")}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <MaterialRow label="Glaze" count={stats.materialsReceived.Glaze} />
            <MaterialRow label="Twine" count={stats.materialsReceived.Twine} />
            <MaterialRow label="Ester" count={stats.materialsReceived.Ester} />
            <hr className="my-2 border-border" />
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">
                {tStats("savage.totalLabel")}
              </span>
              <span className="font-mono text-base">
                {stats.savageDropsThisTier}
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {tBis("title")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{tBis("description")}</p>
        </CardHeader>
        <CardContent className="p-0">
          <BisTable player={player} tier={tier} initialChoices={choices} />
        </CardContent>
      </Card>
    </main>
  );
}

function MaterialRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{count}</span>
    </div>
  );
}
