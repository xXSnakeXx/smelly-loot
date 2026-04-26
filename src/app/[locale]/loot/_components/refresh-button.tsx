"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Client-side refresh button for server-rendered tabs.
 *
 * The Plan tab (and anything that consumes the same player /
 * tier snapshot) auto-refreshes after every Server Action that
 * calls `revalidatePath` — so this button is mostly a backstop for
 * edge cases the framework can't see:
 *
 *   - Direct DB edits (e.g. running `pnpm tsx scripts/...`).
 *   - State changed in another browser tab.
 *   - Just wanting an explicit "recompute now".
 *
 * Wraps `router.refresh()` from next-intl's locale-aware navigation
 * so the URL prefix is preserved. `useTransition` lets us disable
 * the button + spin the icon while the RSC payload re-fetches,
 * which feels much better than a hard reload.
 */
export function RefreshButton({ className }: { className?: string }) {
  const t = useTranslations("loot.plan");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors",
        "hover:border-primary hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      aria-label={t("refresh")}
      title={t("refreshHint")}
    >
      <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
      <span>{pending ? t("refreshing") : t("refresh")}</span>
    </button>
  );
}
