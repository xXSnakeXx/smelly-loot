"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type { Player } from "@/lib/db/schema";
import { jobToGearRole } from "@/lib/ffxiv/jobs";
import {
  type RosterActionState,
  removePlayerFromTierAction,
} from "@/lib/tiers/membership-actions";

interface RosterTableProps {
  members: Player[];
  tierId: number;
}

/**
 * Roster table for the tier-detail Roster tab.
 *
 * Each row shows the player's name, main job + role badge, and a
 * remove-from-tier button. Stable-identity edits (name, jobs,
 * gear-link, notes) live on the `/team/[id]` page — clicking the
 * name link jumps there. The "remove from tier" action triggers
 * `removePlayerFromTierAction`, which drops every `bis_choice` row
 * for the (player, tier) pair so the player is no longer a member.
 *
 * The remove control is rendered as a tiny inline form — bound via
 * `useActionState` so we get pending state + error surfacing
 * without manual fetch wiring.
 */
export function RosterTable({ members, tierId }: RosterTableProps) {
  const t = useTranslations("roster.table");
  const tRoles = useTranslations("players.roles");

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("name")}</TableHead>
          <TableHead>{t("job")}</TableHead>
          <TableHead>{t("altJobs")}</TableHead>
          <TableHead className="w-[120px] text-right">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((player) => {
          const role = jobToGearRole(player.mainJob);
          return (
            <TableRow key={player.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/team/${player.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {player.name}
                </Link>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{player.mainJob}</span>
                  {role ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {tRoles(role)}
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {player.altJobs.length > 0 ? (
                  <span className="font-mono text-xs">
                    {player.altJobs.join(", ")}
                  </span>
                ) : (
                  <span className="text-xs">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <RemoveFromTierButton
                  playerId={player.id}
                  tierId={tierId}
                  playerName={player.name}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

const INITIAL_STATE: RosterActionState = { ok: false, reason: "validation" };

/**
 * Per-row "remove from tier" button. Wraps the
 * `removePlayerFromTierAction` server action and surfaces the
 * pending / success / error states as toasts so the user gets
 * feedback even though the row disappears immediately on success.
 */
function RemoveFromTierButton({
  playerId,
  tierId,
  playerName,
}: {
  playerId: number;
  tierId: number;
  playerName: string;
}) {
  const t = useTranslations("roster.toasts");
  const tButton = useTranslations("roster.table");

  const [state, formAction, pending] = useActionState(
    removePlayerFromTierAction,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (state.ok) {
      toast.success(t("removed", { name: playerName }));
    } else if (state.reason === "validation") {
      // initial state — don't toast
    } else {
      toast.error(t("removeError"));
    }
  }, [state, playerName, t]);

  return (
    <form action={formAction} className="inline-flex">
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="tierId" value={tierId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label={tButton("removeFromTier")}
        title={tButton("removeFromTier")}
      >
        <Trash2 />
      </Button>
    </form>
  );
}
