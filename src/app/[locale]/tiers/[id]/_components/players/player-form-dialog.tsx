"use client";

import { useTranslations } from "next-intl";
import { type ReactElement, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel as SelectLabelGroup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Player } from "@/lib/db/schema";
import {
  GEAR_ROLES,
  type GearRole,
  JOB_CODES,
  type JobCode,
  jobToGearRole,
} from "@/lib/ffxiv/jobs";
import {
  type ActionState,
  createPlayerAction,
  updatePlayerAction,
} from "@/lib/players/actions";

const INITIAL_STATE: ActionState = { ok: false, errors: {} };

interface PlayerFormDialogProps {
  /** When provided, the dialog opens in edit mode and pre-fills the form. */
  player?: Player;
  /**
   * The tier this dialog adds the player to. Required for creates;
   * ignored for edits because a player's tier is fixed at creation
   * time (rolling over to a new tier creates a fresh player row).
   */
  tierId: number;
  /**
   * Element rendered as the dialog's trigger. Base UI's `render` prop
   * swaps the trigger's underlying button for this one — equivalent
   * to Radix's `asChild` but explicitly typed.
   */
  trigger: ReactElement;
}

/**
 * Player create / edit dialog.
 *
 * The same component handles both flows: pass a `player` prop to edit,
 * omit it to create. The Server Action is bound through React 19's
 * `useActionState` so per-field errors round-trip without manual fetch
 * choreography. On success the dialog closes itself, fires a toast,
 * and Next.js's `revalidatePath` (called from the action) refreshes
 * the parent list.
 *
 * Job options are grouped by gear role to mirror the spreadsheet's
 * mental model and to make the role-weight mapping visible at the
 * point of selection.
 */
export function PlayerFormDialog({
  player,
  tierId,
  trigger,
}: PlayerFormDialogProps) {
  const t = useTranslations("players.form");
  const tToast = useTranslations("players.toasts");
  const tRoles = useTranslations("players.roles");
  const isEditing = player !== undefined;

  const [open, setOpen] = useState(false);
  const action = isEditing ? updatePlayerAction : createPlayerAction;
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  // Close + toast on success. The state object is replaced for every
  // submit, so a successful result reliably fires this exactly once.
  useEffect(() => {
    if (state.ok) {
      toast.success(tToast(isEditing ? "updated" : "created"));
      setOpen(false);
    }
  }, [state, isEditing, tToast]);

  const errors = !state.ok ? state.errors : {};
  const groupedJobs = GEAR_ROLES.map((role) => ({
    role,
    jobs: JOB_CODES.filter((job) => jobToGearRole(job) === role),
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("editTitle") : t("addTitle")}
          </DialogTitle>
          <DialogDescription>{isEditing ? player?.name : ""}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {isEditing ? (
            <input type="hidden" name="id" value={player.id} />
          ) : (
            <input type="hidden" name="tierId" value={tierId} />
          )}

          <FormRow id="name" label={t("name.label")} error={errors.name}>
            <Input
              id="name"
              name="name"
              required
              defaultValue={player?.name ?? ""}
              placeholder={t("name.placeholder")}
            />
          </FormRow>

          <FormRow id="mainJob" label={t("mainJob")} error={errors.mainJob}>
            <Select
              name="mainJob"
              defaultValue={player?.mainJob ?? "PLD"}
              required
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("mainJob")} />
              </SelectTrigger>
              <SelectContent>
                {groupedJobs.map(({ role, jobs }) => (
                  <SelectGroup key={role}>
                    <SelectLabelGroup>
                      {tRoles(role as GearRole)}
                    </SelectLabelGroup>
                    {jobs.map((job: JobCode) => (
                      <SelectItem key={job} value={job}>
                        {job}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow
            id="altJobs"
            label={t("altJobs.label")}
            help={t("altJobs.help")}
            error={errors.altJobs}
          >
            <Input
              id="altJobs"
              name="altJobs"
              defaultValue={(player?.altJobs ?? []).join(", ")}
              placeholder={t("altJobs.placeholder")}
            />
          </FormRow>

          <FormRow
            id="gearLink"
            label={t("gearLink.label")}
            error={errors.gearLink}
          >
            <Input
              id="gearLink"
              name="gearLink"
              defaultValue={player?.gearLink ?? ""}
              placeholder={t("gearLink.placeholder")}
            />
          </FormRow>

          <FormRow id="notes" label={t("notes.label")} error={errors.notes}>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={player?.notes ?? ""}
              placeholder={t("notes.placeholder")}
              rows={2}
            />
          </FormRow>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Tiny wrapper that pairs a label, an input, an optional help text,
 * and the field-level error message with consistent spacing. Keeps
 * the form readable without a heavy form library.
 */
function FormRow({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string | undefined;
  error?: string | undefined;
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
