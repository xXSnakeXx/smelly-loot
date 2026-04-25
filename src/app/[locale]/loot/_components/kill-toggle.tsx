"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { recordBossKillAction, undoBossKillAction } from "@/lib/loot/actions";

interface KillToggleProps {
  raidWeekId: number;
  floorId: number;
  killed: boolean;
}

/**
 * Two-state toggle for the per-floor kill status.
 *
 * `killed = false` renders a primary "Mark as cleared" button.
 * `killed = true` renders a quiet "Undo clear" button (kept simple
 * because operators rarely undo a kill — it's almost always there
 * to recover from a misclick).
 */
export function KillToggle({ raidWeekId, floorId, killed }: KillToggleProps) {
  const t = useTranslations("loot.floor");
  const tToast = useTranslations("loot.toasts");
  const [pending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const action = killed ? undoBossKillAction : recordBossKillAction;
      const result = await action(formData);
      if (result.ok) {
        toast.success(tToast(killed ? "killUndone" : "killRecorded"));
      } else {
        toast.error(tToast("error"));
      }
    });
  };

  return (
    <form action={onSubmit}>
      <input type="hidden" name="raidWeekId" value={raidWeekId} />
      <input type="hidden" name="floorId" value={floorId} />
      <Button
        type="submit"
        size="sm"
        variant={killed ? "ghost" : "default"}
        disabled={pending}
      >
        {killed ? t("undoKill") : t("killCta")}
      </Button>
    </form>
  );
}
