"use client";

import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";

/**
 * Bundles every client-side provider needed at the root of the app.
 *
 * - `ThemeProvider` (from next-themes) toggles a `dark` class on `<html>` so
 *   the CSS-variable theme defined in globals.css can switch between light
 *   and dark palettes. `system` follows the user's OS preference until they
 *   pick a theme manually.
 * - `Toaster` (Sonner) renders application-wide toast notifications. It must
 *   live inside `ThemeProvider` so it can read the current theme via
 *   next-themes and style itself accordingly.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
