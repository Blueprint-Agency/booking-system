"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { BookingRow } from "@/components/account/booking-cards";
import { BookedClassOverlay } from "@/components/account/booked-class-overlay";
import { CancelBookingDialog } from "@/components/account/cancel-booking-dialog";
import type { ApiBooking } from "@/components/account/class-bookings";
import { Portal } from "@/components/ui/portal";
import {
  OVERLAY_BACKDROP_CENTRED,
  OVERLAY_BODY,
  OVERLAY_HEADER,
  OVERLAY_PANEL_CENTRED,
} from "@/components/ui/styles";
import { useApi } from "@/lib/api";
import { readBookingSources } from "@/lib/booking-sources";
import { ptCancelResult } from "@/lib/cancellation-copy";
import { useCancellationPolicy } from "@/lib/cancellation-policy";
import { bookingItems, sessionsOnDay, type BookingSources } from "@/lib/my-bookings";
import { dayTitle } from "@/lib/practice";
import { reportError } from "@/lib/report-error";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useClientPackages } from "@/lib/use-client-packages";
import { useFocusTrap } from "@/lib/use-focus-trap";

/**
 * A day of My activity's month, opened from its tile: the classes and private
 * sessions the member held that day, as the same cards My bookings draws
 * (`BookingRow`) — a class card opens the class's detail, and one still to
 * come can be cancelled here as there. `onChanged` tells the page a booking
 * moved, so its counts are read again.
 */
export function PracticeDayDialog({
  date,
  onClose,
  onChanged,
}: {
  date: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const policy = useCancellationPolicy();
  const { refetch: refetchPackages } = useClientPackages();
  const [src, setSrc] = useState<BookingSources | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ booking: ApiBooking; ongoing: boolean } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ApiBooking | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setSrc(await readBookingSources(api));
    } catch (err) {
      reportError(err, { scope: "practice-day" });
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => (src ? sessionsOnDay(bookingItems(src, Date.now()), date) : null), [src, date]);

  async function changed(text: string) {
    setNote(text);
    onChanged();
    await load();
  }

  // One dialog at a time: the class detail or the cancel prompt stands in for
  // the day while it is open, so focus is never split between two.
  if (cancelTarget) {
    return (
      <CancelBookingDialog
        booking={cancelTarget}
        policy={policy}
        onDone={async (outcome) => {
          setCancelTarget(null);
          if (outcome.cancelled || outcome.stale) await changed(outcome.text);
          else setNote(outcome.text);
        }}
        onClose={() => setCancelTarget(null)}
      />
    );
  }
  if (opened) {
    return (
      <BookedClassOverlay
        booking={opened.booking}
        ongoing={opened.ongoing}
        onCancel={(b) => {
          setOpened(null);
          setCancelTarget(b);
        }}
        onClose={() => setOpened(null)}
      />
    );
  }
  return (
    <DayPanel date={date} onClose={onClose} failed={failed} loading={items === null} retry={load} note={note}>
      {items && items.length === 0 ? (
        <p className="text-sm text-muted">No sessions on this day.</p>
      ) : (
        <ul className="space-y-3">
          {items?.map((i) => (
            <BookingRow
              key={i.key}
              item={i}
              policy={policy}
              onCancelClass={setCancelTarget}
              onOpenClass={(booking, ongoing) => setOpened({ booking, ongoing })}
              onPtCancelled={async (result) => {
                await changed(ptCancelResult(result.refundOutcome, result.refundedSessions).text);
                // A returned session changes the balances, as My bookings re-reads them.
                await refetchPackages();
              }}
            />
          ))}
        </ul>
      )}
    </DayPanel>
  );
}

function DayPanel({
  date,
  onClose,
  failed,
  loading,
  retry,
  note,
  children,
}: {
  date: string;
  onClose: () => void;
  failed: boolean;
  loading: boolean;
  retry: () => Promise<void>;
  note: string | null;
  children: React.ReactNode;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);
  const title = dayTitle(date);

  return (
    <Portal>
      <div className={OVERLAY_BACKDROP_CENTRED} onClick={onClose}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          className={OVERLAY_PANEL_CENTRED}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        >
          <header className={OVERLAY_HEADER}>
            <h2 className="min-w-0 flex-1 text-xl font-bold leading-snug text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>
          <div className={OVERLAY_BODY}>
            {note && (
              <p role="status" className="mb-4 rounded-xl bg-ink/[0.04] px-4 py-3 text-sm text-ink">
                {note}
              </p>
            )}
            {failed ? (
              <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
                We couldn&apos;t load this day.{" "}
                <button type="button" onClick={() => void retry()} className="font-medium underline underline-offset-2">
                  Try again
                </button>
              </div>
            ) : loading ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading your sessions…
              </p>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
