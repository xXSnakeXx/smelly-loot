"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", key: "dashboard" },
  { href: "/players", key: "players" },
  { href: "/tier", key: "tier" },
  { href: "/loot", key: "loot" },
  { href: "/history", key: "history" },
] as const;

/**
 * Top-bar navigation between the five Phase 1 areas.
 *
 * Renders as a horizontal flexbox of locale-aware links; the active
 * link gets a subtle underline and bolder text so the user always
 * knows which section they're in. The `Link` import is the next-intl
 * variant so navigation preserves the active locale prefix.
 *
 * Intentionally simple — no NavigationMenu, no popovers. The five-tab
 * surface fits comfortably on every desktop width we target. If a
 * future feature pushes the count past ~8, this should grow into a
 * proper command-palette + responsive overflow.
 */
export function MainNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 text-sm">
      {NAV_ITEMS.map(({ href, key }) => {
        const isActive =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
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
