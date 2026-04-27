"use client";

import { Coins } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Tier } from "@/lib/db/schema";
import {
  BIS_SOURCES,
  type BisSource,
  deriveSourceIlvs,
} from "@/lib/ffxiv/slots";
import { refreezeBuysAction, updateTierAction } from "@/lib/tiers/actions";

interface TierEditFormProps {
  tier: Tier;
}

/**
 * Tier-edit form: name + max_ilv + buy-refreeze action.
 *
 * The iLv block edits the tier's max-iLv with a live preview of
 * the nine derived per-source iLvs. The actual cascade happens
 * in `updateTierAction`.
 *
 * The "Buys neu berechnen" button (v4.1) clears `tier.frozen_buys`
 * via `refreezeBuysAction` and flushes the plan cache so the
 * next render regenerates the buy schedule from current state.
 * Wrapped in an alert-dialog confirmation because it can shift
 * the recommendations the operator has been working off of.
 */
export function TierEditForm({ tier }: TierEditFormProps) {
  const t = useTranslations("tierEdit");
  const tSources = useTranslations("bis.sources");
  const [name, setName] = useState(tier.name);
  const [maxIlv, setMaxIlv] = useState(tier.maxIlv);
  const [pending, startTransition] = useTransition();
  const [refreezePending, startRefreezeTransition] = useTransition();
  const [refreezeOpen, setRefreezeOpen] = useState(false);

  const previewIlvs = deriveSourceIlvs(maxIlv);

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateTierAction(formData);
      if (result.ok) toast.success(t("savedToast"));
      else toast.error(t("saveErrorToast"));
    });
  };

  const onRefreeze = () => {
    startRefreezeTransition(async () => {
      const fd = new FormData();
      fd.set("tierId", String(tier.id));
      const result = await refreezeBuysAction(fd);
      if (result.ok) {
        toast.success(t("refreezeBuys.savedToast"));
        setRefreezeOpen(false);
      } else {
        toast.error(t("refreezeBuys.errorToast"));
      }
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <form action={onSubmit} className="flex flex-col gap-4">
        <input type="hidden" name="tierId" value={tier.id} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tier-name">{t("name.label")}</Label>
          <Input
            id="tier-name"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("name.placeholder")}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tier-max-ilv">{t("maxIlv.label")}</Label>
          <Input
            id="tier-max-ilv"
            name="maxIlv"
            type="number"
            required
            value={maxIlv}
            min={100}
            max={2000}
            onChange={(e) =>
              setMaxIlv(Number.parseInt(e.target.value, 10) || 0)
            }
            className="w-32 font-mono"
          />
          <p className="text-xs text-muted-foreground">{t("maxIlv.help")}</p>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("preview")}
          </p>
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {BIS_SOURCES.filter((s) => s !== "NotPlanned").map(
              (source: BisSource) => (
                <li
                  key={source}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    {tSources(source)}
                  </span>
                  <span className="font-mono">{previewIlvs[source]}</span>
                </li>
              ),
            )}
          </ul>
        </div>

        <div>
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t pt-6">
        <h3 className="text-sm font-medium">{t("refreezeBuys.heading")}</h3>
        <p className="max-w-2xl text-xs text-muted-foreground">
          {t("refreezeBuys.description")}
        </p>
        <AlertDialog open={refreezeOpen} onOpenChange={setRefreezeOpen}>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={refreezePending}
              >
                <Coins className="mr-1.5 size-3.5" />
                {t("refreezeBuys.trigger")}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("refreezeBuys.confirmTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("refreezeBuys.confirmDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={refreezePending}>
                {t("refreezeBuys.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={onRefreeze}
                disabled={refreezePending}
              >
                {refreezePending
                  ? t("refreezeBuys.confirmInProgress")
                  : t("refreezeBuys.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
