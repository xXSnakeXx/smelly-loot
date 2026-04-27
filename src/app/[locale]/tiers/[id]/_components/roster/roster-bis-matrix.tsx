import { Trash2 } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getCurrentTeam } from "@/lib/db/queries";
import { listBisChoicesForTier } from "@/lib/db/queries-bis";
import { listPlayersInTier } from "@/lib/db/queries-players";
import { findTierById } from "@/lib/db/queries-tiers";
import {
  type BisRowTone,
  bisToneClasses,
  computeBisTone,
} from "@/lib/ffxiv/bis-status";
import { type GearRole, jobToGearRole } from "@/lib/ffxiv/jobs";
import { type BisSource, SLOTS, type Slot } from "@/lib/ffxiv/slots";
import { removePlayerFromTierAction } from "@/lib/tiers/membership-actions";
import { cn } from "@/lib/utils";

import { BisMatrixCell } from "./bis-matrix-cell";

/**
 * Roster-tab BiS matrix.
 *
 * Spreadsheet-style overview of every player × every wearable
 * slot for the tier. Each cell is an interactive `BisMatrixCell`
 * that pops an inline editor on click — change desired or current
 * source, the action saves immediately, the page revalidates and
 * the cell re-renders. No round-trip via the per-player editor
 * required.
 *
 * Sticky-header / sticky-leftmost-column means the player names
 * stay visible while scrolling the grid horizontally on a small
 * screen, and the slot headers stay visible while scrolling
 * vertically.
 *
 * The Offhand column is omitted because only Paladins ever wear
 * one and a 7/8-empty column was just noise. Per-slot Offhand
 * edits still happen via the per-player BiS editor at
 * `/tiers/[tid]/players/[pid]`.
 *
 * The "remove from tier" affordance has been folded into the
 * matrix's leftmost cell so the standalone `RosterTable` below it
 * isn't needed — every roster action a player would do
 * (rename / change job / remove / edit BiS) is now reachable
 * from this view in one or two clicks.
 */

interface RosterBisMatrixProps {
  tierId: number;
}

const MATRIX_SLOTS: ReadonlyArray<Slot> = SLOTS.filter(
  (slot) => slot !== "Offhand",
);

const SLOT_HEADER: Record<Slot, string> = {
  Weapon: "Wpn",
  Offhand: "Off",
  Head: "Head",
  Chestpiece: "Chest",
  Gloves: "Gloves",
  Pants: "Pants",
  Boots: "Boots",
  Earring: "Earring",
  Necklace: "Necklace",
  Bracelet: "Bracelet",
  Ring1: "Ring 1",
  Ring2: "Ring 2",
};

/**
 * Tone classes for the role chip in the player column.
 */
const ROLE_CLASSES: Record<GearRole, string> = {
  tank: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
  healer:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  melee: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
  phys_range:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  caster:
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
};

/** Sort the gear roles in the order the spreadsheet uses. */
const ROLE_ORDER: Record<GearRole, number> = {
  tank: 0,
  healer: 1,
  melee: 2,
  phys_range: 3,
  caster: 4,
};

export async function RosterBisMatrix({ tierId }: RosterBisMatrixProps) {
  const t = await getTranslations("roster.matrix");
  const tRoles = await getTranslations("players.roles");

  const team = await getCurrentTeam();
  const tier = await findTierById(team.id, tierId);
  if (!tier) return null;

  const [players, allBis] = await Promise.all([
    listPlayersInTier(tierId),
    listBisChoicesForTier(tierId),
  ]);
  if (players.length === 0) return null;

  // Sort players by gear role (tank → healer → melee → phys_range
  // → caster) so the matrix mirrors the spreadsheet's row order.
  // Ties fall back to sort_order then id for stability.
  const sortedPlayers = [...players].sort((a, b) => {
    const ra = jobToGearRole(a.mainJob) ?? "caster";
    const rb = jobToGearRole(b.mainJob) ?? "caster";
    const roleDelta = ROLE_ORDER[ra] - ROLE_ORDER[rb];
    if (roleDelta !== 0) return roleDelta;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

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
    <Card className="overflow-hidden">
      <header className="flex flex-col gap-1 border-b px-4 py-3">
        <h2 className="text-base font-medium">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </header>

      <div className="overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 left-0 z-30 border-b border-r bg-muted/60 px-3 py-2 text-left text-xs font-medium text-muted-foreground backdrop-blur"
              >
                {t("playerColumn")}
              </th>
              {MATRIX_SLOTS.map((slot) => (
                <th
                  key={slot}
                  scope="col"
                  className="sticky top-0 z-20 border-b bg-muted/60 px-2 py-2 text-center text-xs font-medium text-muted-foreground backdrop-blur"
                >
                  {SLOT_HEADER[slot]}
                </th>
              ))}
              <th
                scope="col"
                className="sticky top-0 z-20 border-b bg-muted/60 px-2 py-2 text-center text-xs font-medium text-muted-foreground backdrop-blur"
              >
                {t("removeColumn")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((player) => {
              const role = jobToGearRole(player.mainJob);
              const slotMap:
                | Map<Slot, { desired: BisSource; current: BisSource }>
                | undefined = bisByPlayerSlot.get(player.id);
              return (
                <tr key={player.id} className="hover:bg-muted/15">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-r bg-background px-3 py-2 text-left font-normal"
                  >
                    <Link
                      href={`/team/${player.id}`}
                      className="block text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {player.name}
                    </Link>
                    <span
                      className={cn(
                        "mt-0.5 inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                        role
                          ? ROLE_CLASSES[role]
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {player.mainJob}
                      {role ? ` · ${tRoles(role)}` : ""}
                    </span>
                  </th>
                  {MATRIX_SLOTS.map((slot) => {
                    const entry = slotMap?.get(slot);
                    const desired: BisSource = entry?.desired ?? "NotPlanned";
                    const current: BisSource = entry?.current ?? "NotPlanned";
                    const tone: BisRowTone = computeBisTone(
                      desired,
                      current,
                      tier,
                    );
                    return (
                      <td
                        key={slot}
                        className="border-b p-1 text-center align-middle"
                      >
                        <BisMatrixCell
                          playerId={player.id}
                          tierId={tierId}
                          slot={slot}
                          desired={desired}
                          current={current}
                          tone={tone}
                          tier={tier}
                        />
                      </td>
                    );
                  })}
                  <td className="border-b p-1 text-center">
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        await removePlayerFromTierAction(
                          { ok: false, reason: "validation" },
                          formData,
                        );
                      }}
                      className="inline-flex"
                    >
                      <input type="hidden" name="playerId" value={player.id} />
                      <input type="hidden" name="tierId" value={tierId} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-sm"
                        title={t("removeRow")}
                        aria-label={t("removeRow")}
                      >
                        <Trash2 />
                      </Button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend so the colour code stays self-documenting. */}
      <div className="flex flex-wrap gap-3 border-t px-4 py-3 text-[11px] text-muted-foreground">
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
function LegendChip({ tone, label }: { tone: BisRowTone; label: string }) {
  const classes = bisToneClasses(tone);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-3 rounded-sm", classes.accent)} />
      {label}
    </span>
  );
}
