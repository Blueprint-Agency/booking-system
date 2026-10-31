"use client";
import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { loadFailureSentence } from "@/lib/failed-read";
import { cn } from "@/lib/utils";

/**
 * What a screen draws when a read failed: what couldn't be loaded, and Try
 * again. It is the portal's one such line.
 *
 * - `block` (the default) stands in place of a list, a count or a form, instead
 *   of the empty state, never beside it.
 * - `inline` is a warning strip for a part of a screen that can stand without
 *   the read, or for a refresh that failed while what loaded earlier is still
 *   drawn beneath it.
 *
 * `what` completes "Couldn't load …": "the bookings", "the studio list". Each
 * Try again names it too, so two on one screen can be told apart.
 */
export function LoadFailure({
  what,
  onRetry,
  detail,
  variant = "block",
  sentence,
  className,
}: {
  what: string;
  onRetry: () => Promise<unknown> | void;
  /** Why, when the backend said (a switch turned off, say). */
  detail?: string;
  variant?: "block" | "inline";
  /** Replaces "Couldn't load {what}." where that verb is wrong ("Couldn't search members."). */
  sentence?: string;
  className?: string;
}) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  const inline = variant === "inline";
  return (
    <div
      role={inline ? "status" : "alert"}
      className={cn(
        inline
          ? "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink"
          : "flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 py-8 text-sm text-ink",
        className,
      )}
    >
      <AlertCircle className={cn("shrink-0", inline ? "h-3.5 w-3.5 text-warning" : "h-4 w-4 text-error")} aria-hidden />
      <span>{sentence ?? loadFailureSentence(what)}</span>
      {detail && <span className="text-muted">{detail}</span>}
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        aria-label={sentence ? `Try ${what} again` : `Try loading ${what} again`}
        className="inline-flex min-h-[32px] items-center gap-1.5 font-semibold underline underline-offset-2 disabled:opacity-60"
      >
        {retrying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        Try again
      </button>
    </div>
  );
}
