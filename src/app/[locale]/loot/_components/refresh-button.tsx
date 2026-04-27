"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { refreshPlanAction } from "@/lib/loot/actions";
import { cn } from "@/lib/utils";

/**
 * Refresh button for the Plan tab.
 *
 * The Plan tab is the only sticky surface in the app — it caches
 * its `simulateLootTimeline` output in the `tier_plan_cache` table
 * and only refreshes when the user clicks here. Other server
 * actions (kill toggles, drop awards, BiS edits, page-adjust
 * saves, roster changes) deliberately don't advance the plan, so
 * casual Track interactions don't reshuffle the next-N-week
 * recommendations under the operator.
 *
 * Pressing the button fires `refreshPlanAction`, which recomputes
 * the simulation, writes the new result back to the cache, and
 * triggers a layout-wide revalidate so the Plan tab re-renders
 * with the fresh data. `useTransition` keeps the icon spinning
 * while the round-trip lands.
 */
export function RefreshButton({
  tierId,
  className,
}: {
  tierId: number;
  className?: string;
}) {
  const t = useTranslations("loot.plan");
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const fd = new FormData();
          fd.set("tierId", String(tierId));
          const result = await refreshPlanAction(fd);
          if (!result.ok) toast.error(t("refreshError"));
        });
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors",
        "hover:border-primary hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      aria-label={t("refresh")}
      title={t("refreshHint")}
    >
      <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
      <span>{pending ? t("refreshing") : t("refresh")}</span>
    </button>
  );
}
