"use client";

import { Loader2, MapPin, UserRound } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  NOTE,
  SHEET_ACTIONS,
  SHEET_BACKDROP,
  SHEET_HANDLE,
  SHEET_PANEL,
  SHEET_TEXT,
  SHEET_TITLE,
} from "@/components/ui/styles";
import { formatDate } from "@/lib/utils";
import { formatClassTime, type ApiClassCard } from "@/lib/classes";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useCancellationPolicy } from "@/lib/cancellation-policy";
import { classBookingPolicy } from "@/lib/cancellation-copy";

/**
 * "Book this class?" — asked before a booking spends anything, so a stray tap
 * on a row never costs a credit. States what the booking costs and how late it
 * can be cancelled, the two things a member can't take back by closing the tab.
 */
export function ConfirmBookingSheet({
  cls,
  cost,
  booking,
  onConfirm,
  onClose,
}: {
  cls: ApiClassCard;
  /** What pays, as the row words it: "Uses 1 credit", "Covered by your plan". */
  cost: string;
  booking: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);
  const policy = useCancellationPolicy();
  const close = () => !booking && onClose();

  return (
    <Portal>
      <div className={SHEET_BACKDROP} onClick={close}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`confirm-book-${cls.id}`}
          tabIndex={-1}
          className={SHEET_PANEL}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && close()}
        >
          <span aria-hidden className={SHEET_HANDLE} />
          <h3 id={`confirm-book-${cls.id}`} className={SHEET_TITLE}>
            Book {cls.class_type.name}?
          </h3>
          <p className="mt-1 text-sm font-medium text-ink/80 tabular-nums">
            {formatDate(cls.starts_at)} · {formatClassTime(cls.starts_at)} – {formatClassTime(cls.ends_at)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {cls.location && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {cls.location.name}
              </span>
            )}
            <span className="inline-flex items-center gap-1 min-w-0">
              <UserRound className="h-3.5 w-3.5 shrink-0" />
              {cls.instructor.name}
            </span>
          </div>
          <p className={`${NOTE} mt-4 font-semibold`}>{cost}</p>
          {policy && <p className={SHEET_TEXT}>{classBookingPolicy(policy)}</p>}
          <div className={SHEET_ACTIONS}>
            <button type="button" onClick={close} disabled={booking} className={BTN_SECONDARY}>
              Not now
            </button>
            <button type="button" onClick={onConfirm} disabled={booking} className={BTN_PRIMARY}>
              {booking && <Loader2 className="h-4 w-4 animate-spin" />}
              {booking ? "Booking…" : "Book class"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
