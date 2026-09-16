import { AppError } from '../middleware/error'
import { ERROR_CODES } from '../shared/error-codes'
import { logger } from '../shared/logger'

/**
 * The one door every call to a vendor goes through: Stripe, object storage and
 * Resend (which also carries Better Auth's mail).
 *
 * A vendor that stops answering must not hold a member's request open, so each
 * call runs under a short deadline and ends in one of three ways — `ok`,
 * `timeout`, `error` — with one log line saying which vendor, which operation,
 * how long it took and how it ended. A timed-out call rejects with
 * `VendorTimeoutError`, a 503 the client can retry, rather than a spinner.
 *
 * The call is handed an `AbortSignal` that fires at the deadline. Pass it on
 * where the SDK takes one (the S3 client does); where it does not, the SDK's own
 * timeout is set to the same figure at construction, and the deadline here
 * governs either way.
 *
 * Retry is off unless asked for, and only webhook handlers and cron steps ask.
 * A route that retried would multiply its own deadline. The mail send gate has
 * its own backoff that honours `retry-after`, so the Resend call never asks.
 */

export type Vendor = 'stripe' | 'storage' | 'resend'
export type OutboundOutcome = 'ok' | 'timeout' | 'error'

/** Catalogued error code for a vendor that did not answer in time. */
export const VENDOR_TIMEOUT = ERROR_CODES.vendor_timeout

/** Per vendor, and short: request paths wait on these. */
export const VENDOR_DEADLINE_MS: Record<Vendor, number> = {
  stripe: 8_000,
  storage: 8_000,
  resend: 5_000,
}

export class VendorTimeoutError extends AppError {
  constructor(
    readonly vendor: Vendor,
    readonly op: string,
    readonly deadlineMs: number,
  ) {
    super(503, VENDOR_TIMEOUT, { vendor, retryable: true })
  }
}

export interface RetryPolicy {
  /** Total tries, first included. */
  attempts: number
  baseMs?: number
  capMs?: number
}

/** For webhook handlers and cron steps. Never on a route. */
export const OFF_REQUEST_RETRY: RetryPolicy = { attempts: 3, baseMs: 500, capMs: 4_000 }

export interface OutboundOptions {
  deadlineMs?: number
  retry?: RetryPolicy
}

export interface OutboundLine {
  vendor: Vendor
  op: string
  ms: number
  outcome: OutboundOutcome
  attempt: number
  err?: unknown
}

export interface OutboundDeps {
  now: () => number
  /** Resolves after `ms`; the fake clock in tests. */
  sleep: (ms: number) => Promise<void>
  random: () => number
  log: (line: OutboundLine) => void
}

export type Outbound = <T>(
  vendor: Vendor,
  op: string,
  call: (signal: AbortSignal) => Promise<T>,
  options?: OutboundOptions,
) => Promise<T>

export function createOutbound(deps: OutboundDeps): Outbound {
  const { now, sleep, random, log } = deps

  async function once<T>(
    vendor: Vendor,
    op: string,
    call: (signal: AbortSignal) => Promise<T>,
    deadlineMs: number,
    attempt: number,
  ): Promise<T> {
    const started = now()
    const controller = new AbortController()
    let settled = false
    let timedOut = false
    const deadline = sleep(deadlineMs).then(() => {
      // A deadline that outlives its call does nothing.
      if (settled) return new Promise<never>(() => {})
      timedOut = true
      controller.abort()
      throw new VendorTimeoutError(vendor, op, deadlineMs)
    })
    try {
      const result = await Promise.race([call(controller.signal), deadline])
      settled = true
      log({ vendor, op, ms: now() - started, outcome: 'ok', attempt })
      return result
    } catch (err) {
      settled = true
      if (timedOut) {
        log({ vendor, op, ms: now() - started, outcome: 'timeout', attempt })
        throw err instanceof VendorTimeoutError ? err : new VendorTimeoutError(vendor, op, deadlineMs)
      }
      log({ vendor, op, ms: now() - started, outcome: 'error', attempt, err })
      throw err
    }
  }

  return async function outbound(vendor, op, call, options = {}) {
    const deadlineMs = options.deadlineMs ?? VENDOR_DEADLINE_MS[vendor]
    const retry = options.retry
    const attempts = Math.max(1, retry?.attempts ?? 1)
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(vendor, op, call, deadlineMs, attempt)
      } catch (err) {
        if (attempt >= attempts || !retryable(err)) throw err
        const ceiling = Math.min(retry?.capMs ?? 4_000, (retry?.baseMs ?? 500) * 2 ** (attempt - 1))
        await sleep(ceiling / 2 + random() * (ceiling / 2))
      }
    }
  }
}

/**
 * Worth trying again: a timeout, a network failure, a 429 or a 5xx. A 4xx is a
 * problem with the request, and asking again gets the same answer.
 */
export function retryable(err: unknown): boolean {
  if (err instanceof VendorTimeoutError) return true
  const e = err as { statusCode?: unknown; $metadata?: { httpStatusCode?: unknown } } | null
  const status = e?.statusCode ?? e?.$metadata?.httpStatusCode
  if (typeof status !== 'number') return true
  return status === 429 || status >= 500
}

/** A timer the deadline can race without keeping the process alive. */
function realSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms).unref())
}

export const outbound: Outbound = createOutbound({
  now: Date.now,
  sleep: realSleep,
  random: Math.random,
  log: ({ err, ...line }) => {
    if (line.outcome === 'ok') logger.info(line, 'outbound call')
    else logger.warn({ ...line, ...(err ? { err } : {}) }, 'outbound call')
  },
})
