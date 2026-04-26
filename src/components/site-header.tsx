import { Settings } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { MainNav } from "@/components/main-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link } from "@/i18n/navigation";

/**
 * Persistent top bar shown above every page.
 *
 * Layout: brand on the left, primary nav (just *Players* for now;
 * everything else hangs off the dashboard tier-grid), and a small
 * cluster on the right with a Settings cog → `/team`, the locale
 * switcher and the theme toggle.
 *
 * The intentionally-small nav surface is the central change vs the
 * pre-v1.2 layout, where Tier/Loot/History sat alongside Players up
 * here. Those features now live as tabs inside the per-tier detail
 * page so the dashboard stays the single anchor "home" view.
 */
export async function SiteHeader() {
  const t = await getTranslations("nav");

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-12 max-w-screen-2xl items-center gap-4 px-4">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight"
          aria-label="Smelly Loot"
        >
          Smelly Loot
        </Link>
        <MainNav />
        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/team/settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("teamSettings")}
            title={t("teamSettings")}
          >
            <Settings className="size-4" />
          </Link>
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
