"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Cycles through light → dark → system → light.
 *
 * Uses an icon-only button so it disappears into the header on smaller
 * screens. The icon represents the *active* state, not the next state,
 * which matches the convention every shadcn/ui example uses.
 *
 * The `mounted` guard avoids the typical next-themes hydration flicker
 * (the server can't know the system preference, so the icon is
 * blank-ish until React rehydrates on the client). Returning a
 * placeholder of the same dimensions keeps the header from reflowing.
 */
export function ThemeToggle() {
  const t = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const cycle = () => {
    setTheme(
      theme === "light" ? "dark" : theme === "dark" ? "system" : "light",
    );
  };

  const Icon = !mounted
    ? Monitor
    : theme === "dark"
      ? Moon
      : theme === "light"
        ? Sun
        : Monitor;

  const labelKey: "light" | "dark" | "system" =
    theme === "light" || theme === "dark" ? theme : "system";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={cycle}
      aria-label={t("toggle")}
      title={t(labelKey)}
    >
      <Icon />
    </Button>
  );
}
