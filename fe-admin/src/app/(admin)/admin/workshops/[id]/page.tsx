"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, EmptyState, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { WorkshopForm } from "@/components/domain/workshops/workshop-form";
import { RosterTable } from "@/components/domain/schedule/roster-table";
import { AuditTimeline } from "@/components/audit/audit-timeline";

type WorkshopTab = "details" | "roster" | "audit";

export default function WorkshopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const session = useAdminState((s) => s.sessions.find((x) => x.id === id));
  const [tab, setTab] = useState<WorkshopTab>("details");

  if (!session || session.type !== "workshop") {
    return (
      <EmptyState
        title="Workshop not found"
        description="This workshop doesn't exist or isn't in your tenant."
        cta={{ href: "/admin/workshops", label: "Back to Workshops" }}
      />
    );
  }

  return (
    <>
      <div className="mb-3 text-xs text-muted">
        <Link href="/admin/workshops" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Workshops
        </Link>
      </div>
      <PageHeader
        title={session.name}
        description={`${session.date} at ${session.time} · ${session.duration} min`}
      />
      <div className="mt-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as WorkshopTab)}>
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="roster">Roster ({session.bookedCount})</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <WorkshopForm workshop={session} />
          </TabsContent>
          <TabsContent value="roster">
            <RosterTable session={session} />
          </TabsContent>
          <TabsContent value="audit">
            <AuditTimeline targetId={session.id} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
