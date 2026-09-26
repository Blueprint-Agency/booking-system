"use client";

import { Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { formatClassTime } from "@/lib/classes";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { Portal } from "@/components/ui/portal";

/**
 * "Leave this waitlist?" — asked from the class row and from My Bookings alike.
 * Leaving costs nothing, but a place given up cannot be taken back: joining
 * again goes to the end of the line.
 */
export function LeaveWaitlistDialog({
  classTitle,
  startsAt,
  position,
  leaving,
  onConfirm,
  onClose,
}: {
  /** The class's name, as the member knows it. */
  classTitle: string;
  startsAt: string;
  position: number;
  leaving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);
  return (
    <Portal>
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={() => !leaving && onClose()}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Leave this waitlist?"
        tabIndex={-1}
        className="w-full max-w-sm max-h-[85dvh] overflow-y-auto rounded-2xl bg-paper p-6 sm:p-8 shadow-modal outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-serif text-xl text-ink leading-snug">Leave this waitlist?</h3>
        <p className="mt-1 text-sm text-muted">
          {classTitle} · {formatDate(startsAt)} · {formatClassTime(startsAt)}
        </p>
        <p className="mt-4 rounded-xl border border-ink/10 bg-warm p-3 text-sm text-ink">
          You&apos;re #{position} in line. If you join again later, you&apos;ll go to the end of the line.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={leaving}
            className="flex-1 min-h-[44px] rounded-full border border-ink/10 px-4 text-sm font-medium hover:border-accent transition-colors disabled:opacity-60"
          >
            Stay in line
          </button>
          <button
            onClick={onConfirm}
            disabled={leaving}
            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-full bg-error px-4 text-sm font-medium text-paper hover:bg-error/90 transition-colors disabled:opacity-70 disabled:cursor-wait"
          >
            {leaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {leaving ? "Leaving…" : "Leave waitlist"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
