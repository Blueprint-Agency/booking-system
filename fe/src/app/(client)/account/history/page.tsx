"use client";

import { useMemo, useState } from "react";
import { ClipboardX } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import type { Booking, Session, Instructor, Location } from "@/types";
import bookingsData from "@/data/bookings.json";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";

const CLIENT_ID = "cli-1";

const bookings = bookingsData as Booking[];
const sessions = sessionsData as Session[];
const instructors = instructorsData as Instructor[];
const locations = locationsData as Location[];

function getSession(id: string) {
  return sessions.find((s) => s.id === id);
}

function getInstructor(id: string) {
  return instructors.find((i) => i.id === id);
}

function getLocation(id: string | null) {
  if (!id) return null;
  return locations.find((l) => l.id === id);
}

type StatusFilter = "all" | "attended" | "canceled";
type DateFilter = "all" | "30" | "90" | "365";

export default function BookingHistory() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  const pastBookings = useMemo(() => {
    return bookings
      .filter((b) => {
        if (b.clientId !== CLIENT_ID) return false;
        return (
          b.checkInStatus === "attended" ||
          b.checkInStatus === "late" ||
          b.checkInStatus === "no-show" ||
          b.status === "cancelled"
        );
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const maxDays =
      dateFilter === "30"
        ? 30
        : dateFilter === "90"
          ? 90
          : dateFilter === "365"
            ? 365
            : null;

    return pastBookings.filter((b) => {
      const session = getSession(b.sessionId);
      if (!session) return false;

      const isCanceled = b.status === "cancelled";
      const isAttended =
        b.checkInStatus === "attended" || b.checkInStatus === "late";

      if (statusFilter === "attended" && !isAttended) return false;
      if (statusFilter === "canceled" && !isCanceled) return false;

      if (maxDays !== null) {
        const sessionTime = new Date(session.date).getTime();
        if (now - sessionTime > maxDays * dayMs) return false;
      }

      if (q) {
        const instructor = getInstructor(session.instructorId);
        const location = getLocation(session.locationId);
        const hay = [
          session.name,
          instructor?.name ?? "",
          location?.name ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [pastBookings, search, statusFilter, dateFilter]);

  return (
    <div>
      <SectionHeading eyebrow="History" title="Your bookings" />

      <div className="rounded-2xl bg-paper border border-ink/10 overflow-hidden">
        <div className="flex items-center gap-3 p-6 border-b border-ink/10 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search class, instructor, location"
            className="rounded-full border border-ink/10 bg-warm px-4 py-2 text-sm w-64"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-full border border-ink/10 bg-warm px-4 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="attended">Attended</option>
            <option value="canceled">Canceled</option>
          </select>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className="rounded-full border border-ink/10 bg-warm px-4 py-2 text-sm"
          >
            <option value="all">All time</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardX}
            title="No bookings match"
            description="Try adjusting your filters."
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="bg-warm">
                <th className="text-left text-xs uppercase tracking-wider text-muted px-6 py-4">
                  Date
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted px-6 py-4">
                  Class
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted px-6 py-4">
                  Instructor
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted px-6 py-4">
                  Location
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted px-6 py-4">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((booking) => {
                const session = getSession(booking.sessionId);
                if (!session) return null;
                const instructor = getInstructor(session.instructorId);
                const location = getLocation(session.locationId);

                const isCanceled = booking.status === "cancelled";
                const isAttended =
                  booking.checkInStatus === "attended" ||
                  booking.checkInStatus === "late";

                const pillClass = isAttended
                  ? "bg-sage/20 text-sage"
                  : isCanceled
                    ? "bg-error/10 text-error"
                    : "bg-warm text-muted";

                const pillLabel = isCanceled
                  ? "Canceled"
                  : booking.checkInStatus === "attended"
                    ? "Attended"
                    : booking.checkInStatus === "late"
                      ? "Late"
                      : booking.checkInStatus === "no-show"
                        ? "No-show"
                        : "Pending";

                return (
                  <tr key={booking.id}>
                    <td className="px-6 py-4 border-b border-ink/5 last:border-0 text-ink">
                      {formatDate(session.date)}
                    </td>
                    <td className="px-6 py-4 border-b border-ink/5 last:border-0 text-ink font-medium">
                      {session.name}
                    </td>
                    <td className="px-6 py-4 border-b border-ink/5 last:border-0 text-muted">
                      {instructor?.name ?? "—"}
                    </td>
                    <td className="px-6 py-4 border-b border-ink/5 last:border-0 text-muted">
                      {location?.name ?? "—"}
                    </td>
                    <td className="px-6 py-4 border-b border-ink/5 last:border-0">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${pillClass}`}
                      >
                        {pillLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
