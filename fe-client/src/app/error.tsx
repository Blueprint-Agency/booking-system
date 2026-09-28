"use client";

import { useEffect } from "react";
import Link from "next/link";
import { reportError } from "@/lib/report-error";

/**
 * Route-segment error boundary. Catches runtime errors thrown while rendering
 * any page under the app and shows a recoverable fallback instead of a blank
 * screen. `retry()` re-fetches and re-renders the segment (`reset()` only
 * re-renders, so a page whose server payload failed would fail again).
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportError(error, { boundary: "route", digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-muted">Error</p>
        <h1 className="mt-3 text-2xl font-extrabold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          An unexpected error occurred. You can try again, or head back home.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-muted">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-deep dark:hover:bg-accent/85"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-border bg-card px-6 text-sm font-medium text-ink transition-colors hover:bg-paper"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
