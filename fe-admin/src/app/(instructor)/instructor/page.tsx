"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Clock, Users, ChevronRight } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useMyInstructorId } from "@/lib/instructor-scope";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { formatDateTime, formatTime } from "@/lib/formatters";

export default function InstructorTodayPage() {
  const myId = useMyInstructorId();
  const sessions = useAdminState((s) => s.sessions);

  const today = new Date().toISOString().slice(0, 10);
  const myUpcoming = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            s.instructorId === myId &&
            s.status === "scheduled" &&
            (s.date === today ||
              Date.parse(`${s.date}T${s.time}:00`) >= Date.now() - 60 * 60_000),
        )
        .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
        .slice(0, 8),
    [sessions, myId, today],
  );

  if (!myId) {
    return (
      <>
        <PageHeader title="Today" />
        <EmptyState
          title="No instructor profile"
          description="The signed-in admin user doesn't match an instructor record."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Today"
        description="Your upcoming sessions. Click any to manage the roster."
      />
      <div className="mt-6 space-y-3">
        {myUpcoming.length === 0 ? (
          <EmptyState
            title="Nothing scheduled"
            description="No upcoming sessions assigned to you."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {myUpcoming.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/instructor/sessions/${s.id}/roster`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-paper"
                >
                  <Clock className="h-4 w-4 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">{s.name}</div>
                    <div className="text-xs text-muted">
                      {s.date === today
                        ? `Today · ${formatTime(`${s.date}T${s.time}:00`)}`
                        : formatDateTime(`${s.date}T${s.time}:00`)}
                    </div>
                  </div>
                  <Badge tone={s.bookedCount >= s.capacity ? "warning" : "neutral"}>
                    <Users className="mr-0.5 inline h-3 w-3" /> {s.bookedCount}/{s.capacity}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
