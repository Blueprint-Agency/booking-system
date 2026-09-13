import { Resend } from 'resend'
import { env } from '../env'

/**
 * Outbound mail leaves through Resend's HTTP API — no SMTP, no credentials
 * beyond one API key.
 *
 * Env-driven (secrets / per-environment):
 *   - RESEND_API_KEY          — the key, scoped to the platform's verified domain
 *   - MAIL_FROM_EMAIL         — the address a *member* sees mail arrive from
 *   - MAIL_FROM_PORTAL_EMAIL  — the address *staff* see mail arrive from
 *   - MAIL_FROM_NAME          — the display name when a tenant has none
 *
 * Two envelope addresses, one domain, one key. Both live in the platform's
 * verified zone, so SPF, DKIM and DMARC pass for either. A member sees the
 * studio's name over `hello@`; an admin sees the same name over `portal@`, so
 * a staff inbox can filter platform operations away from customer traffic.
 *
 * The *tenant's* half of the identity is not here. One sender serves every
 * studio, and each studio's mail wears its own display name and `Reply-To` —
 * see docs/md/mail-identity.md and services/tenants/mail-identity.ts.
 */

/** Which of the platform's two addresses a message leaves on. */
export type MailAudience = 'client' | 'staff'

/** The envelope address for each audience. */
export const PLATFORM_MAIL_FROM_EMAIL: Record<MailAudience, string> = {
  client: env.MAIL_FROM_EMAIL,
  // Blank falls back to the member address: one address is a valid setup, two
  // is the intended one.
  staff: env.MAIL_FROM_PORTAL_EMAIL ?? env.MAIL_FROM_EMAIL,
}
/** Shown only when a tenant has no name of its own to put there. */
export const PLATFORM_MAIL_FROM_NAME = env.MAIL_FROM_NAME

export interface SendMailInput {
  to: string
  subject: string
  html: string
  /** The studio's name, shown in the recipient's inbox before the address. */
  fromName?: string
  /** The studio's own address, so a reply reaches the studio and not the platform. */
  replyTo?: string | null
  /**
   * Who is reading: picks the envelope address. Defaults to `client`, the
   * safer of the two — a member should never see `portal@`.
   */
  audience?: MailAudience
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
 * Resend allows 2 requests a second and the SDK does not retry a refusal.
 * `emailEveryAdmin` sends one message per admin back to back, so the third
 * admin of a studio would otherwise be refused and filed as `failed` — and
 * never told. Three waits is enough for any admin list a studio has.
 */
const RATE_LIMIT_RETRIES = 3
const RATE_LIMIT_WAIT_MS = 600

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Resend does not throw on a refused send — it returns `{ error }` — so the
 * refusal is turned into a throw here, where `sendTemplatedEmail` already has
 * a catch that files it under `email_log.status = 'failed'`. A rate-limit
 * refusal is the one kind waited out first, because it says nothing about the
 * message.
 */
function resendTransport(apiKey: string): MailTransport {
  const client = new Resend(apiKey)
  return {
    name: 'resend',
    async send(message) {
      for (let attempt = 0; ; attempt++) {
        const { data, error } = await client.emails.send(message)
        if (!error) return { messageId: data?.id ?? null, response: null }
        if (error.name === 'rate_limit_exceeded' && attempt < RATE_LIMIT_RETRIES) {
          await sleep(RATE_LIMIT_WAIT_MS * (attempt + 1))
          continue
        }
        throw new Error(`resend:${error.name}: ${error.message}`)
      }
    },
  }
}

export const transport: MailTransport =
  env.NODE_ENV === 'test' ? nullTransport : resendTransport(env.RESEND_API_KEY)

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

/**
 * Thin wrapper around the live transport.
 *
 * The address is always the platform's; the *name* is the tenant's. Callers that
 * know their tenant pass `fromName` and `replyTo` from
 * `tenantMailIdentity()`; ones that do not send platform-branded mail.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const email = PLATFORM_MAIL_FROM_EMAIL[input.audience ?? 'client']
  return transport.send({
    from: fromHeader(input.fromName ?? PLATFORM_MAIL_FROM_NAME, email),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    to: input.to,
    subject: input.subject,
    html: input.html,
  })
}
