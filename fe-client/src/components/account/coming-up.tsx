"use client";

/**
 * "Coming up" on the account overview: the next class as the ticket, and
 * everything after it — bookings and places in line alike — as one row of
 * cards the member swipes through. Sideways rather than down, so three
 * bookings cost a phone the same height as one.
 *
 * Tapping a card opens its sheet, where the QR and the cancel (or, for a
 * waitlist place, the leave) live. The ticket carries its own QR and cancel.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Hourglass, MapPin, QrCode, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Portal } from "@/components/ui/portal";
import { ContentLoading } from "@/components/ui/content-loading";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD,
  SHEET_BACKDROP,
  SHEET_HANDLE,
  SHEET_PANEL,
  SHEET_TEXT,
  SHEET_TITLE,
} from "@/components/ui/styles";
import { DateStub } from "@/components/account/date-stub";
import { NextClassCard, nextClass } from "@/components/account/next-class-card";
import { QrFullScreen } from "@/components/account/qr-badge";
import { CancelBookingDialog, type CancelOutcome } from "@/components/account/cancel-booking-dialog";
import { LeaveWaitlistDialog } from "@/components/booking/leave-waitlist-dialog";
import type { ApiBooking } from "@/components/account/class-bookings";
import { ApiError, apiErrorCode as errCode, useApi } from "@/lib/api";
import { formatClassTime } from "@/lib/classes";
import { cn, formatDate } from "@/lib/utils";
import { reportError } from "@/lib/report-error";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useCancellationPolicy, type CancellationPolicy } from "@/lib/cancellation-policy";
import { cancelClosed, canStillCancel } from "@/lib/cancellation-copy";
import {
  leaveWaitlist,
  listWaitlist,
  waitlistRefusal,
  type ApiWaitlistEntry,
} from "@/lib/waitlist";

type Item =
  | { kind: "booking"; id: string; starts_at: string; booking: ApiBooking }
  | { kind: "waitlist"; id: string; starts_at: string; entry: ApiWaitlistEntry };

/**
 * Whether the member can still cancel this themselves. Until the studio's
 * window is known, anything not yet started, and the server decides.
 */
function cancellable(b: ApiBooking, policy: CancellationPolicy | null): boolean {
  return policy
    ? canStillCancel(b.starts_at, policy.class_window_hours)
    : new Date(b.starts_at).getTime() > Date.now();
}

function when(iso: string): string {
  return `${formatDate(iso)} · ${formatClassTime(iso)}`;
}

export function ComingUp() {
  const api = useApi();
  const policy = useCancellationPolicy();
  const [loading, setLoading] = useState(true);
  const [featured, setFeatured] = useState<ApiBooking | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<Item | null>(null);
  const [qrFor, setQrFor] = useState<ApiBooking | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ApiBooking | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<ApiWaitlistEntry | null>(null);
  const [leaving, setLeaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      // Only the bookings are essential: a failed past or waitlist read must not
      // blank the member's confirmed classes into "No classes booked yet".
      const optional = <T,>(p: Promise<T>, fallback: T, scope: string) =>
        p.catch((err) => {
          reportError(err, { scope });
          return fallback;
        });
      const [upcoming, past, waitlist] = await Promise.all([
        api.get<{ bookings: ApiBooking[] }>("/me/bookings/upcoming"),
        optional(api.get<{ bookings: ApiBooking[] }>("/me/bookings/past"), { bookings: [] }, "coming-up-past"),
        optional(listWaitlist(api), [] as ApiWaitlistEntry[], "coming-up-waitlist"),
      ]);
      const next = nextClass(upcoming.bookings ?? [], past.bookings ?? [], Date.now());
      const rest: Item[] = [
        ...(upcoming.bookings ?? [])
          .filter((b) => b.state === "confirmed" && b.booking_id !== next?.booking_id)
          .map((b) => ({ kind: "booking" as const, id: b.booking_id, starts_at: b.starts_at, booking: b })),
        ...waitlist.map((e) => ({ kind: "waitlist" as const, id: e.id, starts_at: e.starts_at, entry: e })),
      ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      setFeatured(next);
      setItems(rest);
    } catch (err) {
      reportError(err, { scope: "coming-up" });
      setFeatured(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onCancelled(outcome: CancelOutcome) {
    setCancelTarget(null);
    const say = outcome.tone === "ok" ? toast.success : outcome.tone === "warn" ? toast.warning : toast.error;
    say(outcome.text);
    if (outcome.cancelled || outcome.stale) await reload();
  }

  async function confirmLeave() {
    if (!leaveTarget) return;
    setLeaving(true);
    try {
      await leaveWaitlist(api, leaveTarget.id);
      toast.success("Left the waitlist.");
    } catch (err) {
      const out = waitlistRefusal(errCode(err), err instanceof ApiError ? err.body : null);
      toast.error(out?.kind === "message" ? out.msg : "Couldn't leave the waitlist. Please try again.");
    } finally {
      setLeaving(false);
      setLeaveTarget(null);
      // Everyone behind the member moves up, so positions are re-read, not guessed.
      await reload();
    }
  }

  const hasAny = featured !== null || items.length > 0;

  return (
    <section aria-labelledby="coming-up" className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="coming-up" className="text-base font-bold text-ink">
          Coming up
        </h2>
        {hasAny && (
          <Link
            href="/account/classes"
            className="inline-flex items-center gap-0.5 text-sm font-semibold text-accent-deep hover:text-accent"
          >
            All classes
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {loading ? (
        <ContentLoading label="Loading upcoming classes" className="min-h-32" />
      ) : !hasAny ? (
        <div className={cn(CARD, "flex items-center justify-between gap-3 p-4")}>
          <p className="text-sm text-muted">No classes booked yet.</p>
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent-deep hover:text-accent"
          >
            Book a class
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <>
          {featured && (
            <NextClassCard
              booking={featured}
              className={items.length > 0 ? "mb-3" : "mb-0"}
              onCancel={cancellable(featured, policy) ? () => setCancelTarget(featured) : undefined}
            />
          )}

          {items.length > 0 && (
            // Runs to the screen edge on a phone, so the card cut off at the
            // right says there is more to swipe to.
            <ul
              aria-label={featured ? "Also coming up" : "Coming up"}
              className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0 md:scroll-px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {items.map((item) => (
                <li key={`${item.kind}-${item.id}`} className="w-[15.5rem] shrink-0 snap-start">
                  <ItemCard item={item} onOpen={() => setOpen(item)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {open && (
        <ItemSheet
          item={open}
          policy={policy}
          onClose={() => setOpen(null)}
          onShowQr={(b) => {
            setOpen(null);
            setQrFor(b);
          }}
          onCancel={(b) => {
            setOpen(null);
            setCancelTarget(b);
          }}
          onLeave={(e) => {
            setOpen(null);
            setLeaveTarget(e);
          }}
        />
      )}

      {qrFor && (
        <QrFullScreen
          value={qrFor.qr_token}
          code={qrFor.code}
          title={qrFor.name}
          subtitle={qrFor.location ? `${when(qrFor.starts_at)} · ${qrFor.location.name}` : when(qrFor.starts_at)}
          onClose={() => setQrFor(null)}
        />
      )}

      {cancelTarget && (
        <CancelBookingDialog
          booking={cancelTarget}
          policy={policy}
          onDone={onCancelled}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {leaveTarget && (
        <LeaveWaitlistDialog
          classTitle={leaveTarget.name}
          startsAt={leaveTarget.starts_at}
          position={leaveTarget.position}
          leaving={leaving}
          onConfirm={confirmLeave}
          onClose={() => setLeaveTarget(null)}
        />
      )}
    </section>
  );
}

function ItemCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const waitlisted = item.kind === "waitlist";
  const name = waitlisted ? item.entry.name : item.booking.name;
  const place = waitlisted ? item.entry.location : item.booking.location?.name ?? null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn(
        "flex h-full w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-soft transition-colors",
        waitlisted ? "border-warning/40 hover:border-warning" : "border-ink/5 hover:border-accent/30",
      )}
    >
      <DateStub iso={item.starts_at} tone={waitlisted ? "muted" : "default"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{name}</span>
        <span className="block text-sm text-ink/80 tabular-nums">{formatClassTime(item.starts_at)}</span>
        {waitlisted ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-ink">
            <Hourglass className="h-3 w-3 text-ink/50" aria-hidden />
            Waitlist · #{item.entry.position}
          </span>
        ) : (
          place && <span className="block truncate text-xs text-muted">{place}</span>
        )}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
    </button>
  );
}

function ItemSheet({
  item,
  policy,
  onClose,
  onShowQr,
  onCancel,
  onLeave,
}: {
  item: Item;
  policy: CancellationPolicy | null;
  onClose: () => void;
  onShowQr: (b: ApiBooking) => void;
  onCancel: (b: ApiBooking) => void;
  onLeave: (e: ApiWaitlistEntry) => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);

  const name = item.kind === "booking" ? item.booking.name : item.entry.name;
  const instructor = item.kind === "booking" ? item.booking.instructor?.name : item.entry.instructor;
  const place = item.kind === "booking" ? item.booking.location?.name : item.entry.location;

  return (
    <Portal>
      <div className={SHEET_BACKDROP} onClick={onClose}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="coming-up-sheet-title"
          tabIndex={-1}
          className={SHEET_PANEL}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        >
          <span aria-hidden className={SHEET_HANDLE} />
          <h3 id="coming-up-sheet-title" className={SHEET_TITLE}>
            {name}
          </h3>
          <p className="mt-1 text-sm font-medium text-ink/80">{when(item.starts_at)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {place && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {place}
              </span>
            )}
            {instructor && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <UserRound className="h-3.5 w-3.5 shrink-0" />
                {instructor}
              </span>
            )}
          </div>

          {item.kind === "booking" ? (
            <>
              <p className="mt-4 text-xs text-muted">
                Booking code <span className="font-mono tracking-wide text-ink">{item.booking.code}</span>
              </p>
              <div className="mt-5 flex flex-col gap-2">
                <button type="button" onClick={() => onShowQr(item.booking)} className={BTN_PRIMARY}>
                  <QrCode className="h-4 w-4" />
                  Show my QR
                </button>
                {cancellable(item.booking, policy) ? (
                  <button
                    type="button"
                    onClick={() => onCancel(item.booking)}
                    className={cn(BTN_SECONDARY, "text-error hover:border-error/40")}
                  >
                    Cancel booking
                  </button>
                ) : (
                  <p className="text-center text-xs text-muted">
                    {policy ? cancelClosed(policy.class_window_hours) : "Cancellation closed"}
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <p className={SHEET_TEXT}>
                You&apos;re #{item.entry.position} in line. If a seat opens, we&apos;ll book you in and
                email you.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                <button type="button" onClick={onClose} className={BTN_PRIMARY}>
                  Stay in line
                </button>
                <button
                  type="button"
                  onClick={() => onLeave(item.entry)}
                  className={cn(BTN_SECONDARY, "text-error hover:border-error/40")}
                >
                  Leave waitlist
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}
