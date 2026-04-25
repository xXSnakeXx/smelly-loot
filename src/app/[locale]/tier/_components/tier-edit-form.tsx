"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Tier } from "@/lib/db/schema";
import {
  BIS_SOURCES,
  type BisSource,
  deriveSourceIlvs,
} from "@/lib/ffxiv/slots";
import { updateTierAction } from "@/lib/tiers/actions";

interface TierEditFormProps {
  tier: Tier;
}

/**
 * Tier-edit form: name + max_ilv only.
 *
 * The UI maintains a local preview of the nine derived per-source
 * iLvs so the operator can see what saving with a particular max_ilv
 * would produce. The actual cascade happens in the Server Action so
 * the database value can never disagree with `deriveSourceIlvs`.
 */
export function TierEditForm({ tier }: TierEditFormProps) {
  const t = useTranslations("tierEdit");
  const tSources = useTranslations("bis.sources");
  const [name, setName] = useState(tier.name);
  const [maxIlv, setMaxIlv] = useState(tier.maxIlv);
  const [pending, startTransition] = useTransition();

  const previewIlvs = deriveSourceIlvs(maxIlv);

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateTierAction(formData);
      if (result.ok) toast.success(t("savedToast"));
      else toast.error(t("saveErrorToast"));
    });
  };

  return (
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
          onChange={(e) => setMaxIlv(Number.parseInt(e.target.value, 10) || 0)}
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
  );
}
