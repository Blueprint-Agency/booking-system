import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../env'

/**
 * Single Nodemailer SMTP transport.
 *
 * Hardcoded for this platform (Gmail SMTP — stable for its lifetime):
 *   - host:   smtp.gmail.com
 *   - port:   587 (STARTTLS)
 *   - secure: false
 *
 * Env-driven (because they're secrets / per-environment):
 *   - SMTP_USER     — the gmail account
 *   - SMTP_PASSWORD — the 16-char gmail App Password
 *   - MAIL_FROM_EMAIL / MAIL_FROM_NAME — the platform's envelope identity
 *
 * The *tenant's* half of the identity is not here. One transport serves every
 * studio, on one authenticated envelope, and each studio's mail wears its own
 * display name and `Reply-To` — see docs/md/mail-identity.md and
 * services/tenants/mail-identity.ts.
 */
const SMTP_HOST = 'smtp.gmail.com'
const SMTP_PORT = 587
const SMTP_SECURE = false

/**
 * The envelope address every tenant's mail leaves on.
 *
 * It has to be an address the SMTP credentials are authorised for — that is the
 * whole constraint. Defaulting to `SMTP_USER` means an environment that sets
 * only the credentials still sends deliverable mail rather than mail that fails
 * SPF on a mismatched From.
 */
export const PLATFORM_MAIL_FROM_EMAIL = env.MAIL_FROM_EMAIL || env.SMTP_USER
/** Shown only when a tenant has no name of its own to put there. */
export const PLATFORM_MAIL_FROM_NAME = env.MAIL_FROM_NAME

/**
 * Under test, no transport at all: `jsonTransport` renders the message and
 * hands it back instead of delivering it. `.env` holds the real Gmail
 * credentials and the harness cannot know a fake pair from a live one, so
 * the guard has to sit here, on the mode, not on the credentials. Before it,
 * every test that sent a templated email sent it for real — to an
 * `@example.test` address — and each one bounced into the platform inbox.
 */
export const transporter: Transporter =
  env.NODE_ENV === 'test'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASSWORD,
        },
      })

/** Back-compat alias — older modules import `mailer`. */
export const mailer = transporter

export interface SendMailInput {
  to: string
  subject: string
  html: string
  /** The studio's name, shown in the recipient's inbox before the address. */
  fromName?: string
  /** The studio's own address, so a reply reaches the studio and not the platform. */
  replyTo?: string | null
}

export interface SendMailResult {
  messageId: string | null
  response: string | null
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

/**
 * Thin wrapper around `transporter.sendMail`.
 *
 * The address is always the platform's; the *name* is the tenant's. Callers that
 * know their tenant pass `fromName` and `replyTo` from
 * `tenantMailIdentity()`; ones that do not send platform-branded mail.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const info = await transporter.sendMail({
    from: fromHeader(input.fromName ?? PLATFORM_MAIL_FROM_NAME, PLATFORM_MAIL_FROM_EMAIL),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    to: input.to,
    subject: input.subject,
    html: input.html,
  })
  const response =
    typeof info.response === 'string' ? info.response.split('\n').pop() ?? null : null
  return {
    messageId: typeof info.messageId === 'string' ? info.messageId : null,
    response,
  }
}
