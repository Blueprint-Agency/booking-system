"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { formatDate, formatTime } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import type { Booking, Session } from "@/types";
import bookingsData from "@/data/bookings.json";
import sessionsData from "@/data/sessions.json";

const STAR_OPTIONS = [1, 2, 3, 4, 5] as const;

function RatingDropdown({
  bookingId,
  canRate,
  initialRating,
  ratings,
  onRate,
}: {
  bookingId: string;
  canRate: boolean;
  initialRating: number | null;
  ratings: Record<string, number>;
  onRate: (bookingId: string, value: number) => void;
}) {
  const current = ratings[bookingId] ?? initialRating ?? "";
  const [saved, setSaved] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = Number(e.target.value);
    onRate(bookingId, val);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!canRate) {
    return (
      <select
        disabled
        className="text-xs bg-transparent text-muted border border-border/40 rounded px-2 py-1 cursor-default opacity-50"
      >
        <option>—</option>
      </select>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={current}
        onChange={handleChange}
        className="text-xs bg-warm border border-border rounded px-2 py-1 text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors cursor-pointer"
      >
        <option value="" disabled>
          Rate class
        </option>
        {STAR_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {"★".repeat(n)}{"☆".repeat(5 - n)} {n}/5
          </option>
        ))}
      </select>
      {saved && (
        <span className="text-xs text-sage font-medium whitespace-nowrap">
          Rated ✓
        </span>
      )}
    </div>
  );
}

const CLIENT_ID = "cli-1";

const bookings = bookingsData as Booking[];
const sessions = sessionsData as Session[];

function getSession(id: string) {
  return sessions.find((s) => s.id === id);
}

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function BookingHistory() {
  const [ratings, setRatings] = useState<Record<string, number>>({});

  function handleRate(bookingId: string, value: number) {
    setRatings((prev) => ({ ...prev, [bookingId]: value }));
  }

  // Past bookings: attended, late, no-show, or cancelled
  const pastBookings = bookings
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

  if (pastBookings.length === 0) {
    return (
      <EmptyState
        icon="📋"
        title="No booking history"
        description="Your past bookings will appear here after you attend a session."
        actionLabel="Browse Classes"
        actionHref="/classes"
      />
    );
  }

  return (
    <div>
      <motion.h2
        initial="hidden"
        animate="visible"
        custom={0}
        variants={fadeUp}
        className="font-serif text-xl text-ink mb-6"
      >
        Booking History
      </motion.h2>

      {/* Desktop table */}
      <div className="hidden sm:block">
        <motion.div
          initial="hidden"
          animate="visible"
          custom={1}
          variants={fadeUp}
          className="bg-card border border-border rounded-lg overflow-hidden"
        >
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  Session
                </th>
                <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  Date
                </th>
                <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  Time
                </th>
                <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  Status
                </th>
                <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">
                  Rating
                </th>
              </tr>
            </thead>
            <tbody>
              {pastBookings.map((booking, i) => {
                const session = getSession(booking.sessionId);
                if (!session) return null;

                const statusLabel =
                  booking.status === "cancelled"
                    ? "cancelled"
                    : booking.checkInStatus;

                return (
                  <motion.tr
                    key={booking.id}
                    initial="hidden"
                    animate="visible"
                    custom={2 + i}
                    variants={fadeUp}
                    className="border-b border-border last:border-0 hover:bg-warm/50 transition-colors duration-150"
                  >
                    <td className="px-5 py-4">
                      <span className="text-sm font-medium text-ink">
                        {session.name}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm text-muted">
                        {formatDate(session.date)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm text-muted">
                        {formatTime(session.time)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={statusLabel} />
                    </td>
                    <td className="px-5 py-4">
                      <RatingDropdown
                        bookingId={booking.id}
                        canRate={
                          booking.checkInStatus === "attended" ||
                          booking.checkInStatus === "late"
                        }
                        initialRating={booking.rating ?? null}
                        ratings={ratings}
                        onRate={handleRate}
                      />
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {pastBookings.map((booking, i) => {
          const session = getSession(booking.sessionId);
          if (!session) return null;

          const statusLabel =
            booking.status === "cancelled"
              ? "cancelled"
              : booking.checkInStatus;

          return (
            <motion.div
              key={booking.id}
              initial="hidden"
              animate="visible"
              custom={2 + i}
              variants={fadeUp}
              className="bg-card border border-border rounded-lg p-4"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <span className="text-sm font-medium text-ink">
                  {session.name}
                </span>
                <StatusBadge status={statusLabel} />
              </div>
              <p className="text-sm text-muted mb-3">
                {formatDate(session.date)} &middot; {formatTime(session.time)}
              </p>
              <RatingDropdown
                bookingId={booking.id}
                canRate={
                  booking.checkInStatus === "attended" ||
                  booking.checkInStatus === "late"
                }
                initialRating={booking.rating ?? null}
                ratings={ratings}
                onRate={handleRate}
              />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
