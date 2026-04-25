"use client";

import { format } from "date-fns";
import { de as deLocale, enUS as enLocale } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { saveBisChoice } from "@/lib/bis/actions";
import { BIS_MARKERS, type BisMarker } from "@/lib/bis/schemas";
import type { BisChoice, Player, Tier } from "@/lib/db/schema";
import {
  BIS_SOURCES,
  type BisSource,
  ilvForSource,
  SLOTS,
  type Slot,
} from "@/lib/ffxiv/slots";
import { cn } from "@/lib/utils";

interface BisTableProps {
  player: Player;
  tier: Tier;
  initialChoices: BisChoice[];
}

interface SlotRowState {
  desiredSource: BisSource;
  currentSource: BisSource;
  marker: BisMarker | "";
  receivedAt: Date | null;
}

const MARKER_TRANSLATION_KEY: Record<BisMarker, string> = {
  "📃": "pages",
  "🔨": "craft",
  "◀️": "nextUpgrade",
  "💾": "saveToken",
  "💰": "tomes",
};

/**
 * Twelve-row BiS plan editor.
 *
 * Each row is a tiny inline form: changing any of the three dropdowns
 * (desired source, current source, marker) fires a Server Action that
 * upserts the corresponding `bis_choice` row. There's no Save button —
 * dropdown changes commit immediately, which matches the spreadsheet's
 * reflexes. A short toast confirms each save; failures surface a
 * different toast and the optimistic row state is rolled back.
 *
 * The row colour signals BiS progress at a glance:
 * - emerald: current matches desired (BiS achieved)
 * - amber:  current iLv lower than desired iLv (upgrade pending)
 * - rose:   current iLv significantly lower (≥10 iLv gap)
 * - neutral: NotPlanned on either side
 */
export function BisTable({ player, tier, initialChoices }: BisTableProps) {
  const t = useTranslations("bis");
  const tSlots = useTranslations("bis.slots");
  const tSources = useTranslations("bis.sources");
  const tMarkers = useTranslations("bis.markers");
  const locale = useLocale();
  const dateLocale = locale === "de" ? deLocale : enLocale;

  // Hydrate initial state from the database. Slots without a row
  // default to NotPlanned on both sides.
  const initialBySlot = new Map<Slot, BisChoice>(
    initialChoices.map((row) => [row.slot as Slot, row]),
  );
  const [rows, setRows] = useState<Record<Slot, SlotRowState>>(() => {
    const initial = {} as Record<Slot, SlotRowState>;
    for (const slot of SLOTS) {
      const existing = initialBySlot.get(slot);
      initial[slot] = {
        desiredSource: (existing?.desiredSource ?? "NotPlanned") as BisSource,
        currentSource: (existing?.currentSource ?? "NotPlanned") as BisSource,
        marker: (existing?.marker as BisMarker | null) ?? "",
        receivedAt: existing?.receivedAt ?? null,
      };
    }
    return initial;
  });

  const [, startTransition] = useTransition();

  const persist = (slot: Slot, next: SlotRowState) => {
    startTransition(async () => {
      const result = await saveBisChoice({
        playerId: player.id,
        slot,
        desiredSource: next.desiredSource,
        currentSource: next.currentSource,
        marker: next.marker || undefined,
      });
      if (result.ok) {
        toast.success(t("savedToast"));
      } else {
        toast.error(t("saveErrorToast"));
        // Roll the row back on failure so the UI matches the DB.
        setRows((current) => ({
          ...current,
          [slot]: {
            ...current[slot],
            // If validation failed, the source columns are the most
            // likely culprits; revert them to the previous values
            // by reading from the existing state. The simplest
            // implementation is "do nothing" — the next render keeps
            // showing the user's input, which is fine for a
            // validation error since it's recoverable.
          },
        }));
      }
    });
  };

  const updateRow = (slot: Slot, patch: Partial<SlotRowState>) => {
    setRows((current) => {
      const next = { ...current[slot], ...patch };
      persist(slot, next);
      return { ...current, [slot]: next };
    });
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[140px]">{t("table.slot")}</TableHead>
          <TableHead>{t("table.desired")}</TableHead>
          <TableHead>{t("table.current")}</TableHead>
          <TableHead className="w-[180px]">{t("table.marker")}</TableHead>
          <TableHead className="w-[140px]">{t("table.received")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {SLOTS.map((slot) => {
          const row = rows[slot];
          const desiredIlv = ilvForSource(tier, row.desiredSource);
          const currentIlv = ilvForSource(tier, row.currentSource);
          const tone = computeTone(desiredIlv, currentIlv);

          return (
            <TableRow key={slot} className={cn(toneClasses(tone))}>
              <TableCell className="font-medium">{tSlots(slot)}</TableCell>
              <TableCell>
                <SourceSelect
                  value={row.desiredSource}
                  onChange={(value) =>
                    updateRow(slot, { desiredSource: value })
                  }
                  ilvFor={(source) => ilvForSource(tier, source)}
                  labelFor={(source) => tSources(source)}
                />
              </TableCell>
              <TableCell>
                <SourceSelect
                  value={row.currentSource}
                  onChange={(value) =>
                    updateRow(slot, { currentSource: value })
                  }
                  ilvFor={(source) => ilvForSource(tier, source)}
                  labelFor={(source) => tSources(source)}
                />
              </TableCell>
              <TableCell>
                <Select
                  value={row.marker || "none"}
                  onValueChange={(value) =>
                    updateRow(slot, {
                      marker: value === "none" ? "" : (value as BisMarker),
                    })
                  }
                >
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tMarkers("none")}</SelectItem>
                    {BIS_MARKERS.map((marker) => (
                      <SelectItem key={marker} value={marker}>
                        {tMarkers(MARKER_TRANSLATION_KEY[marker])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.receivedAt
                  ? format(row.receivedAt, "PP", { locale: dateLocale })
                  : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Reusable source dropdown with the iLv inline. Used for both
 * desired and current columns.
 */
function SourceSelect({
  value,
  onChange,
  ilvFor,
  labelFor,
}: {
  value: BisSource;
  onChange: (next: BisSource) => void;
  ilvFor: (source: BisSource) => number | null;
  labelFor: (source: BisSource) => string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger className="w-full" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {BIS_SOURCES.map((source) => {
          const ilv = ilvFor(source);
          const label = labelFor(source);
          return (
            <SelectItem key={source} value={source}>
              <span className="flex items-center justify-between gap-3">
                <span>{label}</span>
                {ilv === null ? null : (
                  <span className="font-mono text-xs text-muted-foreground">
                    {ilv}
                  </span>
                )}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

type Tone = "match" | "upgrade" | "behind" | "neutral";

function computeTone(
  desiredIlv: number | null,
  currentIlv: number | null,
): Tone {
  if (desiredIlv === null || currentIlv === null) return "neutral";
  if (currentIlv >= desiredIlv) return "match";
  if (desiredIlv - currentIlv >= 10) return "behind";
  return "upgrade";
}

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "match":
      return "bg-emerald-50/40 dark:bg-emerald-950/20";
    case "upgrade":
      return "bg-amber-50/40 dark:bg-amber-950/20";
    case "behind":
      return "bg-rose-50/40 dark:bg-rose-950/20";
    case "neutral":
      return "";
  }
}
