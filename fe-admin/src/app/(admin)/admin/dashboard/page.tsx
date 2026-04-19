"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarDays, Users, AlertTriangle, QrCode } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, Button } from "@/components/ui";
import { StatCard } from "@/components/domain/reports/stat-card";
import { formatTime } from "@/lib/formatters";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TodayPage() {
  const today = todayIso();
  const sessions = useAdminState((s) => s.sessions);
  const bookings = useAdminState((s) => s.bookings);
  const instructors = useAdminState((s) => s.instructors);
  const locations = useAdminState((s) => s.locations);
  const refundOpen = useAdminState((s) => s.refundRequests.filter((r) => r.status === "open").length);
  const cancelOpen = useAdminState((s) => s.cancellationRequests.filter((r) => r.status === "open").length);
  const privatePending = useAdminState((s) => s.privateRequests.filter((r) => r.status === "pending").length);

  const todaySessions = useMemo(
    () =>
      sessions
        .filter((s) => s.date === today && s.status === "scheduled")
        .sort((a, b) => a.time.localeCompare(b.time)),
    [sessions, today],
  );

  const expectedToday = useMemo(() => {
    const ids = new Set(todaySessions.map((s) => s.id));
    return bookings.filter((b) => ids.has(b.sessionId) && b.status === "confirmed").length;
  }, [bookings, todaySessions]);

  const instructorById = new Map(instructors.map((i) => [i.id, i.name]));
  const locationById = new Map(locations.map((l) => [l.id, l.shortName]));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Front-desk view of today's classes and pending work."
        actions={
          <Link href="/admin/check-in">
            <Button>
              <QrCode className="mr-1 h-4 w-4" /> Open check-in
            </Button>
          </Link>
        }
      />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Classes today" value={String(todaySessions.length)} icon={CalendarDays} />
        <StatCard label="Expected" value={String(expectedToday)} icon={Users} />
        <StatCard label="Open refunds" value={String(refundOpen)} icon={AlertTriangle} />
        <StatCard
          label="Open inboxes"
          value={String(refundOpen + cancelOpen + privatePending)}
          hint={`${cancelOpen} cancel · ${privatePending} private`}
          icon={AlertTriangle}
        />
      </div>
      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Today's classes</h3>
        {todaySessions.length === 0 ? (
          <p className="text-sm text-muted">No classes scheduled today.</p>
        ) : (
          <ul className="divide-y divide-border">
            {todaySessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-16 font-mono text-xs text-muted">
                  {formatTime(`${s.date}T${s.time}:00`)}
                </span>
                <Link href={`/admin/sessions/${s.id}/roster`} className="flex-1 font-medium text-ink hover:text-accent">
                  {s.name}
                </Link>
                <span className="text-xs text-muted">
                  {instructorById.get(s.instructorId) ?? "—"}
                </span>
                {s.locationId && (
                  <span className="text-xs text-muted">{locationById.get(s.locationId) ?? "—"}</span>
                )}
                <span className="w-16 text-right text-xs tabular-nums">
                  {s.bookedCount}/{s.capacity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
