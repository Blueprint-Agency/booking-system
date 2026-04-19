"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAdminState } from "@/lib/admin-state";
import { useMyInstructorId } from "@/lib/instructor-scope";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/formatters";

export default function InstructorSchedulePage() {
  const myId = useMyInstructorId();
  const sessions = useAdminState((s) => s.sessions);

  const upcoming = useMemo(
    () =>
      sessions
        .filter((s) => s.instructorId === myId && Date.parse(`${s.date}T${s.time}:00`) >= Date.now() - 60 * 60_000)
        .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)),
    [sessions, myId],
  );

  return (
    <>
      <PageHeader title="My schedule" description="All upcoming sessions assigned to you." />
      <div className="mt-6">
        {upcoming.length === 0 ? (
          <EmptyState title="Nothing scheduled" description="No upcoming sessions." />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {upcoming.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/instructor/sessions/${s.id}/roster`} className="flex-1 hover:text-accent">
                  <div className="font-medium text-ink">{s.name}</div>
                  <div className="text-xs text-muted">{formatDateTime(`${s.date}T${s.time}:00`)} · {s.duration} min</div>
                </Link>
                <Badge tone={s.bookedCount >= s.capacity ? "warning" : "neutral"}>
                  {s.bookedCount}/{s.capacity}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
