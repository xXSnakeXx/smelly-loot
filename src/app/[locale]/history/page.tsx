import { format } from "date-fns";
import { de as deLocale, enUS as enLocale } from "date-fns/locale";
import { desc, eq } from "drizzle-orm";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { getCurrentContext } from "@/lib/db/queries";
import { listPlayersForTeam } from "@/lib/db/queries-players";
import {
  floor as floorTable,
  lootDrop,
  raidWeek as raidWeekTable,
} from "@/lib/db/schema";

// Live data per request — see the dashboard page for the full rationale.
export const dynamic = "force-dynamic";

/**
 * Loot-history page.
 *
 * Reads every raid week + every loot drop on the active tier and
 * renders a per-week card. Each card has one row per cleared floor;
 * each floor lists its drops with the recipient. Token purchases and
 * manual overrides surface as small badges so the spreadsheet's
 * "via pages" / "override" annotations are preserved.
 */
export default async function HistoryPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("history");
  const dateLocale = (await getLocale()) === "de" ? deLocale : enLocale;
  const { team, tier } = await getCurrentContext();

  // Pull every week + drop for this tier in two queries; group in JS.
  const [weeks, drops, floors, players] = await Promise.all([
    db
      .select()
      .from(raidWeekTable)
      .where(eq(raidWeekTable.tierId, tier.id))
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
      .where(eq(raidWeekTable.tierId, tier.id))
      .orderBy(lootDrop.id),
    db
      .select()
      .from(floorTable)
      .where(eq(floorTable.tierId, tier.id))
      .orderBy(floorTable.number),
    listPlayersForTeam(team.id),
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
      <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </header>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

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
                  <p className="text-sm text-muted-foreground">
                    {t("noDrops")}
                  </p>
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
    </main>
  );
}
