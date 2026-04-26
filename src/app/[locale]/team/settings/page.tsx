import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { getCurrentTeam } from "@/lib/db/queries";

import { TeamSettingsForm } from "./_components/team-settings-form";

// Live data per request — see the dashboard page for the full rationale.
export const dynamic = "force-dynamic";

/**
 * Team-settings page.
 *
 * Phase 1.1 only allows renaming the team and changing its default
 * UI locale. The form lives in a Client Component for the
 * `useActionState` ergonomics; the page itself stays server-rendered
 * so the form is pre-filled with the current values without a
 * client-side fetch.
 */
export default async function TeamSettingsPage({
  params,
}: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("team.settings");
  const team = await getCurrentTeam();

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <Card>
        <CardContent className="py-6">
          <TeamSettingsForm team={team} />
        </CardContent>
      </Card>
    </main>
  );
}
