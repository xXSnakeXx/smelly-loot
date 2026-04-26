"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Locale, routing } from "@/i18n/routing";
import type { Team } from "@/lib/db/schema";
import { type ActionState, updateTeamSettingsAction } from "@/lib/team/actions";

const INITIAL_STATE: ActionState = { ok: false, errors: {} };

interface TeamSettingsFormProps {
  team: Team;
}

/**
 * Inline form for the team-settings page (no dialog wrapper).
 *
 * The two editable fields — name and default locale — round-trip
 * through the same Server Action; a successful save fires a toast
 * and lets `revalidatePath` refresh every page that consumed the
 * old team data.
 */
export function TeamSettingsForm({ team }: TeamSettingsFormProps) {
  const t = useTranslations("team.settings");
  const tLocale = useTranslations("locale");

  const [state, formAction, pending] = useActionState(
    updateTeamSettingsAction,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (state.ok) toast.success(t("savedToast"));
  }, [state, t]);

  const errors = !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="team-name">{t("name.label")}</Label>
        <Input
          id="team-name"
          name="name"
          required
          defaultValue={team.name}
          placeholder={t("name.placeholder")}
        />
        {errors.name ? (
          <p className="text-xs text-destructive">{errors.name}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="team-locale">{t("locale.label")}</Label>
        <Select name="locale" defaultValue={team.locale as Locale} required>
          <SelectTrigger id="team-locale" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {routing.locales.map((locale) => (
              <SelectItem key={locale} value={locale}>
                {tLocale(`names.${locale}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("locale.description")}
        </p>
        {errors.locale ? (
          <p className="text-xs text-destructive">{errors.locale}</p>
        ) : null}
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
