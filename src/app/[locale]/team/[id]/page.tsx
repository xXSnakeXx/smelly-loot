import { ArrowLeft, ChevronRight, ExternalLink, Settings } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getCurrentTeam } from "@/lib/db/queries";
import { findPlayer } from "@/lib/db/queries-bis";
import { listTiersForPlayer } from "@/lib/db/queries-players";
import { type GearRole, jobToGearRole } from "@/lib/ffxiv/jobs";
import { cn } from "@/lib/utils";

import { PlayerFormDialog } from "../_components/player-form-dialog";

// Live data per request — see the dashboard page for the full rationale.
export const dynamic = "force-dynamic";

/**
 * Tone classes for the role chip in the hero card.
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
 * Team-level player-detail page.
 *
 * Shows the stable identity of a single team player — name, main
 * job, role, alt jobs, gear-tracker URL, freeform notes — plus a
 * navigation list of every tier this player participates in. The
 * BiS plan + per-floor pages stats + materials need + savage drop
 * counter live on `/tiers/[tid]/players/[pid]` because they're
 * tier-scoped (each tier has its own max iLv and BiS plan).
 *
 * The "Edit identity" affordance opens the same form the team-page
 * roster table uses; from here a user can adjust the team-level
 * fields without leaving the player view.
 */
export default async function TeamPlayerDetailPage({
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

  const tTeam = await getTranslations("team.player");
  const tRoles = await getTranslations("players.roles");

  const team = await getCurrentTeam();
  const player = await findPlayer(playerId);
  if (!player || player.teamId !== team.id) {
    notFound();
  }

  const tiers = await listTiersForPlayer(playerId);
  const role = jobToGearRole(player.mainJob);

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <Link
        href="/team"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        {tTeam("back")}
      </Link>

      {/* Hero card: identity + edit affordance. */}
      <Card>
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
                {tTeam("altJobs")}:{" "}
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
                {tTeam("gearLink")}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
            {player.notes ? (
              <p className="max-w-prose whitespace-pre-line text-xs text-muted-foreground">
                {player.notes}
              </p>
            ) : null}
          </div>

          <PlayerFormDialog
            player={player}
            teamId={team.id}
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-1.5 self-start rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted md:self-auto"
              >
                <Settings className="size-3" />
                {tTeam("editIdentity")}
              </button>
            }
          />
        </CardContent>
      </Card>

      {/* Tier list: per-tier links into the BiS-editor page. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {tTeam("tiers.title")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {tTeam("tiers.description")}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {tiers.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              {tTeam("tiers.empty")}
            </p>
          ) : (
            <ul className="divide-y">
              {tiers.map((tier) => (
                <li key={tier.id}>
                  <Link
                    href={`/tiers/${tier.id}/players/${player.id}`}
                    className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-muted/40"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{tier.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {tier.archivedAt === null
                          ? tTeam("tiers.active")
                          : tTeam("tiers.archived")}
                        {" · "}
                        iLv {tier.maxIlv}
                      </span>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
