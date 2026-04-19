"use client";

import { useMemo, useState } from "react";
import { CalendarX, X, CheckCircle2, XCircle, Clock } from "lucide-react";
import { QrBadge } from "@/components/account/qr-badge";
import { formatDate, formatTime, cn } from "@/lib/utils";
import { SectionHeading } from "@/components/booking/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { CLASS_CANCELLATION_POLICY, CLASS_CANCELLATION_HOURS } from "@/data/policy";
import type { Session, Instructor } from "@/types";
import sessionsData from "@/data/sessions.json";
import instructorsData from "@/data/instructors.json";
import { useMockState, cancelBooking, type MockBooking } from "@/lib/mock-state";

const sessions = sessionsData as Session[];
const instructors = instructorsData as Instructor[];

function getSession(id: string) {
  return sessions.find((s) => s.id === id);
}
function getInstructor(id: string) {
  return instructors.find((i) => i.id === id);
}
function sessionEndMs(s: Session) {
  return new Date(`${s.date}T${s.time}:00`).getTime() + (s.duration ?? 60) * 60 * 1000;
}

type Display = {
  name: string;
  instructorName?: string;
  date: string;
  time: string;
  startMs: number;
  endMs: number;
};

function getDisplay(b: MockBooking): Display | null {
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
  return {
    name: s.name,
    instructorName: inst?.name,
    date: s.date,
    time: s.time,
    startMs: new Date(`${s.date}T${s.time}:00`).getTime(),
    endMs: sessionEndMs(s),
  };
}

type Props = {
  type: MockBooking["type"];
  eyebrow: string;
  title: string;
  emptyDesc: string;
  browseHref: string;
  browseLabel: string;
};

type BookingStatus = "pending" | "upcoming" | "attended" | "cancelled";
type FilterKey = "all" | BookingStatus;

const PAGE_SIZE = 5;

const TYPE_TAG: Record<MockBooking["type"], { label: string; tone: string }> = {
  class:    { label: "Class",    tone: "bg-accent/15 text-accent-deep" },
  workshop: { label: "Workshop", tone: "bg-sage/15 text-sage" },
  private:  { label: "Private",  tone: "bg-warm text-ink" },
};

export function BookingsPage({
  type,
  eyebrow,
  title,
  emptyDesc,
  browseHref,
  browseLabel,
}: Props) {
  const state = useMockState();
  const cancelled = state.cancelledBookings;
  const confirmed = state.confirmedPrivateBookings;

  const filters: FilterKey[] = type === "private"
    ? ["all", "pending", "upcoming", "attended", "cancelled"]
    : ["all", "upcoming", "attended", "cancelled"];

  const FILTER_LABELS: Record<FilterKey, string> = {
    all: "All",
    pending: "Pending",
    upcoming: "Upcoming",
    attended: type === "private" ? "Completed" : "Attended",
    cancelled: "Cancelled",
  };

  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [cancelTarget, setCancelTarget] = useState<MockBooking | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const typed = useMemo(
    () => state.bookings.filter((b) => b.type === type),
    [state.bookings, type],
  );

  const classified = useMemo(() => {
    const now = Date.now();
    const rows: Array<MockBooking & { _status: BookingStatus }> = [];

    for (const b of typed) {
      const d = getDisplay(b);
      if (!d) continue;
      const isCancelled = cancelled.includes(b.id);
      const bookedAfterEnd = new Date(b.bookedAt).getTime() >= d.endMs;
      const isAttended = state.attendedBookings.includes(b.id);
      const isFuture = d.endMs >= now || bookedAfterEnd;

      let status: BookingStatus;
      if (isCancelled) status = "cancelled";
      else if (isAttended) status = "attended";
      else if (isFuture) {
        status = type === "private" && !confirmed.includes(b.id) ? "pending" : "upcoming";
      } else status = "attended";

      rows.push({ ...b, _status: status });
    }

    rows.sort((a, b) => {
      const da = getDisplay(a);
      const db = getDisplay(b);
      if (!da || !db) return 0;
      const aPast = a._status === "attended" || a._status === "cancelled";
      const bPast = b._status === "attended" || b._status === "cancelled";
      if (aPast !== bPast) return aPast ? 1 : -1;
      return aPast ? db.startMs - da.startMs : da.startMs - db.startMs;
    });

    return rows;
  }, [typed, cancelled, confirmed, state.attendedBookings, type]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: classified.length,
      pending: 0,
      upcoming: 0,
      attended: 0,
      cancelled: 0,
    };
    for (const b of classified) c[b._status]++;
    return c;
  }, [classified]);

  const filtered = useMemo(() => {
    if (activeFilter === "all") return classified;
    return classified.filter((b) => b._status === activeFilter);
  }, [classified, activeFilter]);

  function switchFilter(f: FilterKey) {
    setActiveFilter(f);
    setVisibleCount(PAGE_SIZE);
  }

  function hoursUntil(d: Display | null) {
    if (!d) return Infinity;
    return (d.startMs - Date.now()) / (1000 * 60 * 60);
  }

  function confirmCancel() {
    if (cancelTarget) cancelBooking(cancelTarget.id);
    setCancelTarget(null);
  }

  const visible = filtered.slice(0, visibleCount);
  const firstUpcomingIdx = visible.findIndex((b) => b._status === "upcoming");
  const hasAny = classified.length > 0;

  return (
    <div>
      <SectionHeading eyebrow={eyebrow} title={title} />

      {!hasAny ? (
        <EmptyState
          icon={CalendarX}
          title={`No ${eyebrow.toLowerCase()} yet`}
          description={emptyDesc}
          cta={{ href: browseHref, label: browseLabel }}
        />
      ) : (
        <>
          <div className="mb-4 -mx-4 sm:mx-0 overflow-x-auto no-scrollbar">
            <div className="inline-flex rounded-lg border border-border bg-warm p-1 mx-4 sm:mx-0">
              {filters.map((f) => (
                <button
                  key={f}
                  onClick={() => switchFilter(f)}
                  className={cn(
                    "px-3 sm:px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap shrink-0",
                    activeFilter === f ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink"
                  )}
                >
                  {FILTER_LABELS[f]}
                  <span className="ml-1.5 text-xs text-muted">({counts[f]})</span>
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl bg-paper border border-ink/10 p-8 text-center text-sm text-muted">
              {activeFilter === "all" && "No bookings yet."}
              {activeFilter === "pending" && "No pending requests."}
              {activeFilter === "upcoming" && "Nothing on the schedule."}
              {activeFilter === "attended" && (type === "private" ? "No completed sessions yet." : "No attended bookings yet.")}
              {activeFilter === "cancelled" && "No cancelled bookings."}
            </div>
          ) : (
            <div className="space-y-3">
              {firstUpcomingIdx !== -1 && (
                <BookingCard
                  booking={visible[firstUpcomingIdx] as MockBooking}
                  onCancel={setCancelTarget}
                  featured
                  pending={false}
                />
              )}
              {visible.filter((_, i) => i !== firstUpcomingIdx).length > 0 && (
                <div className="rounded-2xl bg-paper border border-ink/10 divide-y divide-ink/5">
                  {visible.map((b, i) => {
                    if (i === firstUpcomingIdx) return null;
                    if (b._status === "attended" || b._status === "cancelled") {
                      return <CompletedRow key={b.id} booking={b} status={b._status} type={type} />;
                    }
                    return (
                      <div key={b.id} className="p-4">
                        <BookingCard
                          booking={b}
                          onCancel={setCancelTarget}
                          pending={b._status === "pending"}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {filtered.length > visibleCount && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                className="rounded-full border border-ink/10 px-5 py-2 text-sm font-medium hover:border-accent transition-colors"
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}

      {cancelTarget && (() => {
        const display = getDisplay(cancelTarget);
        const hours = hoursUntil(display);
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
              {display && (
                <p className="mt-1 text-sm text-muted">
                  {display.name} · {formatDate(display.date)} · {formatTime(display.time)}
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
              <p className="mt-3 text-xs text-muted">{CLASS_CANCELLATION_POLICY.repeat}</p>
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

function BookingCard({
  booking,
  onCancel,
  featured = false,
  pending = false,
}: {
  booking: MockBooking;
  onCancel: (b: MockBooking) => void;
  featured?: boolean;
  pending?: boolean;
}) {
  const display = getDisplay(booking);
  if (!display) return null;
  const showQR = !pending;
  const tag = TYPE_TAG[booking.type];

  return (
    <div
      className={
        featured
          ? "rounded-2xl bg-paper border border-accent/30 p-6 shadow-soft"
          : ""
      }
    >
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {booking.type !== "private" && (
              <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tag.tone}`}>
                {tag.label}
              </span>
            )}
            {pending && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warm px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                <Clock className="w-3 h-3" />
                Awaiting confirmation
              </span>
            )}
          </div>
          <p className={cn(
            featured ? "text-base sm:text-lg font-semibold text-ink truncate" : "font-medium text-ink truncate",
            (booking.type !== "private" || pending) && "mt-1",
          )}>
            {display.name}
          </p>
          {display.instructorName && (
            <p className="text-sm text-muted mt-0.5 truncate">with {display.instructorName}</p>
          )}
          <div className="mt-1 text-xs text-muted sm:hidden">
            {formatDate(display.date)} · {formatTime(display.time)}
          </div>
        </div>
        <div className="hidden sm:block text-right shrink-0">
          <p className="text-sm text-ink font-medium">{formatDate(display.date)}</p>
          <p className="text-sm text-muted">{formatTime(display.time)}</p>
        </div>
        {showQR && (
          <QrBadge
            value={`teeko:booking:${booking.id}`}
            label={display.name}
            subLabel={`${formatDate(display.date)} · ${formatTime(display.time)}`}
          />
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => onCancel(booking)}
          className="inline-flex items-center gap-1.5 min-h-[32px] text-xs font-medium text-muted hover:text-error transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          {pending ? "Withdraw request" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

function CompletedRow({
  booking,
  status,
  type,
}: {
  booking: MockBooking;
  status: "attended" | "cancelled";
  type: MockBooking["type"];
}) {
  const display = getDisplay(booking);
  if (!display) return null;
  const Icon = status === "attended" ? CheckCircle2 : XCircle;
  const tone =
    status === "attended"
      ? "bg-sage/15 text-sage"
      : "bg-warm text-muted";
  const label =
    status === "attended"
      ? (type === "private" ? "Completed" : "Attended")
      : "Cancelled";

  return (
    <div className="flex items-center justify-between gap-3 sm:gap-4 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink truncate">{display.name}</p>
        {display.instructorName && (
          <p className="text-sm text-muted truncate">with {display.instructorName}</p>
        )}
        <p className="text-xs text-muted mt-0.5 sm:hidden">
          {formatDate(display.date)} · {formatTime(display.time)}
        </p>
      </div>
      <div className="hidden sm:block text-right shrink-0">
        <p className="text-sm text-ink">{formatDate(display.date)}</p>
        <p className="text-sm text-muted">{formatTime(display.time)}</p>
      </div>
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
      >
        <Icon className="w-3.5 h-3.5" />
        {label}
      </span>
    </div>
  );
}
