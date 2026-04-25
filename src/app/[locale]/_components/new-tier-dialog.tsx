"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactElement, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import {
  type CreateTierActionState,
  createTierAction,
} from "@/lib/tiers/actions";
import { cn } from "@/lib/utils";

const INITIAL_STATE: CreateTierActionState = { ok: false, errors: {} };

interface NewTierDialogProps {
  /**
   * Element rendered as the dialog's trigger. Pass the desired
   * trigger (a button, a card, etc.); Base UI's `render` prop swaps
   * the trigger button's render-element for this one.
   */
  trigger?: ReactElement;
  /**
   * If `true`, the trigger is the dashboard's "plus card" — a
   * dashed-border card that visually invites the user to add a
   * new tier alongside the existing tier-grid.
   */
  asPlusCard?: boolean;
}

/**
 * Tier creation dialog backed by `createTierAction`.
 *
 * Two trigger styles:
 *
 * - `trigger`: arbitrary element (e.g. a button). Use this for
 *   inline "New tier" buttons on the tier-detail page or in nav menus.
 * - `asPlusCard`: a dashed-border card matching the surrounding
 *   tier-grid. Designed to slot into the dashboard's grid as the
 *   last cell so the "add new" affordance lives next to the existing
 *   tiers (FFLogs Analyzer pattern).
 *
 * On a successful create the dialog closes itself, fires a toast,
 * and navigates to `/tiers/<newTierId>` so the user lands on the
 * tier detail right away (matching the "open after create" reflex
 * the spreadsheet workflow already established).
 */
export function NewTierDialog({ trigger, asPlusCard }: NewTierDialogProps) {
  const t = useTranslations("dashboard.newTier");
  const tCard = useTranslations("dashboard.tiers.newCard");
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createTierAction,
    INITIAL_STATE,
  );
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      toast.success(t("createdToast"));
      setOpen(false);
      router.push(`/tiers/${state.tierId}`);
      router.refresh();
    } else if (state.errors && Object.keys(state.errors).length > 0) {
      // Toast on validation/server failures so the dashboard renders
      // a user-visible signal even if the only field error is the
      // catch-all "createFailed".
      toast.error(t("errorToast"));
    }
  }, [state, t, router]);

  const errors = state.ok ? {} : state.errors;

  const triggerEl =
    trigger ??
    (asPlusCard ? (
      <PlusCardTrigger
        title={tCard("title")}
        description={tCard("description")}
      />
    ) : null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerEl ? <DialogTrigger render={triggerEl} /> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <FormRow id="newTierName" label={t("name.label")} error={errors.name}>
            <Input
              id="newTierName"
              name="name"
              required
              placeholder={t("name.placeholder")}
            />
          </FormRow>
          <FormRow
            id="newTierMaxIlv"
            label={t("maxIlv.label")}
            error={errors.maxIlv}
            help={t("maxIlv.help")}
          >
            <Input
              id="newTierMaxIlv"
              name="maxIlv"
              type="number"
              min={100}
              max={2000}
              required
              defaultValue={795}
            />
          </FormRow>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border bg-background px-4 py-1.5 text-sm hover:bg-muted"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {t("submit")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Form-row wrapper used inside the dialog form. Mirrors the helper in
 * the player-form-dialog so the visual rhythm is consistent across
 * dialogs.
 */
function FormRow({
  id,
  label,
  error,
  help,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  help?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * Dashed-border "plus" card used as the dialog trigger inside the
 * dashboard's tier-grid. Mirrors the surrounding tier-cards in size
 * and rhythm so the grid stays a clean 2/3-column layout, but uses a
 * dashed border + centered Plus icon to read clearly as an
 * affordance ("add another tier").
 */
function PlusCardTrigger({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-muted-foreground",
        "transition-colors hover:border-primary hover:bg-muted/40 hover:text-foreground",
        "min-h-[160px]",
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-border bg-muted/40 transition-colors group-hover:border-primary group-hover:bg-primary/10 group-hover:text-primary">
        <Plus className="size-5" />
      </div>
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-xs">{description}</span>
    </button>
  );
}
