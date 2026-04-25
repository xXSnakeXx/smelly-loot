"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createRaidWeekAction } from "@/lib/loot/actions";

interface NewWeekButtonProps {
  tierId: number;
  /** When true, renders the primary CTA wording for the empty state. */
  variant?: "primary" | "secondary";
}

/**
 * Form-button wrapper around `createRaidWeekAction`.
 *
 * Two render modes: `primary` (used in the no-weeks-yet empty state)
 * shows a fully-styled primary button; `secondary` is the inline
 * "Start new week" pill in the page header.
 */
export function NewWeekButton({
  tierId,
  variant = "secondary",
}: NewWeekButtonProps) {
  const t = useTranslations("loot");
  const tToast = useTranslations("loot.toasts");
  const [pending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createRaidWeekAction(formData);
      if (result.ok) {
        toast.success(tToast("weekStarted"));
      } else {
        toast.error(tToast("error"));
      }
    });
  };

  return (
    <form action={onSubmit}>
      <input type="hidden" name="tierId" value={tierId} />
      <Button
        type="submit"
        disabled={pending}
        variant={variant === "primary" ? "default" : "outline"}
        size={variant === "primary" ? "default" : "sm"}
      >
        {variant === "primary" ? t("noWeeks.cta") : t("header.newWeek")}
      </Button>
    </form>
  );
}
