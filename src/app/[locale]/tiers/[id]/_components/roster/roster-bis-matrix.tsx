import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getCurrentTeam } from "@/lib/db/queries";
import { listBisChoicesForTier } from "@/lib/db/queries-bis";
import { listPlayersInTier } from "@/lib/db/queries-players";
import { findTierById } from "@/lib/db/queries-tiers";
import { bisToneClasses, computeBisTone } from "@/lib/ffxiv/bis-status";
import { jobToGearRole } from "@/lib/ffxiv/jobs";
import { type BisSource, SLOTS, type Slot } from "@/lib/ffxiv/slots";
import { cn } from "@/lib/utils";

/**
 * Roster-tab BiS matrix.
 *
 * Renders one row per player and one column per slot, with each
 * cell colour-coded to mirror the spreadsheet legend (purple =
 * BiS achieved, amber = needs upgrade, red = significant gap,
 * etc.). Each cell shows two short codes:
 *
 *   - top: desired source ("S", "T+", "C", "T", "E", "Cr", ...)
 *   - bottom: current source
 *
 * Clicking a player's name opens the per-player BiS-table editor
 * at /tiers/[tid]/players/[pid] for full per-slot edits. The
 * matrix itself is read-only — its job is the at-a-glance "who
 * has what" overview the spreadsheet provided, not editing.
 */

const SOURCE_SHORT: Record<BisSource, string> = {
  Savage: "S",
  TomeUp: "T+",
  Catchup: "C",
  Tome: "T",
  Extreme: "E",
  Relic: "R",
  Crafted: "Cr",
  WHYYYY: "?",
  JustNo: "✗",
  NotPlanned: "—",
};

/**
 * Slot order shown in the matrix. Mirrors the canonical SLOTS
 * declaration so the column layout matches everywhere we surface
 * a slot list, but skips Offhand for now — only Paladins ever
 * wear one and a column where 7 of 8 cells say "—" is mostly
 * noise. Operators who need to track Offhand can still edit it
 * via the per-player BiS table.
 */
const MATRIX_SLOTS: ReadonlyArray<Slot> = SLOTS.filter(
  (slot) => slot !== "Offhand",
);

/**
 * Short labels for the column headers. Keep them tight so all 11
 * columns fit on a typical raid-leader screen without horizontal
 * scrolling.
 */
const SLOT_HEADER: Record<Slot, string> = {
  Weapon: "Wpn",
  Offhand: "Off",
  Head: "Hd",
  Chestpiece: "Chst",
  Gloves: "Glv",
  Pants: "Pnt",
  Boots: "Bts",
  Earring: "Ear",
  Necklace: "Nck",
  Bracelet: "Brc",
  Ring1: "R1",
  Ring2: "R2",
};

interface RosterBisMatrixProps {
  tierId: number;
}

export async function RosterBisMatrix({ tierId }: RosterBisMatrixProps) {
  const t = await getTranslations("roster.matrix");

  const team = await getCurrentTeam();
  const tier = await findTierById(team.id, tierId);
  if (!tier) return null;

  const [players, allBis] = await Promise.all([
    listPlayersInTier(tierId),
    listBisChoicesForTier(tierId),
  ]);
  if (players.length === 0) return null;

  // Build a lookup: playerId → slot → { desired, current } so the
  // render path is a clean O(player × slot) double loop without
  // re-scanning `allBis` per cell.
  const bisByPlayerSlot = new Map<
    number,
    Map<Slot, { desired: BisSource; current: BisSource }>
  >();
  for (const row of allBis) {
    let slotMap = bisByPlayerSlot.get(row.playerId);
    if (!slotMap) {
      slotMap = new Map();
      bisByPlayerSlot.set(row.playerId, slotMap);
    }
    slotMap.set(row.slot as Slot, {
      desired: row.desiredSource as BisSource,
      current: row.currentSource as BisSource,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">{t("title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="bg-muted/30 text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left font-medium">
                {t("playerColumn")}
              </th>
              {MATRIX_SLOTS.map((slot) => (
                <th
                  key={slot}
                  className="px-2 py-2 text-center font-medium"
                  title={slot}
                >
                  {SLOT_HEADER[slot]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((player) => {
              const role = jobToGearRole(player.mainJob);
              const slotMap: Map<
                Slot,
                { desired: BisSource; current: BisSource }
              > = bisByPlayerSlot.get(player.id) ?? new Map();
              return (
                <tr
                  key={player.id}
                  className="border-t border-border/50 hover:bg-muted/20"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-normal"
                  >
                    <Link
                      href={`/tiers/${tierId}/players/${player.id}`}
                      className="block underline-offset-4 hover:underline"
                    >
                      <span className="block font-medium">{player.name}</span>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {player.mainJob}
                        {role ? ` · ${role}` : ""}
                      </span>
                    </Link>
                  </th>
                  {MATRIX_SLOTS.map((slot) => {
                    const entry = slotMap.get(slot);
                    const desired = entry?.desired ?? "NotPlanned";
                    const current = entry?.current ?? "NotPlanned";
                    const tone = computeBisTone(desired, current, tier);
                    const toneClasses = bisToneClasses(tone);
                    const fullTitle = `${slot}: ${desired} desired / ${current} current`;
                    return (
                      <td
                        key={slot}
                        title={fullTitle}
                        className={cn(
                          "px-1.5 py-1 text-center font-mono",
                          toneClasses.row,
                        )}
                      >
                        <div className="flex flex-col items-center leading-tight">
                          <span className="text-[11px] font-semibold">
                            {SOURCE_SHORT[desired]}
                          </span>
                          <span className="text-[9px] text-muted-foreground">
                            {SOURCE_SHORT[current]}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>

      {/* Legend so the colour code stays self-documenting. */}
      <div className="flex flex-wrap gap-2 border-t px-4 py-3 text-[10px] text-muted-foreground">
        <LegendChip tone="bis-achieved" label={t("legend.bisAchieved")} />
        <LegendChip tone="needs-upgrade" label={t("legend.needsUpgrade")} />
        <LegendChip tone="near-max" label={t("legend.nearMax")} />
        <LegendChip tone="intermediate" label={t("legend.intermediate")} />
        <LegendChip tone="behind" label={t("legend.behind")} />
        <LegendChip tone="significant-gap" label={t("legend.significantGap")} />
      </div>
    </Card>
  );
}

/**
 * Legend swatch — small coloured square + label, matched against
 * the matrix cell tone classes so the legend reads correctly under
 * both light and dark themes.
 */
function LegendChip({
  tone,
  label,
}: {
  tone: Parameters<typeof bisToneClasses>[0];
  label: string;
}) {
  const classes = bisToneClasses(tone);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-3 rounded-sm", classes.accent)} />
      {label}
    </span>
  );
}
