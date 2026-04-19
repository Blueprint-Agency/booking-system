"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdminState } from "@/lib/admin-state";
import { StatusBadge } from "@/components/ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { formatDateTime } from "@/lib/formatters";
import type { Booking } from "@/types";

export default function ClientBookingsPage() {
  const { id } = useParams<{ id: string }>();
  const allBookings = useAdminState((s) => s.bookings);
  const sessions = useAdminState((s) => s.sessions);

  const bookings = useMemo(
    () => allBookings.filter((b) => b.clientId === id),
    [allBookings, id],
  );
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  const columns: DataTableColumn<Booking>[] = [
    {
      key: "session",
      header: "Session",
      cell: (b) => {
        const s = sessionById.get(b.sessionId);
        if (!s) return <span className="text-muted">—</span>;
        return (
          <Link href={`/admin/sessions/${s.id}/roster`} className="font-medium text-ink hover:text-accent">
            {s.name}
          </Link>
        );
      },
    },
    {
      key: "when",
      header: "When",
      cell: (b) => {
        const s = sessionById.get(b.sessionId);
        return s ? (
          <span className="text-sm text-muted">{formatDateTime(`${s.date}T${s.time}:00`)}</span>
        ) : null;
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (b) => <StatusBadge status={b.status} />,
    },
    {
      key: "checkin",
      header: "Check-in",
      cell: (b) => <span className="text-xs text-muted">{b.checkInStatus}</span>,
    },
  ];

  return (
    <DataTable<Booking>
      rows={bookings}
      columns={columns}
      rowKey={(b) => b.id}
      empty={<div className="rounded-md border border-dashed border-border bg-paper/40 px-4 py-6 text-center text-xs text-muted">No bookings yet.</div>}
    />
  );
}
