import * as Sentry from '@sentry/node'
import { env } from './env'

/**
 * Error monitoring (Sentry) — OPTIONAL and fully gated on SENTRY_DSN.
 *
 * With no DSN configured this file is a no-op, so the app runs identically
 * whether or not Sentry is set up. To turn it on: create a (free) Sentry
 * project, then set SENTRY_DSN in the environment. Nothing else changes.
 *
 * IMPORTANT: this module is imported FIRST in server.ts (before app/http) so
 * Sentry can auto-instrument the runtime. Keep it dependency-light.
 */
// Report from any deployed environment (staging / production) but NOT local dev,
// where errors are already visible live in your terminal — sending them just
// burns the free quota and adds noise. Driven by APP_ENV (the deployment name),
// which is separate from NODE_ENV (a build flag that stays 'production' on any
// server).
export const sentryEnabled = Boolean(env.SENTRY_DSN) && env.APP_ENV !== 'development'

if (sentryEnabled) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    // Errors only for now. Bump this (0..1) when we add performance tracing
    // in the observability phase.
    tracesSampleRate: 0,
    enableLogs: true,
  })
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : 'Unknown error'
}

/**
 * Report an exception to Sentry with optional structured context. Safe to call
 * unconditionally — it's a no-op when Sentry isn't configured.
 */
export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (!sentryEnabled) return
  Sentry.logger.error(errorMessage(err), context)
  Sentry.captureException(err, context ? { extra: context } : undefined)
}

export { Sentry }
