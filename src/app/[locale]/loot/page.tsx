import { format } from "date-fns";
import { de as deLocale, enUS as enLocale } from "date-fns/locale";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentContext } from "@/lib/db/queries";
import {
  listBossKillsForWeek,
  listFloorsForTier,
  listLootDropsForWeek,
} from "@/lib/db/queries-loot";
import { listPlayersForTeam } from "@/lib/db/queries-players";
import type { ItemKey } from "@/lib/ffxiv/slots";
import { findCurrentWeek } from "@/lib/loot/actions";
import { scoreDrop } from "@/lib/loot/algorithm";
import { loadPlayerSnapshots, loadTierSnapshot } from "@/lib/loot/snapshots";

import { DropCard, type RecommendationEntry } from "./_components/drop-card";
import { KillToggle } from "./_components/kill-toggle";
import { NewWeekButton } from "./_components/new-week-button";

// Live data per request — see the dashboard page for the rationale.
export const dynamic = "force-dynamic";

/**
 * Loot-distribution page.
 *
 * Renders the active raid week with one section per floor. Each
 * unassigned drop pre-computes its algorithm ranking server-side and
 * passes the result to the (client) DropCard, which handles the
 * accept/override flow against the matching Server Actions.
 *
 * Empty state: the page shows a "Start first raid week" CTA when no
 * `raid_week` rows exist for the active tier yet.
 */
export default async function LootPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("loot");
  const tFloor = await getTranslations("loot.floor");
  const dateLocale = (await getLocale()) === "de" ? deLocale : enLocale;

  const { team, tier } = await getCurrentContext();
  const currentWeek = await findCurrentWeek(tier.id);

  // Empty state: no week recorded yet.
  if (!currentWeek) {
    return (
      <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </header>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <h2 className="text-lg font-medium">{t("noWeeks.title")}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {t("noWeeks.description")}
            </p>
            <NewWeekButton tierId={tier.id} variant="primary" />
          </CardContent>
        </Card>
      </main>
    );
  }

  // Populate everything for the active week.
  const [floors, kills, drops, players, snapshots, tierSnapshot] =
    await Promise.all([
      listFloorsForTier(tier.id),
      listBossKillsForWeek(currentWeek.id),
      listLootDropsForWeek(currentWeek.id),
      listPlayersForTeam(team.id),
      loadPlayerSnapshots(team.id, tier.id),
      loadTierSnapshot(tier.id),
    ]);

  const playerNameById = new Map<number, string>(
    players.map((p) => [p.id, p.name]),
  );
  const killByFloorId = new Set(kills.map((k) => k.floorId));
  const dropsByFloorItem = new Map<string, (typeof drops)[number]>();
  for (const drop of drops) {
    dropsByFloorItem.set(`${drop.floorId}|${drop.itemKey}`, drop);
  }

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          <p className="mt-1 text-xs font-mono text-muted-foreground">
            {t("header.weekLabel", { number: currentWeek.weekNumber })}
            <span className="mx-2">·</span>
            {t("header.started", {
              date: format(currentWeek.startedAt, "PP", { locale: dateLocale }),
            })}
          </p>
        </div>
        <NewWeekButton tierId={tier.id} />
      </header>

      <div className="flex flex-col gap-6">
        {floors.map((floor) => {
          const isKilled = killByFloorId.has(floor.id);
          const itemKeys = floor.drops as string[];

          return (
            <Card key={floor.id}>
              <CardHeader className="flex-row items-center justify-between">
                <div className="flex flex-col gap-1">
                  <CardTitle className="flex items-center gap-2 text-base font-medium">
                    {isKilled ? (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    ) : (
                      <CircleDashed className="size-4 text-muted-foreground" />
                    )}
                    {tFloor("label", { number: floor.number })}
                    {floor.trackedForAlgorithm ? null : (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ({tFloor("untracked")})
                      </span>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {isKilled
                      ? tFloor("killed", { date: "" })
                      : tFloor("notKilled")}
                  </p>
                </div>
                <KillToggle
                  raidWeekId={currentWeek.id}
                  floorId={floor.id}
                  killed={isKilled}
                />
              </CardHeader>

              {isKilled ? (
                <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
                  {itemKeys.map((itemKey) => {
                    const existing = dropsByFloorItem.get(
                      `${floor.id}|${itemKey}`,
                    );
                    const rankings: RecommendationEntry[] =
                      floor.trackedForAlgorithm
                        ? scoreDrop(snapshots, {
                            itemKey: itemKey as ItemKey,
                            floorNumber: floor.number,
                            currentWeek: currentWeek.weekNumber,
                            tier: tierSnapshot,
                          }).map((entry) => ({
                            playerId: entry.player.id,
                            playerName: entry.player.name,
                            score: entry.score,
                            effectiveNeed: entry.breakdown.effectiveNeed,
                            buyPower: entry.breakdown.buyPower,
                            roleWeight: entry.breakdown.roleWeight,
                          }))
                        : players.map((p) => ({
                            playerId: p.id,
                            playerName: p.name,
                            score: 0,
                            effectiveNeed: 0,
                            buyPower: 0,
                            roleWeight: 1,
                          }));

                    const awarded = existing
                      ? {
                          lootDropId: existing.id,
                          recipientId: existing.recipientId ?? 0,
                          recipientName:
                            playerNameById.get(existing.recipientId ?? -1) ??
                            "?",
                          paidWithPages: existing.paidWithPages,
                          pickedByAlgorithm: existing.pickedByAlgorithm,
                        }
                      : undefined;

                    return (
                      <DropCard
                        key={itemKey}
                        raidWeekId={currentWeek.id}
                        floorId={floor.id}
                        itemKey={itemKey as ItemKey}
                        itemLabel={itemKey}
                        rankings={rankings}
                        awarded={awarded}
                      />
                    );
                  })}
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </main>
  );
}
