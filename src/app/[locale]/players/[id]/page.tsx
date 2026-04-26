import { ArrowLeft, ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getCurrentContext } from "@/lib/db/queries";
import { findPlayer, listBisChoicesForPlayer } from "@/lib/db/queries-bis";
import { loadPlayerStats } from "@/lib/db/queries-stats";
import { bisProgress } from "@/lib/ffxiv/bis-status";
import { type GearRole, jobToGearRole } from "@/lib/ffxiv/jobs";
import type { BisSource, Slot } from "@/lib/ffxiv/slots";
import { cn } from "@/lib/utils";

import { BisTable } from "./_components/bis-table";
import { PageStatsTable } from "./_components/page-stats-table";

// Live data per request — see the dashboard page for the full rationale.
export const dynamic = "force-dynamic";

/**
 * Slot → upgrade-token mapping.
 *
 * Used to compute "needed" materials from the BiS plan: counting
 * desiredSource === "TomeUp" rows per slot category gives the number
 * of Glaze / Twine / Ester tokens the player still has to acquire.
 *
 * Material assignment follows the seed (`src/lib/db/seed.ts`):
 *
 *   - Glaze drops on Floor 2 alongside Head/Gloves/Boots → small armor
 *   - Twine drops on Floor 3 alongside Chestpiece/Pants → large armor
 *   - Ester drops on Floor 3 → accessories (Earring/Necklace/Bracelet/Rings)
 *
 * Weapons live on Floor 4 (track-only) and don't draw from the three
 * material categories, so they're omitted on purpose.
 */
const SLOT_TO_MATERIAL: Partial<Record<Slot, "Glaze" | "Twine" | "Ester">> = {
  Head: "Glaze",
  Gloves: "Glaze",
  Boots: "Glaze",
  Chestpiece: "Twine",
  Pants: "Twine",
  Earring: "Ester",
  Necklace: "Ester",
  Bracelet: "Ester",
  Ring1: "Ester",
  Ring2: "Ester",
};

/**
 * Tone classes for the role chip in the hero card. The five gear
 * roles get a distinct accent + matching foreground; jobs that have
 * no role mapping fall through to neutral.
 */
const ROLE_CLASSES: Record<GearRole, string> = {
  tank: "bg-sky-100 text-sky-700 ring-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-700/40",
  healer:
    "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-700/40",
  melee:
    "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-700/40",
  phys_range:
    "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700/40",
  caster:
    "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:ring-violet-700/40",
};

/**
 * Player detail page.
 *
 * Sections:
 *
 * 1. **Hero card** — large name, role-coloured job chip, alt jobs,
 *    gear-set link, and a BiS progress bar so the operator gets the
 *    headline status the moment the page paints.
 * 2. **Pages** — auto-derived per-floor balance (the only editable
 *    seam in the page-accounting layer; Adjust column).
 * 3. **Materials** — Glaze/Twine/Ester table with received vs needed
 *    counts driven by the BiS plan, so a "Glaze: 1/4" reads as
 *    "received 1, still need 3 more for the planned upgrades".
 * 4. **Savage drops** — small fairness-counter card.
 * 5. **BiS tracker** — the twelve-slot table with spreadsheet-style
 *    colour-coded rows.
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
    listBisChoicesForPlayer(playerId, tier.id),
    loadPlayerStats(playerId, tier.id),
  ]);
  const role = jobToGearRole(player.mainJob);

  // Derive the per-material need from the BiS plan: each slot whose
  // desiredSource === "TomeUp" demands one token of that slot's
  // material. Slots without a matching material (e.g. Weapon) are
  // ignored.
  const materialsNeeded: Record<"Glaze" | "Twine" | "Ester", number> = {
    Glaze: 0,
    Twine: 0,
    Ester: 0,
  };
  for (const choice of choices) {
    if (choice.desiredSource !== ("TomeUp" satisfies BisSource)) continue;
    const material = SLOT_TO_MATERIAL[choice.slot as Slot];
    if (material) materialsNeeded[material] += 1;
  }

  const progress = bisProgress(
    choices.map((c) => ({
      desiredSource: c.desiredSource as BisSource,
      currentSource: c.currentSource as BisSource,
    })),
  );

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <Link
        href="/players"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        {tPlayers("detail.back")}
      </Link>

      {/* Hero card: name, job chip, alt jobs, gear-set link, BiS progress. */}
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-6 p-6 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">
                {player.name}
              </h1>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-xs ring-1 ring-inset",
                  role
                    ? ROLE_CLASSES[role]
                    : "bg-muted text-muted-foreground ring-border",
                )}
              >
                {player.mainJob}
              </span>
              {role ? (
                <span className="text-xs text-muted-foreground">
                  {tRoles(role)}
                </span>
              ) : null}
            </div>
            {player.altJobs.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {tStats("hero.altJobs")}:{" "}
                <span className="font-mono text-foreground/80">
                  {player.altJobs.join(", ")}
                </span>
              </p>
            ) : null}
            {player.gearLink ? (
              <a
                href={player.gearLink}
                className="inline-flex w-fit items-center gap-1 text-sm text-foreground underline-offset-4 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {tStats("hero.gearLink")}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>

          {/* BiS progress: ring + count + bar. */}
          <div className="flex flex-col items-stretch gap-2 md:min-w-[280px]">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {tStats("hero.bisProgress")}
              </span>
              <span className="font-mono text-sm">
                {tStats("hero.bisProgressValue", {
                  achieved: progress.achieved,
                  planned: progress.planned,
                })}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-violet-400 transition-all dark:bg-violet-500"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="text-right font-mono text-xs text-muted-foreground">
              {progress.percent}%
            </span>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* Pages stats — wide. */}
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

        {/* Materials + Savage compact column. */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">
                {tStats("materials.title")}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {tStats("materials.description")}
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 text-center text-xs">
              <span className="col-start-2 text-muted-foreground">
                {tStats("materials.received")}
              </span>
              <span className="text-muted-foreground">
                {tStats("materials.needed")}
              </span>
              {(["Glaze", "Twine", "Ester"] as const).map((mat) => {
                const got = stats.materialsReceived[mat];
                const need = materialsNeeded[mat];
                const remaining = Math.max(need - got, 0);
                const fulfilled = need === 0 ? false : got >= need;
                return (
                  <MaterialGrid
                    key={mat}
                    label={mat}
                    received={got}
                    needed={need}
                    remaining={remaining}
                    fulfilled={fulfilled}
                  />
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">
                {tStats("savage.title")}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {tStats("savage.description")}
              </p>
            </CardHeader>
            <CardContent className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">
                {tStats("savage.totalLabel")}
              </span>
              <span className="font-mono text-2xl">
                {stats.savageDropsThisTier}
              </span>
            </CardContent>
          </Card>
        </div>
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

/**
 * Material row laid out as three cells in a 3-column grid.
 *
 * - Label
 * - Received (mono)
 * - Needed (mono) — shown as `count - remaining` when partially
 *   fulfilled to make the residual obvious without a third column.
 *
 * Fully-funded materials get a subtle emerald tint; everything else
 * stays neutral.
 */
function MaterialGrid({
  label,
  received,
  needed,
  remaining: _remaining,
  fulfilled,
}: {
  label: string;
  received: number;
  needed: number;
  remaining: number;
  fulfilled: boolean;
}) {
  return (
    <>
      <span
        className={cn(
          "rounded-md px-2 py-1 text-left font-medium",
          fulfilled
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
            : "bg-muted/40",
        )}
      >
        {label}
      </span>
      <span className="self-center font-mono text-sm">{received}</span>
      <span
        className={cn(
          "self-center font-mono text-sm",
          needed === 0 ? "text-muted-foreground" : "",
        )}
      >
        {needed}
      </span>
    </>
  );
}
