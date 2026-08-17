"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";
import "./globals.css";

/**
 * Root error boundary — catches errors thrown in the root layout itself, which
 * the per-segment error.tsx cannot. It REPLACES the whole document, so it must
 * render its own <html>/<body>. Rarely triggered, but the last safety net.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { boundary: "global", digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body className="font-sans antialiased bg-paper text-ink">
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold text-ink">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted">
              The console hit an unexpected error. Please try again.
            </p>
            {error.digest && (
              <p className="mt-3 text-xs text-muted">Reference: {error.digest}</p>
            )}
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-deep"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
