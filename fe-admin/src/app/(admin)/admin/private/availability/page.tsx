"use client";

import { PageHeader, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { AvailabilityTemplateGrid } from "@/components/domain/private/availability-template-grid";
import { BlockoffList } from "@/components/domain/private/blockoff-list";
import { useState } from "react";

export default function AvailabilityPage() {
  const [tab, setTab] = useState<"weekly" | "blockoffs">("weekly");
  return (
    <>
      <PageHeader
        title="Availability"
        description="Per-instructor weekly template and date-range block-offs."
      />
      <div className="mt-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "weekly" | "blockoffs")}>
          <TabsList>
            <TabsTrigger value="weekly">Weekly template</TabsTrigger>
            <TabsTrigger value="blockoffs">Block-offs</TabsTrigger>
          </TabsList>
          <TabsContent value="weekly">
            <AvailabilityTemplateGrid />
          </TabsContent>
          <TabsContent value="blockoffs">
            <BlockoffList />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
