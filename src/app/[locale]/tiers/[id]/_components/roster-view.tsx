import { UserPlus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  listPlayersInTier,
  listTeamPlayersNotInTier,
} from "@/lib/db/queries-players";

import { AddPlayersToTierDialog } from "./roster/add-players-to-tier-dialog";
import { RosterTable } from "./roster/roster-table";

/**
 * Roster tab on the tier-detail page.
 *
 * Players are team-scoped (v2.0) — the canonical roster lives on
 * `/team`. A player IS a member of a tier iff at least one
 * `bis_choice` row exists for the (player, tier) pair. This view
 * lists the current tier members and offers two affordances:
 *
 *   - "Add players" — opens a dialog showing every team player not
 *     yet in the tier, with checkboxes; submitting stamps the
 *     12-slot Crafted-baseline default BiS plan for each selection.
 *   - Per-row "Remove from tier" — drops every `bis_choice` row for
 *     that (player, tier) pair, taking the player out of the tier
 *     while leaving their team-level identity (and historical loot
 *     drops) untouched.
 *
 * Stable identity (name, jobs, gear-link, notes) is edited on the
 * `/team` page, not here, because those fields don't change between
 * tiers.
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
      <div className="flex items-center justify-end">
        {candidates.length > 0 ? (
          <AddPlayersToTierDialog
            tierId={tierId}
            candidates={candidates}
            trigger={
              <Button>
                <UserPlus />
                {t("addCta")}
              </Button>
            }
          />
        ) : null}
      </div>
      <Card>
        <CardContent className="p-0">
          <RosterTable members={members} tierId={tierId} />
        </CardContent>
      </Card>
    </div>
  );
}
