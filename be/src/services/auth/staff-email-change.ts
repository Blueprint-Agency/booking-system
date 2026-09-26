/**
 * An admin changes a staff member's sign-in email — another instructor's,
 * another admin's, or their own.
 *
 * **Verified before it moves.** A staff address is a credential twice over:
 * the password signs in against it, and the second factor is a code mailed to
 * it. An address moved on an admin's say-so alone could put the portal's second
 * factor in a typo's inbox, or in a stranger's. So the change is two steps:
 *
 *   1. `startStaffEmailChange` mails a six-digit code to the NEW address and
 *      keeps the request pending. Nothing about the account changes yet.
 *   2. `confirmStaffEmailChange` takes that code back. Only then do the
 *      `staff_users` row and the `staff` pool login move, together.
 *
 * For someone else's address the admin gets the code from the person, who
 * reads it off their new inbox; for their own, from their own inbox.
 *
 * **The login is kept, not replaced.** Unlike a member's change
 * (`services/clients/change-email.ts`), where the login is passwordless and
 * rebuilt, a staff login carries a password its owner chose and possibly a
 * second factor. The same `staff_auth_users` row is re-addressed, so both
 * survive and no session ends: sessions belong to the login, not the address.
 *
 * The pending request is a row in the pool's own verification table, keyed by
 * the staff member, holding the address and a hash of the code — never the code.
 * A code works for ten minutes and five guesses, and a new one replaces the old.
 *
 * The old address is told afterwards, unless it is a placeholder (`.invalid`)
 * that reaches nobody — so a change nobody expected does not go unnoticed.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { now } from '../../lib/clock'
import { isUniqueViolation } from '../../db/unique-violation'
import { staffAuthUsers, staffAuthVerifications } from '../../db/schema/auth'
import { staffInvitations, staffUsers } from '../../db/schema/identity'
import { auditLog } from '../../db/schema/ledger'
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { reportError } from '../../shared/logger'
import { assignedLeaveDays, withLeaveFigures } from '../leave/requests'
import { emailCode, emailHeading, emailNote, emailParagraph, escapeHtml, renderEmail } from '../mail/layout'
import { sendStudioSystemEmail } from '../notifications/send'
import { isPlaceholderEmail } from './account-access'
import type { StaffProfileRow } from './staff-archive'
import { STAFF_EDIT_REFUSAL_MESSAGE, staffEditRefusal } from './staff-rank'

export const EMAIL_CHANGE_CODE_TTL_MS = 10 * 60_000
export const EMAIL_CHANGE_MAX_ATTEMPTS = 5
/** How soon another code may be sent for the same person. */
export const EMAIL_CHANGE_RESEND_AFTER_MS = 30_000

const identifierFor = (staffId: string) => `staff-email-change:${staffId}`

/** What the verification row's `value` holds. */
interface PendingChange {
  email: string
  /** Null once withdrawn: no code confirms, but `sentAt` still holds the cooldown. */
  codeHash: string | null
  attempts: number
  /** On the app's clock (`lib/clock`), like the expiry — not the row's own timestamps. */
  sentAt: string
}

/** Salted with the staff id, so one code's hash says nothing about another's. */
const hashCode = (staffId: string, code: string) =>
  createHash('sha256').update(`${staffId}:${code}`).digest('hex')

function codeMatches(pending: PendingChange, staffId: string, code: string): boolean {
  if (!pending.codeHash) return false
  const expected = Buffer.from(pending.codeHash, 'hex')
  const offered = Buffer.from(hashCode(staffId, code), 'hex')
  return expected.length === offered.length && timingSafeEqual(expected, offered)
}

const emailInUse = () =>
  new ConflictError('email_in_use', {
    message: 'Another staff member of this studio already signs in with that email.',
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
  // Archived is how staff are blocked; the account is closed to changes as it is to sign-in.
  if (target.status === 'archived') {
    throw new ConflictError('staff_archived', {
      message: 'This staff member is blocked. Unblock them before changing their email.',
    })
  }
  return { target, actor }
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
 * starts at once each delete-then-insert and leave two rows, and twenty
 * confirms at once each read `attempts: 0` and spend twenty guesses against a
 * limit of five. A transaction-scoped advisory lock, because the first start
 * has no row yet to lock.
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

export interface StartStaffEmailChangeInput {
  tenantId: string
  targetStaffId: string
  actorStaffId: string
  email: string
}

export interface PendingStaffEmailChange {
  email: string
  expiresAt: Date
}

/** Step one: mail a code to the new address. Changes nothing on the account. */
export async function startStaffEmailChange(input: StartStaffEmailChangeInput): Promise<PendingStaffEmailChange> {
  const email = input.email.trim().toLowerCase()
  if (!email) throw new BadRequestError('email_required')
  const { target } = await editableTarget(input.tenantId, input.targetStaffId, input.actorStaffId)

  if (target.email.toLowerCase() === email) throw new BadRequestError('email_unchanged')
  // A placeholder can receive no code, and moving onto one is not a change anyone needs.
  if (isPlaceholderEmail(email)) {
    throw new BadRequestError('email_placeholder_not_allowed', {
      message: 'Enter an address that receives mail — a code is sent to it to confirm the change.',
    })
  }
  await assertAddressFree(input.tenantId, target, email)

  await lockPending(target.id)
  const previous = await pendingRow(input.tenantId, target.id)
  const sentAt = previous && (JSON.parse(previous.value) as PendingChange).sentAt
  if (sentAt && now().getTime() - new Date(sentAt).getTime() < EMAIL_CHANGE_RESEND_AFTER_MS) {
    throw new AppError(429, 'too_many_requests', {
      message: `A code was sent a moment ago. Wait ${EMAIL_CHANGE_RESEND_AFTER_MS / 1000} seconds before sending another.`,
    })
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const sent = now()
  const expiresAt = new Date(sent.getTime() + EMAIL_CHANGE_CODE_TTL_MS)
  const pending: PendingChange = {
    email,
    codeHash: hashCode(target.id, code),
    attempts: 0,
    sentAt: sent.toISOString(),
  }
  // A new code replaces the old one, and whatever address it was for.
  await dropPending(input.tenantId, target.id)
  await db.insert(staffAuthVerifications).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    identifier: identifierFor(target.id),
    value: JSON.stringify(pending),
    expiresAt,
  })

  const sentOk = await sendStudioSystemEmail({
    tenantId: input.tenantId,
    slug: 'staff_email_change_code',
    recipient: { email, userId: target.id, userKind: 'staff' },
    render: (studio, redact) => emailChangeCodeEmail(studio, target.name, redact ? '[redacted]' : code),
  })
  // Unlike an everyday notice, this flow is nothing without the mail: say so,
  // rather than "Code sent" for a code nobody will receive. The row goes too,
  // so the retry is not held back by the cooldown of a send that never left.
  if (!sentOk) {
    await dropPending(input.tenantId, target.id)
    throw new AppError(503, 'email_send_failed', {
      message: 'The code could not be emailed. Try again in a moment.',
    })
  }

  return { email, expiresAt }
}

export interface ConfirmStaffEmailChangeInput {
  tenantId: string
  targetStaffId: string
  actorStaffId: string
  code: string
}

/** Step two: the code back, and the address moves. Returns the staff row as the portal reads it. */
export async function confirmStaffEmailChange(input: ConfirmStaffEmailChangeInput): Promise<StaffProfileRow> {
  const { target, actor } = await editableTarget(input.tenantId, input.targetStaffId, input.actorStaffId)

  await lockPending(target.id)
  const row = await pendingRow(input.tenantId, target.id)
  const pending = row && (JSON.parse(row.value) as PendingChange)
  // No row, or one withdrawn — kept only so its cooldown still holds.
  if (!row || !pending?.codeHash) {
    throw new BadRequestError('email_change_not_requested', {
      message: 'No email change is waiting to be confirmed. Send a code first.',
    })
  }
  if (row.expiresAt.getTime() <= now().getTime()) {
    await dropPending(input.tenantId, target.id)
    throw new BadRequestError('email_change_code_expired', {
      message: 'That code has expired. Send a new one.',
    })
  }

  if (!codeMatches(pending, target.id, input.code.trim())) {
    // The count is written and then refused. A refusal does not roll the
    // request's transaction back — `onError` answers at the layer that threw —
    // so the guess stays spent; and `lockPending` makes the next guess wait
    // for this one's count.
    const attempts = pending.attempts + 1
    const left = EMAIL_CHANGE_MAX_ATTEMPTS - attempts
    if (left <= 0) {
      await dropPending(input.tenantId, target.id)
      throw new BadRequestError('email_change_code_expired', {
        message: 'Too many wrong codes. Send a new one.',
      })
    }
    await db
      .update(staffAuthVerifications)
      .set({ value: JSON.stringify({ ...pending, attempts }) })
      .where(and(eq(staffAuthVerifications.tenantId, input.tenantId), eq(staffAuthVerifications.id, row.id)))
    throw new BadRequestError('email_change_code_invalid', {
      message: `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
    })
  }

  // Checked again: the address may have been taken in the minutes the code was in flight.
  await assertAddressFree(input.tenantId, target, pending.email)
  const previousEmail = target.email

  const updated = await db
    .transaction(async tx => {
      const [moved] = await tx
        .update(staffUsers)
        .set({ email: pending.email, updatedAt: new Date() })
        .where(and(eq(staffUsers.tenantId, input.tenantId), eq(staffUsers.id, target.id)))
        .returning()
      // The same login, re-addressed: its password, second factor and sessions stay.
      // Verified, because the code just proved the address receives mail.
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
        actorStaffId: input.actorStaffId,
        actorType: 'staff',
        action: 'staff_email_changed',
        targetTable: 'staff_users',
        targetId: target.id,
        payload: { from: previousEmail, to: pending.email },
      })
      return moved!
    })
    .catch((err: unknown) => {
      // Two changes racing onto one address: the index decides.
      if (isUniqueViolation(err)) throw emailInUse()
      throw err
    })

  if (!isPlaceholderEmail(previousEmail)) {
    // Best-effort: the change is committed, and a notice that fails to send must not undo it.
    await sendStudioSystemEmail({
      tenantId: input.tenantId,
      slug: 'staff_email_changed_notice',
      recipient: { email: previousEmail, userId: target.id, userKind: 'staff' },
      render: studio =>
        emailChangedNotice(studio, target.name, pending.email, actor.id === target.id ? null : actor.name),
    }).catch(err => reportError(err, 'staff email change notice failed', { scope: 'staff-email-change' }))
  }

  const [profile] = await withLeaveFigures(input.tenantId, [
    { ...updated, ...(await assignedLeaveDays(input.tenantId, target.id)) },
  ])
  return profile ?? updated
}

/**
 * Withdraw a pending change's code — the admin closed the dialog. The row stays,
 * code-less, until it expires: deleting it would reset the resend cooldown, so
 * closing and reopening the dialog could mail codes as fast as it can be clicked.
 */
export async function cancelStaffEmailChange(input: {
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
    .set({ value: JSON.stringify({ ...pending, codeHash: null }) })
    .where(and(eq(staffAuthVerifications.tenantId, input.tenantId), eq(staffAuthVerifications.id, row.id)))
}

/* ── the two messages, in the studio's name ─────────────────────────────── */

export function emailChangeCodeEmail(studio: string, name: string, code: string) {
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
          `This address was entered as the new sign-in email for your ${escapeHtml(studio)} portal account. Give this code to whoever is making the change, or enter it yourself:`,
        ),
        emailCode(escapeHtml(code)),
        emailNote(
          "The code works once and expires in ten minutes. Until it is entered, you keep signing in with your current email. If you weren't expecting this, ignore it — nothing changes.",
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
