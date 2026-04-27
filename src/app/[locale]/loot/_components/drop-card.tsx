"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ItemKey } from "@/lib/ffxiv/slots";
import { awardLootDropAction, undoLootDropAction } from "@/lib/loot/actions";

export interface RecommendationEntry {
  playerId: number;
  playerName: string;
  score: number;
  effectiveNeed: number;
  buyPower: number;
  roleWeight: number;
}

interface AwardedInfo {
  lootDropId: number;
  recipientId: number;
  recipientName: string;
  paidWithPages: boolean;
  pickedByAlgorithm: boolean;
}

interface DropCardProps {
  raidWeekId: number;
  floorId: number;
  itemKey: ItemKey;
  itemLabel: string;
  rankings: RecommendationEntry[];
  awarded?: AwardedInfo | undefined;
}

/**
 * Single drop within a floor section.
 *
 * Three render branches:
 *
 *  1. Awarded — shows the recipient and an Undo button. The award is
 *     authoritative; the recommendation cards are rendered only for
 *     unassigned drops.
 *  2. Eligible recipients — shows the algorithm's top pick prominently
 *     (Topic 6, Option A) plus an "Other player" button that opens a
 *     dialog with the full ranked list.
 *  3. No eligible recipient — usually means every player is covered
 *     by pages or no one wants the slot at all. The Other-player
 *     dialog is still available so the operator can hand-assign.
 */
export function DropCard({
  raidWeekId,
  floorId,
  itemKey,
  itemLabel,
  rankings,
  awarded,
}: DropCardProps) {
  const t = useTranslations("loot.drop");
  const tToast = useTranslations("loot.toasts");
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  const award = (
    recipientId: number,
    recipientName: string,
    pickedByAlgorithm: boolean,
  ) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("raidWeekId", String(raidWeekId));
      formData.set("floorId", String(floorId));
      formData.set("itemKey", itemKey);
      formData.set("recipientId", String(recipientId));
      formData.set("pickedByAlgorithm", pickedByAlgorithm ? "true" : "false");
      // Persist a compact snapshot so historical decisions stay
      // auditable even if the algorithm is tweaked later.
      formData.set(
        "scoreSnapshot",
        JSON.stringify({ rankings, recipientId, pickedByAlgorithm }),
      );
      const result = await awardLootDropAction(formData);
      if (result.ok) {
        toast.success(tToast("dropAwarded", { name: recipientName }));
        setPickerOpen(false);
      } else if (result.reason === "not_bis") {
        toast.error(tToast("notBisError", { name: recipientName }));
      } else {
        toast.error(tToast("error"));
      }
    });
  };

  const undo = (lootDropId: number) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("lootDropId", String(lootDropId));
      const result = await undoLootDropAction(formData);
      if (result.ok) {
        toast.success(tToast("dropUndone"));
      } else {
        toast.error(tToast("error"));
      }
    });
  };

  const top = rankings[0];
  const hasEligible = top !== undefined && top.score > 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm">{itemLabel}</h3>
        {awarded ? (
          <Badge variant={awarded.pickedByAlgorithm ? "default" : "secondary"}>
            {awarded.recipientName}
          </Badge>
        ) : null}
      </div>

      {awarded ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t("awarded", { name: awarded.recipientName })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => undo(awarded.lootDropId)}
          >
            {t("undo")}
          </Button>
        </div>
      ) : hasEligible ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">
              {t("recommended")}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {Math.round(top.score)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{top.playerName}</span>
            <span className="text-xs text-muted-foreground">
              {t("scoreBreakdown", {
                need: top.effectiveNeed,
                role: top.roleWeight.toFixed(2),
                ilv: "—",
                fairness: "—",
                recency: "—",
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => award(top.playerId, top.playerName, true)}
            >
              {t("accept", { name: top.playerName })}
            </Button>
            <ManualPicker
              raidWeekId={raidWeekId}
              floorId={floorId}
              itemKey={itemKey}
              itemLabel={itemLabel}
              rankings={rankings}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onPick={(playerId, playerName) =>
                award(playerId, playerName, false)
              }
              pending={pending}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {rankings.length > 0 ? t("noEligible") : t("noBisNeeders")}
          </p>
          {rankings.length > 0 ? (
            <ManualPicker
              raidWeekId={raidWeekId}
              floorId={floorId}
              itemKey={itemKey}
              itemLabel={itemLabel}
              rankings={rankings}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onPick={(playerId, playerName) =>
                award(playerId, playerName, false)
              }
              pending={pending}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

interface ManualPickerProps {
  raidWeekId: number;
  floorId: number;
  itemKey: ItemKey;
  itemLabel: string;
  rankings: RecommendationEntry[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onPick: (playerId: number, playerName: string) => void;
  pending: boolean;
}

/**
 * Override-list dialog: every player sorted by algorithm score.
 *
 * Each row is a clickable button; clicking it fires the same
 * `awardLootDropAction` as the recommendation but with
 * `pickedByAlgorithm = false`. Disabled players (those with score
 * 0 because they don't want the drop and have enough pages) still
 * show up — the raid leader sometimes intentionally awards to them
 * (PUG, alt jobs, etc.).
 */
function ManualPicker({
  rankings,
  open,
  onOpenChange,
  onPick,
  pending,
}: ManualPickerProps) {
  const t = useTranslations("loot.drop");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {t("manual")}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("manualPickerTitle")}</DialogTitle>
          <DialogDescription>{t("manualPickerDescription")}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1 py-2">
          {rankings.map((entry) => (
            <li key={entry.playerId}>
              <button
                type="button"
                disabled={pending}
                onClick={() => onPick(entry.playerId, entry.playerName)}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
              >
                <span className="font-medium">{entry.playerName}</span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {t("needLabel")} {entry.effectiveNeed}
                  </span>
                  <span>
                    {t("pagesLabel")} {entry.buyPower}
                  </span>
                  <span className="font-mono">{Math.round(entry.score)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
