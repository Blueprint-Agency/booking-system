"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin, UserCog } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { ensureMaterialized } from "@/lib/schedule";
import { formatDateTime } from "@/lib/formatters";
import { PageHeader, EmptyState, Badge, StatusBadge } from "@/components/ui";
import { CapacityBar } from "@/components/domain/schedule/capacity-bar";
import { RosterTable } from "@/components/domain/schedule/roster-table";
import { WalkInForm } from "@/components/domain/schedule/walk-in-form";

export default function SessionRosterPage() {
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    if (id?.includes("@")) {
      try {
        ensureMaterialized(id);
      } catch {
        // template missing — handled in render below
      }
    }
  }, [id]);

  const session = useAdminState((s) => s.sessions.find((x) => x.id === id));
  const instructor = useAdminState((s) =>
    session ? s.instructors.find((i) => i.id === session.instructorId) : undefined,
  );
  const location = useAdminState((s) =>
    session ? s.locations.find((l) => l.id === session.locationId) : undefined,
  );

  if (!session) {
    return (
      <EmptyState
        title="Session not found"
        description="This occurrence isn't materialized yet, or the template is missing."
        cta={{ href: "/admin/schedule", label: "Back to Schedule" }}
      />
    );
  }

  return (
    <>
      <div className="mb-3 text-xs text-muted">
        <Link href="/admin/schedule" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Schedule
        </Link>
      </div>
      <PageHeader
        title={session.name}
        description={`${formatDateTime(`${session.date}T${session.time}:00`)} · ${session.duration} min`}
        actions={<StatusBadge status={session.status} />}
      />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <RosterTable session={session} />
          <WalkInForm session={session} />
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Capacity</h3>
            <CapacityBar
              booked={session.bookedCount}
              capacity={session.capacity}
              waitlist={session.waitlistCount}
            />
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <UserCog className="h-3.5 w-3.5 text-muted" />
                <dt className="text-muted">Instructor</dt>
                <dd className="ml-auto text-ink">{instructor?.name ?? "—"}</dd>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-muted" />
                <dt className="text-muted">Location</dt>
                <dd className="ml-auto text-ink">{location?.name ?? "—"}</dd>
              </div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-3.5 w-3.5 text-muted" />
                <dt className="text-muted">Type</dt>
                <dd className="ml-auto">
                  <Badge tone="neutral">{session.type}</Badge>
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted">Level</dt>
                <dd className="ml-auto">
                  <Badge tone={session.level === "advanced" ? "warning" : "neutral"}>
                    {session.level}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted">Price</dt>
                <dd className="ml-auto tabular-nums">
                  SGD {(session.price / 100).toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted">Package eligible</dt>
                <dd className="ml-auto">
                  {session.packageEligible ? (
                    <Badge tone="sage">Yes</Badge>
                  ) : (
                    <Badge tone="neutral">No</Badge>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </>
  );
}
