"use client";

import { useMemo } from "react";
import { useAdminState } from "@/lib/admin-state";
import { useMyInstructorId } from "@/lib/instructor-scope";
import { PageHeader, Badge, EmptyState } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatDateTime } from "@/lib/formatters";
import type { Session } from "@/types";

interface LogRow {
  session: Session;
  attended: number;
  noShow: number;
  capacity: number;
}

export default function TeachingLogPage() {
  const myId = useMyInstructorId();
  const sessions = useAdminState((s) => s.sessions);
  const bookings = useAdminState((s) => s.bookings);

  const today = new Date().toISOString().slice(0, 10);

  const rows: LogRow[] = useMemo(() => {
    if (!myId) return [];
    const past = sessions
      .filter((s) => s.instructorId === myId && s.date < today)
      .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
    return past.map((s) => {
      const sessionBookings = bookings.filter((b) => b.sessionId === s.id);
      return {
        session: s,
        attended: sessionBookings.filter(
          (b) => b.checkInStatus === "attended" || b.checkInStatus === "late",
        ).length,
        noShow: sessionBookings.filter((b) => b.checkInStatus === "no-show").length,
        capacity: s.capacity,
      };
    });
  }, [myId, sessions, bookings, today]);

  const columns: DataTableColumn<LogRow>[] = [
    {
      key: "when",
      header: "When",
      sortable: true,
      sortValue: (r) => `${r.session.date}T${r.session.time}`,
      cell: (r) => (
        <span className="text-sm text-muted">
          {formatDateTime(`${r.session.date}T${r.session.time}:00`)}
        </span>
      ),
    },
    {
      key: "name",
      header: "Class",
      cell: (r) => <span className="font-medium text-ink">{r.session.name}</span>,
    },
    {
      key: "attendance",
      header: "Attendance",
      align: "right",
      cell: (r) => (
        <span className="text-sm tabular-nums">
          {r.attended}/{r.capacity}
        </span>
      ),
    },
    {
      key: "noShow",
      header: "No-show",
      align: "right",
      cell: (r) => (
        <span className="text-sm tabular-nums text-muted">{r.noShow}</span>
      ),
    },
    {
      key: "status",
      header: "",
      align: "right",
      cell: (r) => <Badge tone="neutral">{r.session.status}</Badge>,
    },
  ];

  if (!myId) return null;

  return (
    <>
      <PageHeader
        title="Teaching log"
        description="Read-only history of your past sessions. Pay/statements live outside the app."
      />
      <div className="mt-6">
        <DataTable<LogRow>
          rows={rows}
          columns={columns}
          rowKey={(r) => r.session.id}
          empty={<EmptyState title="No past sessions yet" description="Once you've taught a class, it will appear here." />}
        />
      </div>
    </>
  );
}
