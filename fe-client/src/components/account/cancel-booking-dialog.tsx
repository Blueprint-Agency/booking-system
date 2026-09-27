"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import type { ApiBooking } from "@/components/account/class-bookings";
import { apiErrorCode as errCode, useApi } from "@/lib/api";
import { ERROR_CODES } from "@/lib/error-codes";
import { formatDate } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import { useClientPackages } from "@/lib/use-client-packages";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { CancellationPolicy } from "@/lib/cancellation-policy";
import {
  classCancelNotice,
  classCancelResult,
  isLate,
  type CancelPreview,
} from "@/lib/cancellation-copy";

/** What the member is told once the dialog closes, and what the list should do. */
export interface CancelOutcome {
  tone: "ok" | "warn" | "error";
  text: string;
  /** The booking is gone: drop it from the list. */
  cancelled: boolean;
  /** The server refused on a state the list got wrong: re-read it. */
  stale: boolean;
}

/**
 * "Cancel this booking?" — the one class cancel, asked from My Classes and the
 * account overview alike, so both say the same thing about the credit.
 *
 * On opening it reads the booking's `cancel_preview`: the server's own answer
 * to what this cancel would do — late or not, credit back or not, the cap
 * included — so the member is told before they confirm (#318).
 */
export function CancelBookingDialog({
  booking,
  policy,
  onDone,
  onClose,
}: {
  booking: ApiBooking;
  policy: CancellationPolicy | null;
  onDone: (outcome: CancelOutcome) => void;
  onClose: () => void;
}) {
  const api = useApi();
  const { refetch: refetchPackages } = useClientPackages();
  const [cancelling, setCancelling] = useState(false);
  // Undefined while it loads; null once read with nothing to preview, or if the read failed.
  const [preview, setPreview] = useState<CancelPreview | null | undefined>(undefined);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);

  useEffect(() => {
    let gone = false;
    api
      .get<{ cancel_preview: CancelPreview | null }>(`/me/bookings/${booking.booking_id}`)
      .then((b) => {
        if (!gone) setPreview(b.cancel_preview);
      })
      .catch(() => {
        // The dialog states the whole rule instead; the cancel itself is the server's call.
        if (!gone) setPreview(null);
      });
    return () => {
      gone = true;
    };
  }, [api, booking.booking_id]);

  async function confirm() {
    setCancelling(true);
    let outcome: CancelOutcome;
    try {
      const res = await api.del<{ refund_outcome: string; refund_fired: boolean }>(
        `/me/bookings/${booking.booking_id}`,
      );
      const late = preview?.late || isLate(booking.cancel_deadline);
      outcome = {
        ...classCancelResult(res.refund_outcome, booking.credits_used, late),
        cancelled: true,
        stale: false,
      };
      await refetchPackages();
    } catch (err) {
      const code = errCode(err);
      const refused = { tone: "error" as const, cancelled: false, stale: true };
      if (code === ERROR_CODES.class_started) {
        outcome = { ...refused, text: "This class has already started, so it can no longer be cancelled." };
      } else if (code === ERROR_CODES.not_cancellable) {
        outcome = { ...refused, text: "This booking can no longer be cancelled." };
      } else {
        outcome = { ...refused, stale: false, text: "Couldn't cancel this booking. Please try again." };
      }
    }
    setCancelling(false);
    onDone(outcome);
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink/40 p-3 sm:p-4"
        onClick={() => !cancelling && onClose()}
      >
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-booking-title"
          tabIndex={-1}
          className="w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl bg-card p-6 shadow-modal outline-none animate-fade-up"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && !cancelling && onClose()}
        >
          <h3 id="cancel-booking-title" className="text-lg font-bold text-ink">Cancel this booking?</h3>
          <p className="mt-1 text-sm text-muted">
            {booking.name} · {formatDate(booking.starts_at)} · {formatClassTime(booking.starts_at)}
          </p>
          <div
            className={
              // Amber whenever the credit stays spent: late, or over the cap.
              preview && !preview.unlimited && (preview.late || !preview.credit_back)
                ? "mt-4 rounded-xl bg-warning/10 p-3 text-sm font-medium text-ink"
                : "mt-4 rounded-xl bg-ink/[0.04] p-3 text-sm text-ink"
            }
            aria-live="polite"
          >
            {preview === undefined ? (
              <span className="inline-flex items-center gap-1.5 text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking your credit…
              </span>
            ) : (
              classCancelNotice(policy, booking.was_unlimited, preview, booking.effective_cancel_window_hours)
            )}
          </div>
          <div className="mt-6 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
            <button
              onClick={onClose}
              disabled={cancelling}
              className="flex-1 min-h-[48px] rounded-full border border-ink/10 px-4 text-sm font-semibold hover:border-ink/30 transition-colors disabled:opacity-60"
            >
              Keep booking
            </button>
            <button
              onClick={confirm}
              disabled={cancelling || preview === undefined}
              className="flex-1 min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-full bg-error px-4 text-sm font-semibold text-inverse hover:bg-error/90 transition-colors disabled:opacity-70 disabled:cursor-wait"
            >
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              {cancelling ? "Cancelling…" : "Confirm cancellation"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
