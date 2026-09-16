import { Resend } from 'resend'
import { sql } from 'drizzle-orm'
import { env } from '../env'
import { db } from '../db'
import { logger, reportError } from '../shared/logger'
import { outbound } from './outbound'
import {
  createSendGate,
  type MailKind,
  type MailReporter,
  type MailTag,
  type ResendClient,
  type SendGate,
  type SendGateDeps,
} from './send-gate'

export type { MailKind } from './send-gate'

/**
 * Outbound mail leaves through Resend's HTTP API — no SMTP, no credentials
 * beyond `RESEND_API_KEY`, and every call through the one send gate in
 * `./send-gate.ts`.
 *
 * The platform's half of the identity is fixed, so it is code, not env: one
 * envelope address in the domain verified on Resend, for members and staff
 * alike, and the platform's name for mail no studio speaks for. SPF, DKIM and
 * DMARC pass on that address; what a recipient actually reads is the studio's
 * name and its Reply-To.
 *
 * The *tenant's* half of the identity is not here. One sender serves every
 * studio, and each studio's mail wears its own display name and `Reply-To` —
 * see docs/md/mail-identity.md and services/tenants/mail-identity.ts.
 */
export const PLATFORM_MAIL_FROM_EMAIL = 'noreply@reservetoday.app'
/** Shown only when no studio name applies — and on super portal mail. */
export const PLATFORM_MAIL_FROM_NAME = 'ReserveToday'

/**
 * The one place a message's kind is decided. Credential mail is what someone
 * is waiting on to get in; it takes the next slot at the gate. The kind sets
 * queue priority and a tag, never the address.
 */
const CREDENTIAL_SLUGS: ReadonlySet<string> = new Set([
  'sign_in_code',
  'staff_two_factor_code',
  'staff_password_reset',
  'platform_two_factor_code',
  'platform_password_reset',
])

export function mailKind(slug: string): MailKind {
  return CREDENTIAL_SLUGS.has(slug) ? 'credential' : 'everyday'
}

export interface SendMailInput {
  to: string
  subject: string
  html: string
  /** The template slug — or the super portal's own — which decides the kind. */
  slug: string
  /** Null for super portal mail, which no studio sends. */
  tenantId: string | null
  /**
   * Stable for this one message: the `email_log` row id, or a generated one
   * for super portal mail. Resend drops a repeat for 24 hours.
   */
  idempotencyKey: string
  /** The studio's name, shown in the recipient's inbox before the address. */
  fromName?: string
  /** The studio's own address, so a reply reaches the studio and not the platform. */
  replyTo?: string | null
}

export interface SendMailResult {
  messageId: string | null
  response: string | null
}

/** A fully-formed message, ready for whichever transport is live. */
export interface OutboundMessage {
  from: string
  to: string
  subject: string
  html: string
  replyTo?: string
  kind: MailKind
  idempotencyKey: string
  tags: MailTag[]
}

export interface MailTransport {
  /** `resend` delivers; `null` renders and discards. Asserted on under test. */
  readonly name: 'resend' | 'null'
  send(message: OutboundMessage): Promise<SendMailResult>
}

/**
 * Under test, no transport at all: the message is accepted and dropped. `.env`
 * holds a live API key and the harness cannot know a fake key from a real one,
 * so the guard has to sit here, on the mode, not on the credentials. Before it,
 * every test that sent a templated email sent it for real — to an
 * `@example.test` address — and each one bounced into the platform inbox.
 */
const nullTransport: MailTransport = {
  name: 'null',
  async send(message) {
    discardedMail.push(message)
    if (discardedMail.length > DISCARDED_MAIL_KEPT) discardedMail.shift()
    return { messageId: `null-${Date.now()}`, response: 'discarded (NODE_ENV=test)' }
  },
}

/**
 * The last few messages the null transport dropped, newest last — so a test
 * can read what was "sent". The sign-in code tests need it: a one-time code is
 * stored hashed and redacted from `email_log`, so the rendered message is the
 * only place the code exists. Empty outside tests, where nothing is discarded.
 */
export const discardedMail: OutboundMessage[] = []
const DISCARDED_MAIL_KEPT = 50

/**
 * Sent rows across every tenant since midnight UTC. Through migration 0057's
 * function, because Row-Level Security shows the application role one tenant's
 * `email_log` at most.
 */
async function sentTodayAcrossTenants(): Promise<number> {
  // In its own savepoint: this runs inside the caller's Tenant transaction, and
  // a failed count must not abort the transaction the `email_log` update and
  // the business action still need.
  return db.transaction(async tx => {
    const rows = (await tx.execute(sql`SELECT public.email_log_sent_today() AS sent`)) as unknown as {
      sent: number
    }[]
    return Number(rows[0]?.sent ?? 0)
  })
}

const loggingReporter: MailReporter = {
  warn: (code, context) => logger.warn({ code, ...context }, `mail: ${code}`),
  alert: (code, err, context) => reportError(err, `mail: ${code}`, { code, ...context }),
  usage: context => logger.info(context, 'mail: resend monthly usage'),
}

/**
 * Resend behind the send gate. Takes the client so a test can hand it a
 * scripted fake; everything else defaults to the real clock, logger and count.
 */
export function createResendTransport(
  client: ResendClient,
  options: Partial<Omit<SendGateDeps, 'client'>> = {},
): MailTransport {
  const gate: SendGate = createSendGate({
    client,
    report: loggingReporter,
    sentToday: sentTodayAcrossTenants,
    ...options,
  })
  return {
    name: 'resend',
    send: ({ kind, idempotencyKey, ...payload }) => gate.send({ kind, idempotencyKey, payload }),
  }
}

/**
 * The Resend call itself, under the outbound deadline. Below the gate and with
 * no retry of its own: a timeout throws, the gate reads it as a network failure,
 * and the gate's backoff decides whether to go again.
 */
function resendClient(apiKey: string): ResendClient {
  const resend = new Resend(apiKey)
  return {
    send: (payload, options) => outbound('resend', 'emails.send', () => resend.emails.send(payload, options)),
  }
}

export let transport: MailTransport =
  env.NODE_ENV === 'test' ? nullTransport : createResendTransport(resendClient(env.RESEND_API_KEY))

/** Swap the live transport — for tests. Returns the undo. */
export function useTransport(next: MailTransport): () => void {
  const previous = transport
  transport = next
  return () => {
    transport = previous
  }
}

/**
 * A display name safe to put in a `From` header.
 *
 * A name is tenant-supplied text, and a `"` or a newline in it would break the
 * header apart — a CRLF there is header injection, not a formatting bug. So the
 * name is quoted, and everything that could end the quoted string is removed.
 */
function fromHeader(name: string, email: string): string {
  const safe = name.replace(/[\r\n"\\]/g, ' ').trim()
  return safe ? `"${safe}" <${email}>` : email
}

/** Resend accepts only ASCII letters, digits, `_` and `-` in a tag. */
const tagValue = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_')

/**
 * Thin wrapper around the live transport.
 *
 * The address is always the platform's; the *name* is the tenant's. Callers that
 * know their tenant pass `fromName` and `replyTo` from
 * `tenantMailIdentity()`; ones that do not send platform-branded mail.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const kind = mailKind(input.slug)
  return transport.send({
    from: fromHeader(input.fromName ?? PLATFORM_MAIL_FROM_NAME, PLATFORM_MAIL_FROM_EMAIL),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    to: input.to,
    subject: input.subject,
    html: input.html,
    kind,
    idempotencyKey: input.idempotencyKey,
    tags: [
      { name: 'kind', value: kind },
      { name: 'template', value: tagValue(input.slug) },
      ...(input.tenantId ? [{ name: 'tenant', value: tagValue(input.tenantId) }] : []),
    ],
  })
}
