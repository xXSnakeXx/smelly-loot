import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Providers } from "@/components/providers";
import { routing } from "@/i18n/routing";

import "../globals.css";

// Brand fonts. Geist is Vercel's modern variable font; Geist Mono is its
// monospace counterpart. Both are loaded via `next/font/google` so they are
// self-hosted at build time and don't trigger external CSS imports at runtime.
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Pre-render every supported locale at build time so the [locale] segment
 * stays statically generated. New locales are picked up automatically via
 * the routing config — no separate list to maintain.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Build per-locale metadata so the document title / description follow
 * the active language. Falls back to the routing default if the requested
 * locale isn't supported (the layout itself returns 404 in that case).
 */
export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const safeLocale = hasLocale(routing.locales, locale)
    ? locale
    : routing.defaultLocale;
  const t = await getTranslations({ locale: safeLocale, namespace: "app" });
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

/**
 * Locale-scoped root layout.
 *
 * - Validates the [locale] param against the supported set; an unknown
 *   value results in a 404 (cheaper than rendering with the default).
 * - `setRequestLocale` opts the route into static rendering by binding
 *   the resolved locale before any data fetching runs.
 * - `<html lang>` reflects the active locale for assistive tech and
 *   search engines. `suppressHydrationWarning` is required by
 *   next-themes (light/dark class is set on the client after mount).
 * - `NextIntlClientProvider` is intentionally placed *outside* of
 *   `<Providers>` (theme + toasts) because translations are needed by
 *   anything inside, including future toast contents.
 */
export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
