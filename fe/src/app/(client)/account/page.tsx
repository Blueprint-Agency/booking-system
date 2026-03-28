"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { formatDate, formatTime } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import type { Booking, Session, Instructor, ClientPackage, Membership } from "@/types";
import bookingsData from "@/data/bookings.json";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";
import packagesData from "@/data/client-packages.json";
import membershipsData from "@/data/memberships.json";

const CLIENT_ID = "cli-1";

const bookings = bookingsData as Booking[];
const sessions = sessionsData as Session[];
const instructors = instructorsData as Instructor[];
const packages = packagesData as ClientPackage[];
const memberships = membershipsData as Membership[];

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

function getSession(id: string) {
  return sessions.find((s) => s.id === id);
}
function getInstructor(id: string) {
  return instructors.find((i) => i.id === id);
}

export default function AccountOverview() {
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState<string[]>([]);

  // Upcoming confirmed bookings for cli-1 where session date is in the future
  const upcomingBookings = bookings
    .filter((b) => {
      if (b.clientId !== CLIENT_ID) return false;
      if (b.status !== "confirmed") return false;
      if (cancelled.includes(b.id)) return false;
      const session = getSession(b.sessionId);
      if (!session) return false;
      return new Date(session.date) >= new Date("2026-03-29");
    })
    .sort((a, b) => {
      const sa = getSession(a.sessionId);
      const sb = getSession(b.sessionId);
      if (!sa || !sb) return 0;
      return new Date(sa.date).getTime() - new Date(sb.date).getTime();
    });

  // Quick stats
  const nextBooking = upcomingBookings[0];
  const nextSession = nextBooking ? getSession(nextBooking.sessionId) : null;

  const activePackages = packages.filter(
    (p) => p.clientId === CLIENT_ID && p.status === "active"
  );
  const totalRemaining = activePackages.reduce(
    (sum, p) => sum + p.sessionsRemaining,
    0
  );

  const membership = memberships.find((m) => m.clientId === CLIENT_ID);

  function handleConfirmCancel() {
    if (cancelId) {
      setCancelled((prev) => [...prev, cancelId]);
      setCancelId(null);
    }
  }

  return (
    <div>
      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <motion.div
          initial="hidden"
          animate="visible"
          custom={0}
          variants={fadeUp}
          className="bg-card border border-border rounded-lg p-5"
        >
          <p className="text-xs text-muted uppercase tracking-wide mb-1">
            Next Session
          </p>
          {nextSession ? (
            <div>
              <p className="font-serif text-lg text-ink">
                {formatDate(nextSession.date)}
              </p>
              <p className="text-sm text-muted">{formatTime(nextSession.time)}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">No upcoming sessions</p>
          )}
        </motion.div>

        <motion.div
          initial="hidden"
          animate="visible"
          custom={1}
          variants={fadeUp}
          className="bg-card border border-border rounded-lg p-5"
        >
          <p className="text-xs text-muted uppercase tracking-wide mb-1">
            Package Balance
          </p>
          <p className="font-serif text-lg text-ink">
            {totalRemaining} sessions
          </p>
          <p className="text-sm text-muted">
            {activePackages.length} active{" "}
            {activePackages.length === 1 ? "package" : "packages"}
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          animate="visible"
          custom={2}
          variants={fadeUp}
          className="bg-card border border-border rounded-lg p-5"
        >
          <p className="text-xs text-muted uppercase tracking-wide mb-1">
            Membership
          </p>
          {membership ? (
            <div className="flex items-center gap-2">
              <StatusBadge status={membership.status} />
              <span className="text-sm text-muted">Unlimited</span>
            </div>
          ) : (
            <p className="text-sm text-muted">No membership</p>
          )}
        </motion.div>
      </div>

      {/* Upcoming Bookings */}
      <motion.div
        initial="hidden"
        animate="visible"
        custom={3}
        variants={fadeUp}
      >
        <h2 className="font-serif text-xl text-ink mb-4">Upcoming Bookings</h2>

        {upcomingBookings.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <p className="text-muted text-sm mb-4">No upcoming bookings</p>
            <Link
              href="/sessions"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-md hover:bg-accent-deep transition-colors duration-200"
            >
              Browse Sessions
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingBookings.map((booking, i) => {
              const session = getSession(booking.sessionId);
              if (!session) return null;
              const instructor = getInstructor(session.instructorId);

              return (
                <motion.div
                  key={booking.id}
                  initial="hidden"
                  animate="visible"
                  custom={4 + i}
                  variants={fadeUp}
                  className="bg-card border border-border rounded-lg p-5 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/sessions/${session.id}`}
                      className="font-serif text-lg text-ink hover:text-accent-deep transition-colors duration-200"
                    >
                      {session.name}
                    </Link>
                    <p className="text-sm text-muted mt-1">
                      {formatDate(session.date)} &middot;{" "}
                      {formatTime(session.time)} &middot; {session.duration} min
                    </p>
                    {instructor && (
                      <p className="text-sm text-muted">
                        with {instructor.name}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href="/sessions"
                      className="px-4 py-2 text-sm font-medium text-accent-deep border border-accent-glow rounded-md hover:bg-accent-glow/20 transition-colors duration-200"
                    >
                      Reschedule
                    </Link>
                    <button
                      onClick={() => setCancelId(booking.id)}
                      className="px-4 py-2 text-sm font-medium text-error border border-error-bg rounded-md hover:bg-error-bg transition-colors duration-200"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Cancel Confirmation Dialog */}
      {cancelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm animate-fade-in">
          <div className="bg-card rounded-xl shadow-modal p-8 max-w-sm w-full mx-4">
            <h3 className="font-serif text-xl text-ink mb-2">
              Cancel Booking?
            </h3>
            <p className="text-sm text-muted mb-6">
              Are you sure you want to cancel this booking? If you used a
              package credit, it will be refunded.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelId(null)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-muted border border-border rounded-md hover:bg-warm transition-colors duration-200"
              >
                Keep Booking
              </button>
              <button
                onClick={handleConfirmCancel}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-error rounded-md hover:bg-error/90 transition-colors duration-200"
              >
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
