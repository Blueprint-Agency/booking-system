"use client";
import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { loadFailureSentence } from "@/lib/failed-read";
import { cn } from "@/lib/utils";

/**
 * What a screen draws in place of a list, a count or a form when its read
 * failed: what couldn't be loaded, and Try again. Drawn instead of the empty
 * state, never beside it.
 *
 * `what` completes "Couldn't load …": "the bookings", "the studio list".
 */
export function LoadFailure({
  what,
  onRetry,
  className,
}: {
  what: string;
  onRetry: () => Promise<unknown> | void;
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

  return (
    <div
      role="alert"
      className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 py-8 text-sm text-ink", className)}
    >
      <AlertCircle className="h-4 w-4 shrink-0 text-error" aria-hidden />
      <span>{loadFailureSentence(what)}</span>
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
