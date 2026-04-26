"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TierDetailTabsProps {
  roster: ReactNode;
  plan: ReactNode;
  track: ReactNode;
  history: ReactNode;
  settings: ReactNode;
}

/**
 * Client wrapper that renders the five tier-detail tabs.
 *
 * Roster / Plan / Track / History / Settings.
 *
 * Each tab's children are server-rendered React nodes passed in from
 * the page; the client side only owns the active-tab state. This
 * keeps the algorithm + DB queries on the server while still letting
 * us swap views in place without round-tripping the whole page.
 *
 * The default tab is `roster` because "who's in this tier" is the
 * canonical first question on landing — the team-level player
 * roster lives on `/team`, the tier-roster (membership) lives
 * here. The Plan tab is one click away and remains the place where
 * the simulator surfaces.
 */
export function TierDetailTabs({
  roster,
  plan,
  track,
  history,
  settings,
}: TierDetailTabsProps) {
  const t = useTranslations("loot.tabs");
  return (
    <Tabs defaultValue="roster" className="w-full gap-6">
      <TabsList>
        <TabsTrigger value="roster">{t("roster")}</TabsTrigger>
        <TabsTrigger value="plan">{t("plan")}</TabsTrigger>
        <TabsTrigger value="track">{t("track")}</TabsTrigger>
        <TabsTrigger value="history">{t("history")}</TabsTrigger>
        <TabsTrigger value="settings">{t("settings")}</TabsTrigger>
      </TabsList>
      <TabsContent value="roster">{roster}</TabsContent>
      <TabsContent value="plan">{plan}</TabsContent>
      <TabsContent value="track">{track}</TabsContent>
      <TabsContent value="history">{history}</TabsContent>
      <TabsContent value="settings">{settings}</TabsContent>
    </Tabs>
  );
}
