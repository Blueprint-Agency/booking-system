/**
 * An admin changes a staff member's sign-in email — another instructor's,
 * another admin's, or their own — and the new address confirms it by link.
 *
 * **Verified before it moves.** A staff address is a credential twice over:
 * the password signs in against it, and the second factor is a code mailed to
 * it. An address moved on an admin's say-so alone could put the portal's second
 * factor in a typo's inbox, or in a stranger's. So the change is two steps:
 *
 *   1. `startStaffEmailChange` saves the new address as **Unverified** and
 *      mails a confirmation link to it. The portal shows the address, labelled
 *      Unverified, beside the staff member; nothing about the sign-in changes.
 *   2. `confirmStaffEmailChange` is the link clicked, on the studio's own
 *      portal, by whoever holds the new inbox. Only then do the `staff_users`
 *      row and the `staff` pool login move, together.
 *
 * While it is Unverified an admin can revoke it (`revokeStaffEmailChange`), and
 * the link dies. A new change, or a resend, replaces the old link.
 *
 * **The login is kept, not replaced.** Unlike a member's change
 * (`services/clients/change-email.ts`), where the login is passwordless and
 * rebuilt, a staff login carries a password its owner chose and possibly a
 * second factor. The same `staff_auth_users` row is re-addressed, so both
 * survive and no session ends: sessions belong to the login, not the address.
 *
 * The pending change is a row in the pool's own verification table, keyed by
 * the staff member, holding the address and a hash of the link's secret — never
 * the secret. The link names the staff member and carries 32 random bytes, so
 * it cannot be guessed and needs no attempt count. It works for 24 hours; after
 * that the portal shows the change as expired until it is resent or revoked.
 * The page the link opens asks for a click before confirming, so a mail
 * scanner that opens links cannot confirm one.
 *
 * The old address is told afterwards, unless it is a placeholder (`.invalid`)
 * that reaches nobody — so a change nobody expected does not go unnoticed.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq, inArray, isNull, like, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { now } from '../../lib/clock'
import { isUniqueViolation } from '../../db/unique-violation'
import { staffAuthUsers, staffAuthVerifications } from '../../db/schema/auth'
import { staffInvitations, staffUsers } from '../../db/schema/identity'
import { auditLog } from '../../db/schema/ledger'
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { reportError } from '../../shared/logger'
import { emailButton, emailHeading, emailNote, emailParagraph, escapeHtml, renderEmail } from '../mail/layout'
import { sendStudioSystemEmail } from '../notifications/send'
import { requireTenantUrl } from '../tenants/urls'
import { isPlaceholderEmail } from './account-access'
import { STAFF_EDIT_REFUSAL_MESSAGE, staffEditRefusal } from './staff-rank'

export const EMAIL_CHANGE_LINK_TTL_MS = 24 * 60 * 60_000
/** How soon another link may be sent for the same person. */
export const EMAIL_CHANGE_RESEND_AFTER_MS = 30_000

const IDENTIFIER_PREFIX = 'staff-email-change:'
const identifierFor = (staffId: string) => `${IDENTIFIER_PREFIX}${staffId}`

/** What the verification row's `value` holds. */
interface PendingChange {
  email: string
  /** Null once revoked: no link confirms, but `sentAt` still holds the cooldown. */
  tokenHash: string | null
  /** The admin who made the change — the actor on the audit row when it is confirmed. */
  requestedByStaffId: string
  /** On the app's clock (`lib/clock`), like the expiry — not the row's own timestamps. */
  sentAt: string
}

/** An Unverified address, as the portal shows it beside the staff member. */
export interface PendingStaffEmail {
  email: string
  sentAt: Date
  expiresAt: Date
  /** The link no longer works; the portal offers a resend. */
  expired: boolean
}

/** Salted with the staff id, so one link's hash says nothing about another's. */
const hashSecret = (staffId: string, secret: string) =>
  createHash('sha256').update(`${staffId}:${secret}`).digest('hex')

/** The link's token: whose change it is, then the secret. */
const tokenFor = (staffId: string, secret: string) => `${staffId}.${secret}`

function parseToken(token: string): { staffId: string; secret: string } | null {
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const staffId = token.slice(0, dot)
  // A uuid, or no row could hold it — and the query below would refuse the cast.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)) return null
  return { staffId, secret: token.slice(dot + 1) }
}

function secretMatches(pending: PendingChange, staffId: string, secret: string): boolean {
  if (!pending.tokenHash) return false
  const expected = Buffer.from(pending.tokenHash, 'hex')
  const offered = Buffer.from(hashSecret(staffId, secret), 'hex')
  return expected.length === offered.length && timingSafeEqual(expected, offered)
}

/**
 * The confirmation page, on the **studio's own portal**: the link is looked up
 * inside the Tenant it was issued for, as an invitation's is.
 */
export function buildConfirmEmailUrl(portalUrl: string, token: string): string {
  return `${portalUrl.replace(/\/+$/, '')}/confirm-email?token=${encodeURIComponent(token)}`
}

const emailInUse = () =>
  new ConflictError('email_in_use', {
    message: 'Another staff member of this studio already signs in with that email.',
  })

const linkInvalid = () =>
  new BadRequestError('email_change_link_invalid', {
    message: 'This link no longer works. It was used, replaced by a newer one, or revoked.',
  })

/** The target, and a refusal when this actor may not edit them. */
async function editableTarget(tenantId: string, targetStaffId: string, actorStaffId: string) {
  const people = await db
    .select()
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        inArray(staffUsers.id, [targetStaffId, actorStaffId]),
        isNull(staffUsers.deletedAt),
      ),
    )
  const target = people.find(r => r.id === targetStaffId)
  const actor = people.find(r => r.id === actorStaffId)
  if (!target) throw new NotFoundError('staff_not_found')
  if (!actor) throw new ForbiddenError('actor_not_found')

  const refusal = staffEditRefusal({
    actorRole: actor.role,
    targetRole: target.role,
    touchesPrivilegeFields: false,
  })
  if (refusal) throw new ForbiddenError(refusal, { message: STAFF_EDIT_REFUSAL_MESSAGE[refusal] })
  assertNotBlocked(target)
  return { target, actor }
}

/** Archived is how staff are blocked; the account is closed to changes as it is to sign-in. */
function assertNotBlocked(target: { status: string }) {
  if (target.status === 'archived') {
    throw new ConflictError('staff_archived', {
      message: 'This staff member is blocked. Unblock them before changing their email.',
    })
  }
}

/**
 * Refuse an address already signing someone else in at this studio: another
 * staff row, or a login left without one. Per studio, like the unique indexes —
 * the same person may be staff at two studios with one address.
 */
async function assertAddressFree(tenantId: string, target: { id: string; authUserId: string }, email: string) {
  const [staff] = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        ne(staffUsers.id, target.id),
        sql`lower(${staffUsers.email}) = ${email}`,
      ),
    )
    .limit(1)
  if (staff) throw emailInUse()
  const [login] = await db
    .select({ id: staffAuthUsers.id })
    .from(staffAuthUsers)
    .where(
      and(
        eq(staffAuthUsers.tenantId, tenantId),
        ne(staffAuthUsers.id, target.authUserId),
        sql`lower(${staffAuthUsers.email}) = ${email}`,
      ),
    )
    .limit(1)
  if (login) throw emailInUse()
}

/**
 * One step at a time per staff member, until the request commits.
 *
 * Every step reads the pending row and writes it back: without this, two
 * starts at once each delete-then-insert and leave two rows. A
 * transaction-scoped advisory lock, because the first start has no row yet to
 * lock.
 */
async function lockPending(staffId: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${identifierFor(staffId)}))`)
}

async function pendingRow(tenantId: string, staffId: string) {
  const [row] = await db
    .select()
    .from(staffAuthVerifications)
    .where(
      and(
        eq(staffAuthVerifications.tenantId, tenantId),
        eq(staffAuthVerifications.identifier, identifierFor(staffId)),
      ),
    )
    .limit(1)
  return row
}

async function dropPending(tenantId: string, staffId: string) {
  await db
    .delete(staffAuthVerifications)
    .where(
      and(
        eq(staffAuthVerifications.tenantId, tenantId),
        eq(staffAuthVerifications.identifier, identifierFor(staffId)),
      ),
    )
}

function pendingView(row: { value: string; expiresAt: Date }): PendingStaffEmail | null {
  const pending = JSON.parse(row.value) as PendingChange
  // Revoked: kept only for its cooldown, and no longer anything to show.
  if (!pending.tokenHash) return null
  return {
    email: pending.email,
    sentAt: new Date(pending.sentAt),
    expiresAt: row.expiresAt,
    expired: row.expiresAt.getTime() <= now().getTime(),
  }
}

/**
 * The Unverified addresses at this studio, by staff id — for the staff list,
 * or for the given staff members only.
 */
export async function pendingStaffEmails(
  tenantId: string,
  staffIds?: readonly string[],
): Promise<Map<string, PendingStaffEmail>> {
  if (staffIds && staffIds.length === 0) return new Map()
  const rows = await db
    .select({
      identifier: staffAuthVerifications.identifier,
      value: staffAuthVerifications.value,
      expiresAt: staffAuthVerifications.expiresAt,
    })
    .from(staffAuthVerifications)
    .where(
      and(
        eq(staffAuthVerifications.tenantId, tenantId),
        staffIds
          ? inArray(staffAuthVerifications.identifier, staffIds.map(identifierFor))
          : like(staffAuthVerifications.identifier, `${IDENTIFIER_PREFIX}%`),
      ),
    )
  const byStaff = new Map<string, PendingStaffEmail>()
  for (const row of rows) {
    const view = pendingView(row)
    if (view) byStaff.set(row.identifier.slice(IDENTIFIER_PREFIX.length), view)
  }
  return byStaff
}

export interface StartStaffEmailChangeInput {
  tenantId: string
  targetStaffId: string
  actorStaffId: string
  email: string
}

/**
 * Step one: save the address as Unverified and mail it the confirmation link.
 * Changes nothing on the account. Sending the same address again is the resend:
 * a new link, and the old one dies.
 */
export async function startStaffEmailChange(input: StartStaffEmailChangeInput): Promise<PendingStaffEmail> {
  const email = input.email.trim().toLowerCase()
  if (!email) throw new BadRequestError('email_required')
  const { target } = await editableTarget(input.tenantId, input.targetStaffId, input.actorStaffId)

  if (target.email.toLowerCase() === email) throw new BadRequestError('email_unchanged')
  // A placeholder can receive no link, and moving onto one is not a change anyone needs.
  if (isPlaceholderEmail(email)) {
    throw new BadRequestError('email_placeholder_not_allowed', {
      message: 'Enter an address that receives mail — a link is sent to it to confirm the change.',
    })
  }
  await assertAddressFree(input.tenantId, target, email)
  // Before anything is written: a change saved with no link built for it is an
  // Unverified address that can never be verified.
  const portalUrl = await requireTenantUrl('portal', input.tenantId)

  await lockPending(target.id)
  const previous = await pendingRow(input.tenantId, target.id)
  const sentAt = previous && (JSON.parse(previous.value) as PendingChange).sentAt
  if (sentAt && now().getTime() - new Date(sentAt).getTime() < EMAIL_CHANGE_RESEND_AFTER_MS) {
    throw new AppError(429, 'too_many_requests', {
      message: `A link was sent a moment ago. Wait ${EMAIL_CHANGE_RESEND_AFTER_MS / 1000} seconds before sending another.`,
    })
  }

  const secret = randomBytes(32).toString('base64url')
  const sent = now()
  const expiresAt = new Date(sent.getTime() + EMAIL_CHANGE_LINK_TTL_MS)
  const pending: PendingChange = {
    email,
    tokenHash: hashSecret(target.id, secret),
    requestedByStaffId: input.actorStaffId,
    sentAt: sent.toISOString(),
  }
  // A new link replaces the old one, and whatever address it was for.
  await dropPending(input.tenantId, target.id)
  await db.insert(staffAuthVerifications).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    identifier: identifierFor(target.id),
    value: JSON.stringify(pending),
    expiresAt,
  })

  const link = buildConfirmEmailUrl(portalUrl, tokenFor(target.id, secret))
  const sentOk = await sendStudioSystemEmail({
    tenantId: input.tenantId,
    slug: 'staff_email_change_link',
    recipient: { email, userId: target.id, userKind: 'staff' },
    render: (studio, redact) => emailChangeLinkEmail(studio, target.name, redact ? '#redacted' : link),
  })
  // Unlike an everyday notice, this flow is nothing without the mail: say so,
  // rather than "Link sent" for a link nobody will receive. The row goes too,
  // so the retry is not held back by the cooldown of a send that never left.
  if (!sentOk) {
    await dropPending(input.tenantId, target.id)
    throw new AppError(503, 'email_send_failed', {
      message: 'The confirmation link could not be emailed. Try again in a moment.',
    })
  }

  return { email, sentAt: sent, expiresAt, expired: false }
}

/** The pending change a link names, and whether it still confirms. */
async function changeForToken(tenantId: string, token: string) {
  const parsed = parseToken(token.trim())
  if (!parsed) return null
  const row = await pendingRow(tenantId, parsed.staffId)
  if (!row) return null
  const pending = JSON.parse(row.value) as PendingChange
  if (!secretMatches(pending, parsed.staffId, parsed.secret)) return null
  const [target] = await db
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, parsed.staffId), isNull(staffUsers.deletedAt)))
    .limit(1)
  if (!target) return null
  return { row, pending, target, expired: row.expiresAt.getTime() <= now().getTime() }
}

export type StaffEmailChangeLinkStatus = 'valid' | 'expired' | 'invalid'

/**
 * What the confirmation page shows before the click. Read-only, and public:
 * holding the link is the only way to learn anything from it.
 */
export async function lookupStaffEmailChange(
  tenantId: string,
  token: string,
): Promise<{ status: StaffEmailChangeLinkStatus; email: string | null }> {
  const change = await changeForToken(tenantId, token)
  if (!change) return { status: 'invalid', email: null }
  return { status: change.expired ? 'expired' : 'valid', email: change.pending.email }
}

/**
 * Step two: the link clicked, and the address moves. Public — the person
 * holding the new inbox need not be signed in, and holding the link is the
 * proof, as it is for an invitation or a password reset.
 */
export async function confirmStaffEmailChange(input: { tenantId: string; token: string }): Promise<{ email: string }> {
  const parsed = parseToken(input.token.trim())
  if (!parsed) throw linkInvalid()
  await lockPending(parsed.staffId)
  const change = await changeForToken(input.tenantId, input.token)
  if (!change) throw linkInvalid()
  const { row, pending, target } = change
  if (change.expired) {
    throw new BadRequestError('email_change_link_expired', {
      message: 'This link has expired. Ask an admin to send a new one.',
    })
  }
  // Blocked since the link was sent: the account is closed to changes.
  assertNotBlocked(target)
  // Checked again: the address may have been taken while the link was out.
  await assertAddressFree(input.tenantId, target, pending.email)
  const previousEmail = target.email

  await db
    .transaction(async tx => {
      await tx
        .update(staffUsers)
        .set({ email: pending.email, updatedAt: new Date() })
        .where(and(eq(staffUsers.tenantId, input.tenantId), eq(staffUsers.id, target.id)))
      // The same login, re-addressed: its password, second factor and sessions stay.
      // Verified, because the link just proved the address receives mail.
      await tx
        .update(staffAuthUsers)
        .set({ email: pending.email, emailVerified: true, updatedAt: new Date() })
        .where(and(eq(staffAuthUsers.tenantId, input.tenantId), eq(staffAuthUsers.id, target.authUserId)))
      // Anything the old address was sent that still opens the account dies
      // with it: a set-password link, a half-finished second factor. Better
      // Auth keys those by the login's id, in `value`.
      await tx
        .delete(staffAuthVerifications)
        .where(
          and(
            eq(staffAuthVerifications.tenantId, input.tenantId),
            eq(staffAuthVerifications.value, target.authUserId),
          ),
        )
      // A pending invitation moves to the new address, with a new token: the
      // link already mailed to the old one — perhaps a typo, in a stranger's
      // inbox — would otherwise still set this account's first password.
      await tx
        .update(staffInvitations)
        .set({ email: pending.email, token: randomBytes(32).toString('base64url') })
        .where(
          and(
            eq(staffInvitations.tenantId, input.tenantId),
            eq(staffInvitations.staffUserId, target.id),
            eq(staffInvitations.status, 'pending'),
          ),
        )
      await tx
        .delete(staffAuthVerifications)
        .where(and(eq(staffAuthVerifications.tenantId, input.tenantId), eq(staffAuthVerifications.id, row.id)))
      await tx.insert(auditLog).values({
        tenantId: input.tenantId,
        actorStaffId: pending.requestedByStaffId,
        actorType: 'staff',
        action: 'staff_email_changed',
        targetTable: 'staff_users',
        targetId: target.id,
        payload: { from: previousEmail, to: pending.email },
      })
    })
    .catch((err: unknown) => {
      // Two changes racing onto one address: the index decides.
      if (isUniqueViolation(err)) throw emailInUse()
      throw err
    })

  if (!isPlaceholderEmail(previousEmail)) {
    const [requester] =
      pending.requestedByStaffId === target.id
        ? []
        : await db
            .select({ name: staffUsers.name })
            .from(staffUsers)
            .where(and(eq(staffUsers.tenantId, input.tenantId), eq(staffUsers.id, pending.requestedByStaffId)))
            .limit(1)
    // Best-effort: the change is committed, and a notice that fails to send must not undo it.
    await sendStudioSystemEmail({
      tenantId: input.tenantId,
      slug: 'staff_email_changed_notice',
      recipient: { email: previousEmail, userId: target.id, userKind: 'staff' },
      render: studio => emailChangedNotice(studio, target.name, pending.email, requester?.name ?? null),
    }).catch(err => reportError(err, 'staff email change notice failed', { scope: 'staff-email-change' }))
  }

  return { email: pending.email }
}

/**
 * Revoke an Unverified address: the link dies and the portal stops showing it.
 * The row stays, link-less, until it expires: deleting it would reset the
 * resend cooldown, so revoking and re-adding could mail links as fast as it can
 * be clicked.
 */
export async function revokeStaffEmailChange(input: {
  tenantId: string
  targetStaffId: string
  actorStaffId: string
}): Promise<void> {
  const { target } = await editableTarget(input.tenantId, input.targetStaffId, input.actorStaffId)
  await lockPending(target.id)
  const row = await pendingRow(input.tenantId, target.id)
  if (!row) return
  const pending = JSON.parse(row.value) as PendingChange
  await db
    .update(staffAuthVerifications)
    .set({ value: JSON.stringify({ ...pending, tokenHash: null }) })
    .where(and(eq(staffAuthVerifications.tenantId, input.tenantId), eq(staffAuthVerifications.id, row.id)))
}

/* ── the two messages, in the studio's name ─────────────────────────────── */

export function emailChangeLinkEmail(studio: string, name: string, link: string) {
  const subject = `Confirm your new ${studio} portal email`
  return {
    subject,
    ...renderEmail({
      brandName: studio,
      subject,
      bodyHtml: [
        emailHeading('Confirm your new email'),
        emailParagraph(`Hi ${escapeHtml(name)},`),
        emailParagraph(
          `This address was entered as the new sign-in email for your ${escapeHtml(studio)} portal account. Confirm it to start signing in with it:`,
        ),
        emailButton(escapeHtml(link), 'Confirm email'),
        emailNote(
          "The link works once and expires in 24 hours. Until it is confirmed, you keep signing in with your current email. If you weren't expecting this, ignore it — nothing changes.",
        ),
      ].join('\n'),
      reason: `You're receiving this because this address was entered as a new sign-in email at ${studio}.`,
    }),
  }
}

export function emailChangedNotice(studio: string, name: string, newEmail: string, changedBy: string | null) {
  const subject = `Your ${studio} portal email was changed`
  const by = changedBy ? ` by ${escapeHtml(changedBy)}` : ''
  return {
    subject,
    ...renderEmail({
      brandName: studio,
      subject,
      bodyHtml: [
        emailHeading('Your sign-in email was changed'),
        emailParagraph(`Hi ${escapeHtml(name)},`),
        emailParagraph(
          `The email you sign in to the ${escapeHtml(studio)} portal with was changed${by} to <strong>${escapeHtml(newEmail)}</strong>. Your password is unchanged. This address no longer signs you in.`,
        ),
        emailNote(`If you didn't expect this, contact ${escapeHtml(studio)} straight away.`),
      ].join('\n'),
      reason: `You're receiving this because this address was your sign-in email at ${studio}.`,
    }),
  }
}
