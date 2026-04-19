"use client";

import { PageHeader } from "@/components/ui/page-header";
import { RequestInbox } from "@/components/requests/request-inbox";
import { useAdminState } from "@/lib/mock-state";
import clientsData from "@/data/clients.json";
import instructorsData from "@/data/instructors.json";
import type { Client, Instructor } from "@/types";

const NOW = new Date("2026-04-20T10:00:00");

export default function RequestsPage() {
  const state = useAdminState();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Private session requests"
        description="Sorted by SLA deadline. Respond within 12 hours of submission."
      />
      <RequestInbox
        requests={state.privateRequests}
        clients={clientsData as Client[]}
        instructors={instructorsData as Instructor[]}
        now={NOW}
      />
    </div>
  );
}
