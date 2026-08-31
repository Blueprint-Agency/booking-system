import { pino } from 'pino'
import { env } from '../env'
import { captureException } from '../instrument'

/**
 * Centralized structured logger (Pino).
 *
 * - In production we emit newline-delimited JSON to stdout. On the VPS, Docker
 *   captures stdout, so `docker compose logs -f booking-be` is the live feed and
 *   the json-file logging driver (with rotation) is the persistent store.
 * - In development we pretty-print via pino-pretty for readability.
 *
 * Every log line carries `service` so logs stay attributable if they're ever
 * shipped to a shared backend (New Relic / Grafana / Loki) later. Per-request
 * logs additionally carry `requestId` — see middleware/logger.ts.
 */
const isProd = env.NODE_ENV === 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  // The platform, not a studio — one backend serves every tenant, so a log line
  // is tagged with the service and the request's own `tenantId`, never a name.
  base: { service: 'reservetoday-be' },
  // Render `level` as its label ("info") instead of the numeric code (30) so
  // the raw JSON is human-readable in `docker logs`.
  formatters: {
    level: label => ({ level: label }),
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname,service',
          },
        },
      }),
})

export type Logger = typeof logger

/**
 * The swallowed-error pair, written once: log the error OBJECT (Pino serialises
 * its stack — a flattened `err.message` throws that away) and report it to the
 * error monitor, exactly as middleware/error.ts and jobs/index.ts already do.
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
  captureException(err, context)
}
