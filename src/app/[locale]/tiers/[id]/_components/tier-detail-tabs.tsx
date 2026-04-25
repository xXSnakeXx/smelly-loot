"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TierDetailTabsProps {
  plan: ReactNode;
  track: ReactNode;
  history: ReactNode;
  settings: ReactNode;
}

/**
 * Client wrapper that renders the four tier-detail tabs.
 *
 * Plan / Track / History / Settings.
 *
 * Each tab's children are server-rendered React nodes passed in from
 * the page; the client side only owns the active-tab state. This
 * keeps the algorithm + DB queries on the server while still letting
 * us swap views in place without round-tripping the whole page.
 *
 * The default tab is `plan` because it surfaces the "what's coming
 * up" view that makes the new dashboard model meaningful — the team
 * lead opens a tier and sees the projected distribution before
 * deciding to record actual kills.
 */
export function TierDetailTabs({
  plan,
  track,
  history,
  settings,
}: TierDetailTabsProps) {
  const t = useTranslations("loot.tabs");
  return (
    <Tabs defaultValue="plan" className="w-full gap-6">
      <TabsList>
        <TabsTrigger value="plan">{t("plan")}</TabsTrigger>
        <TabsTrigger value="track">{t("track")}</TabsTrigger>
        <TabsTrigger value="history">{t("history")}</TabsTrigger>
        <TabsTrigger value="settings">{t("settings")}</TabsTrigger>
      </TabsList>
      <TabsContent value="plan">{plan}</TabsContent>
      <TabsContent value="track">{track}</TabsContent>
      <TabsContent value="history">{history}</TabsContent>
      <TabsContent value="settings">{settings}</TabsContent>
    </Tabs>
  );
}
