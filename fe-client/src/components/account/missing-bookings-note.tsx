"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { missingSentence, type BookingKind } from "@/lib/booking-gaps";
import { cn } from "@/lib/utils";

/**
 * The one line a page of bookings draws above its list when some kinds could
 * not be read (#500): which ones, and Try again, which re-reads them all in
 * place. What did load is drawn beneath it. Draws nothing when none is missing.
 *
 * `text` puts the page's own words in the sentence's place ("Some of your
 * bookings couldn't be checked, so this may not be your next one." on Up next).
 */
export function MissingBookingsNote({
  missing,
  onRetry,
  text,
  className,
}: {
  missing: readonly BookingKind[];
  onRetry: () => Promise<unknown> | void;
  /** Overrides the sentence naming the missing kinds. */
  text?: string;
  className?: string;
}) {
  const [retrying, setRetrying] = useState(false);
  const sentence = missing.length === 0 ? null : (text ?? missingSentence(missing));
  if (!sentence) return null;

  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink",
        className,
      )}
    >
      <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">{sentence}</span>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        className="inline-flex min-h-[32px] items-center gap-1.5 font-semibold underline underline-offset-2 disabled:opacity-60"
      >
        {retrying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        Try again
      </button>
    </div>
  );
}
