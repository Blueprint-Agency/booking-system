/**
 * Staff invitation lifecycle (admin, superadmin, or instructor). The very first
 * superadmin is seeded from SUPERADMIN_EMAIL; additional superadmins are invited
 * via this flow (per user direction, overriding the original "superadmin not
 * invitable" line in `admin-restructure.md` §15a). Instructors share the same
 * email-invite path as admins. See `be-portal.md` §3a.
 *
 * **Invitation-only, in fact (#115).** Nobody signs up. An invitation writes
 * everything a staff member is, in one transaction:
 *
 *   1. the `staff` pool auth user (Better Auth), with no password
 *   2. the `staff_users` row (status='pending'), linked to it by `auth_user_id`
 *   3. the `staff_invitations` row (token, expires_at = now+7d)
 *
 * and then mails a link to `{studio portal origin}/signup?invite_token=…`. That
 * page is where the invitee chooses a password: `acceptInvitation` checks the
 * token, sets the password and activates the row, and the portal signs in with
 * it. There is no webhook matching a stranger's sign-up to a row by address.
 *
 * The link is our token, not a Better Auth reset link, for two reasons: the
 * invitation lives for a week and a reset token for an hour, and the mail is the
 * studio's own invitation copy (`admin_invite` / `instructor_invite`), not a
 * password-reset notice.
 */
import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { db } from '../../db'
import type * as schema from '../../db/schema'
import { staffUsers, staffInvitations } from '../../db/schema/identity'
import { instructors } from '../../db/schema/catalog'
import { tenantDisplayName } from '../tenants/mail-identity'
import { requireTenantUrl } from '../tenants/urls'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { sendTemplatedEmail } from '../notifications/send'
import { splitName, joinName } from '../../lib/name'
import { sgFormat } from '../../lib/time'
import { withLeaveFigures } from '../leave/requests'
import {
  ensureAuthUser,
  hasStaffPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  removeUnusedStaffUser,
  renameStaffUser,
  setFirstStaffPassword,
} from './auth-users'
import type { StaffProfileRow } from './staff-archive'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type StaffUserRow = typeof staffUsers.$inferSelect
export type StaffInvitationRow = typeof staffInvitations.$inferSelect

export type InvitableRole = 'admin' | 'superadmin' | 'instructor'

export interface InviteAdminInput {
  tenantId: string
  email: string
  role?: InvitableRole
  grantedLocationIds?: string[]
  invitedByStaffId: string
}

/** A handle an invitation can be written through — `db`, or a transaction on it. */
type Writer = Pick<PostgresJsDatabase<typeof schema>, 'insert' | 'select'>

function cryptoRandomBase64Url(byteLen: number): string {
  return randomBytes(byteLen).toString('base64url')
}

function emailLocalPart(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

/**
 * The set-password link, on the **inviting studio's own portal**.
 *
 * `portalUrl` is that studio's origin, from `requireTenantUrl('portal', …)`, and
 * is a parameter rather than read here so the lookup that can fail happens
 * before the invitation row is written — an admin gets a refusal instead of a
 * committed invitation nobody could be told about.
 *
 * On the studio's own hostname because that is the only place the token is
 * found: an invitation is looked up inside the Tenant it was issued for.
 */
export function buildSignUpUrl(portalUrl: string, email: string, token: string): string {
  return `${portalUrl.replace(/\/+$/, '')}/signup?invite_email=${encodeURIComponent(email)}&invite_token=${encodeURIComponent(token)}`
}

export interface PendingStaffInput {
  tenantId: string
  email: string
  name: string
  role: InvitableRole
  grantedLocationIds?: string[]
  invitedByStaffId: string
  bio?: string | null
  phone?: string | null
  photoR2Key?: string | null
}

/**
 * Write a staff member who has been invited and not yet arrived: the auth user,
 * the pending `staff_users` row linked to it, the instructor profile when the
 * role needs one, and the invitation. Through `tx`, so a caller's transaction
 * takes all of it or none.
 *
 * The auth user is found by address when it already exists — a person who is
 * staff at another studio has one account — and made otherwise.
 */
export async function writePendingStaff(
  tx: Writer,
  input: PendingStaffInput,
): Promise<{ staff: StaffUserRow; invitation: StaffInvitationRow }> {
  const email = input.email.trim().toLowerCase()
  const now = new Date()
  // Superadmin ignores granted_location_ids (implicit grant = all locations).
  // Instructors don't carry location grants — they teach where assigned.
  const grants = input.role === 'admin' ? (input.grantedLocationIds ?? []) : []
  const { firstName, lastName } = splitName(input.name)

  const authUserId = await ensureAuthUser(tx, 'staff', { email, name: input.name })

  const [staff] = await tx
    .insert(staffUsers)
    .values({
      tenantId: input.tenantId,
      email,
      name: joinName(firstName, lastName),
      firstName,
      lastName,
      role: input.role,
      status: 'pending',
      grantedLocationIds: grants,
      invitedAt: now,
      authUserId,
      bio: input.bio ?? null,
      phone: input.phone ?? null,
    })
    .returning()
  if (!staff) throw new Error('staff_users_insert_failed')

  // Instructor role requires a profile row so the catalog INNER JOIN in
  // listInstructors/loadById matches. Profile fields are populated later
  // when the instructor edits their bio/photo.
  if (input.role === 'instructor') {
    await tx.insert(instructors).values({
      tenantId: input.tenantId,
      staffUserId: staff.id,
      photoR2Key: input.photoR2Key ?? null,
    })
  }

  const [invitation] = await tx
    .insert(staffInvitations)
    .values({
      tenantId: input.tenantId,
      email,
      role: input.role,
      grantedLocationIds: grants,
      token: cryptoRandomBase64Url(32),
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      status: 'pending',
      invitedByStaffId: input.invitedByStaffId,
      staffUserId: staff.id,
      createdAt: now,
    })
    .returning()
  if (!invitation) throw new Error('staff_invitations_insert_failed')

  return { staff, invitation }
}

// Human-readable SGT-friendly format for the email body.
const expiresAtFormat = sgFormat('en-SG', { dateStyle: 'long', timeStyle: 'short' })

/**
 * Mail an invitation's set-password link, in the studio's own invitation copy
 * for the role.
 *
 * Best-effort, and called OUTSIDE the transaction that wrote the invitation, so
 * a transient mail failure doesn't roll the invitation back. Failures land in
 * `email_log`, and resending is the way to try again.
 */
export async function mailInvitation(input: {
  tenantId: string
  invitation: StaffInvitationRow
  portalUrl: string
  name: string
  inviterName: string
}): Promise<void> {
  const { invitation } = input
  const link = buildSignUpUrl(input.portalUrl, invitation.email, invitation.token)
  await sendTemplatedEmail({
    tenantId: input.tenantId,
    slug: invitation.role === 'instructor' ? 'instructor_invite' : 'admin_invite',
    recipient: { email: invitation.email, userId: invitation.staffUserId, userKind: 'staff' },
    variables: {
      // Canonical variables from services/notifications/variables.ts
      name: input.name,
      invite_url: link,
      expires_at: expiresAtFormat.format(invitation.expiresAt),
      // Friendly extras — unknown {{}} are left as-is per spec, but the
      // seeded template uses these for richer copy.
      invitee_email: invitation.email,
      inviter_name: input.inviterName,
      sign_up_url: link,
    },
    // The link is the way into a staff account, so the log keeps it redacted.
    secretVariables: ['invite_url', 'sign_up_url'],
  })
}

/**
 * The name that signs an invitation: the inviting colleague's, or — when there
 * is none — the studio's. Never the platform's, and never another tenant's.
 */
export async function inviterNameFor(tenantId: string, invitation: StaffInvitationRow): Promise<string> {
  const [inviter] = await db
    .select({ name: staffUsers.name })
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, invitation.invitedByStaffId)))
    .limit(1)
  return inviter?.name ?? tenantDisplayName(tenantId)
}

export type InvitationLookupStatus = 'valid' | 'expired' | 'used' | 'revoked' | 'not_found'

export interface InvitationLookup {
  status: InvitationLookupStatus
  email: string | null
  role: InvitableRole | null
  /**
   * Whether the invitee already has a password — they are staff at another
   * studio, say — so the page asks them to sign in with it rather than choose
   * one. Always false unless the invitation is `valid`.
   */
  passwordSet: boolean
}

/**
 * The invitation a token names, at the studio whose context is open.
 *
 * Expiry is computed from `expires_at`, NOT persisted: the row stays `pending`
 * so it remains visible in the admin invitation list and a resend (which extends
 * `expires_at`) revives the link.
 *
 * Tenant-scoped by the request's context: tokens are unique per Tenant, and the
 * link was mailed on the inviting studio's own hostname, so a token presented at
 * any other studio finds nothing.
 */
async function findInvitation(tenantId: string, token: string) {
  const [inv] = await db
    .select()
    .from(staffInvitations)
    .where(and(eq(staffInvitations.tenantId, tenantId), eq(staffInvitations.token, token)))
    .limit(1)
  if (!inv) return { inv: null, status: 'not_found' as const }
  if (inv.status === 'accepted') return { inv, status: 'used' as const }
  if (inv.status === 'revoked') return { inv, status: 'revoked' as const }
  // pending (or a legacy 'expired' status) — treat a past-due invite as expired
  // by comparison, without mutating the row.
  if (inv.status === 'expired' || inv.expiresAt.getTime() < Date.now()) {
    return { inv, status: 'expired' as const }
  }
  return { inv, status: 'valid' as const }
}

/**
 * Public (unauthenticated) lookup used by the set-password page to render the
 * right state for an invite link. Read-only.
 */
export async function lookupInvitationByToken(tenantId: string, token: string): Promise<InvitationLookup> {
  const { inv, status } = await findInvitation(tenantId, token)
  if (!inv) return { status, email: null, role: null, passwordSet: false }

  let passwordSet = false
  if (status === 'valid' && inv.staffUserId) {
    const [staff] = await db
      .select({ authUserId: staffUsers.authUserId })
      .from(staffUsers)
      .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, inv.staffUserId)))
      .limit(1)
    if (staff?.authUserId) passwordSet = await hasStaffPassword(db, staff.authUserId)
  }
  return { status, email: inv.email, role: inv.role as InvitableRole, passwordSet }
}

const ACCEPT_REFUSALS = {
  used: 'invitation_used',
  revoked: 'invitation_revoked',
  expired: 'invitation_expired',
} as const

/**
 * Accept an invitation: the link's holder chooses a password, and the pending
 * staff member becomes an active one.
 *
 * Holding the token is the proof. It was mailed to the invited address and
 * nowhere else, which is the same proof a password-reset link rests on.
 *
 * A person who already has a password — staff at another studio, with one
 * account — keeps it: `password` is ignored, and they sign in with the one they
 * have. A token can set a first password; it can never replace one.
 *
 * In one transaction, with the invitation claimed first by a conditional update,
 * so two tabs submitting the same link cannot both get through.
 */
export async function acceptInvitation(input: {
  tenantId: string
  token: string
  password?: string
  /** The name they go by, replacing the placeholder an invitation starts with. Both or neither. */
  firstName?: string
  lastName?: string
}): Promise<{ email: string }> {
  const { tenantId } = input
  return db.transaction(async tx => {
    const { inv, status } = await findInvitation(tenantId, input.token)
    if (!inv) throw new NotFoundError('invitation_not_found')
    if (status !== 'valid') throw new ConflictError(ACCEPT_REFUSALS[status])

    const [staff] = inv.staffUserId
      ? await tx
          .select()
          .from(staffUsers)
          .where(
            and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, inv.staffUserId), isNull(staffUsers.deletedAt)),
          )
          .limit(1)
      : []
    if (!staff) throw new NotFoundError('invitation_not_found')

    const now = new Date()
    const [claimed] = await tx
      .update(staffInvitations)
      .set({ status: 'accepted', acceptedAt: now })
      .where(
        and(
          eq(staffInvitations.tenantId, tenantId),
          eq(staffInvitations.id, inv.id),
          eq(staffInvitations.status, 'pending'),
        ),
      )
      .returning({ id: staffInvitations.id })
    if (!claimed) throw new ConflictError('invitation_used')

    // An invitation written before invitations made the auth user (#115), or one
    // whose auth user was removed when a sibling invitation at another studio was
    // revoked, is linked here instead.
    const authUserId =
      staff.authUserId ?? (await ensureAuthUser(tx, 'staff', { email: staff.email, name: staff.name }))

    if (!(await hasStaffPassword(tx, authUserId))) {
      const password = input.password ?? ''
      if (!password) throw new BadRequestError('password_required')
      if (password.length < MIN_PASSWORD_LENGTH) throw new BadRequestError('password_too_short')
      if (password.length > MAX_PASSWORD_LENGTH) throw new BadRequestError('password_too_long')
      await setFirstStaffPassword(tx, authUserId, password)
    }

    const named =
      input.firstName && input.lastName
        ? { firstName: input.firstName, lastName: input.lastName, name: joinName(input.firstName, input.lastName) }
        : {}
    await tx
      .update(staffUsers)
      .set({ ...named, authUserId, status: 'active', acceptedAt: staff.acceptedAt ?? now, updatedAt: now })
      .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, staff.id)))
    // The account's name too, so mail the auth pool sends greets them by it.
    if (named.name) await renameStaffUser(tx, authUserId, named.name)

    return { email: staff.email }
  })
}

/**
 * Create a pending invitation + send the invite email.
 * Returns the inserted invitation row.
 */
export async function inviteAdmin(input: InviteAdminInput): Promise<StaffInvitationRow> {
  const email = input.email.trim().toLowerCase()
  const role: InvitableRole = input.role ?? 'admin'

  // Resolved before anything is written. The link is the whole point of an
  // invitation, so a studio the platform cannot build a portal URL for must fail
  // here — not after a `staff_users` row and a token exist for someone who was
  // never told about either.
  const portalUrl = await requireTenantUrl('portal', input.tenantId)

  const invitation = await db.transaction(async tx => {
    // Existing staff with this email blocks invitation. Active or pending = already in use;
    // archived = explicitly refuse re-use (audit log integrity — superadmin should restore
    // archived accounts via a separate path, not by re-inviting).
    //
    // Platform-wide rather than per-tenant, for the same reason as
    // `createInstructor`: `staff_users.email` still carries a global unique
    // index, so a scoped check would trade a clean 409 for a constraint error.
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

    // No first/last name is collected at invite time (just email + role), so the
    // address's local part stands in until the person edits their profile.
    const { invitation } = await writePendingStaff(tx, {
      tenantId: input.tenantId,
      email,
      name: emailLocalPart(email),
      role,
      grantedLocationIds: input.grantedLocationIds,
      invitedByStaffId: input.invitedByStaffId,
    })
    return invitation
  })

  await mailInvitation({
    tenantId: input.tenantId,
    invitation,
    portalUrl,
    name: emailLocalPart(email),
    inviterName: await inviterNameFor(input.tenantId, invitation),
  })

  return invitation
}

export interface ListStaffResult {
  staff: StaffProfileRow[]
  invitations: Array<StaffInvitationRow & { invitedByStaffName: string | null }>
}

/**
 * Returns active/pending staff plus all pending invitations. Accepted invitations
 * are reflected by the corresponding staff row's status flipping to 'active', so
 * we filter them out of the invitations list to avoid double-display.
 */
export async function listStaffAndInvitations(
  tenantId: string,
  opts?: {
    includeArchived?: boolean
  },
): Promise<ListStaffResult> {
  const includeArchived = opts?.includeArchived ?? false

  // Left-joined so the Assigned Days ride along on the instructors and are
  // simply absent on everyone else — see StaffProfileRow.
  const staffRows = await db
    .select({
      staff: staffUsers,
      annualLeaveDays: instructors.annualLeaveDays,
      medicalLeaveDays: instructors.medicalLeaveDays,
      studyLeaveDays: instructors.studyLeaveDays,
    })
    .from(staffUsers)
    .leftJoin(instructors, eq(instructors.staffUserId, staffUsers.id))
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        isNull(staffUsers.deletedAt),
        includeArchived ? sql`true` : sql`${staffUsers.status} <> 'archived'`,
      ),
    )
    .orderBy(desc(staffUsers.createdAt))

  const staff = await withLeaveFigures(
    tenantId,
    staffRows.map(r =>
      r.annualLeaveDays === null || r.medicalLeaveDays === null || r.studyLeaveDays === null
        ? r.staff
        : {
            ...r.staff,
            annualLeaveDays: r.annualLeaveDays,
            medicalLeaveDays: r.medicalLeaveDays,
            studyLeaveDays: r.studyLeaveDays,
          },
    ),
  )

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
    .where(
      and(eq(staffInvitations.tenantId, tenantId), eq(staffInvitations.status, 'pending')),
    )
    .orderBy(desc(staffInvitations.createdAt))

  return { staff, invitations: invitations as ListStaffResult['invitations'] }
}

/**
 * Revoke a pending invitation, taking with it what the invitation made: the
 * still-pending staff row, and the auth user if nobody ever set a password on
 * it. If the invitation has already been accepted, return 409.
 */
export async function revokeInvitation(
  tenantId: string,
  invitationId: string,
  _actorStaffId: string,
): Promise<StaffInvitationRow> {
  return db.transaction(async tx => {
    const [inv] = await tx
      .select()
      .from(staffInvitations)
      .where(
        and(eq(staffInvitations.tenantId, tenantId), eq(staffInvitations.id, invitationId)),
      )
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
      .where(
        and(eq(staffInvitations.tenantId, tenantId), eq(staffInvitations.id, invitationId)),
      )
      .returning()

    if (inv.staffUserId) {
      // Only a row that is still pending — anyone who did arrive keeps their
      // audit trail. A pending row linked to a Clerk user signed up the old
      // way, and is kept for the same reason.
      const [removed] = await tx
        .delete(staffUsers)
        .where(
          and(
            eq(staffUsers.tenantId, tenantId),
            eq(staffUsers.id, inv.staffUserId),
            eq(staffUsers.status, 'pending'),
            isNull(staffUsers.clerkUserId),
          ),
        )
        .returning({ authUserId: staffUsers.authUserId })
      if (removed?.authUserId) await removeUnusedStaffUser(tx, removed.authUserId)
    }

    return updated!
  })
}

/**
 * Re-fire the invitation email. Token is unchanged; expires_at extended
 * to now + 7d so the set-password link works again.
 */
export async function resendInvitation(
  tenantId: string,
  invitationId: string,
  _actorStaffId: string,
): Promise<StaffInvitationRow> {
  const [inv] = await db
    .select()
    .from(staffInvitations)
    .where(and(eq(staffInvitations.tenantId, tenantId), eq(staffInvitations.id, invitationId)))
    .limit(1)
  if (!inv) throw new NotFoundError('invitation_not_found')
  if (inv.status !== 'pending') {
    throw new ConflictError('invitation_not_pending', { status: inv.status })
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS)

  // Before the extension, for the reason `inviteAdmin` gives: an invitation
  // whose expiry was pushed out but whose email could not be built is a link
  // that silently did not arrive.
  const portalUrl = await requireTenantUrl('portal', tenantId)

  const [updated] = await db
    .update(staffInvitations)
    .set({ createdAt: now, expiresAt })
    .where(and(eq(staffInvitations.tenantId, tenantId), eq(staffInvitations.id, invitationId)))
    .returning()
  if (!updated) throw new Error('staff_invitations_update_failed')

  const [invitee] = inv.staffUserId
    ? await db
        .select({ name: staffUsers.name, role: staffUsers.role })
        .from(staffUsers)
        .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, inv.staffUserId)))
        .limit(1)
    : []

  await mailInvitation({
    tenantId,
    invitation: updated,
    portalUrl,
    // An instructor was created with a real name; an invited admin has only the
    // address's local part until they edit their profile.
    name: invitee?.role === 'instructor' ? invitee.name : emailLocalPart(inv.email),
    inviterName: await inviterNameFor(tenantId, updated),
  })

  return updated
}
