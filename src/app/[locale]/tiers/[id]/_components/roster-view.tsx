import { UserPlus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  listPlayersInTier,
  listTeamPlayersNotInTier,
} from "@/lib/db/queries-players";

import { AddPlayersToTierDialog } from "./roster/add-players-to-tier-dialog";
import { RosterBisMatrix } from "./roster/roster-bis-matrix";

/**
 * Roster tab on the tier-detail page.
 *
 * The matrix is the primary view: click any cell to edit the
 * desired / current source for that (player, slot) pair, click a
 * player's name to jump to their team-level detail page. The
 * leftmost cell of each row holds the "remove from tier" button
 * so every per-player roster action is reachable from this single
 * scroll surface.
 *
 * The "Add player" affordance lives in the toolbar above the
 * matrix; it opens a multi-select dialog of every team player
 * not yet in the tier. Each selection stamps the 12-slot
 * Crafted-baseline default BiS plan.
 *
 * Stable identity (name, jobs, gear-link, notes) is edited on the
 * `/team/[id]` page — those fields don't change between tiers
 * and don't belong in the matrix surface.
 */
export async function RosterView({
  tierId,
  teamId,
}: {
  tierId: number;
  teamId: number;
}) {
  const t = await getTranslations("roster");
  const [members, candidates] = await Promise.all([
    listPlayersInTier(tierId),
    listTeamPlayersNotInTier(teamId, tierId),
  ]);

  if (members.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <h2 className="text-lg font-medium">{t("empty.title")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("empty.description")}
          </p>
          {candidates.length > 0 ? (
            <AddPlayersToTierDialog
              tierId={tierId}
              candidates={candidates}
              trigger={
                <Button>
                  <UserPlus />
                  {t("empty.cta")}
                </Button>
              }
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("empty.noTeamPlayers")}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("memberCount", { count: members.length })}
        </p>
        {candidates.length > 0 ? (
          <AddPlayersToTierDialog
            tierId={tierId}
            candidates={candidates}
            trigger={
              <Button size="sm">
                <UserPlus />
                {t("addCta")}
              </Button>
            }
          />
        ) : null}
      </div>

      <RosterBisMatrix tierId={tierId} />
    </div>
  );
}
