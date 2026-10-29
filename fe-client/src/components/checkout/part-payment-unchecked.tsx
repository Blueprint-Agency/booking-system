"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Where Part Payment would be offered, when the studio's checkout options could
 * not be read (#500): the app does not know whether this payment can be split,
 * so it says so and offers no split — and never hides it silently, which would
 * tell a member who meant to split that the studio does not allow it. Paying
 * the whole Balance stays available beside it.
 */
export function PartPaymentUnchecked({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-ink/10 bg-warm px-3.5 py-3 text-xs text-ink",
        className,
      )}
    >
      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        We couldn&apos;t check whether this payment can be split. You can still pay it in full.
      </span>
      <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
        Try again
      </button>
    </div>
  );
}
