/**
 * A person's access to this studio, as an admin manages it from their detail
 * view (#119): the sessions they hold here, signing them out everywhere, and
 * resending a staff member's or a member's set-password mail. Blocking and unblocking are the
 * existing acts — `softDeleteClient` / `restoreClient` for a member,
 * `archiveStaff` / `unarchiveStaff` for staff. Every one of them is logged in
 * `auth_events` as the acting staff member's (`recordStaffAct`).
 *
 * **"Everywhere" means every device, at this studio.** Not the admin plugin's
 * revoke-all or ban, which are keyed on the auth user alone: one person holds one
 * auth user across every studio they belong to, and studio A signing them out, or
 * blocking them, is not studio A's to do at studio B (`endStaffSessionsAt`).
 *
 * **Every lookup starts from this studio's row.** The target is found by its
 * `clients` / `staff_users` id *at the caller's Tenant*, and only then by its
 * auth user — so an id from another studio is a 404, never a session list.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { clients, staffInvitations, staffUsers } from '../../db/schema/identity'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { requireTenantUrl } from '../tenants/urls'
import { endClientSessionsAt, endStaffSessionsAt, listSessionsAt, type SessionAtStudio } from './auth-users'
import { mailStaffSetPasswordLink } from './better-auth'
import { mailLinkOrThrow } from './member-passwords'
import { resendInvitation } from './invitations'
import { recordStaffAct } from './staff-acts'

/* ── members ───────────────────────────────────────────────────────────── */

async function memberAuthUserId(tenantId: string, clientId: string): Promise<string | null> {
  const [row] = await db
    .select({ authUserId: clients.authUserId })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId)))
    .limit(1)
  if (!row) throw new NotFoundError('client_not_found')
  return row.authUserId
}

/** A member's sessions at this studio. A member with no auth user has none. */
export async function listMemberSessions(tenantId: string, clientId: string): Promise<SessionAtStudio[]> {
  const authUserId = await memberAuthUserId(tenantId, clientId)
  return authUserId ? listSessionsAt(db, 'client', tenantId, authUserId) : []
}

/** End every session a member holds at this studio, and log it. Returns how many ended. */
export async function signMemberOutEverywhere(input: {
  tenantId: string
  clientId: string
  actorStaffId: string
  from?: Headers
}): Promise<number> {
  const authUserId = await memberAuthUserId(input.tenantId, input.clientId)
  const ended = authUserId ? await endClientSessionsAt(db, input.tenantId, authUserId) : 0
  await recordStaffAct({
    tenantId: input.tenantId,
    actorStaffId: input.actorStaffId,
    kind: 'sessions_revoked',
    subjectUserId: authUserId,
    from: input.from,
  })
  return ended
}

/**
 * Mail a member the link that sets their password (#173) — for a member who
 * never received theirs, or lost it. The same link their own email step or
 * "forgot password" sends, landing on this studio's member app. A blocked
 * member is refused: the link would lead to a sign-in their block refuses.
 */
export async function sendMemberSetPasswordLink(input: {
  tenantId: string
  clientId: string
  actorStaffId: string
  from: Headers
}): Promise<void> {
  const [target] = await db
    .select({ email: clients.email, authUserId: clients.authUserId, deletedAt: clients.deletedAt })
    .from(clients)
    .where(and(eq(clients.tenantId, input.tenantId), eq(clients.id, input.clientId)))
    .limit(1)
  if (!target) throw new NotFoundError('client_not_found')
  if (target.deletedAt) throw new ConflictError('client_blocked')
  if (!target.authUserId) throw new BadRequestError('client_not_provisioned')

  await mailLinkOrThrow(input.from, target.email, input.tenantId)
  await recordStaffAct({
    tenantId: input.tenantId,
    actorStaffId: input.actorStaffId,
    kind: 'invitation_resent',
    subjectUserId: target.authUserId,
    from: input.from,
  })
}

/* ── staff ─────────────────────────────────────────────────────────────── */

async function staffTarget(tenantId: string, staffId: string) {
  const [row] = await db
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, staffId), isNull(staffUsers.deletedAt)))
    .limit(1)
  if (!row) throw new NotFoundError('staff_not_found')
  return row
}

/** A staff member's sessions at this studio. */
export async function listStaffSessions(tenantId: string, staffId: string): Promise<SessionAtStudio[]> {
  const target = await staffTarget(tenantId, staffId)
  return target.authUserId ? listSessionsAt(db, 'staff', tenantId, target.authUserId) : []
}

/**
 * End every session a staff member holds at this studio, and log it.
 *
 * Any admin may sign any staff member out, another admin included. Unlike archival
 * it is not a lockout risk in the first place: the person signed out can sign
 * straight back in. Yourself is allowed — it is how you end the session on a
 * phone you have lost — and signs out this tab too.
 */
export async function signStaffOutEverywhere(input: {
  tenantId: string
  targetStaffId: string
  actorStaffId: string
  from?: Headers
}): Promise<number> {
  const target = await staffTarget(input.tenantId, input.targetStaffId)
  const ended = target.authUserId ? await endStaffSessionsAt(db, input.tenantId, target.authUserId) : 0
  await recordStaffAct({
    tenantId: input.tenantId,
    actorStaffId: input.actorStaffId,
    kind: 'sessions_revoked',
    subjectUserId: target.authUserId,
    from: input.from,
  })
  return ended
}

/**
 * Resend a pending invitation — from the invitation list, by its id — and log it
 * against the staff member it invites.
 */
export async function resendStaffInvitation(input: {
  tenantId: string
  invitationId: string
  actorStaffId: string
  from?: Headers
}) {
  const invitation = await resendInvitation(input.tenantId, input.invitationId, input.actorStaffId)
  const [invitee] = invitation.staffUserId
    ? await db
        .select({ authUserId: staffUsers.authUserId })
        .from(staffUsers)
        .where(and(eq(staffUsers.tenantId, input.tenantId), eq(staffUsers.id, invitation.staffUserId)))
        .limit(1)
    : []
  await recordStaffAct({
    tenantId: input.tenantId,
    actorStaffId: input.actorStaffId,
    kind: 'invitation_resent',
    subjectUserId: invitee?.authUserId ?? null,
    from: input.from,
  })
  return invitation
}

/** What a resend from the staff detail view mailed. */
export type ResentMail = 'invitation' | 'set_password'

/**
 * Resend the mail that lets a staff member set their password.
 *
 * While their invitation is pending, that is the invitation itself — the same
 * resend the invitation list offers, extending its week. Once there is none —
 * an account that predates invitations, or someone who has lost their password —
 * it is Better Auth's reset link, on this studio's portal: it sets a first
 * password as readily as it replaces one.
 *
 * An archived staff member is refused: the link would lead to a sign-in their
 * status refuses anyway.
 */
export async function resendStaffSetPassword(input: {
  tenantId: string
  targetStaffId: string
  actorStaffId: string
  from: Headers
}): Promise<ResentMail> {
  const target = await staffTarget(input.tenantId, input.targetStaffId)
  if (target.status === 'archived') throw new ConflictError('staff_archived')

  const [pending] = await db
    .select({ id: staffInvitations.id })
    .from(staffInvitations)
    .where(
      and(
        eq(staffInvitations.tenantId, input.tenantId),
        eq(staffInvitations.staffUserId, target.id),
        eq(staffInvitations.status, 'pending'),
      ),
    )
    .limit(1)

  if (pending) {
    await resendStaffInvitation({ ...input, invitationId: pending.id })
    return 'invitation'
  }

  if (!target.authUserId) throw new BadRequestError('staff_not_provisioned')
  await mailStaffSetPasswordLink(input.from, target.email, await requireTenantUrl('portal', input.tenantId))
  await recordStaffAct({
    tenantId: input.tenantId,
    actorStaffId: input.actorStaffId,
    kind: 'invitation_resent',
    subjectUserId: target.authUserId,
    from: input.from,
  })
  return 'set_password'
}
