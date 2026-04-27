import { CheckCircle2, CircleDashed } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  DropCard,
  type RecommendationEntry,
} from "@/app/[locale]/loot/_components/drop-card";
import { KillToggle } from "@/app/[locale]/loot/_components/kill-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  listBossKillsForWeek,
  listFloorsForTier,
  listLootDropsForWeek,
} from "@/lib/db/queries-loot";
import type { listPlayersInTier } from "@/lib/db/queries-players";
import type { ItemKey } from "@/lib/ffxiv/slots";
import type { FloorPlan } from "@/lib/loot/floor-planner";

/**
 * Per-floor list with kill toggle + drop cards.
 *
 * Server-rendered so the algorithm runs once per request and the
 * recommendation arrives in the markup. The component is shared
 * between the legacy `/loot` route (kept around for direct linking)
 * and the new `/tiers/[id]` tier-detail page (Track tab).
 *
 * Since v3.0.0 Track does NOT re-score drops on its own — it
 * reads the recommended recipient straight out of the cached
 * Plan (`floorPlans`) so Plan and Track can never disagree. If
 * the Plan is stale (cache hasn't been refreshed since the last
 * relevant edit), Track still shows the prior recommendation;
 * it's the operator's call when to click Refresh on the Plan tab.
 *
 * `floor.trackedForAlgorithm = false` floors render their drops as
 * a flat "any of the players could take this" list — the algorithm
 * abstains for floor 4 (weapons) per Topic 3 in the roadmap.
 */
export async function TrackView({
  currentWeek,
  floors,
  kills,
  drops,
  players,
  floorPlans,
}: {
  currentWeek: { id: number; weekNumber: number };
  floors: Awaited<ReturnType<typeof listFloorsForTier>>;
  kills: Awaited<ReturnType<typeof listBossKillsForWeek>>;
  drops: Awaited<ReturnType<typeof listLootDropsForWeek>>;
  players: Awaited<ReturnType<typeof listPlayersInTier>>;
  floorPlans: FloorPlan[];
}) {
  const tFloor = await getTranslations("loot.floor");

  const playerNameById = new Map<number, string>(
    players.map((p) => [p.id, p.name]),
  );
  const killByFloorId = new Set(kills.map((k) => k.floorId));
  const dropsByFloorItem = new Map<string, (typeof drops)[number]>();
  for (const drop of drops) {
    dropsByFloorItem.set(`${drop.floorId}|${drop.itemKey}`, drop);
  }

  // Index plan recommendations for O(1) lookup per drop card.
  // Key: `${floorNumber}|${weekNumber}|${itemKey}` → recipient.
  const planByKey = new Map<
    string,
    { recipientId: number; recipientName: string }
  >();
  for (const plan of floorPlans) {
    for (const planned of plan.drops) {
      planByKey.set(`${plan.floorNumber}|${planned.week}|${planned.itemKey}`, {
        recipientId: planned.recipientId,
        recipientName: planned.recipientName,
      });
    }
  }

  return (
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
                  const planned = floor.trackedForAlgorithm
                    ? planByKey.get(
                        `${floor.number}|${currentWeek.weekNumber}|${itemKey}`,
                      )
                    : undefined;

                  // Build the rankings list the DropCard expects:
                  // recommended player first (sentinel score=100),
                  // then everyone else for manual override
                  // (score=0). Track no longer ranks players via
                  // its own scoring run; the Plan-cache provides
                  // the single optimal recipient and the rest are
                  // treated as equivalent override options.
                  const rankings: RecommendationEntry[] = [];
                  if (planned) {
                    rankings.push({
                      playerId: planned.recipientId,
                      playerName: planned.recipientName,
                      score: 100,
                      effectiveNeed: 1,
                      buyPower: 0,
                      roleWeight: 1,
                    });
                  }
                  for (const player of players) {
                    if (planned && player.id === planned.recipientId) continue;
                    rankings.push({
                      playerId: player.id,
                      playerName: player.name,
                      score: 0,
                      effectiveNeed: 0,
                      buyPower: 0,
                      roleWeight: 1,
                    });
                  }

                  const awarded = existing
                    ? {
                        lootDropId: existing.id,
                        recipientId: existing.recipientId ?? 0,
                        recipientName:
                          playerNameById.get(existing.recipientId ?? -1) ?? "?",
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
  );
}
