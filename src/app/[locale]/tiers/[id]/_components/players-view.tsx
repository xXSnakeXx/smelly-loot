import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listPlayersForTier } from "@/lib/db/queries-players";

import { PlayerFormDialog } from "./players/player-form-dialog";
import { PlayersTable } from "./players/players-table";

/**
 * Players tab on the tier-detail page.
 *
 * Players are tier-scoped (v1.4) so this component takes a `tierId`
 * and lists the roster for that tier specifically. The same
 * `PlayerFormDialog` and `PlayersTable` components used by the
 * legacy `/players` route are reused here — they were lifted into
 * `_components/players/` so they live alongside the only place
 * that renders them.
 *
 * Both the empty-state CTA and the toolbar action open the same
 * `PlayerFormDialog`. The dialog stamps a hidden `tierId` field so
 * `createPlayerAction` knows which roster to attach the new player
 * to without an extra round-trip to look up the active tier.
 */
export async function PlayersView({ tierId }: { tierId: number }) {
  const t = await getTranslations("players");
  const players = await listPlayersForTier(tierId);

  if (players.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <h2 className="text-lg font-medium">{t("empty.title")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("empty.description")}
          </p>
          <PlayerFormDialog
            tierId={tierId}
            trigger={
              <Button>
                <Plus />
                {t("empty.cta")}
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <PlayerFormDialog
          tierId={tierId}
          trigger={
            <Button>
              <Plus />
              {t("addCta")}
            </Button>
          }
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <PlayersTable players={players} tierId={tierId} />
        </CardContent>
      </Card>
    </div>
  );
}
