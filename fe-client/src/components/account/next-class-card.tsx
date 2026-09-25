"use client";

/**
 * "My next class" — the class the member is about to walk into, with one tap
 * to a full-screen QR and the typed code for check-in (#192).
 *
 * A class already running comes first: a member who arrives late still has
 * something to show the desk, and the desk can still scan it until the day is
 * out. `/me/bookings/upcoming` stops at the start time, so a running class is
 * found the way My Classes finds its Ongoing tab — in `/past`, not yet ended.
 *
 * `MyNextClass` loads both lists for a signed-in member and renders nothing
 * without a booking to show.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, MapPin, QrCode, UserRound } from "lucide-react";
import { QrFullScreen } from "@/components/account/qr-badge";
import { DateStub } from "@/components/account/date-stub";
import type { ApiBooking } from "@/components/account/class-bookings";
import { formatDate } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import { useApi } from "@/lib/api";
import { useMemberSession } from "@/lib/member-auth";
import { reportError } from "@/lib/report-error";

/**
 * A confirmed class running now (started, not ended), else the soonest
 * upcoming one. Sorted here rather than trusting the order it arrived in.
 */
function nextClass(upcoming: ApiBooking[], past: ApiBooking[], now: number): ApiBooking | null {
  const byStart = (a: ApiBooking, b: ApiBooking) => a.starts_at.localeCompare(b.starts_at);
  const running = past
    .filter((b) => b.state === "confirmed" && new Date(b.ends_at).getTime() > now)
    .sort(byStart);
  const next = upcoming.filter((b) => b.state === "confirmed").sort(byStart);
  return running[0] ?? next[0] ?? null;
}

function NextClassCard({ booking }: { booking: ApiBooking }) {
  const [qrOpen, setQrOpen] = useState(false);
  const closeQr = useCallback(() => setQrOpen(false), []);

  const attended = booking.check_in_state === "attended";
  const running = new Date(booking.starts_at).getTime() <= Date.now();
  const when = `${formatDate(booking.starts_at)} · ${formatClassTime(booking.starts_at)}`;

  return (
    <section
      data-testid="next-class-card"
      aria-labelledby="next-class-heading"
      className="relative mb-6 overflow-hidden rounded-2xl bg-accent text-inverse p-5 sm:p-6 shadow-hover"
    >
      {/* The perforation between stub and ticket: two notches and a dashed
          seam, so the card reads as the ticket it stands in for. */}
      {/* Centred in the gap after the stub: padding + stub width + half the gap. */}
      <span aria-hidden className="pointer-events-none absolute left-[4.75rem] sm:left-[5.125rem] -top-2.5 h-5 w-5 rounded-full bg-paper" />
      <span aria-hidden className="pointer-events-none absolute left-[4.75rem] sm:left-[5.125rem] -bottom-2.5 h-5 w-5 rounded-full bg-paper" />
      <span aria-hidden className="pointer-events-none absolute left-[5.375rem] sm:left-[5.75rem] top-5 bottom-5 border-l border-dashed border-inverse/25" />

      <div className="flex gap-5 sm:gap-6">
        <DateStub iso={booking.starts_at} tone="accent" className="bg-inverse/10 self-start" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h2
              id="next-class-heading"
              className="text-[11px] font-bold uppercase tracking-[0.14em] text-inverse/70"
            >
              {running ? "Happening now" : "My next class"}
            </h2>
            {attended && (
              <span
                data-testid="next-class-checked-in"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-inverse/15 px-2.5 py-1 text-xs font-semibold text-inverse"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Checked in
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xl font-extrabold leading-tight break-words">{booking.name}</p>
          <p className="mt-1 text-sm font-semibold text-inverse/90">{formatClassTime(booking.starts_at)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-inverse/75">
            {booking.location && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="break-words">{booking.location.name}</span>
              </span>
            )}
            {booking.instructor && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <UserRound className="h-3.5 w-3.5 shrink-0" />
                <span className="break-words">{booking.instructor.name}</span>
              </span>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        data-testid="next-class-show-qr"
        onClick={() => setQrOpen(true)}
        aria-haspopup="dialog"
        className="mt-5 inline-flex w-full min-h-[48px] items-center justify-center gap-2 rounded-full bg-inverse px-5 text-base font-bold text-accent-deep hover:bg-inverse/90 transition-colors sm:w-auto focus-visible:outline-inverse"
      >
        <QrCode className="h-5 w-5" />
        Show my QR
      </button>

      {qrOpen && (
        <QrFullScreen
          value={booking.qr_token}
          code={booking.code}
          title={booking.name}
          subtitle={booking.location ? `${when} · ${booking.location.name}` : when}
          onClose={closeQr}
        />
      )}
    </section>
  );
}

/**
 * The card, loading the member's bookings itself. `onResolved` hears which
 * booking it settled on (or null), so a list beside it can leave that one out.
 */
export function MyNextClass({
  onResolved,
}: {
  onResolved?: (bookingId: string | null) => void;
} = {}) {
  const api = useApi();
  const { isSignedIn } = useMemberSession();
  const [booking, setBooking] = useState<ApiBooking | null>(null);

  const resolvedId = booking?.booking_id ?? null;
  useEffect(() => {
    onResolved?.(resolvedId);
  }, [onResolved, resolvedId]);

  useEffect(() => {
    if (!isSignedIn) {
      setBooking(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [upcoming, past] = await Promise.all([
          api.get<{ bookings: ApiBooking[] }>("/me/bookings/upcoming"),
          api.get<{ bookings: ApiBooking[] }>("/me/bookings/past"),
        ]);
        if (!cancelled) setBooking(nextClass(upcoming.bookings ?? [], past.bookings ?? [], Date.now()));
      } catch (err) {
        // The card is an extra on a page that works without it: say nothing.
        reportError(err, { scope: "next-class" });
        if (!cancelled) setBooking(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, isSignedIn]);

  if (!isSignedIn || !booking) return null;
  return <NextClassCard booking={booking} />;
}
