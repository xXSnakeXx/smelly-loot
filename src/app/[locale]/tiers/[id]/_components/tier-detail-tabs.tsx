"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TierDetailTabsProps {
  players: ReactNode;
  plan: ReactNode;
  track: ReactNode;
  history: ReactNode;
  settings: ReactNode;
}

/**
 * Client wrapper that renders the five tier-detail tabs.
 *
 * Players / Plan / Track / History / Settings.
 *
 * Each tab's children are server-rendered React nodes passed in from
 * the page; the client side only owns the active-tab state. This
 * keeps the algorithm + DB queries on the server while still letting
 * us swap views in place without round-tripping the whole page.
 *
 * The default tab is `players` because rosters are tier-scoped (v1.4)
 * and "who's in this tier" is the canonical first question. The Plan
 * tab is one click away and remains the place where the simulator
 * surfaces.
 */
export function TierDetailTabs({
  players,
  plan,
  track,
  history,
  settings,
}: TierDetailTabsProps) {
  const t = useTranslations("loot.tabs");
  return (
    <Tabs defaultValue="players" className="w-full gap-6">
      <TabsList>
        <TabsTrigger value="players">{t("players")}</TabsTrigger>
        <TabsTrigger value="plan">{t("plan")}</TabsTrigger>
        <TabsTrigger value="track">{t("track")}</TabsTrigger>
        <TabsTrigger value="history">{t("history")}</TabsTrigger>
        <TabsTrigger value="settings">{t("settings")}</TabsTrigger>
      </TabsList>
      <TabsContent value="players">{players}</TabsContent>
      <TabsContent value="plan">{plan}</TabsContent>
      <TabsContent value="track">{track}</TabsContent>
      <TabsContent value="history">{history}</TabsContent>
      <TabsContent value="settings">{settings}</TabsContent>
    </Tabs>
  );
}
