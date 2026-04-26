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
import type { listPlayersForTier } from "@/lib/db/queries-players";
import type { ItemKey } from "@/lib/ffxiv/slots";
import { scoreDrop } from "@/lib/loot/algorithm";
import type {
  loadPlayerSnapshots,
  loadTierSnapshot,
} from "@/lib/loot/snapshots";

/**
 * Per-floor list with kill toggle + drop cards.
 *
 * Server-rendered so the algorithm runs once per request and the
 * recommendation arrives in the markup. The component is shared
 * between the legacy `/loot` route (kept around for direct linking)
 * and the new `/tiers/[id]` tier-detail page (Track tab).
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
  snapshots,
  tierSnapshot,
}: {
  currentWeek: { id: number; weekNumber: number };
  floors: Awaited<ReturnType<typeof listFloorsForTier>>;
  kills: Awaited<ReturnType<typeof listBossKillsForWeek>>;
  drops: Awaited<ReturnType<typeof listLootDropsForWeek>>;
  players: Awaited<ReturnType<typeof listPlayersForTier>>;
  snapshots: Awaited<ReturnType<typeof loadPlayerSnapshots>>;
  tierSnapshot: Awaited<ReturnType<typeof loadTierSnapshot>>;
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
