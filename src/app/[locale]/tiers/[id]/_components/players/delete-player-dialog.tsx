"use client";

import { useTranslations } from "next-intl";
import { type ReactElement, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { type ActionState, deletePlayerAction } from "@/lib/players/actions";

const INITIAL_STATE: ActionState = { ok: false, errors: {} };

interface DeletePlayerDialogProps {
  playerId: number;
  /**
   * The element rendered as the dialog's trigger button. Base UI's
   * `render` prop swaps the trigger's underlying element for this one
   * — equivalent to Radix's `asChild` pattern but explicitly typed.
   */
  trigger: ReactElement;
}

/**
 * Confirmation prompt for removing a player from the static.
 *
 * The Server Action returns an `ActionState`; on success we toast and
 * close the dialog. The hidden `id` field is what the schema-validated
 * Server Action consumes; the rest of the form is the AlertDialog
 * scaffolding.
 */
export function DeletePlayerDialog({
  playerId,
  trigger,
}: DeletePlayerDialogProps) {
  const t = useTranslations("players.delete");
  const tToast = useTranslations("players.toasts");

  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    deletePlayerAction,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (state.ok) {
      toast.success(tToast("deleted"));
      setOpen(false);
    }
  }, [state, tToast]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <form action={formAction}>
          <input type="hidden" name="id" value={playerId} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={pending}>
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
