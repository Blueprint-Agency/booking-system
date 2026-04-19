"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Ticket,
  UserRound,
  CalendarX,
  Package,
} from "lucide-react";
import { formatDate, formatTime } from "@/lib/utils";
import { SectionHeading } from "@/components/booking/section-heading";
import { AccountMobileNav } from "@/components/account/account-mobile-nav";
import { EmptyState } from "@/components/ui/empty-state";
import { QrBadge } from "@/components/account/qr-badge";
import type { Session, Instructor } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";
import {
  useMockState,
  getActiveClassCredits,
  hasActiveUnlimited,
  isExpired,
  type MockBooking,
  type MockPackage,
} from "@/lib/mock-state";

const sessions = sessionsData as Session[];
const instructors = instructorsData as Instructor[];

function getSession(id: string) {
  return sessions.find((s) => s.id === id);
}
function getInstructor(id: string) {
  return instructors.find((i) => i.id === id);
}

type NextUpItem = {
  booking: MockBooking;
  name: string;
  instructorName?: string;
  date: string;
  time: string;
  startMs: number;
  detailHref: string;
};

const PAGE_SIZE = 5;

function getBookingStart(b: MockBooking): { name: string; instructorName?: string; date: string; time: string; startMs: number; endMs: number } | null {
  if (b.meta) {
    const d = new Date(b.meta.startsAt);
    if (isNaN(d.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      name: b.meta.name,
      instructorName: b.meta.instructorName,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      startMs: d.getTime(),
      endMs: d.getTime() + (b.meta.duration ?? 60) * 60 * 1000,
    };
  }
  const s = getSession(b.sessionId);
  if (!s) return null;
  const inst = getInstructor(s.instructorId);
  const startMs = new Date(`${s.date}T${s.time}:00`).getTime();
  return {
    name: s.name,
    instructorName: inst?.name,
    date: s.date,
    time: s.time,
    startMs,
    endMs: startMs + (s.duration ?? 60) * 60 * 1000,
  };
}

const TYPE_META: Record<MockBooking["type"], { label: string; href: string; tone: string }> = {
  class:     { label: "Class",           href: "/account/classes",          tone: "bg-accent/15 text-accent-deep" },
  workshop:  { label: "Workshop",        href: "/account/workshops",        tone: "bg-sage/15 text-sage" },
  private:   { label: "Private session", href: "/account/private-sessions", tone: "bg-warm text-ink" },
};

export default function AccountOverview() {
  const state = useMockState();
  const firstName = state.user?.firstName || "there";
  const [nextUpVisible, setNextUpVisible] = useState(PAGE_SIZE);

  const upcomingBookings = useMemo<NextUpItem[]>(() => {
    const now = Date.now();
    const items: NextUpItem[] = [];
    for (const b of state.bookings) {
      if (state.cancelledBookings.includes(b.id)) continue;
      if (state.attendedBookings.includes(b.id)) continue;
      if (b.type === "private" && !state.confirmedPrivateBookings.includes(b.id)) continue;
      const d = getBookingStart(b);
      if (!d) continue;
      const isFuture = d.endMs >= now || new Date(b.bookedAt).getTime() >= d.endMs;
      if (!isFuture) continue;
      items.push({
        booking: b,
        name: d.name,
        instructorName: d.instructorName,
        date: d.date,
        time: d.time,
        startMs: d.startMs,
        detailHref: TYPE_META[b.type].href,
      });
    }
    return items.sort((a, b) => a.startMs - b.startMs);
  }, [state.bookings, state.cancelledBookings, state.attendedBookings, state.confirmedPrivateBookings]);

  const unlimited = hasActiveUnlimited(state);
  const classCredits = unlimited ? -1 : getActiveClassCredits(state);
  const unlimitedPkg = state.packages.find(
    (p) => p.kind === "class-unlimited" && !isExpired(p),
  );

  const ptSessionsRemaining = state.packages
    .filter((p) => (p.kind === "pt1on1" || p.kind === "pt2on1") && !isExpired(p))
    .reduce((sum, p) => sum + p.credits, 0);

  const classPackages = state.packages.filter(
    (p) =>
      !isExpired(p) &&
      ((p.kind === "class-credit" && p.credits > 0) ||
        p.kind === "class-unlimited"),
  );
  const ptPackages = state.packages.filter(
    (p) =>
      !isExpired(p) &&
      (p.kind === "pt1on1" || p.kind === "pt2on1") &&
      p.credits > 0,
  );

  return (
    <div>
      <SectionHeading
        eyebrow={`Welcome back, ${firstName}`}
        title="Here's your practice"
      />
      <AccountMobileNav />

      {/* Credit totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-paper border border-ink/10 p-6">
          <Ticket className="w-5 h-5 text-accent-deep mb-3" />
          <p className="text-3xl font-extrabold text-ink">
            {unlimited ? "Unlimited" : classCredits}
          </p>
          <p className="text-xs uppercase tracking-wider text-muted mt-1">
            Class credits
          </p>
          {unlimited && unlimitedPkg && (
            <p className="text-xs text-muted mt-1">
              Valid until {formatDate(unlimitedPkg.expiresAt)}
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-paper border border-ink/10 p-6">
          <UserRound className="w-5 h-5 text-accent-deep mb-3" />
          <p className="text-3xl font-extrabold text-ink">{ptSessionsRemaining}</p>
          <p className="text-xs uppercase tracking-wider text-muted mt-1">
            PT sessions
          </p>
        </div>
      </div>

      {/* Next up */}
      <div className="mt-6 rounded-2xl bg-paper border border-ink/10 p-6">
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
            {upcomingBookings.slice(0, nextUpVisible).map((item) => {
              const meta = TYPE_META[item.booking.type];
              return (
                <Link
                  key={item.booking.id}
                  href={item.detailHref}
                  className="flex items-center justify-between gap-4 py-3 border-b border-ink/5 last:border-0 hover:opacity-80 transition-opacity"
                >
                  <div className="min-w-0">
                    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.tone}`}>
                      {meta.label}
                    </span>
                    <p className="font-medium text-ink truncate mt-1">{item.name}</p>
                    {item.instructorName && (
                      <p className="text-sm text-muted mt-0.5">with {item.instructorName}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm text-ink">{formatDate(item.date)}</p>
                    <p className="text-sm text-muted">{formatTime(item.time)}</p>
                  </div>
                  <QrBadge
                    value={`teeko:booking:${item.booking.id}`}
                    label={item.name}
                    subLabel={`${formatDate(item.date)} · ${formatTime(item.time)}`}
                  />
                </Link>
              );
            })}
            {upcomingBookings.length > nextUpVisible && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    setNextUpVisible((v) => v + PAGE_SIZE);
                  }}
                  className="rounded-full border border-ink/10 px-5 py-2 text-sm font-medium hover:border-accent transition-colors"
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Packages — Class */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          Class packages
        </h3>
        {classPackages.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No active class packages"
            description="Purchase a bundle or unlimited pass to start booking classes."
            cta={{ href: "/packages", label: "Browse packages" }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {classPackages.map((p) => (
              <PackageCard key={p.id} pkg={p} unitLabel="credits" />
            ))}
          </div>
        )}
      </div>

      {/* Packages — PT */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          PT packages
        </h3>
        {ptPackages.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No active PT packages"
            description="Purchase a 1-on-1 or 2-on-1 package to book private sessions."
            cta={{ href: "/packages", label: "Browse packages" }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ptPackages.map((p) => (
              <PackageCard key={p.id} pkg={p} unitLabel="sessions" />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

function PackageCard({
  pkg,
  unitLabel,
}: {
  pkg: MockPackage;
  unitLabel: string;
}) {
  const isUnlimited = pkg.kind === "class-unlimited";
  return (
    <div className="rounded-2xl bg-paper border border-ink/10 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-ink truncate">{pkg.name}</p>
          <p className="text-xs text-muted mt-1">
            Expires {formatDate(pkg.expiresAt)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-extrabold text-ink">
            {isUnlimited ? "∞" : pkg.credits}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted">
            {isUnlimited ? "Unlimited" : `of ${pkg.totalCredits} ${unitLabel}`}
          </p>
        </div>
      </div>
    </div>
  );
}
