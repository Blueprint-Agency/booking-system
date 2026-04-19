"use client";

import { PageHeader, EmptyState, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { AvailabilityTemplateGrid } from "@/components/domain/private/availability-template-grid";
import { BlockoffList } from "@/components/domain/private/blockoff-list";
import { useMyInstructorId } from "@/lib/instructor-scope";
import { useState } from "react";

export default function InstructorAvailabilityPage() {
  const myId = useMyInstructorId();
  const [tab, setTab] = useState<"weekly" | "blockoffs">("weekly");

  if (!myId) {
    return <EmptyState title="No instructor profile" description="Your account is not linked to an instructor record." />;
  }

  return (
    <>
      <PageHeader title="My availability" description="Edit your weekly availability and add block-offs." />
      <div className="mt-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "weekly" | "blockoffs")}>
          <TabsList>
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="blockoffs">Block-offs</TabsTrigger>
          </TabsList>
          <TabsContent value="weekly">
            <AvailabilityTemplateGrid instructorId={myId} selectorEnabled={false} />
          </TabsContent>
          <TabsContent value="blockoffs">
            <BlockoffList instructorId={myId} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
