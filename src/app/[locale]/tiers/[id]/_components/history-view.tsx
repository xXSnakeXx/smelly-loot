import { format } from "date-fns";
import { de as deLocale, enUS as enLocale } from "date-fns/locale";
import { desc, eq } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { listPlayersForTier } from "@/lib/db/queries-players";
import {
  floor as floorTable,
  lootDrop,
  raidWeek as raidWeekTable,
} from "@/lib/db/schema";

/**
 * Tier-scoped loot history.
 *
 * Renders one card per raid week (newest first) with the per-floor
 * drops underneath. Token purchases get a "via pages" badge; manual
 * overrides (drops awarded against the algorithm's recommendation)
 * get a separate "manual override" badge — exactly matching the
 * spreadsheet's annotations.
 *
 * Used by the tier-detail page's History tab. The shape is identical
 * to the legacy `/history` route so the visual rhythm survives the
 * routing reshuffle.
 */
export async function HistoryView({ tierId }: { tierId: number }) {
  const t = await getTranslations("history");
  const dateLocale = (await getLocale()) === "de" ? deLocale : enLocale;

  const [weeks, drops, floors, players] = await Promise.all([
    db
      .select()
      .from(raidWeekTable)
      .where(eq(raidWeekTable.tierId, tierId))
      .orderBy(desc(raidWeekTable.weekNumber)),
    db
      .select({
        id: lootDrop.id,
        raidWeekId: lootDrop.raidWeekId,
        floorId: lootDrop.floorId,
        itemKey: lootDrop.itemKey,
        recipientId: lootDrop.recipientId,
        paidWithPages: lootDrop.paidWithPages,
        pickedByAlgorithm: lootDrop.pickedByAlgorithm,
        notes: lootDrop.notes,
      })
      .from(lootDrop)
      .innerJoin(raidWeekTable, eq(lootDrop.raidWeekId, raidWeekTable.id))
      .where(eq(raidWeekTable.tierId, tierId))
      .orderBy(lootDrop.id),
    db
      .select()
      .from(floorTable)
      .where(eq(floorTable.tierId, tierId))
      .orderBy(floorTable.number),
    listPlayersForTier(tierId),
  ]);

  const playerNameById = new Map(players.map((p) => [p.id, p.name]));

  const dropsByWeek = new Map<number, typeof drops>();
  for (const drop of drops) {
    const existing = dropsByWeek.get(drop.raidWeekId);
    if (existing) existing.push(drop);
    else dropsByWeek.set(drop.raidWeekId, [drop]);
  }

  if (weeks.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {weeks.map((week) => {
        const weekDrops = dropsByWeek.get(week.id) ?? [];
        const dropsByFloor = new Map<number, typeof drops>();
        for (const drop of weekDrops) {
          const existing = dropsByFloor.get(drop.floorId);
          if (existing) existing.push(drop);
          else dropsByFloor.set(drop.floorId, [drop]);
        }

        return (
          <Card key={week.id}>
            <CardHeader className="flex-row items-baseline justify-between">
              <CardTitle className="text-base font-medium">
                {t("weekLabel", { number: week.weekNumber })}
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {t("weekStarted", {
                  date: format(week.startedAt, "PP", { locale: dateLocale }),
                })}
              </span>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {weekDrops.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noDrops")}</p>
              ) : (
                floors.map((floor) => {
                  const floorDrops = dropsByFloor.get(floor.id) ?? [];
                  if (floorDrops.length === 0) return null;
                  return (
                    <div key={floor.id} className="flex flex-col gap-1">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t("floorLabel", { number: floor.number })}
                      </p>
                      <ul className="grid gap-1.5 sm:grid-cols-2">
                        {floorDrops.map((drop) => (
                          <li
                            key={drop.id}
                            className="flex items-center justify-between gap-2 rounded-md border bg-card/50 px-3 py-1.5 text-sm"
                          >
                            <span className="font-mono text-xs">
                              {drop.itemKey}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="font-medium">
                                {drop.recipientId
                                  ? (playerNameById.get(drop.recipientId) ??
                                    t("unassigned"))
                                  : t("unassigned")}
                              </span>
                              {drop.paidWithPages ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {t("viaPages")}
                                </Badge>
                              ) : null}
                              {!drop.pickedByAlgorithm && drop.recipientId ? (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  {t("manualOverride")}
                                </Badge>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
