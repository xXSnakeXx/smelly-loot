"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PerFloorPageStats } from "@/lib/db/queries-stats";
import { updatePageAdjustAction } from "@/lib/stats/actions";
import { cn } from "@/lib/utils";

interface PageStatsTableProps {
  playerId: number;
  tierId: number;
  rows: PerFloorPageStats[];
}

/**
 * Per-floor page-balance table for a player. The Adjust column is
 * inline-editable; everything else is read-only because it's
 * auto-derived from the source rows (boss kills, loot drops).
 *
 * The form uses local state for the input value plus an explicit
 * Save button rather than auto-save on blur. Page adjustments are
 * deliberate corrections, not the kind of input that should fire
 * silently — the explicit click reduces the chance of typos
 * silently corrupting the page accounting.
 */
export function PageStatsTable({
  playerId,
  tierId,
  rows,
}: PageStatsTableProps) {
  const t = useTranslations("stats.pages");

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("floor", { number: "" })}</TableHead>
          <TableHead className="text-right">{t("kills")}</TableHead>
          <TableHead className="text-right">{t("spent")}</TableHead>
          <TableHead className="text-right">{t("adjust")}</TableHead>
          <TableHead className="text-right">{t("current")}</TableHead>
          <TableHead className="w-[100px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <PageStatsRow
            key={row.floorNumber}
            playerId={playerId}
            tierId={tierId}
            row={row}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function PageStatsRow({
  playerId,
  tierId,
  row,
}: {
  playerId: number;
  tierId: number;
  row: PerFloorPageStats;
}) {
  const t = useTranslations("stats.pages");
  const [adjust, setAdjust] = useState(row.adjust);
  const [pending, startTransition] = useTransition();

  const isDirty = adjust !== row.adjust;
  const optimisticCurrent = Math.max(0, row.kills + adjust - row.spent);

  const save = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("playerId", String(playerId));
      formData.set("tierId", String(tierId));
      formData.set("floorNumber", String(row.floorNumber));
      formData.set("delta", String(adjust));
      const result = await updatePageAdjustAction(formData);
      if (result.ok) toast.success(t("saveAdjustToast"));
      else toast.error(t("saveErrorToast"));
    });
  };

  return (
    <TableRow>
      <TableCell className="font-medium">
        {t("floor", { number: row.floorNumber })}
      </TableCell>
      <TableCell className="text-right font-mono text-sm">
        {row.kills}
      </TableCell>
      <TableCell className="text-right font-mono text-sm text-muted-foreground">
        {row.spent}
      </TableCell>
      <TableCell className="text-right">
        <input
          type="number"
          value={adjust}
          onChange={(e) => setAdjust(Number.parseInt(e.target.value, 10) || 0)}
          className={cn(
            "h-7 w-16 rounded-md border border-input bg-background px-2 text-right font-mono text-sm",
            "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          )}
        />
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono text-sm font-semibold",
          optimisticCurrent === 0 ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {optimisticCurrent}
      </TableCell>
      <TableCell>
        {isDirty ? (
          <Button size="xs" onClick={save} disabled={pending}>
            {t("saveAdjust")}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
