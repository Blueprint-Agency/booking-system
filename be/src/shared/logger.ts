import { AsyncLocalStorage } from 'node:async_hooks'
import { pino, type DestinationStream } from 'pino'
import { env } from '../env'

/**
 * Centralized structured logger (Pino).
 *
 * - In production we emit newline-delimited JSON to stdout. On the VPS, Docker
 *   captures stdout, so `docker compose logs -f booking-be` is the live feed and
 *   the json-file logging driver (with rotation) is the persistent store.
 * - In development we pretty-print via pino-pretty for readability.
 *
 * Every log line carries `service`, and whatever the **log context** holds at
 * the moment it is written. The context is a per-request (or per-job) store that
 * the middlewares and job wrappers fill in as they learn things, and the root
 * logger reads on every line through Pino's `mixin` — so a service logs with the
 * plain `logger` and its line still says whose request it was.
 *
 * The field names are fixed, because alert rules key on them:
 *
 *   requestId       — the request's id (`x-request-id`), set by middleware/request-id.ts
 *   tenantId        — the resolved Tenant's id, set by middleware/tenant.ts and
 *                     by the per-Tenant job wrapper. An id only, never a slug or a name.
 *   actorId         — the Better Auth user id of the signed-in caller, set by the
 *                     three auth middlewares. Under impersonation, the member's.
 *   pool            — which auth pool that user is in: client | staff | platform
 *   impersonatedBy  — the acting Admin's Better Auth user id, when an impersonation
 *                     grant is present (middleware/client-impersonation.ts)
 *   job             — the cron job's name, set by the wrappers in jobs/index.ts
 *   webhook         — the vendor a webhook came from: stripe | resend
 */
export type LogContext = {
  requestId?: string
  tenantId?: string
  actorId?: string
  pool?: 'client' | 'staff' | 'platform'
  impersonatedBy?: string
  job?: string
  webhook?: 'stripe' | 'resend'
}

const store = new AsyncLocalStorage<LogContext>()

/** Run `fn` with a log context of its own; everything it awaits sees it. */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return store.run({ ...context }, fn)
}

/**
 * Add fields to the current log context. Outside one (a boot-time call, a test)
 * there is nothing to write to, and that is not an error.
 */
export function setLogContext(fields: LogContext): void {
  const current = store.getStore()
  if (current) Object.assign(current, fields)
}

/** The current log context, or an empty one. */
export function logContext(): LogContext {
  return { ...store.getStore() }
}

const isProd = env.NODE_ENV === 'production'

/**
 * Build a root logger. With a `destination` it writes JSON lines there — the
 * integration harness passes an in-memory stream to read what a request logged.
 * Without one it writes to stdout, pretty-printed outside production.
 */
export function createLogger(destination?: DestinationStream) {
  const options = {
    level: env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
    // The platform, not a studio — one backend serves every tenant, so a log line
    // is tagged with the service and the request's own `tenantId`, never a name.
    base: { service: 'reservetoday-be' },
    // Render `level` as its label ("info") instead of the numeric code (30) so
    // the raw JSON is human-readable in `docker logs`.
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    mixin: () => store.getStore() ?? {},
  }
  if (destination) return pino(options, destination)
  if (isProd) return pino(options)
  return pino({
    ...options,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname,service',
      },
    },
  })
}

export type Logger = ReturnType<typeof createLogger>

/**
 * The root logger. A `let`, so the test harness can point it at an in-memory
 * stream (`useLogDestination`) before the app handles its first request;
 * importers read the live binding.
 */
export let logger: Logger = createLogger()

/** Test seam: replace the root logger with one writing to `destination`. */
export function useLogDestination(destination: DestinationStream): void {
  logger = createLogger(destination)
}

/**
 * The swallowed-error helper, written once: log the error OBJECT (Pino
 * serialises its stack — a flattened `err.message` throws that away) with
 * full context, exactly as middleware/error.ts and jobs/index.ts already do.
 *
 * For failures that must NOT undo work which has already committed — a
 * notification that fails after the decision it announces was written. The
 * caller still swallows; this is what stops the swallow being silent.
 */
export function reportError(
  err: unknown,
  message: string,
  context?: Record<string, unknown>,
): void {
  logger.error({ err, ...context }, message)
}
