/**
 * Staff invitation lifecycle (admin, superadmin, or instructor). The very first
 * superadmin is seeded from SUPERADMIN_EMAIL; additional superadmins are invited
 * via this flow (per user direction, overriding the original "superadmin not
 * invitable" line in `admin-restructure.md` §15a). Instructors share the same
 * email-invite path as admins. See `be-portal.md` §3a.
 *
 * Flow:
 *   1. Superadmin POSTs /portal/admin/staff/invite { email, granted_location_ids? }
 *   2. We insert one `staff_users` row (status='pending') + one `staff_invitations`
 *      row (token, expires_at = now+7d) in a single transaction
 *   3. Email the invitee a sign-up link to `PORTAL_ORIGIN/signup?invite_email=…`
 *      (NOT a token-gated landing — they sign up with Clerk normally; the
 *      Clerk webhook matches by email and links them to the pending row)
 */
import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { staffUsers, staffInvitations } from '../../db/schema/identity'
import { instructors } from '../../db/schema/catalog'
import { ConflictError, NotFoundError } from '../../shared/errors'
import { env } from '../../env'
import { sendTemplatedEmail } from '../notifications/send'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type StaffUserRow = typeof staffUsers.$inferSelect
export type StaffInvitationRow = typeof staffInvitations.$inferSelect

export type InvitableRole = 'admin' | 'superadmin' | 'instructor'

export interface InviteAdminInput {
  email: string
  role?: InvitableRole
  grantedLocationIds?: string[]
  invitedByStaffId: string
}

function cryptoRandomBase64Url(byteLen: number): string {
  return randomBytes(byteLen).toString('base64url')
}

function emailLocalPart(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

export function buildSignUpUrl(email: string, token?: string): string {
  const base = `${env.PORTAL_ORIGIN.replace(/\/+$/, '')}/signup?invite_email=${encodeURIComponent(email)}`
  return token ? `${base}&invite_token=${encodeURIComponent(token)}` : base
}

export type InvitationLookupStatus = 'valid' | 'expired' | 'used' | 'revoked' | 'not_found'

export interface InvitationLookup {
  status: InvitationLookupStatus
  email: string | null
  role: InvitableRole | null
}

/**
 * Public (unauthenticated) lookup used by the signup page to render the right
 * state for an invite link. Expiry is computed from `expires_at`, NOT persisted:
 * the row stays `pending` so it remains visible in the admin invitation list and
 * a resend (which extends `expires_at`) revives the link. This also keeps the
 * public endpoint read-only.
 */
export async function lookupInvitationByToken(token: string): Promise<InvitationLookup> {
  const [inv] = await db
    .select()
    .from(staffInvitations)
    .where(eq(staffInvitations.token, token))
    .limit(1)
  if (!inv) return { status: 'not_found', email: null, role: null }

  const role = inv.role as InvitableRole
  if (inv.status === 'accepted') return { status: 'used', email: inv.email, role }
  if (inv.status === 'revoked') return { status: 'revoked', email: inv.email, role }

  // pending (or a legacy 'expired' status) — treat a past-due invite as expired
  // by comparison, without mutating the row.
  if (inv.status === 'expired' || inv.expiresAt.getTime() < Date.now()) {
    return { status: 'expired', email: inv.email, role }
  }

  return { status: 'valid', email: inv.email, role }
}

function formatExpiresAt(d: Date): string {
  // Human-readable SGT-friendly format for the email body.
  return d.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'long',
    timeStyle: 'short',
  })
}

/**
 * Create a pending admin invitation + send the invite email.
 * Returns the inserted invitation row.
 */
export async function inviteAdmin(input: InviteAdminInput): Promise<StaffInvitationRow> {
  const email = input.email.trim().toLowerCase()
  const role: InvitableRole = input.role ?? 'admin'
  // Superadmin ignores granted_location_ids (implicit grant = all locations).
  // Instructors don't carry location grants — they teach where assigned.
  const grants = role === 'admin' ? (input.grantedLocationIds ?? []) : []
  const now = new Date()
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS)

  const { invitation, inviterName } = await db.transaction(async tx => {
    // Existing staff with this email blocks invitation. Active or pending = already in use;
    // archived = explicitly refuse re-use (audit log integrity — superadmin should restore
    // archived accounts via a separate path, not by re-inviting).
    const [existing] = await tx
      .select()
      .from(staffUsers)
      .where(and(sql`lower(${staffUsers.email}) = ${email}`, isNull(staffUsers.deletedAt)))
      .limit(1)
    if (existing) {
      if (existing.status === 'archived') {
        throw new ConflictError('email_was_archived', {
          message:
            'This email was previously archived. Restore the archived account instead of re-inviting.',
        })
      }
      throw new ConflictError('email_in_use', {
        message: `This email is already on the staff list (status=${existing.status}).`,
      })
    }

    const [staffRow] = await tx
      .insert(staffUsers)
      .values({
        email,
        name: emailLocalPart(email),
        role,
        status: 'pending',
        grantedLocationIds: grants,
        invitedAt: now,
      })
      .returning()
    if (!staffRow) throw new Error('staff_users_insert_failed')

    // Instructor role requires a profile row so the catalog INNER JOIN in
    // listInstructors/loadById matches. Profile fields are populated later
    // when the instructor edits their bio/photo.
    if (role === 'instructor') {
      await tx.insert(instructors).values({
        staffUserId: staffRow.id,
        bio: null,
        phone: null,
        photoR2Key: null,
      })
    }

    const [inv] = await tx
      .insert(staffInvitations)
      .values({
        email,
        role,
        grantedLocationIds: grants,
        token: cryptoRandomBase64Url(32),
        expiresAt,
        status: 'pending',
        invitedByStaffId: input.invitedByStaffId,
        staffUserId: staffRow.id,
        createdAt: now,
      })
      .returning()
    if (!inv) throw new Error('staff_invitations_insert_failed')

    const [inviter] = await tx
      .select({ name: staffUsers.name })
      .from(staffUsers)
      .where(eq(staffUsers.id, input.invitedByStaffId))
      .limit(1)

    return { invitation: inv, inviterName: inviter?.name ?? 'Yoga Sadhana' }
  })

  // Email is best-effort and runs OUTSIDE the transaction so a transient SMTP
  // failure doesn't roll back the invitation. Failures land in `email_log`.
  await sendTemplatedEmail({
    slug: 'admin_invite',
    recipient: { email, userId: invitation.staffUserId, userKind: 'staff' },
    variables: {
      // Canonical variables from services/notifications/variables.ts
      name: emailLocalPart(email),
      invite_url: buildSignUpUrl(email, invitation.token),
      expires_at: formatExpiresAt(expiresAt),
      // Friendly extras — unknown {{}} are left as-is per spec, but the
      // seeded template uses these for richer copy.
      invitee_email: email,
      inviter_name: inviterName,
      sign_up_url: buildSignUpUrl(email, invitation.token),
    },
  })

  return invitation
}

export interface ListStaffResult {
  staff: StaffUserRow[]
  invitations: Array<StaffInvitationRow & { invitedByStaffName: string | null }>
}

/**
 * Returns active/pending staff plus all pending invitations. Accepted invitations
 * are reflected by the corresponding staff row's status flipping to 'active', so
 * we filter them out of the invitations list to avoid double-display.
 */
export async function listStaffAndInvitations(opts?: {
  includeArchived?: boolean
}): Promise<ListStaffResult> {
  const includeArchived = opts?.includeArchived ?? false

  const staff = await db
    .select()
    .from(staffUsers)
    .where(
      and(
        isNull(staffUsers.deletedAt),
        includeArchived ? sql`true` : sql`${staffUsers.status} <> 'archived'`,
      ),
    )
    .orderBy(desc(staffUsers.createdAt))

  // Denormalise inviter name via a correlated subquery.
  const invitations = await db
    .select({
      id: staffInvitations.id,
      email: staffInvitations.email,
      role: staffInvitations.role,
      grantedLocationIds: staffInvitations.grantedLocationIds,
      token: staffInvitations.token,
      expiresAt: staffInvitations.expiresAt,
      status: staffInvitations.status,
      invitedByStaffId: staffInvitations.invitedByStaffId,
      staffUserId: staffInvitations.staffUserId,
      createdAt: staffInvitations.createdAt,
      acceptedAt: staffInvitations.acceptedAt,
      revokedAt: staffInvitations.revokedAt,
      invitedByStaffName: sql<string | null>`(SELECT name FROM staff_users WHERE id = ${staffInvitations.invitedByStaffId})`,
    })
    .from(staffInvitations)
    .where(eq(staffInvitations.status, 'pending'))
    .orderBy(desc(staffInvitations.createdAt))

  return { staff, invitations: invitations as ListStaffResult['invitations'] }
}

/**
 * Revoke a pending invitation. If the matching staff_users row is still
 * pending + unlinked from Clerk, delete it (clean revocation). If the
 * invitation has already been accepted, return 409.
 */
export async function revokeInvitation(
  invitationId: string,
  _actorStaffId: string,
): Promise<StaffInvitationRow> {
  return db.transaction(async tx => {
    const [inv] = await tx
      .select()
      .from(staffInvitations)
      .where(eq(staffInvitations.id, invitationId))
      .limit(1)
    if (!inv) throw new NotFoundError('invitation_not_found')
    if (inv.status === 'accepted') throw new ConflictError('already_accepted')
    if (inv.status !== 'pending') {
      // Already revoked / expired — idempotent return.
      return inv
    }

    const now = new Date()
    const [updated] = await tx
      .update(staffInvitations)
      .set({ status: 'revoked', revokedAt: now })
      .where(eq(staffInvitations.id, invitationId))
      .returning()

    if (inv.staffUserId) {
      // Only delete the staff_users row if it never linked to a Clerk user —
      // otherwise the user did sign up and we should keep the audit trail.
      await tx
        .delete(staffUsers)
        .where(
          and(
            eq(staffUsers.id, inv.staffUserId),
            eq(staffUsers.status, 'pending'),
            isNull(staffUsers.clerkUserId),
          ),
        )
    }

    return updated!
  })
}

/**
 * Re-fire the admin_invite email. Token is unchanged; expires_at extended
 * to now + 7d so the sign-up link works again.
 */
export async function resendInvitation(
  invitationId: string,
  _actorStaffId: string,
): Promise<StaffInvitationRow> {
  const [inv] = await db
    .select()
    .from(staffInvitations)
    .where(eq(staffInvitations.id, invitationId))
    .limit(1)
  if (!inv) throw new NotFoundError('invitation_not_found')
  if (inv.status !== 'pending') {
    throw new ConflictError('invitation_not_pending', { status: inv.status })
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS)

  const [updated] = await db
    .update(staffInvitations)
    .set({ createdAt: now, expiresAt })
    .where(eq(staffInvitations.id, invitationId))
    .returning()
  if (!updated) throw new Error('staff_invitations_update_failed')

  // Look up inviter name for the email body.
  const [inviter] = await db
    .select({ name: staffUsers.name })
    .from(staffUsers)
    .where(eq(staffUsers.id, inv.invitedByStaffId))
    .limit(1)

  await sendTemplatedEmail({
    slug: 'admin_invite',
    recipient: { email: inv.email, userId: inv.staffUserId, userKind: 'staff' },
    variables: {
      name: emailLocalPart(inv.email),
      invite_url: buildSignUpUrl(inv.email, inv.token),
      expires_at: formatExpiresAt(expiresAt),
      invitee_email: inv.email,
      inviter_name: inviter?.name ?? 'Yoga Sadhana',
      sign_up_url: buildSignUpUrl(inv.email, inv.token),
    },
  })

  return updated
}
