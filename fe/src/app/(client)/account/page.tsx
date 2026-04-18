"use client";

import { useState } from "react";
import Link from "next/link";
import { Crown, Ticket, CalendarCheck, Send, CalendarX, QrCode, X } from "lucide-react";
import { formatDate, formatTime } from "@/lib/utils";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { CLASS_CANCELLATION_POLICY, CLASS_CANCELLATION_HOURS } from "@/data/policy";
import type { Booking, Session, Instructor, ClientPackage, Membership } from "@/types";
import bookingsData from "@/data/bookings.json";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";
import packagesData from "@/data/client-packages.json";
import membershipsData from "@/data/memberships.json";
import { MOCK_USER } from "@/data/mock-user";

const CLIENT_ID = "cli-1";

const bookings = bookingsData as Booking[];
const sessions = sessionsData as Session[];
const instructors = instructorsData as Instructor[];
const packages = packagesData as ClientPackage[];
const memberships = membershipsData as Membership[];

function getSession(id: string) {
  return sessions.find((s) => s.id === id);
}
function getInstructor(id: string) {
  return instructors.find((i) => i.id === id);
}

export default function AccountOverview() {
  const [cancelled, setCancelled] = useState<string[]>([]);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);

  const firstName = MOCK_USER.name.split(" ")[0];

  function hoursUntil(session: Session | undefined) {
    if (!session) return Infinity;
    const start = new Date(`${session.date}T${session.time}:00`);
    return (start.getTime() - Date.now()) / (1000 * 60 * 60);
  }

  function confirmCancel() {
    if (cancelTarget) setCancelled((prev) => [...prev, cancelTarget.id]);
    setCancelTarget(null);
  }

  // Upcoming confirmed bookings
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
    })
    .slice(0, 3);

  const activePackages = packages.filter(
    (p) => p.clientId === CLIENT_ID && p.status === "active"
  );
  const totalRemaining = activePackages.reduce(
    (sum, p) => sum + p.sessionsRemaining,
    0
  );

  const membership = memberships.find((m) => m.clientId === CLIENT_ID);

  // Stats
  const classesAttendedYtd = bookings.filter((b) => {
    if (b.clientId !== CLIENT_ID) return false;
    if (b.status !== "confirmed") return false;
    const session = getSession(b.sessionId);
    if (!session) return false;
    const d = new Date(session.date);
    return d < new Date("2026-03-29") && d.getFullYear() === 2026;
  }).length;
  const referralsSent = 3;

  return (
    <div>
      <SectionHeading
        eyebrow={`Welcome back, ${firstName}`}
        title="Here's your practice"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Upcoming bookings card */}
        <div className="rounded-2xl bg-paper border border-ink/10 p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
            Next up
          </h3>
          {upcomingBookings.length === 0 ? (
            <EmptyState
              icon={CalendarX}
              title="No upcoming bookings"
              description="Browse classes to book your next session."
              cta={{ href: "/classes", label: "Browse classes" }}
            />
          ) : (
            <div>
              {upcomingBookings.map((booking) => {
                const session = getSession(booking.sessionId);
                if (!session) return null;
                const instructor = getInstructor(session.instructorId);
                return (
                  <div
                    key={booking.id}
                    className="py-3 border-b border-ink/5 last:border-0"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-ink truncate">
                            {session.name}
                          </p>
                          {booking.promotedFromWaitlist && (
                            <span className="inline-flex items-center rounded-full bg-accent/15 text-accent-deep px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                              Promoted from waitlist
                            </span>
                          )}
                        </div>
                        {instructor && (
                          <p className="text-sm text-muted">
                            with {instructor.name}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <p className="text-sm text-ink">
                          {formatDate(session.date)}
                        </p>
                        <p className="text-sm text-muted">
                          {formatTime(session.time)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <Link
                        href={`/booking/confirmation?type=class&session=${session.id}`}
                        className="inline-flex items-center gap-1 min-h-[32px] text-xs font-medium text-accent-deep hover:text-accent transition-colors"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        Show QR
                      </Link>
                      <button
                        onClick={() => setCancelTarget(booking)}
                        className="inline-flex items-center gap-1 min-h-[32px] text-xs font-medium text-muted hover:text-error transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4">
            <Link
              href="/account/history"
              className="text-sm font-medium text-accent-deep hover:text-accent transition-colors"
            >
              View all
            </Link>
          </div>
        </div>

        {/* Active membership card */}
        <div className="rounded-2xl bg-paper border border-ink/10 p-6 flex flex-col">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
            Membership
          </h3>
          <div className="flex-1">
            {membership ? (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <Crown className="w-6 h-6 text-accent-deep" />
                  <span className="text-xl font-bold text-ink">Unlimited</span>
                </div>
                <p className="text-sm text-muted">
                  Renews {formatDate(membership.nextBillingDate)}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <Crown className="w-6 h-6 text-muted" />
                  <span className="text-xl font-bold text-ink">No membership</span>
                </div>
                <p className="text-sm text-muted">
                  Explore unlimited plans to save on every class.
                </p>
              </>
            )}
          </div>
          <div className="mt-4">
            <Link
              href="/account/membership"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-md hover:bg-accent-deep transition-colors"
            >
              Manage membership
            </Link>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <Link
          href="/account/packages"
          className="rounded-2xl bg-paper border border-ink/10 p-6 hover:border-ink/20 transition-colors"
        >
          <Ticket className="w-5 h-5 text-accent-deep mb-3" />
          <p className="text-3xl font-extrabold text-ink">{totalRemaining}</p>
          <p className="text-xs uppercase tracking-wider text-muted mt-1">
            Credits remaining
          </p>
        </Link>

        <div className="rounded-2xl bg-paper border border-ink/10 p-6">
          <CalendarCheck className="w-5 h-5 text-accent-deep mb-3" />
          <p className="text-3xl font-extrabold text-ink">{classesAttendedYtd}</p>
          <p className="text-xs uppercase tracking-wider text-muted mt-1">
            Classes attended YTD
          </p>
        </div>

        <div className="rounded-2xl bg-paper border border-ink/10 p-6">
          <Send className="w-5 h-5 text-accent-deep mb-3" />
          <p className="text-3xl font-extrabold text-ink">{referralsSent}</p>
          <p className="text-xs uppercase tracking-wider text-muted mt-1">
            Referrals sent
          </p>
        </div>
      </div>

      {/* Cancel confirmation dialog */}
      {cancelTarget && (() => {
        const session = getSession(cancelTarget.sessionId);
        const hours = hoursUntil(session);
        const willRefund = hours > CLASS_CANCELLATION_HOURS;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
            onClick={() => setCancelTarget(null)}
          >
            <div
              className="w-full max-w-md rounded-2xl bg-paper border border-ink/10 p-6 shadow-hover"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-ink">Cancel this booking?</h3>
              {session && (
                <p className="mt-1 text-sm text-muted">
                  {session.name} · {formatDate(session.date)} · {formatTime(session.time)}
                </p>
              )}
              <div className={`mt-4 rounded-xl border p-3 text-sm ${
                willRefund
                  ? "border-sage/25 bg-sage/10 text-ink"
                  : "border-error/25 bg-error/10 text-ink"
              }`}>
                {willRefund
                  ? `More than ${CLASS_CANCELLATION_POLICY.window} before class — your credit will be refunded.`
                  : `Within ${CLASS_CANCELLATION_POLICY.window} of class — the credit will be forfeited.`}
              </div>
              <p className="mt-3 text-xs text-muted">
                {CLASS_CANCELLATION_POLICY.repeat}
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setCancelTarget(null)}
                  className="flex-1 min-h-[44px] rounded-full border border-ink/10 px-4 text-sm font-medium hover:border-accent transition-colors"
                >
                  Keep booking
                </button>
                <button
                  onClick={confirmCancel}
                  className="flex-1 min-h-[44px] rounded-full bg-error px-4 text-sm font-medium text-paper hover:bg-error/90 transition-colors"
                >
                  Confirm cancellation
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
