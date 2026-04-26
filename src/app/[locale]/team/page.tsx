import { Plus, Settings as SettingsIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getCurrentTeam } from "@/lib/db/queries";
import { listPlayersForTeam } from "@/lib/db/queries-players";

import { PlayerFormDialog } from "./_components/player-form-dialog";
import { PlayersTable } from "./_components/players-table";

// Live data per request — see the dashboard page for the full rationale.
export const dynamic = "force-dynamic";

/**
 * Team page: master roster of every player on the team.
 *
 * The roster here is the canonical, tier-independent source of
 * truth for a player's stable identity (name, main job, alt jobs,
 * gear-tracker URL, freeform notes). Tier-specific data — the BiS
 * plan, page balances, loot history — lives on `/tiers/[id]` and
 * references the same `player.id` rows shown here.
 *
 * Adding a player here adds them to the team but does NOT enrol them
 * in any tier. Tier membership is granted explicitly via the
 * tier-detail "Roster" tab; that's also where the 12-slot
 * Crafted-baseline default BiS plan gets stamped for the chosen
 * tier. This split keeps the team page minimal and avoids the
 * implicit "creating a player added them to 4 tiers without
 * asking" surprise.
 */
export default async function TeamPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("team");
  const tNav = await getTranslations("nav");
  const team = await getCurrentTeam();
  const players = await listPlayersForTeam(team.id);

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("roster.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("roster.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/team/settings"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <SettingsIcon className="size-3" />
            {tNav("teamSettings")}
          </Link>
          <PlayerFormDialog
            teamId={team.id}
            trigger={
              <Button>
                <Plus />
                {t("roster.addCta")}
              </Button>
            }
          />
        </div>
      </header>

      {players.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <h2 className="text-lg font-medium">{t("roster.empty.title")}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {t("roster.empty.description")}
            </p>
            <PlayerFormDialog
              teamId={team.id}
              trigger={
                <Button>
                  <Plus />
                  {t("roster.empty.cta")}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <PlayersTable players={players} teamId={team.id} />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
