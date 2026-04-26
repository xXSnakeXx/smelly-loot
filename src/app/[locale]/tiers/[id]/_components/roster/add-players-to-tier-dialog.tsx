"use client";

import { useTranslations } from "next-intl";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Player } from "@/lib/db/schema";
import { jobToGearRole } from "@/lib/ffxiv/jobs";
import {
  addPlayerToTierAction,
  type RosterActionState,
} from "@/lib/tiers/membership-actions";

interface AddPlayersToTierDialogProps {
  tierId: number;
  candidates: Player[];
  trigger: ReactElement;
}

const INITIAL_STATE: RosterActionState = { ok: false, reason: "validation" };

/**
 * Dialog for adding team players to a tier's roster.
 *
 * Renders a checklist of every team player NOT currently in the
 * tier. The user picks one or many, and on submit each selection
 * fires its own `addPlayerToTierAction` invocation (the action
 * stamps the 12-slot Crafted-baseline default BiS plan for the
 * (player, tier) pair).
 *
 * Per-player actions instead of a single batched action keeps the
 * server-action contract simple: each call validates exactly one
 * (player, tier) pair, errors are localised to that pair, and a
 * partial failure leaves the rest of the additions intact.
 */
export function AddPlayersToTierDialog({
  tierId,
  candidates,
  trigger,
}: AddPlayersToTierDialogProps) {
  const t = useTranslations("roster.addDialog");
  const tToasts = useTranslations("roster.toasts");
  const tRoles = useTranslations("players.roles");

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const fd = new FormData();
      fd.set("playerId", String(id));
      fd.set("tierId", String(tierId));
      const result = await addPlayerToTierAction(INITIAL_STATE, fd);
      if (result.ok) ok += 1;
      else fail += 1;
    }
    if (ok > 0) toast.success(tToasts("added", { count: ok }));
    if (fail > 0) toast.error(tToasts("addError", { count: fail }));
    setOpen(false);
    setSelected(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto py-2">
          {candidates.map((player) => {
            const role = jobToGearRole(player.mainJob);
            const id = `add-player-${player.id}`;
            return (
              <Label
                key={player.id}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-2 hover:bg-muted/40"
              >
                <Checkbox
                  id={id}
                  checked={selected.has(player.id)}
                  onCheckedChange={() => toggle(player.id)}
                />
                <span className="flex-1 text-sm">{player.name}</span>
                <span className="font-mono text-xs">{player.mainJob}</span>
                {role ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {tRoles(role)}
                  </Badge>
                ) : null}
              </Label>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={selected.size === 0}>
            {t("submit", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
