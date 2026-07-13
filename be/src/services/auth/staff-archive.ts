/**
 * Archive a staff user. Guards (per user direction 2026-05-19):
 *
 *   - Cannot archive yourself.
 *   - Cannot archive the seeded superadmin (the row whose email matches
 *     SUPERADMIN_EMAIL). That row is the recovery anchor; removing it
 *     would lock the org out if no other superadmin is around.
 *   - Archiving a superadmin requires the actor to BE the seeded
 *     superadmin. Other (invited) superadmins can archive admins and
 *     instructors but not each other.
 *   - Already-archived target is a no-op (idempotent).
 *
 * After the DB flip we best-effort revoke all Clerk sessions for the
 * target so they're booted from the portal immediately. requireActiveStaff
 * also blocks archived rows on the next request, so the Clerk revoke is
 * defense-in-depth, not load-bearing — a transient Clerk failure must not
 * roll back the archive.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { staffUsers } from '../../db/schema/identity'
import { clerkStaffApp } from '../../lib/clerk'
import { env } from '../../env'
import { joinName } from '../../lib/name'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors'
import { logger } from '../../shared/logger'

export type StaffUserRow = typeof staffUsers.$inferSelect

export function isSeededSuperadminEmail(email: string): boolean {
  return email.trim().toLowerCase() === env.SUPERADMIN_EMAIL.trim().toLowerCase()
}

export interface ArchiveStaffInput {
  targetStaffId: string
  actorStaffId: string
}

export async function archiveStaff(input: ArchiveStaffInput): Promise<StaffUserRow> {
  const { targetStaffId, actorStaffId } = input

  if (targetStaffId === actorStaffId) {
    throw new ForbiddenError('self_archive_forbidden', {
      message: 'You cannot archive your own staff account.',
    })
  }

  const [target] = await db
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.id, targetStaffId), isNull(staffUsers.deletedAt)))
    .limit(1)
  if (!target) throw new NotFoundError('staff_not_found')

  if (target.status === 'archived') {
    // Idempotent — return the existing row unchanged.
    return target
  }

  if (isSeededSuperadminEmail(target.email)) {
    throw new ForbiddenError('cannot_archive_seeded_superadmin', {
      message:
        'The main superadmin (set via SUPERADMIN_EMAIL) cannot be archived from the app.',
    })
  }

  if (target.role === 'superadmin') {
    const [actor] = await db
      .select()
      .from(staffUsers)
      .where(and(eq(staffUsers.id, actorStaffId), isNull(staffUsers.deletedAt)))
      .limit(1)
    if (!actor) throw new ForbiddenError('actor_not_found')
    if (!isSeededSuperadminEmail(actor.email)) {
      throw new ForbiddenError('only_seeded_can_archive_superadmin', {
        message: 'Only the main superadmin can archive another superadmin.',
      })
    }
  }

  const now = new Date()
  const [updated] = await db
    .update(staffUsers)
    .set({
      status: 'archived',
      archivedAt: now,
      archivedByStaffId: actorStaffId,
      updatedAt: now,
    })
    .where(eq(staffUsers.id, targetStaffId))
    .returning()
  if (!updated) throw new ConflictError('staff_archive_failed')

  if (target.clerkUserId) {
    try {
      const sessions = await clerkStaffApp.sessions.getSessionList({
        userId: target.clerkUserId,
      })
      await Promise.allSettled(
        sessions.data.map(s => clerkStaffApp.sessions.revokeSession(s.id)),
      )
    } catch (err) {
      logger.warn(
        {
          staffId: targetStaffId,
          err: err instanceof Error ? err.message : String(err),
        },
        'archiveStaff: Clerk session revoke failed',
      )
    }
  }

  return updated
}

/**
 * Unarchive a staff user — flip status back to 'active' and clear archived_at.
 * Refuses if already active, soft-deleted, or pending (never been activated).
 */
export async function unarchiveStaff(input: {
  targetStaffId: string
  actorStaffId: string
}): Promise<StaffUserRow> {
  const { targetStaffId } = input
  const [target] = await db
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.id, targetStaffId), isNull(staffUsers.deletedAt)))
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
    .where(eq(staffUsers.id, targetStaffId))
    .returning()
  if (!updated) throw new ConflictError('staff_unarchive_failed')
  return updated
}

/**
 * Soft-delete a staff user. Row must be currently archived AND not yet
 * deleted. Sets deleted_at = now(); the row stays in DB for audit trail.
 *
 * The seeded superadmin can never be soft-deleted (same guard as archive).
 */
export async function softDeleteStaff(input: {
  targetStaffId: string
  actorStaffId: string
}): Promise<void> {
  const { targetStaffId, actorStaffId } = input
  if (targetStaffId === actorStaffId) {
    throw new ForbiddenError('self_delete_forbidden', {
      message: 'You cannot delete your own staff account.',
    })
  }

  const [target] = await db
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.id, targetStaffId), isNull(staffUsers.deletedAt)))
    .limit(1)
  if (!target) throw new NotFoundError('staff_not_found')

  if (target.status !== 'archived') {
    throw new BadRequestError('staff_not_archived', { status: target.status })
  }

  if (isSeededSuperadminEmail(target.email)) {
    throw new ForbiddenError('cannot_delete_seeded_superadmin', {
      message:
        'The main superadmin (set via SUPERADMIN_EMAIL) cannot be deleted from the app.',
    })
  }

  if (target.role === 'superadmin') {
    const [actor] = await db
      .select()
      .from(staffUsers)
      .where(and(eq(staffUsers.id, actorStaffId), isNull(staffUsers.deletedAt)))
      .limit(1)
    if (!actor) throw new ForbiddenError('actor_not_found')
    if (!isSeededSuperadminEmail(actor.email)) {
      throw new ForbiddenError('only_seeded_can_delete_superadmin', {
        message: 'Only the main superadmin can delete another superadmin.',
      })
    }
  }

  await db
    .update(staffUsers)
    .set({ deletedAt: sql`now()`, updatedAt: new Date() })
    .where(eq(staffUsers.id, targetStaffId))
}

/**
 * Update a staff profile (name/contact/bio fields, role, location grants).
 * Guards mirror archiveStaff exactly, but scoped to *role changes* only —
 * editing your own or the seeded superadmin's non-role profile fields
 * (phone, bio, etc.) is fine; only a role change is locked down:
 *
 *   - Cannot change your own role (self_role_edit_forbidden).
 *   - Cannot change the seeded superadmin's role at all.
 *   - Changing an existing superadmin's role requires the actor to BE the
 *     seeded superadmin (same "only seeded can touch a superadmin" rule
 *     archive/delete enforce).
 */
export interface UpdateStaffProfileInput {
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
    grantedLocationIds?: string[]
  }
}

export async function updateStaffProfile(input: UpdateStaffProfileInput): Promise<StaffUserRow> {
  const { targetStaffId, actorStaffId, patch } = input

  const [target] = await db
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.id, targetStaffId), isNull(staffUsers.deletedAt)))
    .limit(1)
  if (!target) throw new NotFoundError('staff_not_found')

  const changingRole = patch.role !== undefined && patch.role !== target.role
  if (changingRole) {
    if (targetStaffId === actorStaffId) {
      throw new ForbiddenError('self_role_edit_forbidden', {
        message: 'You cannot change your own role.',
      })
    }
    if (isSeededSuperadminEmail(target.email)) {
      throw new ForbiddenError('cannot_edit_seeded_superadmin_role', {
        message:
          'The main superadmin (set via SUPERADMIN_EMAIL) cannot have its role changed.',
      })
    }
    if (target.role === 'superadmin') {
      const [actor] = await db
        .select()
        .from(staffUsers)
        .where(and(eq(staffUsers.id, actorStaffId), isNull(staffUsers.deletedAt)))
        .limit(1)
      if (!actor) throw new ForbiddenError('actor_not_found')
      if (!isSeededSuperadminEmail(actor.email)) {
        throw new ForbiddenError('only_seeded_can_edit_superadmin_role', {
          message: "Only the main superadmin can change another superadmin's role.",
        })
      }
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
  if (patch.grantedLocationIds !== undefined) set.grantedLocationIds = patch.grantedLocationIds

  if (Object.keys(set).length === 0) return target

  set.updatedAt = new Date()
  const [updated] = await db
    .update(staffUsers)
    .set(set)
    .where(eq(staffUsers.id, targetStaffId))
    .returning()
  if (!updated) throw new ConflictError('staff_update_failed')
  return updated
}
