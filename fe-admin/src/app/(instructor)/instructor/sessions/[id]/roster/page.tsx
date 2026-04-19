"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useMyInstructorId } from "@/lib/instructor-scope";
import { PageHeader, EmptyState } from "@/components/ui";
import { CapacityBar } from "@/components/domain/schedule/capacity-bar";
import { RosterTable } from "@/components/domain/schedule/roster-table";
import { formatDateTime } from "@/lib/formatters";

export default function InstructorRosterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const myId = useMyInstructorId();
  const session = useAdminState((s) => s.sessions.find((x) => x.id === id));

  useEffect(() => {
    if (session && myId && session.instructorId !== myId) {
      router.replace("/instructor");
    }
  }, [session, myId, router]);

  if (!session) {
    return (
      <EmptyState
        title="Session not found"
        cta={{ href: "/instructor/schedule", label: "Back to schedule" }}
      />
    );
  }
  if (myId && session.instructorId !== myId) {
    return (
      <EmptyState
        title="Not your session"
        description="This session is assigned to a different instructor."
        cta={{ href: "/instructor", label: "Back to today" }}
      />
    );
  }

  return (
    <>
      <div className="mb-3 text-xs text-muted">
        <Link href="/instructor/schedule" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> My schedule
        </Link>
      </div>
      <PageHeader
        title={session.name}
        description={formatDateTime(`${session.date}T${session.time}:00`)}
      />
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RosterTable session={session} />
        </div>
        <div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Capacity</h3>
            <CapacityBar
              booked={session.bookedCount}
              capacity={session.capacity}
              waitlist={session.waitlistCount}
            />
          </div>
        </div>
      </div>
    </>
  );
}
