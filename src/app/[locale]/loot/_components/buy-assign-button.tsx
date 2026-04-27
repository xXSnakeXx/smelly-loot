"use client";

import { Check, Coins } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ItemKey } from "@/lib/ffxiv/slots";
import { awardLootDropAction } from "@/lib/loot/actions";

interface BuyAssignButtonProps {
  raidWeekId: number | null;
  floorId: number | null;
  itemKey: ItemKey;
  recipientId: number;
  recipientName: string;
}

/**
 * "Assign" button on a Plan-tab page-buy row.
 *
 * Wraps `awardLootDropAction` with `paid_with_pages = true`,
 * which records a loot_drop row for the current raid week
 * tagged as "this player spent floor tokens to buy the item".
 * The action's auto-equip + plan-cache invalidation logic
 * fires the same way it does for a real drop.
 *
 * Disabled when there's no active raid week or no floor that
 * matches the item's source — e.g. a Plan that was computed
 * before any raid_week row existed has no place to attach
 * the buy. The operator should start a raid week first.
 */
export function BuyAssignButton({
  raidWeekId,
  floorId,
  itemKey,
  recipientId,
  recipientName,
}: BuyAssignButtonProps) {
  const t = useTranslations("loot.plan.buys");
  const tToast = useTranslations("loot.toasts");
  const [pending, startTransition] = useTransition();

  const disabled = pending || raidWeekId === null || floorId === null;

  const onClick = () => {
    if (disabled) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("raidWeekId", String(raidWeekId));
      formData.set("floorId", String(floorId));
      formData.set("itemKey", itemKey);
      formData.set("recipientId", String(recipientId));
      formData.set("paidWithPages", "on");
      formData.set("pickedByAlgorithm", "true");
      const result = await awardLootDropAction(formData);
      if (result.ok) {
        toast.success(tToast("buyAssigned", { name: recipientName }));
      } else {
        toast.error(tToast("error"));
      }
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs"
      onClick={onClick}
      disabled={disabled}
      title={t("assignTooltip")}
    >
      {pending ? (
        <Check className="size-3.5" />
      ) : (
        <>
          <Coins className="size-3 mr-1" />
          {t("assign")}
        </>
      )}
    </Button>
  );
}
