import { type BisSource, ilvForSource, type SourceIlvLookup } from "./slots";

/**
 * Per-row visual state for the BiS tracker.
 *
 * Mirrors the spreadsheet's color legend with a small refinement:
 *
 *   Spreadsheet      → tone here          → visual
 *   ---------------------------------------------------------
 *   Already have     → bis-achieved       → purple
 *   Needs 1 of 3     → needs-upgrade      → amber  (TomeUp wanted, Tome worn)
 *   At/near max      → near-max           → blue   (gap ≤ 5)
 *   Intermediate     → intermediate       → emerald (gap ≤ 10)
 *   White            → behind             → slate   (gap ≤ 20)
 *   Red              → significant-gap    → rose    (gap > 20)
 *   ---------------------------------------------------------
 *   NotPlanned       → neutral            → no colour
 *
 * The tone is consumed by the BiS-table's row classes so the at-a-
 * glance gear status mirrors the spreadsheet without operators having
 * to re-learn a new colour code.
 */
export type BisRowTone =
  | "bis-achieved"
  | "needs-upgrade"
  | "near-max"
  | "intermediate"
  | "behind"
  | "significant-gap"
  | "neutral";

/**
 * Pure function that decides the tone for a (desired, current) pair
 * on a given tier.
 *
 * `tier` is typed as `SourceIlvLookup` — the lightweight shape used
 * across the codebase — so the function can be reused from both the
 * server-rendered BiS table and any future client-side preview.
 */
export function computeBisTone(
  desiredSource: BisSource,
  currentSource: BisSource,
  tier: SourceIlvLookup,
): BisRowTone {
  if (desiredSource === "NotPlanned") return "neutral";
  if (currentSource === "NotPlanned") return "significant-gap";

  if (currentSource === desiredSource) return "bis-achieved";

  // Special-case the spreadsheet's "yellow" — TomeUp desired, Tome
  // worn. The player has the base; they just need the upgrade token.
  if (desiredSource === "TomeUp" && currentSource === "Tome") {
    return "needs-upgrade";
  }

  const desiredIlv = ilvForSource(tier, desiredSource) ?? 0;
  const currentIlv = ilvForSource(tier, currentSource) ?? 0;
  const gap = desiredIlv - currentIlv;

  if (gap <= 0) return "bis-achieved";
  if (gap <= 5) return "near-max";
  if (gap <= 10) return "intermediate";
  if (gap <= 20) return "behind";
  return "significant-gap";
}

/**
 * Tailwind class fragments for each tone. Both the row background
 * (subtle) and a leading 4px accent stripe are returned so the call
 * site can apply them via `cn(...)`.
 */
export function bisToneClasses(tone: BisRowTone): {
  row: string;
  accent: string;
} {
  switch (tone) {
    case "bis-achieved":
      return {
        row: "bg-violet-50/40 dark:bg-violet-950/30",
        accent: "bg-violet-400",
      };
    case "needs-upgrade":
      return {
        row: "bg-amber-50/50 dark:bg-amber-950/30",
        accent: "bg-amber-400",
      };
    case "near-max":
      return {
        row: "bg-sky-50/40 dark:bg-sky-950/30",
        accent: "bg-sky-400",
      };
    case "intermediate":
      return {
        row: "bg-emerald-50/40 dark:bg-emerald-950/25",
        accent: "bg-emerald-400",
      };
    case "behind":
      return {
        row: "bg-slate-100/60 dark:bg-slate-800/40",
        accent: "bg-slate-400",
      };
    case "significant-gap":
      return {
        row: "bg-rose-50/40 dark:bg-rose-950/30",
        accent: "bg-rose-500",
      };
    case "neutral":
      return { row: "", accent: "bg-transparent" };
  }
}

/**
 * Count slots whose `currentSource === desiredSource` (BiS achieved)
 * out of the slots the player has actually planned. Used by the
 * progress bar in the player-detail hero card.
 */
export function bisProgress(
  rows: ReadonlyArray<{ desiredSource: BisSource; currentSource: BisSource }>,
): { achieved: number; planned: number; percent: number } {
  let achieved = 0;
  let planned = 0;
  for (const row of rows) {
    if (row.desiredSource === "NotPlanned") continue;
    planned += 1;
    if (row.currentSource === row.desiredSource) achieved += 1;
  }
  const percent = planned === 0 ? 0 : Math.round((achieved / planned) * 100);
  return { achieved, planned, percent };
}
