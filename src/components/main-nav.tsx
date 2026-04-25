"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [{ href: "/players", key: "players" }] as const;

/**
 * Top-bar navigation.
 *
 * Smelly Loot's primary surface is the dashboard's tier-grid, so the
 * top nav is intentionally tiny: just the spots a raid leader hits
 * out of muscle memory mid-session ("show me the people"). The dial
 * for everything else (creating tiers, opening loot, history, etc.)
 * lives in the dashboard cards or under the Settings cog.
 *
 * The active link gets a subtle pill background; the rest stay
 * muted-foreground so they read as secondary navigation.
 */
export function MainNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 text-sm">
      {NAV_ITEMS.map(({ href, key }) => {
        const isActive = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "rounded-md px-3 py-1.5 transition-colors hover:bg-muted hover:text-foreground",
              isActive
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground",
            )}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
