"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { formatDateTime } from "@/lib/formatters";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Input, Select, Badge, EmptyState, StatusBadge } from "@/components/ui";
import type { Booking } from "@/types";

type LedgerStatus = "all" | "confirmed" | "attended" | "no-show" | "cancelled" | "waitlisted";

interface Filter {
  status: LedgerStatus;
  locationId: string;
  from: string;
  to: string;
  text: string;
}

const EMPTY: Filter = { status: "all", locationId: "", from: "", to: "", text: "" };

function sessionStartIso(date: string, time: string): string {
  return `${date}T${time}:00`;
}

export function BookingsLedger() {
  const allBookings = useAdminState((s) => s.bookings);
  const bookings = useWithTenant(allBookings);
  const sessions = useAdminState((s) => s.sessions);
  const clients = useAdminState((s) => s.clients);
  const locations = useAdminState((s) => s.locations);
  const [filter, setFilter] = useState<Filter>(EMPTY);

  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const rows = useMemo(() => {
    return bookings.filter((b) => {
      const sess = sessionById.get(b.sessionId);
      if (filter.status !== "all") {
        if (filter.status === "attended" && b.checkInStatus !== "attended") return false;
        if (filter.status === "no-show" && b.checkInStatus !== "no-show") return false;
        if (filter.status === "confirmed" && b.status !== "confirmed") return false;
        if (filter.status === "cancelled" && b.status !== "cancelled") return false;
        if (filter.status === "waitlisted" && b.status !== "waitlisted") return false;
      }
      if (filter.locationId && sess?.locationId !== filter.locationId) return false;
      if (filter.from && sess && sessionStartIso(sess.date, sess.time) < filter.from) return false;
      if (filter.to && sess && sessionStartIso(sess.date, sess.time) > filter.to) return false;
      if (filter.text) {
        const q = filter.text.toLowerCase();
        const client = clientById.get(b.clientId);
        const matches =
          (client?.name ?? "").toLowerCase().includes(q) ||
          (sess?.name ?? "").toLowerCase().includes(q) ||
          b.id.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [bookings, sessionById, clientById, filter]);

  const columns: DataTableColumn<Booking>[] = [
    {
      key: "when",
      header: "When",
      sortable: true,
      sortValue: (b) => {
        const s = sessionById.get(b.sessionId);
        return s ? sessionStartIso(s.date, s.time) : b.createdAt;
      },
      cell: (b) => {
        const s = sessionById.get(b.sessionId);
        return (
          <span className="text-sm">
            {s ? formatDateTime(sessionStartIso(s.date, s.time)) : "—"}
          </span>
        );
      },
    },
    {
      key: "client",
      header: "Client",
      cell: (b) => {
        const c = clientById.get(b.clientId);
        return (
          <Link href={`/admin/clients/${b.clientId}`} className="font-medium text-ink hover:underline">
            {c?.name ?? b.clientId}
          </Link>
        );
      },
    },
    {
      key: "session",
      header: "Session",
      cell: (b) => {
        const s = sessionById.get(b.sessionId);
        return <span className="text-sm">{s?.name ?? b.sessionId}</span>;
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
      cell: (b) => (
        <Badge
          tone={
            b.checkInStatus === "attended"
              ? "sage"
              : b.checkInStatus === "no-show"
                ? "error"
                : b.checkInStatus === "late"
                  ? "warning"
                  : "neutral"
          }
        >
          {b.checkInStatus}
        </Badge>
      ),
    },
    {
      key: "location",
      header: "Location",
      cell: (b) => {
        const s = sessionById.get(b.sessionId);
        const loc = locations.find((l) => l.id === s?.locationId);
        return <span className="text-sm text-muted">{loc?.name ?? "—"}</span>;
      },
    },
    {
      key: "actions",
      header: "",
      width: "w-24",
      cell: (b) => (
        <Link href={`/admin/bookings/${b.id}`} className="text-sm text-accent hover:underline">
          View
        </Link>
      ),
    },
  ];

  const empty =
    filter === EMPTY ? (
      <EmptyState title="No bookings" description="Bookings appear here as clients book sessions." />
    ) : (
      <EmptyState
        title="No bookings match"
        description="Try clearing the filters."
        cta={
          <button
            type="button"
            onClick={() => setFilter(EMPTY)}
            className="text-sm text-accent hover:underline"
          >
            Clear filters
          </button>
        }
      />
    );

  const filters = (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="space-y-1">
        <label className="text-xs text-muted">Status</label>
        <Select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value as LedgerStatus })}
          className="w-40"
        >
          <option value="all">All</option>
          <option value="confirmed">Confirmed</option>
          <option value="attended">Attended</option>
          <option value="no-show">No-show</option>
          <option value="cancelled">Cancelled</option>
          <option value="waitlisted">Waitlisted</option>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted">Location</label>
        <Select
          value={filter.locationId}
          onChange={(e) => setFilter({ ...filter, locationId: e.target.value })}
          className="w-48"
        >
          <option value="">Any</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted">From</label>
        <Input
          type="date"
          value={filter.from}
          onChange={(e) => setFilter({ ...filter, from: e.target.value })}
          className="w-40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted">To</label>
        <Input
          type="date"
          value={filter.to}
          onChange={(e) => setFilter({ ...filter, to: e.target.value })}
          className="w-40"
        />
      </div>
      <div className="space-y-1 flex-1 min-w-[200px]">
        <label className="text-xs text-muted">Search</label>
        <Input
          placeholder="Client, session, booking id"
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
      </div>
    </div>
  );

  return (
    <DataTable<Booking>
      rows={rows}
      columns={columns}
      rowKey={(b) => b.id}
      pageSize={20}
      filters={filters}
      empty={empty}
    />
  );
}
