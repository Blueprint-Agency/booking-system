/**
 * **Instructor Permissions** (be/CONTEXT.md § Staff, be/docs/adr/0012): three
 * switches an Admin sets per Instructor, stored as an enum array on the
 * `instructors` profile row, defaulting to all three.
 *
 * The rule lives here and in `middleware/require-permission.ts`, and nowhere
 * else: an Admin holds every permission and is never gated by one; an
 * Instructor holds what their row grants.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { ALL_INSTRUCTOR_PERMISSIONS, type InstructorPermission, type StaffRole } from '../../db/enums'
import { instructors } from '../../db/schema/catalog'
import { BadRequestError } from '../../shared/errors'

type StaffLike = { id: string; tenantId: string; role: StaffRole }

/**
 * The permissions this staff member holds right now. An Admin: all of them,
 * with no read. An Instructor: their profile row's array. An Instructor with
 * no profile row yet (an admin demoted before the row was made) holds the
 * default, which is also all three — the same answer the row would give.
 */
export async function resolveInstructorPermissions(staff: StaffLike): Promise<ReadonlySet<InstructorPermission>> {
  if (staff.role === 'admin') return new Set(ALL_INSTRUCTOR_PERMISSIONS)
  const granted = await readInstructorPermissions(staff.tenantId, [staff.id])
  return new Set(granted.get(staff.id) ?? ALL_INSTRUCTOR_PERMISSIONS)
}

/**
 * The stored grant of each of `staffUserIds` that has an instructors row, in
 * one read. A staff member with no row is absent from the map.
 */
export async function readInstructorPermissions(
  tenantId: string,
  staffUserIds: string[],
): Promise<Map<string, InstructorPermission[]>> {
  const out = new Map<string, InstructorPermission[]>()
  if (staffUserIds.length === 0) return out
  const rows = await db
    .select({ staffUserId: instructors.staffUserId, permissions: instructors.permissions })
    .from(instructors)
    .where(and(eq(instructors.tenantId, tenantId), inArray(instructors.staffUserId, staffUserIds)))
  for (const r of rows) out.set(r.staffUserId, r.permissions)
  return out
}

/**
 * Each staff row with its stored grant attached as `permissions`, in one read.
 * A row with no instructors profile — every Admin, and an Instructor demoted
 * before the row was made — is left as it was, which `permissionsView` reads
 * as the default.
 */
export async function withInstructorPermissions<T extends { id: string }>(
  tenantId: string,
  rows: T[],
): Promise<(T & { permissions?: InstructorPermission[] })[]> {
  const stored = await readInstructorPermissions(
    tenantId,
    rows.map(r => r.id),
  )
  return rows.map(r => {
    const permissions = stored.get(r.id)
    return permissions ? { ...r, permissions } : r
  })
}

/**
 * Write a grant onto an Instructor's profile row, making the row if the
 * Instructor has none yet. Through `tx` so a caller's transaction takes it or
 * not with the rest.
 */
export async function writeInstructorPermissions(
  tx: Pick<typeof db, 'insert'>,
  tenantId: string,
  staffUserId: string,
  permissions: InstructorPermission[],
): Promise<void> {
  await tx
    .insert(instructors)
    .values({ tenantId, staffUserId, permissions })
    .onConflictDoUpdate({ target: instructors.staffUserId, set: { permissions } })
}

/**
 * Make sure an Instructor has a profile row — a staff member just made an
 * Instructor by a role change needs one for the catalogue join, and it is
 * where their permissions live. A row already there is left exactly as it is,
 * permissions included: an Instructor promoted to Admin and demoted back keeps
 * what an Admin set (be/docs/adr/0012).
 */
export async function ensureInstructorProfile(
  tx: Pick<typeof db, 'insert'>,
  tenantId: string,
  staffUserId: string,
): Promise<void> {
  await tx.insert(instructors).values({ tenantId, staffUserId }).onConflictDoNothing({ target: instructors.staffUserId })
}

/**
 * What the portal is told a staff member may do: the grant for an Instructor,
 * `null` for an Admin, whom the switches never gate. An Instructor with no
 * profile row is reported with the default, as `resolveInstructorPermissions`
 * treats them.
 */
export function permissionsView(
  role: StaffRole,
  stored: InstructorPermission[] | undefined,
): InstructorPermission[] | null {
  if (role === 'admin') return null
  return [...(stored ?? ALL_INSTRUCTOR_PERMISSIONS)]
}

/**
 * Refuse a grant on anyone but an Instructor: the row it would be written to
 * has no meaning for an Admin, and the portal shows an Admin no switches.
 * `role` is the target's role AFTER any role change in the same request.
 */
export function assertPermissionsTargetInstructor(role: StaffRole): void {
  if (role !== 'instructor') {
    throw new BadRequestError('permissions_require_instructor', {
      message: 'Permissions can be set on an instructor only. Admins are never gated by them.',
    })
  }
}
