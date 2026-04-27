import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TimelineForFloor } from "@/lib/loot/timeline";
import { cn } from "@/lib/utils";

import { RefreshButton } from "./refresh-button";

interface TimelinePlanProps {
  timelines: TimelineForFloor[];
  weeksAhead: number;
  hasPlayers: boolean;
  tierId: number;
  computedAt: Date;
}

/**
 * Forward-planning view for the tier-detail Plan tab.
 *
 * Renders one card per floor with a Week × Item grid: rows are
 * upcoming weeks, columns are the items the boss drops. Each cell
 * shows the algorithm's planned recipient. For floors marked
 * `tracked_for_algorithm = false` (Topic 3) the grid still lists the
 * items but the cells stay empty — the operator records those drops
 * manually in the Track tab.
 *
 * The plan is read from the `tier_plan_cache` table; nothing
 * automatic invalidates it. Only the in-card RefreshButton fires
 * `refreshPlanAction`, which recomputes the simulation and writes
 * the new snapshot back to the cache.
 */
export function TimelinePlan({
  timelines,
  weeksAhead,
  hasPlayers,
  tierId,
  computedAt,
}: TimelinePlanProps) {
  const t = useTranslations("loot.plan");
  const tFloor = useTranslations("loot.floor");

  if (!hasPlayers) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">{t("noPlayers")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("description", { weeksAhead })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("computedAt", {
              relative: relativeFromNow(computedAt),
            })}
          </p>
        </div>
        <RefreshButton tierId={tierId} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {timelines.map((floor) => (
          <Card key={floor.floorNumber}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">
                  {tFloor("label", { number: floor.floorNumber })}
                </CardTitle>
                <Badge variant={floor.tracked ? "default" : "secondary"}>
                  {floor.tracked ? tFloor("tracked") : t("untrackedFloor")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px] text-xs">
                      {t("weekColumn")}
                    </TableHead>
                    {floor.itemKeys.map((item) => (
                      <TableHead key={item} className="text-xs">
                        {item}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {floor.weeks.map((week) => (
                    <TableRow key={week.weekNumber}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {week.weekNumber}
                      </TableCell>
                      {floor.itemKeys.map((item) => {
                        const drop = week.drops.find((d) => d.itemKey === item);
                        return (
                          <TableCell key={item} className="text-sm">
                            {drop?.recipientName ? (
                              <span
                                className={cn(
                                  "inline-block rounded-md bg-muted/50 px-2 py-0.5 text-xs",
                                  // Subtle highlight for "first time this
                                  // player gets this slot in the plan",
                                  // detected as drop.score >= 100 (i.e.
                                  // their effective_need was 1 or more).
                                  drop.score >= 100 && "font-medium",
                                )}
                              >
                                {drop.recipientName}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {t("noRecipient")}
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Format a date relative to now in a small, JS-only fashion. Avoids
 * pulling in a heavier i18n date helper for the single string the
 * Plan tab needs. The output is one of:
 *   - "just now"       (< 30s)
 *   - "Xm ago"         (< 60min)
 *   - "Xh ago"         (< 24h)
 *   - "Xd ago"         (>= 1 day)
 */
function relativeFromNow(when: Date): string {
  const diffMs = Date.now() - when.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 30) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}
