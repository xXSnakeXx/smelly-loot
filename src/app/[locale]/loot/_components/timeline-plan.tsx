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

interface TimelinePlanProps {
  timelines: TimelineForFloor[];
  weeksAhead: number;
  hasPlayers: boolean;
}

/**
 * Forward-planning view for the /loot page's "Plan" tab.
 *
 * Renders one card per floor with a Week × Item grid: rows are
 * upcoming weeks, columns are the items the boss drops. Each cell
 * shows the algorithm's planned recipient. For floors marked
 * `tracked_for_algorithm = false` (Topic 3) the grid still lists the
 * items but the cells stay empty — the operator records those drops
 * manually in the Track tab.
 *
 * The whole component is intentionally a Server Component: no
 * interactivity, just data → markup. Re-rendering happens
 * automatically when the underlying snapshot changes (e.g. after a
 * real drop is recorded in the Track tab) because /loot is
 * `force-dynamic`.
 */
export function TimelinePlan({
  timelines,
  weeksAhead,
  hasPlayers,
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
      <p className="text-sm text-muted-foreground">
        {t("description", { weeksAhead })}
      </p>

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
