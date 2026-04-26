"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Top-bar navigation.
 *
 * Surfaces the few global, team-level affordances that don't hang
 * off the per-tier detail page. As of v2.0 that's just the "Team"
 * link → `/team`, which is the master roster of stable player
 * identities. Everything tier-scoped (Plan, Track, History,
 * Roster) lives as a tab on `/tiers/[id]` instead.
 *
 * The active-link styling matches the tab triggers (text-foreground
 * + underline) so the nav doesn't visually compete with the
 * dashboard's tier grid for attention.
 */
export function MainNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const isTeamActive = pathname === "/team" || pathname.startsWith("/team/");

  return (
    <nav className="flex items-center gap-1 text-sm">
      <Link
        href="/team"
        className={cn(
          "rounded-md px-2 py-1 transition-colors hover:bg-muted",
          isTeamActive
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {t("team")}
      </Link>
    </nav>
  );
}
