"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SlaChip } from "@/components/ui/sla-chip";
import { AcceptRequestModal } from "@/components/requests/accept-modal";
import { DeclineRequestModal } from "@/components/requests/decline-modal";
import { useAdminState } from "@/lib/mock-state";
import clientsData from "@/data/clients.json";
import instructorsData from "@/data/instructors.json";
import type { Client, Instructor } from "@/types";

export default function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const state = useAdminState();
  const request = state.privateRequests.find((r) => r.id === id);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);

  if (!request) return notFound();

  const clients = clientsData as Client[];
  const instructors = instructorsData as Instructor[];
  const client = clients.find((c) => c.id === request.clientId);
  const inst = instructors.find((i) => i.id === (request.preferredInstructorId ?? ""));
  const resolver = request.resolution
    ? state.adminId === request.resolution.resolvedBy
      ? "you"
      : request.resolution.resolvedBy
    : null;

  return (
    <div className="space-y-6">
      <Link href="/private-sessions/requests" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to inbox
      </Link>
      <PageHeader
        title={client ? `${client.firstName} ${client.lastName}` : "Request"}
        description={`Submitted ${request.submittedAt}`}
        actions={
          request.status === "pending" ? (
            <div className="flex items-center gap-2">
              <SlaChip deadlineAt={request.deadlineAt} />
              <Button variant="ghost" onClick={() => setDeclineOpen(true)} className="text-error">
                Decline
              </Button>
              <Button onClick={() => setAcceptOpen(true)}>Approve</Button>
            </div>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <Card className="px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-ink/50">Preferred instructor</div>
          <div className="mt-1 font-medium text-ink">{inst?.name ?? "Any"}</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-ink/50">Status</div>
          <div className="mt-1 font-medium capitalize text-ink">{request.status}</div>
          {request.resolution && (
            <div className="mt-1 text-xs text-ink/50">
              Resolved by {resolver} at {request.resolution.resolvedAt}
              {request.resolution.scheduledDate &&
                ` · scheduled ${request.resolution.scheduledDate} ${request.resolution.scheduledTime}`}
              {request.resolution.declineReason &&
                ` · reason: ${request.resolution.declineReason}`}
            </div>
          )}
        </Card>
      </div>

      <Card className="px-5 py-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
          Proposed slots
        </h3>
        <ul className="space-y-1">
          {request.proposedSlots.map((s, i) => (
            <li key={i} className="font-mono text-sm text-ink/80">
              {s.date} · {s.time}
            </li>
          ))}
        </ul>
      </Card>

      {request.notes && (
        <Card className="px-5 py-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">Notes</h3>
          <p className="text-sm text-ink/80">{request.notes}</p>
        </Card>
      )}

      <AcceptRequestModal request={request} open={acceptOpen} onClose={() => setAcceptOpen(false)} />
      <DeclineRequestModal requestId={request.id} open={declineOpen} onClose={() => setDeclineOpen(false)} />
    </div>
  );
}
