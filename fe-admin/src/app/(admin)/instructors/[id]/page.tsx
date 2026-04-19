"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InstructorForm } from "@/components/instructors/instructor-form";
import { useAdminState } from "@/lib/mock-state";
import { sessionDetailHref } from "@/lib/session-routes";

export default function InstructorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const state = useAdminState();
  const instructor = state.instructors.find((i) => i.id === id);
  const [editing, setEditing] = useState(false);

  if (!instructor) return notFound();

  const upcoming = state.sessions
    .filter((s) => s.instructorId === id && s.status === "scheduled" && s.date >= "2026-04-20")
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .slice(0, 20);
  const requests = state.privateRequests.filter(
    (r) => r.preferredInstructorId === id && r.status === "pending",
  );

  return (
    <div className="space-y-6">
      <Link href="/instructors" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to instructors
      </Link>
      <PageHeader
        title={instructor.name}
        description={instructor.specialties.join(" · ") || "No specialties listed"}
        actions={<Button onClick={() => setEditing(true)}>Edit</Button>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="px-5 py-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">Bio</h3>
          <p className="text-sm text-ink/80 whitespace-pre-wrap">{instructor.bio || "—"}</p>
        </Card>

        <Card className="px-5 py-4 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Upcoming classes · {upcoming.length}
          </h3>
          {upcoming.length === 0 ? (
            <div className="text-sm text-ink/50">Nothing scheduled.</div>
          ) : (
            <ul className="divide-y divide-ink/5">
              {upcoming.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={sessionDetailHref(s)} className="font-medium text-ink hover:text-accent">
                    {s.name}
                  </Link>
                  <span className="font-mono text-xs text-ink/50">
                    {s.date} · {s.time} · {s.bookedCount}/{s.capacity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="px-5 py-4 lg:col-span-3">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Pending private requests · {requests.length}
          </h3>
          {requests.length === 0 ? (
            <div className="text-sm text-ink/50">None routed to this instructor.</div>
          ) : (
            <ul className="divide-y divide-ink/5">
              {requests.map((r) => {
                const client = state.clients.find((c) => c.id === r.clientId);
                return (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/private-sessions/requests/${r.id}`} className="font-medium text-ink hover:text-accent">
                      {client ? `${client.firstName} ${client.lastName}` : "Unknown"}
                    </Link>
                    <Badge tone="warning">pending</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {editing && <InstructorForm initial={instructor} open={editing} onClose={() => setEditing(false)} />}
    </div>
  );
}
