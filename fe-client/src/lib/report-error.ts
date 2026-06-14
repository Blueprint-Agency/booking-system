import * as Sentry from "@sentry/nextjs";

/**
 * Single entry point for reporting client-side errors.
 *
 * Logs to the console (visible in dev / Vercel function logs) AND forwards to
 * Sentry. `Sentry.captureException` is a safe no-op when Sentry isn't
 * configured (no NEXT_PUBLIC_SENTRY_DSN), so this is always safe to call.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.error("[client-error]", error, context ?? {});
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
