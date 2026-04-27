"use client";

import { ChevronDown, Pencil, RotateCcw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  editLootDropAction,
  resetRaidWeekAction,
  undoLootDropAction,
} from "@/lib/loot/actions";
import { cn } from "@/lib/utils";

/**
 * Per-drop row passed from the server-component to this client
 * card. Mirrors the columns the History view selects, with
 * `recipientName` / `floorNumber` already joined.
 */
export interface HistoryDropRow {
  id: number;
  floorId: number;
  floorNumber: number;
  itemKey: string;
  recipientId: number | null;
  recipientName: string | null;
  targetSlot: string | null;
  previousCurrentSource: string | null;
  paidWithPages: boolean;
  pickedByAlgorithm: boolean;
  notes: string | null;
}

interface FloorMeta {
  id: number;
  number: number;
  itemKeys: string[];
}

interface RosterEntry {
  id: number;
  name: string;
}

interface HistoryWeekCardProps {
  weekId: number;
  weekNumber: number;
  startedAtIso: string;
  startedAtLabel: string;
  drops: HistoryDropRow[];
  floors: FloorMeta[];
  roster: RosterEntry[];
  defaultOpen: boolean;
  locale: "de" | "en";
}

/**
 * Single raid-week card on the History tab.
 *
 * Header shows: week number, start date, kill summary, and the
 * "reset week" button. Body (collapsible) shows per-floor drops
 * with item key, recipient + slot, source badges, and a per-drop
 * "revert" button.
 *
 * Reset is gated by an alert-dialog confirmation because it
 * cascades to multiple drops + bisCurrent rollbacks. Per-drop
 * revert fires immediately — same semantics as the v3.1 undo
 * button on the active week.
 */
export function HistoryWeekCard({
  weekId,
  weekNumber,
  startedAtLabel,
  drops,
  floors,
  roster,
  defaultOpen,
}: HistoryWeekCardProps) {
  const t = useTranslations("history");
  const [open, setOpen] = useState(defaultOpen);
  const [isResetPending, startResetTransition] = useTransition();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const dropsByFloor = new Map<number, HistoryDropRow[]>();
  for (const drop of drops) {
    const list = dropsByFloor.get(drop.floorId) ?? [];
    list.push(drop);
    dropsByFloor.set(drop.floorId, list);
  }

  const totalDrops = drops.length;
  const assignedDrops = drops.filter((d) => d.recipientId !== null).length;

  const handleReset = () => {
    startResetTransition(async () => {
      const fd = new FormData();
      fd.set("raidWeekId", String(weekId));
      await resetRaidWeekAction(fd);
      setResetConfirmOpen(false);
    });
  };

  return (
    <Card className="overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex flex-1 items-center gap-3 text-left"
              >
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    open && "rotate-180",
                  )}
                />
                <div className="flex flex-col">
                  <span className="text-base font-medium">
                    {t("weekLabel", { number: weekNumber })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("weekStarted", { date: startedAtLabel })}
                  </span>
                </div>
                <span className="ml-3 text-xs text-muted-foreground">
                  {t("dropsCount", {
                    assigned: assignedDrops,
                    total: totalDrops,
                  })}
                </span>
              </button>
            }
          />
          <AlertDialog
            open={resetConfirmOpen}
            onOpenChange={setResetConfirmOpen}
          >
            <AlertDialogTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive hover:text-destructive"
                  disabled={isResetPending}
                >
                  <RotateCcw className="size-3.5" />
                  <span className="ml-1.5">{t("resetWeek")}</span>
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("resetWeekConfirmTitle", { number: weekNumber })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("resetWeekConfirmDescription", { drops: totalDrops })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isResetPending}>
                  {t("cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReset}
                  disabled={isResetPending}
                  className="bg-destructive hover:bg-destructive/90"
                >
                  {isResetPending ? t("resetting") : t("confirmReset")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <CollapsiblePanel>
          <CardContent className="border-t pt-4">
            {drops.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noDrops")}</p>
            ) : (
              <div className="flex flex-col gap-4">
                {floors.map((floor) => {
                  const floorDrops = dropsByFloor.get(floor.id) ?? [];
                  if (floorDrops.length === 0) return null;
                  return (
                    <FloorSection
                      key={floor.id}
                      floor={floor}
                      drops={floorDrops}
                      roster={roster}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </CollapsiblePanel>
      </Collapsible>
    </Card>
  );
}

function FloorSection({
  floor,
  drops,
  roster,
}: {
  floor: FloorMeta;
  drops: HistoryDropRow[];
  roster: RosterEntry[];
}) {
  const t = useTranslations("history");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("floorLabel", { number: floor.number })}
        </h4>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {drops.map((drop) => (
          <DropRow key={drop.id} drop={drop} roster={roster} />
        ))}
      </ul>
    </div>
  );
}

function DropRow({
  drop,
  roster,
}: {
  drop: HistoryDropRow;
  roster: RosterEntry[];
}) {
  const t = useTranslations("history");
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [editRecipientId, setEditRecipientId] = useState<string>(
    drop.recipientId ? String(drop.recipientId) : "",
  );
  const [editPending, startEditTransition] = useTransition();

  // Source = TomeUp if the item is a material, else Savage. We
  // could read the actual `source` from the schema in the future
  // (added in v3.1) but the item-key check is simpler and
  // backwards-compatible with pre-v3.1 rows.
  const isMaterial =
    drop.itemKey === "Glaze" ||
    drop.itemKey === "Twine" ||
    drop.itemKey === "Ester";

  const handleRevert = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("lootDropId", String(drop.id));
      await undoLootDropAction(fd);
    });
  };

  const handleEditSubmit = () => {
    if (!editRecipientId) return;
    startEditTransition(async () => {
      const fd = new FormData();
      fd.set("lootDropId", String(drop.id));
      fd.set("recipientId", editRecipientId);
      const result = await editLootDropAction(fd);
      if (result.ok) setEditOpen(false);
    });
  };

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border bg-card/50 px-3 py-2 text-sm transition-opacity",
        (isPending || editPending) && "opacity-50",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 font-mono text-xs",
            isMaterial
              ? "bg-amber-500/15 text-amber-200"
              : "bg-muted/60 text-foreground/80",
          )}
        >
          {drop.itemKey}
        </span>
        {drop.recipientName ? (
          <span className="truncate font-medium">{drop.recipientName}</span>
        ) : (
          <span className="truncate text-muted-foreground italic">
            {t("unassigned")}
          </span>
        )}
        {drop.targetSlot ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            → {drop.targetSlot}
          </span>
        ) : null}
        {drop.paidWithPages ? (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {t("viaPages")}
          </Badge>
        ) : null}
        {!drop.pickedByAlgorithm && drop.recipientId ? (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {t("manualOverride")}
          </Badge>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {drop.recipientId !== null ? (
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title={t("editRecipient")}
                  disabled={isPending || editPending}
                >
                  <Pencil className="size-3.5" />
                </Button>
              }
            />
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {t("editRecipientTitle", { item: drop.itemKey })}
                </DialogTitle>
                <DialogDescription>
                  {t("editRecipientDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Select
                  value={editRecipientId}
                  onValueChange={(v) => setEditRecipientId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("selectPlayer")} />
                  </SelectTrigger>
                  <SelectContent>
                    {roster.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditOpen(false)}
                  disabled={editPending}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  onClick={handleEditSubmit}
                  disabled={
                    editPending ||
                    !editRecipientId ||
                    Number(editRecipientId) === drop.recipientId
                  }
                >
                  {editPending ? t("saving") : t("save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleRevert}
          disabled={isPending || editPending}
          title={t("revertDrop")}
        >
          <Undo2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}
