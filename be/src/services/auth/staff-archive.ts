/**
 * Archive a staff user. Guards (per user direction 2026-05-19):
 *
 *   - Cannot archive yourself.
 *   - Cannot archive the studio's last active admin — that is the lockout the
 *     guards exist to prevent. Any admin may archive a peer, because a studio
 *     with two of them has a way back in either way.
 *   - Already-archived target is a no-op (idempotent).
 *
 * These used to be keyed on a deploy-time email variable: one address, seeded into the
 * one studio a deployment had, protected from archival and the only account
 * allowed to touch another top-rank account. Studios now arrive by provisioning or
 * restore and carry no seeded address, so that check answered `false` for every
 * real row — which turned "only the main account may archive its peers"
 * into "nobody may, ever". The rule that was actually wanted is the one below:
 * count the admins, and refuse to reach zero.
 *
 * After the DB flip the target's Better Auth sessions at this studio are
 * deleted, in the same transaction, so they're booted from the portal
 * immediately. requireActiveStaff also blocks archived rows on the next request,
 * so that is defense-in-depth, not load-bearing.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { staffUsers } from '../../db/schema/identity'
import { instructors } from '../../db/schema/catalog'
import { joinName } from '../../lib/name'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors'
import { logger } from '../../shared/logger'
import {
  adjustRemainingDays,
  assignedLeaveDays,
  withLeaveFigures,
  type InstructorLeaveFigures,
} from '../leave/requests'
import { endStaffSessionsAt } from './auth-users'
import { recordStaffAct } from './staff-acts'
import { isTopRank, STAFF_EDIT_REFUSAL_MESSAGE, staffEditRefusal, TOP_RANK_ROLES } from './staff-rank'

export type StaffUserRow = typeof staffUsers.$inferSelect

/**
 * A staff row as the portal reads it. Assigned Days live on `instructors`, so
 * they are present for instructors and ABSENT — not null — for everyone else:
 * an admin has no leave concept to have a figure for. `leave` is the same story
 * for this Leave Year's Carried, Pool and Remaining.
 */
export type StaffProfileRow = StaffUserRow & {
  annualLeaveDays?: number
  medicalLeaveDays?: number
  studyLeaveDays?: number
  leave?: InstructorLeaveFigures
}

/**
 * Refuse the change that would leave a studio with no active admin.
 *
 * Applied to archive and demotion — the paths that take an admin out of
 * circulation. Deletion needs an already-archived row, so archive is where it
 * bites; signing someone out is not guarded, because they can sign back in.
 *
 * Counts the rows that can actually reach the portal: top rank, not archived,
 * not soft-deleted. `requireActiveStaff` refuses the other two, so an archived
 * admin is no way back in and does not count towards the one that must remain.
 *
 * **Locks those rows before counting.** The request is one READ COMMITTED
 * transaction, and a plain count would let two admins archiving each other at
 * once both read `2` and both win. `FOR UPDATE` makes the second wait for the
 * first to commit, then re-checks the rows it waited on — the one just archived
 * no longer matches, so it reads `1` and is refused. The lock is held until the
 * caller's write commits, which is the whole point.
 */
async function assertNotLastAdmin(
  tenantId: string,
  target: { role: StaffUserRow['role']; status: StaffUserRow['status'] },
  code: 'cannot_archive_last_admin' | 'cannot_demote_last_admin',
  message: string,
): Promise<void> {
  if (!isTopRank(target.role) || target.status !== 'active') return
  const activeAdmins = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        inArray(staffUsers.role, TOP_RANK_ROLES),
        eq(staffUsers.status, 'active'),
        isNull(staffUsers.deletedAt),
      ),
    )
    .orderBy(staffUsers.id)
    .for('update')
  if (activeAdmins.length > 1) return
  // 409, not 403: the actor may do this in general; the studio's state is what refuses it.
  throw new ConflictError(code, { message })
}

export interface ArchiveStaffInput {
  tenantId: string
  targetStaffId: string
  actorStaffId: string
  /** The acting staff member's request, for the `auth_events` row (#119). */
  from?: Headers
}

export async function archiveStaff(input: ArchiveStaffInput): Promise<StaffUserRow> {
  const { tenantId, targetStaffId, actorStaffId } = input

  if (targetStaffId === actorStaffId) {
    throw new ForbiddenError('self_archive_forbidden', {
      message: 'You cannot archive your own staff account.',
    })
  }

  const [target] = await db
    .select()
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        eq(staffUsers.id, targetStaffId),
        isNull(staffUsers.deletedAt),
      ),
    )
    .limit(1)
  if (!target) throw new NotFoundError('staff_not_found')

  if (target.status === 'archived') {
    // Idempotent — return the existing row unchanged.
    return target
  }

  await assertNotLastAdmin(
    tenantId,
    target,
    'cannot_archive_last_admin',
    'This is the only admin left. Promote someone else to admin before archiving this account.',
  )

  const now = new Date()
  const [updated] = await db
    .update(staffUsers)
    .set({
      status: 'archived',
      archivedAt: now,
      archivedByStaffId: actorStaffId,
      updatedAt: now,
    })
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, targetStaffId)))
    .returning()
  if (!updated) throw new ConflictError('staff_archive_failed')

  // Their Better Auth sessions at this studio end in the request's transaction,
  // with the flip. Only this studio's: their login at another studio is another
  // account (ADR 0006), untouched.
  await endStaffSessionsAt(db, tenantId, target.authUserId)
  // Archiving is how a staff member is blocked, so it is logged as one.
  await recordStaffAct({ tenantId, actorStaffId, kind: 'user_blocked', subjectUserId: target.authUserId, from: input.from })

  return updated
}

/**
 * Unarchive a staff user — flip status back to 'active' and clear archived_at.
 * Refuses if already active, soft-deleted, or pending (never been activated).
 */
export async function unarchiveStaff(input: {
  tenantId: string
  targetStaffId: string
  actorStaffId: string
  from?: Headers
}): Promise<StaffUserRow> {
  const { tenantId, targetStaffId } = input
  const [target] = await db
    .select()
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        eq(staffUsers.id, targetStaffId),
        isNull(staffUsers.deletedAt),
      ),
    )
    .limit(1)
  if (!target) throw new NotFoundError('staff_not_found')
  if (target.status !== 'archived') {
    throw new BadRequestError('staff_not_archived', { status: target.status })
  }

  const now = new Date()
  const [updated] = await db
    .update(staffUsers)
    .set({
      status: 'active',
      archivedAt: null,
      archivedByStaffId: null,
      updatedAt: now,
    })
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, targetStaffId)))
    .returning()
  if (!updated) throw new ConflictError('staff_unarchive_failed')
  await recordStaffAct({
    tenantId,
    actorStaffId: input.actorStaffId,
    kind: 'user_unblocked',
    subjectUserId: target.authUserId,
    from: input.from,
  })
  return updated
}

/**
 * Soft-delete a staff user. Row must be currently archived AND not yet
 * deleted. Sets deleted_at = now(); the row stays in DB for audit trail.
 */
export async function softDeleteStaff(input: {
  tenantId: string
  targetStaffId: string
  actorStaffId: string
}): Promise<void> {
  const { tenantId, targetStaffId, actorStaffId } = input
  if (targetStaffId === actorStaffId) {
    throw new ForbiddenError('self_delete_forbidden', {
      message: 'You cannot delete your own staff account.',
    })
  }

  const [target] = await db
    .select()
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        eq(staffUsers.id, targetStaffId),
        isNull(staffUsers.deletedAt),
      ),
    )
    .limit(1)
  if (!target) throw new NotFoundError('staff_not_found')

  if (target.status !== 'archived') {
    throw new BadRequestError('staff_not_archived', { status: target.status })
  }

  // No last-admin check here: deletion requires an already-archived row
  // (asserted above), and archiving is where that guard bites. An archived
  // admin is not one the studio can sign in with, so it was never the last.

  await db
    .update(staffUsers)
    .set({ deletedAt: sql`now()`, updatedAt: new Date() })
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, targetStaffId)))
}

/**
 * Update a staff profile (name/contact/bio fields, role, location grants).
 * The rank rules are enforced HERE, not in the route:
 *
 *   - Editing a target of higher rank is refused; role and location grants are
 *     admin-only and their mere presence refuses the request. Both live in
 *     staffEditRefusal() so they stay testable.
 *
 * On top of that, two guards scoped to *role changes* only — editing your own
 * non-role profile fields (phone, bio, etc.) is fine:
 *
 *   - Cannot change your own role (self_role_edit_forbidden).
 *   - Cannot demote the studio's last active admin (cannot_demote_last_admin).
 */
export interface UpdateStaffProfileInput {
  tenantId: string
  targetStaffId: string
  actorStaffId: string
  patch: {
    firstName?: string
    lastName?: string | null
    phone?: string | null
    address?: string | null
    gender?: StaffUserRow['gender']
    bio?: string | null
    languages?: string[]
    role?: StaffUserRow['role']
    /** Assigned Days. Deliberately NOT privilege fields — an admin may set
     *  them — and they land on `instructors`, so an instructor target only. */
    annualLeaveDays?: number
    medicalLeaveDays?: number
    studyLeaveDays?: number
    /** The Remaining this instructor should have for the CURRENT Leave Year.
     *  Not a privilege field either. Back-solves that year's Pool — see
     *  services/leave/requests.ts. */
    annualRemainingDays?: number
    medicalRemainingDays?: number
    studyRemainingDays?: number
  }
}

export async function updateStaffProfile(input: UpdateStaffProfileInput): Promise<StaffProfileRow> {
  const { tenantId, targetStaffId, actorStaffId, patch } = input

  const [target] = await db
    .select()
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        eq(staffUsers.id, targetStaffId),
        isNull(staffUsers.deletedAt),
      ),
    )
    .limit(1)
  if (!target) throw new NotFoundError('staff_not_found')

  const [actor] = await db
    .select()
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        eq(staffUsers.id, actorStaffId),
        isNull(staffUsers.deletedAt),
      ),
    )
    .limit(1)
  if (!actor) throw new ForbiddenError('actor_not_found')

  const refusal = staffEditRefusal({
    actorRole: actor.role,
    targetRole: target.role,
    touchesPrivilegeFields: patch.role !== undefined,
  })
  if (refusal) {
    throw new ForbiddenError(refusal, { message: STAFF_EDIT_REFUSAL_MESSAGE[refusal] })
  }

  const changingRole = patch.role !== undefined && patch.role !== target.role
  if (changingRole) {
    if (targetStaffId === actorStaffId) {
      throw new ForbiddenError('self_role_edit_forbidden', {
        message: 'You cannot change your own role.',
      })
    }
    if (!isTopRank(patch.role!)) {
      await assertNotLastAdmin(
        tenantId,
        target,
        'cannot_demote_last_admin',
        'This is the only admin left. Promote someone else to admin before changing this role.',
      )
    }
  }

  const set: Partial<typeof staffUsers.$inferInsert> = {}
  if (patch.firstName !== undefined || patch.lastName !== undefined) {
    const nextFirstName = patch.firstName !== undefined ? patch.firstName : (target.firstName ?? '')
    const nextLastName = patch.lastName !== undefined ? patch.lastName : target.lastName
    set.firstName = nextFirstName
    set.lastName = nextLastName
    set.name = joinName(nextFirstName, nextLastName)
  }
  if (patch.phone !== undefined) set.phone = patch.phone
  if (patch.address !== undefined) set.address = patch.address
  if (patch.gender !== undefined) set.gender = patch.gender
  if (patch.bio !== undefined) set.bio = patch.bio
  if (patch.languages !== undefined) set.languages = patch.languages
  if (patch.role !== undefined) set.role = patch.role

  const assigned = {
    ...(patch.annualLeaveDays !== undefined ? { annualLeaveDays: patch.annualLeaveDays } : {}),
    ...(patch.medicalLeaveDays !== undefined ? { medicalLeaveDays: patch.medicalLeaveDays } : {}),
    ...(patch.studyLeaveDays !== undefined ? { studyLeaveDays: patch.studyLeaveDays } : {}),
  }
  const remaining = {
    ...(patch.annualRemainingDays !== undefined ? { annual: patch.annualRemainingDays } : {}),
    ...(patch.medicalRemainingDays !== undefined ? { medical: patch.medicalRemainingDays } : {}),
    ...(patch.studyRemainingDays !== undefined ? { study: patch.studyRemainingDays } : {}),
  }
  const touchesLeave = Object.keys(assigned).length + Object.keys(remaining).length > 0
  if (touchesLeave && target.role !== 'instructor') {
    throw new BadRequestError('leave_days_instructor_only', {
      message: 'Only an instructor has leave days.',
    })
  }
  // The adjustment goes first because it is the only write here that can be
  // refused (above the Pool, or below zero), and a refusal that has already
  // written half the profile has nothing to roll it back with. Order is
  // otherwise immaterial: Assigned Days apply from the NEXT Leave Year, the
  // adjustment only to this one.
  if (Object.keys(remaining).length > 0) {
    await adjustRemainingDays(tenantId, { instructorId: targetStaffId, ...remaining })
  }
  if (Object.keys(assigned).length > 0) {
    await db
      .update(instructors)
      .set(assigned)
      .where(
        and(eq(instructors.tenantId, tenantId), eq(instructors.staffUserId, targetStaffId)),
      )
  }

  let row = target
  if (Object.keys(set).length > 0) {
    set.updatedAt = new Date()
    const [updated] = await db
      .update(staffUsers)
      .set(set)
      .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, targetStaffId)))
      .returning()
    if (!updated) throw new ConflictError('staff_update_failed')
    row = updated
  }
  const [profile] = await withLeaveFigures(tenantId, [
    { ...row, ...(await assignedLeaveDays(tenantId, targetStaffId)) },
  ])
  return profile ?? row
}
