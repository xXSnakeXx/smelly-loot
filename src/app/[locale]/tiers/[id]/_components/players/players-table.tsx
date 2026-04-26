"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

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

import { DeletePlayerDialog } from "./delete-player-dialog";
import { PlayerFormDialog } from "./player-form-dialog";

interface PlayersTableProps {
  players: Player[];
  tierId: number;
}

/**
 * Read-mostly table of players with per-row Edit / Delete buttons.
 *
 * Each row shows the player's name, the main job + role badge, the
 * comma-separated alt jobs (if any), and a truncated gear-link. The
 * per-row dialogs (`PlayerFormDialog`, `DeletePlayerDialog`) handle
 * the writes. `tierId` is forwarded to the edit dialog so the form
 * can stamp the hidden tier-id input that `createPlayerAction`
 * expects (edits don't actually change the tier, but the dialog is
 * the same component).
 */
export function PlayersTable({ players, tierId }: PlayersTableProps) {
  const t = useTranslations("players.table");
  const tRoles = useTranslations("players.roles");

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("name")}</TableHead>
          <TableHead>{t("job")}</TableHead>
          <TableHead>{t("altJobs")}</TableHead>
          <TableHead>{t("gearLink")}</TableHead>
          <TableHead className="w-[120px] text-right">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {players.map((player) => {
          const role = jobToGearRole(player.mainJob);
          return (
            <TableRow key={player.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/players/${player.id}`}
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
              <TableCell>
                {player.gearLink ? (
                  <a
                    href={player.gearLink}
                    className="block max-w-[20ch] truncate text-xs text-foreground underline-offset-4 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {player.gearLink}
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex items-center gap-1">
                  <PlayerFormDialog
                    player={player}
                    tierId={tierId}
                    trigger={
                      <Button variant="ghost" size="icon-sm">
                        <Pencil />
                      </Button>
                    }
                  />
                  <DeletePlayerDialog
                    playerId={player.id}
                    trigger={
                      <Button variant="ghost" size="icon-sm">
                        <Trash2 />
                      </Button>
                    }
                  />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
