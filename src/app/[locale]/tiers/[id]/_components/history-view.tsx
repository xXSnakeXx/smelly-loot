import { format } from "date-fns";
import { de as deLocale, enUS as enLocale } from "date-fns/locale";
import { desc, eq } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { listPlayersInTier } from "@/lib/db/queries-players";
import {
  floor as floorTable,
  lootDrop,
  raidWeek as raidWeekTable,
} from "@/lib/db/schema";

import { HistoryWeekCard, type HistoryDropRow } from "./history-week-card";

/**
 * Tier-scoped loot history (server entry point).
 *
 * Fetches every raid week + its drops + floor metadata + roster,
 * stitches the data into the shape the per-week client card
 * expects, and renders a stack of cards (newest first).
 *
 * The interactive bits — collapse / expand, per-drop revert,
 * per-week reset — live in `HistoryWeekCard`. This component
 * stays a Server Component so the read-side does no extra work
 * client-side.
 */
export async function HistoryView({ tierId }: { tierId: number }) {
  const t = await getTranslations("history");
  const dateLocale = (await getLocale()) === "de" ? deLocale : enLocale;
  const locale = (await getLocale()) === "de" ? "de" : "en";

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
        targetSlot: lootDrop.targetSlot,
        previousCurrentSource: lootDrop.previousCurrentSource,
        notes: lootDrop.notes,
        awardedAt: lootDrop.awardedAt,
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
    listPlayersInTier(tierId),
  ]);

  const playerNameById = new Map(players.map((p) => [p.id, p.name]));
  const floorNumberById = new Map(floors.map((f) => [f.id, f.number]));

  const dropsByWeek = new Map<number, HistoryDropRow[]>();
  for (const drop of drops) {
    const recipientName = drop.recipientId
      ? (playerNameById.get(drop.recipientId) ?? null)
      : null;
    const floorNumber = floorNumberById.get(drop.floorId) ?? 0;
    const row: HistoryDropRow = {
      id: drop.id,
      floorId: drop.floorId,
      floorNumber,
      itemKey: drop.itemKey,
      recipientId: drop.recipientId,
      recipientName,
      targetSlot: drop.targetSlot,
      previousCurrentSource: drop.previousCurrentSource,
      paidWithPages: drop.paidWithPages,
      pickedByAlgorithm: drop.pickedByAlgorithm,
      notes: drop.notes,
    };
    const existing = dropsByWeek.get(drop.raidWeekId);
    if (existing) existing.push(row);
    else dropsByWeek.set(drop.raidWeekId, [row]);
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

  // Default-expand the most recent week; others stay collapsed.
  const mostRecentWeekId = weeks[0]?.id;

  return (
    <div className="flex flex-col gap-3">
      {weeks.map((week) => {
        const weekDrops = dropsByWeek.get(week.id) ?? [];
        return (
          <HistoryWeekCard
            key={week.id}
            weekId={week.id}
            weekNumber={week.weekNumber}
            startedAtIso={week.startedAt.toISOString()}
            startedAtLabel={format(week.startedAt, "PPP", {
              locale: dateLocale,
            })}
            drops={weekDrops}
            floors={floors.map((f) => ({
              id: f.id,
              number: f.number,
              itemKeys: (f.drops as string[]) ?? [],
            }))}
            defaultOpen={week.id === mostRecentWeekId}
            locale={locale}
          />
        );
      })}
    </div>
  );
}
