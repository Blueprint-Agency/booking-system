import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { currentTenantId, db } from '../../db'
import { clients } from '../../db/schema/identity'
import { sendMail } from '../../lib/mailer'
import { sendTemplatedEmail } from '../notifications/send'
import { platformPasswordResetEmail, platformTwoFactorEmail, type PlatformEmail } from './platform-mail'

/**
 * The mail Better Auth asks us to send: one-time codes, second factors and
 * password resets, for the three pools in `./better-auth.ts`.
 *
 * **A studio pool's mail is that studio's mail.** It goes through
 * `sendTemplatedEmail` like every other message, so it is worded by the
 * Tenant's own `email_templates` row (editable in the portal), wears the
 * Tenant's display name and `Reply-To`, leaves on the platform's one envelope
 * address ahead of any everyday mail at the send gate, and files an `email_log` row. The Tenant is the one whose
 * context the request opened: `/api/v1/auth/{client,staff}/*` runs behind
 * `resolveTenant`, so a code is always sent on behalf of the studio whose
 * hostname asked for it. No context means a caller bug, and it throws rather
 * than send another studio's words.
 *
 * Codes and reset links are credentials, so they go in `secretVariables`: the
 * recipient gets them and `email_log` keeps them redacted.
 *
 * Awaited, not fired and forgotten, although Better Auth suggests the latter
 * against timing attacks: the send runs inside the request's Tenant
 * transaction, and a send still in flight when that transaction commits would
 * write its log row on a connection that has gone back to the pool.
 */

type MailUser = { email: string; name: string }

function tenantInContext(pool: 'client' | 'staff'): string {
  const tenantId = currentTenantId()
  // Invariant: `/api/v1/auth/{client,staff}/*` runs behind `resolveTenant` — see the note above.
  if (!tenantId) throw new Error(`${pool} sign-in mail requested outside a Tenant context`)
  return tenantId
}

export async function mailClientCode(email: string, code: string): Promise<void> {
  await sendTemplatedEmail({
    tenantId: tenantInContext('client'),
    slug: 'sign_in_code',
    recipient: { email, userKind: 'client' },
    variables: { code },
    secretVariables: ['code'],
  })
}

/**
 * A member's set-password link (#173) — the same mail whether they have never
 * had a password or forgot theirs, worded by the studio's `password_reset`
 * template.
 *
 * **Only a member of this studio gets one.** The login is this studio's (#231),
 * but a login is not a membership: one can outlive its `clients` row, or
 * belong to a member this studio has blocked. So the `clients` row at the
 * Tenant in context is looked up here, and an address with none — or a blocked
 * one — is mailed nothing. The caller's answer is the same either way, which is
 * the point: it must never say who is a member.
 */
export async function mailClientPasswordReset(user: MailUser & { id: string }, resetUrl: string): Promise<void> {
  const tenantId = tenantInContext('client')
  const [member] = await db
    .select({ id: clients.id, name: clients.name, deletedAt: clients.deletedAt })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.authUserId, user.id)))
    .limit(1)
  if (!member || member.deletedAt) return
  await sendTemplatedEmail({
    tenantId,
    slug: 'password_reset',
    recipient: { email: user.email, userId: member.id, userKind: 'client' },
    variables: { client_name: member.name, reset_url: resetUrl },
    secretVariables: ['reset_url'],
  })
}

export async function mailStaffTwoFactorCode(user: MailUser, code: string): Promise<void> {
  await sendTemplatedEmail({
    tenantId: tenantInContext('staff'),
    slug: 'staff_two_factor_code',
    recipient: { email: user.email, userKind: 'staff' },
    variables: { name: user.name, code },
    secretVariables: ['code'],
  })
}

export async function mailStaffPasswordReset(user: MailUser, resetUrl: string): Promise<void> {
  await sendTemplatedEmail({
    tenantId: tenantInContext('staff'),
    slug: 'staff_password_reset',
    recipient: { email: user.email, userKind: 'staff' },
    variables: { name: user.name, reset_url: resetUrl },
    secretVariables: ['reset_url'],
  })
}

/*
 * The super portal has no Tenant, so its mail has no studio to speak for: no
 * template row to word it, no studio name to wear, and no `email_log` to file
 * it under (`tenant_id` is `NOT NULL` there). It is platform mail — the
 * platform's name on the platform's envelope, in copy that lives in
 * `./platform-mail.ts` because it belongs to no studio.
 */

async function mailPlatform(to: string, email: PlatformEmail): Promise<void> {
  const { slug, subject, html, text } = email
  // No `email_log` row to key on, so the key is made here, once per message.
  await sendMail({ to, subject, html, text, slug, tenantId: null, idempotencyKey: `platform-mail/${randomUUID()}` })
}

export async function mailPlatformTwoFactorCode(user: MailUser, code: string): Promise<void> {
  await mailPlatform(user.email, platformTwoFactorEmail(user.name, code))
}

export async function mailPlatformPasswordReset(user: MailUser, resetUrl: string): Promise<void> {
  await mailPlatform(user.email, platformPasswordResetEmail(user.name, resetUrl))
}
