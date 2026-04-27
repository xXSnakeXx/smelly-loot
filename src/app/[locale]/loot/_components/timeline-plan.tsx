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
import type { FloorPlan } from "@/lib/loot/floor-planner";

import { RefreshButton } from "./refresh-button";

interface TimelinePlanProps {
  floorPlans: FloorPlan[];
  weeksAhead: number;
  hasPlayers: boolean;
  tierId: number;
  computedAt: Date;
}

/**
 * Forward-planning view for the tier-detail Plan tab (v3.0).
 *
 * Renders one card per floor with two tables:
 *
 *   - Drops grid: Week × Item, cells show the optimal recipient
 *     for each item the boss drops in each upcoming week.
 *   - Buys list: per-player page-buy recommendations — "Brad
 *     should buy Bracelet starting W4 with 3 pages". Surfaces
 *     the buy-plan that the min-cost-flow optimiser computes
 *     alongside the drop assignments.
 *
 * The plan comes straight from `tier_plan_cache`; nothing
 * automatic invalidates it on routine BiS/roster edits. Only the
 * RefreshButton or Track-tab actions (kill recorded, drop
 * awarded) trigger a recompute.
 */
export function TimelinePlan({
  floorPlans,
  weeksAhead,
  hasPlayers,
  tierId,
  computedAt,
}: TimelinePlanProps) {
  const t = useTranslations("loot.plan");
  const tFloor = useTranslations("loot.floor");
  const tBuys = useTranslations("loot.plan.buys");

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
        {floorPlans.map((plan) => (
          <Card key={plan.floorNumber}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">
                  {tFloor("label", { number: plan.floorNumber })}
                </CardTitle>
                <Badge variant={plan.tracked ? "default" : "secondary"}>
                  {plan.tracked ? tFloor("tracked") : t("untrackedFloor")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px] text-xs">
                      {t("weekColumn")}
                    </TableHead>
                    {plan.itemKeys.map((item) => (
                      <TableHead key={item} className="text-xs">
                        {item}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.weekNumbers.map((week) => (
                    <TableRow key={week}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {week}
                      </TableCell>
                      {plan.itemKeys.map((item) => {
                        const drop = plan.drops.find(
                          (d) => d.week === week && d.itemKey === item,
                        );
                        return (
                          <TableCell key={item} className="text-sm">
                            {drop ? (
                              <span className="inline-block rounded-md bg-muted/50 px-2 py-0.5 text-xs">
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

              {plan.tracked && plan.buys.length > 0 ? (
                <div className="border-t px-4 py-3">
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {tBuys("heading")}
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">
                          {tBuys("playerColumn")}
                        </TableHead>
                        <TableHead className="text-xs">
                          {tBuys("slotColumn")}
                        </TableHead>
                        <TableHead className="text-xs">
                          {tBuys("weekColumn")}
                        </TableHead>
                        <TableHead className="text-xs">
                          {tBuys("pagesColumn")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plan.buys.map((buy) => (
                        <TableRow
                          key={`${buy.playerId}|${buy.slot}|${buy.completionWeek}`}
                        >
                          <TableCell className="text-sm">
                            {buy.playerName}
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className="inline-block rounded-md bg-muted/50 px-2 py-0.5 text-xs">
                              {buy.slot}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {buy.completionWeek}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {buy.pagesUsed}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
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
