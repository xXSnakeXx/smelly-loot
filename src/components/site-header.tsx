import { LocaleSwitcher } from "@/components/locale-switcher";
import { MainNav } from "@/components/main-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link } from "@/i18n/navigation";

/**
 * Persistent top bar shown above every page.
 *
 * Layout is: brand on the left, primary nav in the middle, locale
 * switcher + theme toggle on the right. The brand is also a link to
 * the dashboard so clicking it always lands the user "home".
 *
 * Server-rendered: only the three child components that need
 * interactivity (`MainNav`, `LocaleSwitcher`, `ThemeToggle`) are
 * client components.
 */
export function SiteHeader() {
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
        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
