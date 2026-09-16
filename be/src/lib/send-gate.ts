import { AsyncResource } from 'node:async_hooks'

/**
 * The one door every email leaves through on its way to Resend.
 *
 * Resend's rate limit is per *team* — every key, staging and production alike,
 * draws on the same pool — and there is no burst allowance: one request over
 * the limit in a second is refused. A send that retried on its own, as the old
 * mailer did, could not know what the rest of the process was sending, so a
 * burst of admin notifications could be refused alongside the sign-in code a
 * member was standing at the door waiting for.
 *
 * So there is one gate per process, and it does three things:
 *
 * - **Paces.** Sends start at most `SEND_RATE_PER_SECOND` a second, spaced
 *   evenly, below Resend's default of 10 to leave room for the other key.
 * - **Orders.** Two lanes. Credential mail (codes, resets) always goes before
 *   everyday mail that is still waiting.
 * - **Retries what waiting can fix.** A rate-limit refusal, a 5xx or a network
 *   failure is tried again — after Resend's `retry-after`, or exponential
 *   backoff with jitter — on the same idempotency key, so a retry after a send
 *   that did land is not a second email. A quota refusal is never retried:
 *   waiting seconds does not fix a daily or monthly cap, and it is the one
 *   failure that silences sign-in codes too, so it is reported under its own
 *   alertable code. Anything else is a problem with the message, not the
 *   moment, and fails at once.
 *
 * Callers still await their send, so `sendTemplatedEmail` files `sent` or
 * `failed` exactly as before. This module knows nothing about env, the database
 * or the logger — `lib/mailer.ts` wires those in — which is what lets the tests
 * drive it with a scripted Resend on a virtual clock.
 *
 * One process only. A second backend instance would bring a second gate and
 * double the pace; the limiter would then have to move somewhere shared.
 */

/** Credential mail jumps the queue; everyday mail waits its turn. */
export type MailKind = 'credential' | 'everyday'

/** Under Resend's default of 10 a second, per team. */
export const SEND_RATE_PER_SECOND = 8
/** First try included. */
export const MAX_SEND_ATTEMPTS = 5
/** Resend Free's caps. A paid plan has no daily cap and a larger month. */
export const DAILY_QUOTA = 100
export const MONTHLY_QUOTA = 3000
const HEADROOM_WARNING = 0.8
const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 30_000

/** Codes an operator can alert on. */
export type MailAlertCode =
  | 'mail_quota_exhausted'
  | 'mail_quota_daily_high'
  | 'mail_quota_monthly_high'
  | 'mail_usage_unreadable'

export type MailTag = { name: string; value: string }

/** What Resend's `emails.send` takes, as far as this platform uses it. */
export interface ResendPayload {
  from: string
  to: string
  subject: string
  html: string
  replyTo?: string
  tags: MailTag[]
}

/** The SDK's result shape: it returns refusals rather than throwing them. */
export interface ResendResponse {
  data: { id: string } | null
  error: { name: string; message: string; statusCode: number | null } | null
  headers: Record<string, string> | null
}

export interface ResendClient {
  send(payload: ResendPayload, options: { idempotencyKey: string }): Promise<ResendResponse>
}

export interface MailReporter {
  warn(code: MailAlertCode, context: Record<string, unknown>): void
  alert(code: MailAlertCode, err: Error, context: Record<string, unknown>): void
  /** Resend's own count of this month's sends, logged on every delivery. */
  usage(context: Record<string, unknown>): void
}

export interface GateMessage {
  kind: MailKind
  /** Reused on every attempt, so a retry can never deliver twice. */
  idempotencyKey: string
  payload: ResendPayload
}

export interface GateResult {
  messageId: string | null
  response: string | null
}

export interface SendGate {
  send(message: GateMessage): Promise<GateResult>
}

export interface SendGateDeps {
  client: ResendClient
  report: MailReporter
  /** `sent` rows in `email_log` since midnight UTC, across every tenant. */
  sentToday: () => Promise<number>
  ratePerSecond?: number
  maxAttempts?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

const QUOTA_REFUSALS = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded'])
const RETRYABLE_REFUSALS = new Set([
  'rate_limit_exceeded',
  'application_error',
  'internal_server_error',
  'service_unavailable',
  'concurrent_idempotent_requests',
])

type Pending = {
  message: GateMessage
  attempts: number
  resolve: (result: ResendResponse) => void
  reject: (err: Error) => void
}

export function createSendGate(deps: SendGateDeps): SendGate {
  const {
    client,
    report,
    sentToday,
    ratePerSecond = SEND_RATE_PER_SECOND,
    maxAttempts = MAX_SEND_ATTEMPTS,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
    random = Math.random,
  } = deps

  const spacingMs = 1000 / ratePerSecond
  const lanes: Record<MailKind, Pending[]> = { credential: [], everyday: [] }
  /** Earliest the next send may start: pace. */
  let nextStartAt = -Infinity
  /** Earliest any send may start: a rate-limit refusal holds the whole gate. */
  let resumeAt = -Infinity
  let pumping = false
  let warnedDay: string | null = null
  let warnedMonth: string | null = null
  // The worker runs in the async context the gate was built in, not that of
  // whichever request happened to wake it — otherwise every later send would
  // inherit that request's Tenant transaction, long after it closed.
  const detached = new AsyncResource('mail-send-gate')

  function enqueue(pending: Pending, { front = false } = {}) {
    const lane = lanes[pending.message.kind]
    if (front) lane.unshift(pending)
    else lane.push(pending)
    detached.runInAsyncScope(() => void pump())
  }

  /**
   * Start sends, one per slot, until both lanes are empty. The lane is picked
   * when the slot opens, not when the message arrives, so a code that turns up
   * while everyday mail is waiting takes the very next slot.
   */
  async function pump() {
    if (pumping) return
    pumping = true
    try {
      while (lanes.credential.length || lanes.everyday.length) {
        const wait = Math.max(nextStartAt, resumeAt) - now()
        if (wait > 0) {
          await sleep(wait)
          continue
        }
        const next = lanes.credential.shift() ?? lanes.everyday.shift()!
        nextStartAt = now() + spacingMs
        void attempt(next)
      }
    } finally {
      pumping = false
    }
  }

  async function attempt(pending: Pending) {
    pending.attempts++
    const { message } = pending
    let response: ResendResponse
    try {
      response = await client.send(message.payload, { idempotencyKey: message.idempotencyKey })
    } catch (err) {
      // The SDK turns a failed fetch into `application_error`; this is the
      // belt to that brace.
      response = {
        data: null,
        error: { name: 'network_error', message: err instanceof Error ? err.message : String(err), statusCode: null },
        headers: null,
      }
    }

    const { error } = response
    if (!error) return pending.resolve(response)

    const failure = new Error(`resend:${error.name}: ${error.message}`)
    const context = {
      kind: message.kind,
      tags: Object.fromEntries(message.payload.tags.map(t => [t.name, t.value])),
      attempts: pending.attempts,
    }

    if (QUOTA_REFUSALS.has(error.name)) {
      report.alert('mail_quota_exhausted', failure, { ...context, refusal: error.name })
      return pending.reject(failure)
    }
    const retryable =
      RETRYABLE_REFUSALS.has(error.name) ||
      error.name === 'network_error' ||
      error.statusCode === null ||
      error.statusCode >= 500
    if (!retryable || pending.attempts >= maxAttempts) return pending.reject(failure)

    const delay = retryAfterMs(response.headers) ?? backoffMs(pending.attempts)
    if (error.name === 'rate_limit_exceeded') {
      // Resend is refusing the team, not this message: nothing goes until it
      // says so.
      resumeAt = Math.max(resumeAt, now() + delay)
    } else {
      await sleep(delay)
    }
    enqueue(pending, { front: true })
  }

  function backoffMs(attempts: number): number {
    const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1))
    return ceiling / 2 + random() * (ceiling / 2)
  }

  /**
   * Say so before the cap is hit, not after: past it, sign-in codes stop too.
   * Runs in the caller's own async context, after its send, so the count reads
   * through whichever connection the caller is on. Never fails the send.
   */
  async function checkHeadroom(headers: Record<string, string> | null) {
    const stamp = new Date(now()).toISOString()
    const monthlyHeader = headers?.['x-resend-monthly-quota']
    if (monthlyHeader !== undefined) {
      const used = Number(monthlyHeader)
      report.usage({ monthlyUsed: used, monthlyQuota: MONTHLY_QUOTA })
      if (used >= MONTHLY_QUOTA * HEADROOM_WARNING && warnedMonth !== stamp.slice(0, 7)) {
        warnedMonth = stamp.slice(0, 7)
        report.warn('mail_quota_monthly_high', { used, quota: MONTHLY_QUOTA })
      }
    }
    try {
      const sent = await sentToday()
      if (sent >= DAILY_QUOTA * HEADROOM_WARNING && warnedDay !== stamp.slice(0, 10)) {
        warnedDay = stamp.slice(0, 10)
        report.warn('mail_quota_daily_high', { sentToday: sent, quota: DAILY_QUOTA })
      }
    } catch (err) {
      report.warn('mail_usage_unreadable', { err })
    }
  }

  return {
    async send(message) {
      const response = await new Promise<ResendResponse>((resolve, reject) =>
        enqueue({ message, attempts: 0, resolve, reject }),
      )
      await checkHeadroom(response.headers)
      return { messageId: response.data?.id ?? null, response: null }
    },
  }
}

/** Resend's `retry-after` is in seconds. */
function retryAfterMs(headers: Record<string, string> | null): number | null {
  const value = headers?.['retry-after']
  if (value === undefined) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}
