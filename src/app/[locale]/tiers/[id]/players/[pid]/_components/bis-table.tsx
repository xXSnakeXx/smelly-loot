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
import { bisToneClasses, computeBisTone } from "@/lib/ffxiv/bis-status";
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
 * different toast.
 *
 * Row colour mirrors the spreadsheet's status legend exactly via
 * `computeBisTone`: purple = BiS achieved, amber = needs upgrade
 * token, sky = near max, emerald = intermediate, slate = behind,
 * rose = significant gap, neutral = NotPlanned. Each row also carries
 * a 4px coloured accent stripe on the leading edge to make the state
 * legible at a glance even on muted backgrounds.
 */
export function BisTable({ player, tier, initialChoices }: BisTableProps) {
  const t = useTranslations("bis");
  const tSlots = useTranslations("bis.slots");
  const tSources = useTranslations("bis.sources");
  const tMarkers = useTranslations("bis.markers");
  const locale = useLocale();
  const dateLocale = locale === "de" ? deLocale : enLocale;

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
        tierId: tier.id,
        slot,
        desiredSource: next.desiredSource,
        currentSource: next.currentSource,
        marker: next.marker || undefined,
      });
      if (result.ok) toast.success(t("savedToast"));
      else toast.error(t("saveErrorToast"));
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
          <TableHead className="w-[180px]">{t("table.slot")}</TableHead>
          <TableHead>{t("table.desired")}</TableHead>
          <TableHead>{t("table.current")}</TableHead>
          <TableHead className="w-[180px]">{t("table.marker")}</TableHead>
          <TableHead className="w-[140px]">{t("table.received")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {SLOTS.map((slot) => {
          const row = rows[slot];
          const tone = computeBisTone(
            row.desiredSource,
            row.currentSource,
            tier,
          );
          const toneClasses = bisToneClasses(tone);
          const desiredIlv = ilvForSource(tier, row.desiredSource);
          const currentIlv = ilvForSource(tier, row.currentSource);

          return (
            <TableRow key={slot} className={cn(toneClasses.row)}>
              <TableCell className="relative pl-4 font-medium">
                <span
                  className={cn(
                    "absolute left-0 top-1.5 h-[calc(100%-12px)] w-1 rounded-r-sm",
                    toneClasses.accent,
                  )}
                />
                {tSlots(slot)}
              </TableCell>
              <TableCell>
                <SourceSelect
                  value={row.desiredSource}
                  onChange={(value) =>
                    updateRow(slot, { desiredSource: value })
                  }
                  ilvFor={(source) => ilvForSource(tier, source)}
                  labelFor={(source) => tSources(source)}
                  trailingIlv={desiredIlv}
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
                  trailingIlv={currentIlv}
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
 * Reusable source dropdown with the iLv inline.
 *
 * The selected value renders the iLv after the source name (e.g.
 * "Savage 795") so the operator sees the resulting iLv inline
 * without expanding the dropdown.
 */
function SourceSelect({
  value,
  onChange,
  ilvFor,
  labelFor,
  trailingIlv,
}: {
  value: BisSource;
  onChange: (next: BisSource) => void;
  ilvFor: (source: BisSource) => number | null;
  labelFor: (source: BisSource) => string;
  trailingIlv: number | null;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger className="w-full" size="sm">
        <span className="flex w-full items-center justify-between gap-2">
          <SelectValue />
          {trailingIlv !== null ? (
            <span className="font-mono text-xs text-muted-foreground">
              {trailingIlv}
            </span>
          ) : null}
        </span>
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
