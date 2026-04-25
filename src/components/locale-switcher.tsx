"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePathname, useRouter } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";

/**
 * Switches the active UI locale.
 *
 * Uses next-intl's locale-aware navigation helpers so the current path
 * is preserved across the switch (e.g. `/de/players` → `/en/players`).
 * `useTransition` keeps the UI responsive during the locale-driven
 * navigation; the dropdown stays interactive while the new bundle
 * streams in.
 */
export function LocaleSwitcher() {
  const t = useTranslations("locale");
  const currentLocale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (next: Locale | null) => {
    if (next === null || next === currentLocale) {
      return;
    }
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  };

  return (
    <div className="inline-flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("label")}:</span>
      <Select
        value={currentLocale}
        onValueChange={handleChange}
        disabled={isPending}
      >
        <SelectTrigger className="h-7 w-32" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {routing.locales.map((locale) => (
            <SelectItem key={locale} value={locale}>
              {t(`names.${locale}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
