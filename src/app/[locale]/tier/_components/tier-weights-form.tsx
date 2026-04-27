"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_ROLE_WEIGHTS, type GearRole } from "@/lib/ffxiv/jobs";
import { DEFAULT_SLOT_WEIGHTS, SLOTS, type Slot } from "@/lib/ffxiv/slots";
import { updateTierWeightsAction } from "@/lib/tiers/actions";

interface TierWeightsFormProps {
  tierId: number;
  initialSlotWeights: Record<string, number> | null;
  initialRoleWeights: Record<string, number> | null;
}

const ROLES: GearRole[] = ["tank", "healer", "melee", "phys_range", "caster"];

/**
 * Tier-settings form for the loot-planner's per-slot and per-role
 * priority weights.
 *
 * Both maps are number inputs (0.10 ≤ x ≤ 2.00, step 0.05). LOWER
 * value = the optimiser prefers that slot/role first when ties
 * arise. The defaults give DPS roles a 0.95 discount (modest
 * bias) and Chestpiece/Pants a 0.85 discount (high stat budget).
 *
 * "Reset to defaults" wipes the saved override (DB null) and
 * lets the planner fall through to the hard-coded defaults.
 */
export function TierWeightsForm({
  tierId,
  initialSlotWeights,
  initialRoleWeights,
}: TierWeightsFormProps) {
  const t = useTranslations("tierEdit.weights");
  const tSlots = useTranslations("loot.slots");
  const tRoles = useTranslations("tierEdit.weights.roles");
  const [pending, startTransition] = useTransition();

  // Merge the saved override (if any) with the defaults so the
  // form always shows a numeric value for every slot/role. The
  // server-side action only persists keys whose values differ
  // from the defaults — no need to round-trip a "no override"
  // marker through the UI.
  const [slotWeights, setSlotWeights] = useState<Record<Slot, number>>(() => ({
    ...DEFAULT_SLOT_WEIGHTS,
    ...((initialSlotWeights ?? {}) as Partial<Record<Slot, number>>),
  }));
  const [roleWeights, setRoleWeights] = useState<Record<GearRole, number>>(
    () => ({
      ...DEFAULT_ROLE_WEIGHTS,
      ...((initialRoleWeights ?? {}) as Partial<Record<GearRole, number>>),
    }),
  );

  const onSubmit = (formData: FormData) => {
    formData.set("slotWeights", JSON.stringify(slotWeights));
    formData.set("roleWeights", JSON.stringify(roleWeights));
    startTransition(async () => {
      const result = await updateTierWeightsAction(formData);
      if (result.ok) toast.success(t("savedToast"));
      else toast.error(t("saveErrorToast"));
    });
  };

  const onReset = () => {
    setSlotWeights({ ...DEFAULT_SLOT_WEIGHTS });
    setRoleWeights({ ...DEFAULT_ROLE_WEIGHTS });
  };

  const updateSlot = (slot: Slot, raw: string) => {
    const num = Number.parseFloat(raw);
    if (!Number.isFinite(num)) return;
    setSlotWeights((prev) => ({ ...prev, [slot]: num }));
  };
  const updateRole = (role: GearRole, raw: string) => {
    const num = Number.parseFloat(raw);
    if (!Number.isFinite(num)) return;
    setRoleWeights((prev) => ({ ...prev, [role]: num }));
  };

  return (
    <form action={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="tierId" value={tierId} />

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("roles.heading")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("roles.description")}
        </p>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {ROLES.map((role) => (
            <div key={role} className="flex flex-col gap-1">
              <Label
                htmlFor={`role-${role}`}
                className="text-xs text-muted-foreground"
              >
                {tRoles(role)}
              </Label>
              <Input
                id={`role-${role}`}
                type="number"
                step={0.05}
                min={0.1}
                max={2}
                value={roleWeights[role]}
                onChange={(e) => updateRole(role, e.target.value)}
                className="h-8 w-full font-mono text-xs"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("slots.heading")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("slots.description")}
        </p>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {SLOTS.map((slot) => (
            <div key={slot} className="flex flex-col gap-1">
              <Label
                htmlFor={`slot-${slot}`}
                className="text-xs text-muted-foreground"
              >
                {tSlots(slot)}
              </Label>
              <Input
                id={`slot-${slot}`}
                type="number"
                step={0.05}
                min={0.1}
                max={2}
                value={slotWeights[slot]}
                onChange={(e) => updateSlot(slot, e.target.value)}
                className="h-8 w-full font-mono text-xs"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={pending}
        >
          {t("resetDefaults")}
        </Button>
      </div>
    </form>
  );
}
