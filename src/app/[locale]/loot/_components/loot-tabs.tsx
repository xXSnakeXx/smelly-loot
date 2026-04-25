"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface LootTabsProps {
  plan: ReactNode;
  track: ReactNode;
}

/**
 * Client-side tab shell for the /loot page.
 *
 * The two panels (`plan` and `track`) come in already-rendered from
 * the Server Component above; this component is purely the Base UI
 * Tabs primitive plus its labels. Defaults to the Track tab because
 * that's the panel the operator interacts with during a raid night.
 */
export function LootTabs({ plan, track }: LootTabsProps) {
  const t = useTranslations("loot.tabs");
  return (
    <Tabs defaultValue="track" className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="track">{t("track")}</TabsTrigger>
        <TabsTrigger value="plan">{t("plan")}</TabsTrigger>
      </TabsList>
      <TabsContent value="track">{track}</TabsContent>
      <TabsContent value="plan">{plan}</TabsContent>
    </Tabs>
  );
}
