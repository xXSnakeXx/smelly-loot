import { getTranslations, setRequestLocale } from "next-intl/server";

import { LocaleSwitcher } from "@/components/locale-switcher";

/**
 * Placeholder landing page (locale-aware).
 *
 * Replaced in Phase 1 with the actual dashboard. For Phase 0 it renders
 * a localized intro and the locale switcher so the i18n wiring is
 * smoke-testable end-to-end.
 *
 * `setRequestLocale` is called here as well as in the layout because
 * static generation otherwise can't bind the locale to this leaf
 * request. See https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing
 * for the rationale.
 */
export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("subtitle")}</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {t("phaseNote", { file: "ROADMAP.md" })}
      </p>
      <LocaleSwitcher />
    </main>
  );
}
