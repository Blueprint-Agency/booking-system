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
  const when = `${formatDate(booking.starts_at)} · ${formatClassTime(booking.starts_at)}`;

  return (
    <section
      data-testid="next-class-card"
      aria-labelledby="next-class-heading"
      className="mb-6 rounded-2xl bg-paper border border-accent/30 p-5 sm:p-6 shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          id="next-class-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted"
        >
          My next class
        </h2>
        {attended && (
          <span
            data-testid="next-class-checked-in"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sage/15 px-2.5 py-1 text-xs font-medium text-sage"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Checked in
          </span>
        )}
      </div>
      <p className="mt-2 text-lg font-semibold text-ink break-words">{booking.name}</p>
      <p className="mt-1 text-sm font-medium text-ink">{when}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {booking.location && (
          <span className="inline-flex items-center gap-1 min-w-0">
            <MapPin className="h-4 w-4 shrink-0 text-ink/30" />
            <span className="break-words">{booking.location.name}</span>
          </span>
        )}
        {booking.instructor && (
          <span className="inline-flex items-center gap-1 min-w-0">
            <UserRound className="h-4 w-4 shrink-0 text-ink/30" />
            <span className="break-words">{booking.instructor.name}</span>
          </span>
        )}
      </div>
      <button
        type="button"
        data-testid="next-class-show-qr"
        onClick={() => setQrOpen(true)}
        aria-haspopup="dialog"
        className="mt-4 inline-flex w-full min-h-[48px] items-center justify-center gap-2 rounded-full bg-accent px-5 text-base font-medium text-white hover:bg-accent-deep transition-colors sm:w-auto"
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

/** The card, loading the member's bookings itself. */
export function MyNextClass() {
  const api = useApi();
  const { isSignedIn } = useMemberSession();
  const [booking, setBooking] = useState<ApiBooking | null>(null);

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
