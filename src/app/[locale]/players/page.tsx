import { Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentTeam } from "@/lib/db/queries";
import { listPlayersForTeam } from "@/lib/db/queries-players";

import { PlayerFormDialog } from "./_components/player-form-dialog";
import { PlayersTable } from "./_components/players-table";

// Live data per request — see the dashboard page for the full rationale.
export const dynamic = "force-dynamic";

/**
 * Players list page.
 *
 * Server-rendered against the active team's roster. Empty state and
 * the populated table both expose the same `PlayerFormDialog` so the
 * "add player" entry point is consistent. Edit / delete dialogs live
 * inside `PlayersTable` rows.
 */
export default async function PlayersPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("players");
  const team = await getCurrentTeam();
  const players = await listPlayersForTeam(team.id);

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {players.length > 0 ? (
          <PlayerFormDialog
            trigger={
              <Button>
                <Plus />
                {t("addCta")}
              </Button>
            }
          />
        ) : null}
      </header>

      {players.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <h2 className="text-lg font-medium">{t("empty.title")}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {t("empty.description")}
            </p>
            <PlayerFormDialog
              trigger={
                <Button>
                  <Plus />
                  {t("empty.cta")}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <PlayersTable players={players} />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
