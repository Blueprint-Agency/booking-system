"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Clock, X } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { Avatar, Badge, EmptyState, Input, Select, StatusBadge } from "@/components/ui";
import { recordCheckIn, recordNoShow } from "@/lib/mutations/checkin";
import { markAttendance } from "@/lib/mutations/roster";
import { formatTime } from "@/lib/formatters";
import type { Booking, Session } from "@/types";

interface Row {
  booking: Booking;
  session: Session;
  clientName: string;
}

export interface ExpectedListProps {
  highlightBookingId?: string | null;
  onClearHighlight?: () => void;
}

export function ExpectedList({ highlightBookingId, onClearHighlight }: ExpectedListProps) {
  const sessions = useWithTenant(useAdminState((s) => s.sessions));
  const bookings = useWithTenant(useAdminState((s) => s.bookings));
  const clients = useAdminState((s) => s.clients);
  const locations = useWithTenant(useAdminState((s) => s.locations));
  const [locId, setLocId] = useState<string>("");
  const [q, setQ] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = useMemo(
    () =>
      sessions.filter(
        (s) => s.date === today && s.status === "scheduled" && (!locId || s.locationId === locId),
      ),
    [sessions, today, locId],
  );
  const sessionIds = useMemo(() => new Set(todaySessions.map((s) => s.id)), [todaySessions]);
  const sessionById = useMemo(() => new Map(todaySessions.map((s) => [s.id, s])), [todaySessions]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const rows: Row[] = useMemo(() => {
    return bookings
      .filter((b) => sessionIds.has(b.sessionId) && b.status !== "cancelled")
      .map((b) => {
        const sess = sessionById.get(b.sessionId)!;
        const c = clientById.get(b.clientId);
        return { booking: b, session: sess, clientName: c?.name ?? "Unknown" };
      })
      .filter((r) => {
        if (!q.trim()) return true;
        const x = q.trim().toLowerCase();
        return (
          r.clientName.toLowerCase().includes(x) ||
          r.session.name.toLowerCase().includes(x) ||
          r.booking.id.toLowerCase().includes(x)
        );
      })
      .sort((a, b) => {
        const ams = `${a.session.date}T${a.session.time}:00`;
        const bms = `${b.session.date}T${b.session.time}:00`;
        return ams.localeCompare(bms);
      });
  }, [bookings, sessionIds, sessionById, clientById, q]);

  const checkIn = (b: Booking) => {
    recordCheckIn(b.id);
    toast.success("Checked in");
    onClearHighlight?.();
  };
  const noShow = (b: Booking) => {
    recordNoShow(b.id);
    toast.success("Marked no-show");
  };
  const late = (b: Booking) => {
    markAttendance({ bookingId: b.id, status: "late" });
    toast.success("Marked late");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          Location
          <Select
            value={locId}
            onChange={(e) => setLocId(e.target.value)}
            className="h-9 w-44"
          >
            <option value="">All</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-1 items-center gap-2 text-xs text-muted">
          Name search (fallback)
          <Input
            placeholder="Search by name or session…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9"
          />
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nobody to check in"
          description="No expected attendees for today's sessions."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {rows.map((r) => {
            const highlighted = r.booking.id === highlightBookingId;
            return (
              <li
                key={r.booking.id}
                className={
                  "flex flex-wrap items-center gap-3 px-4 py-3 " +
                  (highlighted ? "bg-accent/5 ring-2 ring-accent/40" : "")
                }
              >
                <Avatar name={r.clientName} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">{r.clientName}</div>
                  <div className="text-xs text-muted">
                    {formatTime(`${r.session.date}T${r.session.time}:00`)} · {r.session.name}
                  </div>
                </div>
                <StatusBadge status={r.booking.checkInStatus} />
                {r.booking.checkedInAt && (
                  <Badge tone="sage">in {formatTime(r.booking.checkedInAt)}</Badge>
                )}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => checkIn(r.booking)}
                    title="Check in"
                    className="rounded p-1.5 text-muted hover:bg-paper hover:text-sage"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => late(r.booking)}
                    title="Late"
                    className="rounded p-1.5 text-muted hover:bg-paper hover:text-warning"
                  >
                    <Clock className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => noShow(r.booking)}
                    title="No-show"
                    className="rounded p-1.5 text-muted hover:bg-paper hover:text-error"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
