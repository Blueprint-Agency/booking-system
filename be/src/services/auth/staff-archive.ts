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
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { staffUsers } from '../../db/schema/identity'
import { clerkStaffApp } from '../../lib/clerk'
import { env } from '../../env'
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'

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
    .where(eq(staffUsers.id, targetStaffId))
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
      .where(eq(staffUsers.id, actorStaffId))
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
      // eslint-disable-next-line no-console
      console.warn('[archiveStaff] Clerk session revoke failed', {
        staffId: targetStaffId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return updated
}
