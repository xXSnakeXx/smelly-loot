"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveBisChoice } from "@/lib/bis/actions";
import { type BisRowTone, bisToneClasses } from "@/lib/ffxiv/bis-status";
import {
  BIS_SOURCES,
  type BisSource,
  ilvForSource,
  type Slot,
  type SourceIlvLookup,
} from "@/lib/ffxiv/slots";
import { cn } from "@/lib/utils";

const SOURCE_SHORT: Record<BisSource, string> = {
  Savage: "S",
  TomeUp: "T+",
  Catchup: "C",
  Tome: "T",
  Extreme: "E",
  Relic: "R",
  Crafted: "Cr",
  WHYYYY: "?",
  JustNo: "✗",
  NotPlanned: "—",
};

interface BisMatrixCellProps {
  playerId: number;
  tierId: number;
  slot: Slot;
  desired: BisSource;
  current: BisSource;
  tone: BisRowTone;
  tier: SourceIlvLookup;
}

/**
 * Single cell in the BiS matrix on the Roster tab.
 *
 * The cell shows the desired source code on top and the current
 * source code at the bottom; clicking anywhere on the cell pops a
 * compact inline editor (two `<Select>`s) that calls
 * `saveBisChoice` on every change. The change shows up immediately
 * in the matrix because the parent `<RosterBisMatrix>` is
 * server-rendered and Next.js's `revalidatePath` (called from
 * `saveBisChoice`) refreshes the page after every save.
 *
 * Tone classes come from the same `computeBisTone` formula the
 * per-player BiS table uses, so every visual cue (purple = BiS,
 * amber = needs-upgrade, rose = significant-gap, ...) reads the
 * same way across the app.
 */
export function BisMatrixCell({
  playerId,
  tierId,
  slot,
  desired,
  current,
  tone,
  tier,
}: BisMatrixCellProps) {
  const t = useTranslations("bis.sources");
  const tCell = useTranslations("roster.matrix.cell");
  const [pending, startTransition] = useTransition();
  const toneClasses = bisToneClasses(tone);

  const persist = (next: { desired: BisSource; current: BisSource }) => {
    startTransition(async () => {
      const result = await saveBisChoice({
        playerId,
        tierId,
        slot,
        desiredSource: next.desired,
        currentSource: next.current,
      });
      if (!result.ok) toast.error(tCell("saveError"));
    });
  };

  const desiredIlv = ilvForSource(tier, desired) ?? 0;
  const currentIlv = ilvForSource(tier, current) ?? 0;

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-0.5 rounded px-1 py-1.5 font-mono text-xs leading-tight transition-colors",
          "hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          toneClasses.row || "bg-muted/30 hover:bg-muted/60",
          pending && "opacity-50",
        )}
        title={`${slot}: ${t(desired)} (${desiredIlv > 0 ? `iLv ${desiredIlv}` : "—"}) / ${t(current)} (${currentIlv > 0 ? `iLv ${currentIlv}` : "—"})`}
      >
        <span className="text-sm font-semibold">{SOURCE_SHORT[desired]}</span>
        <span className="text-[10px] text-muted-foreground">
          {SOURCE_SHORT[current]}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-medium">{slot}</p>
            <p className="text-[10px] text-muted-foreground">
              {tCell("clickToEdit")}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {tCell("desired")}
            </span>
            <Select
              value={desired}
              onValueChange={(value) =>
                persist({ desired: value as BisSource, current })
              }
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BIS_SOURCES.map((src) => (
                  <SelectItem key={src} value={src}>
                    {t(src)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {tCell("current")}
            </span>
            <Select
              value={current}
              onValueChange={(value) =>
                persist({ desired, current: value as BisSource })
              }
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BIS_SOURCES.map((src) => (
                  <SelectItem key={src} value={src}>
                    {t(src)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
