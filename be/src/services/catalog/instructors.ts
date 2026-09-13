import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { staffUsers } from '../../db/schema/identity'
import { instructors } from '../../db/schema/catalog'
import { classes, ptSessions, workshops, workshopInstructors } from '../../db/schema/schedule'
import { ConflictError, NotFoundError, BadRequestError } from '../../shared/errors'
import { assertOwnObjectKeys } from '../../lib/object-key'
import { inviterNameFor, mailInvitation, writePendingStaff } from '../auth/invitations'
import { endStaffSessionsAt } from '../auth/auth-users'
import { requireTenantUrl } from '../tenants/urls'

export type StaffRow = typeof staffUsers.$inferSelect
export type InstructorProfile = typeof instructors.$inferSelect

export interface InstructorView {
  id: string // staff_users.id (== instructors.staff_user_id)
  email: string
  name: string
  status: StaffRow['status']
  archivedAt: Date | null
  invitedAt: Date | null
  acceptedAt: Date | null
  bio: string | null
  phone: string | null
  photoR2Key: string | null
}

async function loadById(tenantId: string, id: string): Promise<InstructorView> {
  const [row] = await db
    .select({
      staff: staffUsers,
      ins: instructors,
    })
    .from(staffUsers)
    .leftJoin(instructors, eq(instructors.staffUserId, staffUsers.id))
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        eq(staffUsers.id, id),
        eq(staffUsers.role, 'instructor'),
        isNull(staffUsers.deletedAt),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError('instructor_not_found')

  return {
    id: row.staff.id,
    email: row.staff.email,
    name: row.staff.name,
    status: row.staff.status,
    archivedAt: row.staff.archivedAt,
    invitedAt: row.staff.invitedAt,
    acceptedAt: row.staff.acceptedAt,
    bio: row.staff.bio,
    phone: row.staff.phone,
    photoR2Key: row.ins?.photoR2Key ?? null,
  }
}

export async function listInstructors(
  tenantId: string,
  opts: {
    status?: 'pending' | 'active' | 'archived'
  },
): Promise<InstructorView[]> {
  const filters = [
    eq(staffUsers.tenantId, tenantId),
    eq(staffUsers.role, 'instructor'),
    isNull(staffUsers.deletedAt),
  ]
  if (opts.status) filters.push(eq(staffUsers.status, opts.status))

  const rows = await db
    .select({ staff: staffUsers, ins: instructors })
    .from(staffUsers)
    .leftJoin(instructors, eq(instructors.staffUserId, staffUsers.id))
    .where(and(...filters))

  return rows.map(r => ({
    id: r.staff.id,
    email: r.staff.email,
    name: r.staff.name,
    status: r.staff.status,
    archivedAt: r.staff.archivedAt,
    invitedAt: r.staff.invitedAt,
    acceptedAt: r.staff.acceptedAt,
    bio: r.staff.bio,
    phone: r.staff.phone,
    photoR2Key: r.ins?.photoR2Key ?? null,
  }))
}

export const getInstructor = loadById

export interface CreateInstructorInput {
  email: string
  name: string
  bio?: string | null
  phone?: string | null
  photoR2Key?: string | null
  /** The admin creating them, who signs the invitation. */
  invitedByStaffId: string
}

/**
 * Create an instructor + send the branded invite email. Exactly the admin
 * invitation (`services/auth/invitations.ts`), with a name and profile up front:
 * the staff auth user, the pending staff_users row linked to it, the instructors
 * profile and the invitation are written together, and the mail carries a link
 * that sets the instructor's password.
 *
 * Class-type eligibility (instructor_class_types) is no longer modelled in the
 * UI — instructors are assignable to any class type at scheduling time.
 */
export async function createInstructor(
  tenantId: string,
  input: CreateInstructorInput,
): Promise<InstructorView> {
  const email = input.email.trim().toLowerCase()
  if (!email) throw new BadRequestError('email_required')
  // The photo is an object key an admin sends as a string, not an upload made
  // here, so without this a profile is a way to point at another studio's file.
  assertOwnObjectKeys(tenantId, [input.photoR2Key])

  // Before the writes, as in `inviteAdmin`: the invitation is only worth
  // anything if there is a portal of this studio's own to point it at.
  const portalUrl = await requireTenantUrl('portal', tenantId)

  const { view, invitation } = await db.transaction(async tx => {
    // Deliberately *not* tenant-scoped: `staff_users.email` still carries a
    // platform-wide unique index, so scoping this check would only trade a
    // clean 409 for a unique violation. Making one person staff at two tenants
    // is a schema change, and it belongs with the Clerk organization work (#65).
    const existing = await tx
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(and(sql`lower(${staffUsers.email}) = ${email}`, isNull(staffUsers.deletedAt)))
      .limit(1)
    if (existing.length) throw new ConflictError('staff_email_exists')

    const { staff, invitation } = await writePendingStaff(tx, {
      tenantId,
      email,
      name: input.name,
      role: 'instructor',
      invitedByStaffId: input.invitedByStaffId,
      bio: input.bio,
      phone: input.phone,
      photoR2Key: input.photoR2Key,
    })

    const view: InstructorView = {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      status: staff.status,
      archivedAt: staff.archivedAt,
      invitedAt: staff.invitedAt,
      acceptedAt: staff.acceptedAt,
      bio: input.bio ?? null,
      phone: input.phone ?? null,
      photoR2Key: input.photoR2Key ?? null,
    }
    return { view, invitation }
  })

  // Outside the transaction, as in `inviteAdmin`: a transient mail failure must
  // not roll back the instructor record. Failures land in `email_log`.
  await mailInvitation({
    tenantId,
    invitation,
    portalUrl,
    name: view.name,
    inviterName: await inviterNameFor(tenantId, invitation),
  })

  return view
}

export interface UpdateInstructorInput {
  name?: string
  bio?: string | null
  phone?: string | null
  photoR2Key?: string | null
}

export async function updateInstructor(
  tenantId: string,
  id: string,
  patch: UpdateInstructorInput,
): Promise<InstructorView> {
  await loadById(tenantId, id) // 404 if missing
  assertOwnObjectKeys(tenantId, [patch.photoR2Key])

  await db.transaction(async tx => {
    const staffPatch: Partial<StaffRow> = {}
    if (patch.name !== undefined) staffPatch.name = patch.name
    if (patch.bio !== undefined) staffPatch.bio = patch.bio
    if (patch.phone !== undefined) staffPatch.phone = patch.phone
    if (Object.keys(staffPatch).length) {
      await tx
        .update(staffUsers)
        .set({ ...staffPatch, updatedAt: new Date() })
        .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, id)))
    }

    if (patch.photoR2Key !== undefined) {
      await tx
        .update(instructors)
        .set({ photoR2Key: patch.photoR2Key })
        .where(and(eq(instructors.tenantId, tenantId), eq(instructors.staffUserId, id)))
    }
  })

  return loadById(tenantId, id)
}

export async function archiveInstructor(tenantId: string, id: string): Promise<InstructorView> {
  const existing = await loadById(tenantId, id)
  if (existing.status === 'archived') {
    throw new BadRequestError('instructor_already_archived')
  }
  const now = new Date()

  const futureClasses = await db
    .select({ id: classes.id })
    .from(classes)
    .where(
      and(
        eq(classes.tenantId, tenantId),
        eq(classes.mainInstructorId, id),
        eq(classes.lifecycle, 'active'),
        gt(classes.endsAt, now),
      ),
    )

  const futurePtSessions = await db
    .select({ id: ptSessions.id })
    .from(ptSessions)
    .where(
      and(
        eq(ptSessions.tenantId, tenantId),
        eq(ptSessions.instructorId, id),
        eq(ptSessions.lifecycle, 'active'),
        gt(ptSessions.endsAt, now),
      ),
    )

  const futureWorkshops = await db
    .select({ id: workshops.id })
    .from(workshops)
    .innerJoin(workshopInstructors, eq(workshopInstructors.workshopId, workshops.id))
    .where(
      and(
        eq(workshops.tenantId, tenantId),
        eq(workshopInstructors.instructorId, id),
        eq(workshops.lifecycle, 'active'),
      ),
    )

  if (futureClasses.length || futurePtSessions.length || futureWorkshops.length) {
    throw new ConflictError('instructor_in_use', {
      class_ids: futureClasses.map(r => r.id),
      pt_session_ids: futurePtSessions.map(r => r.id),
      workshop_ids: futureWorkshops.map(r => r.id),
    })
  }

  const [archived] = await db
    .update(staffUsers)
    .set({ status: 'archived', archivedAt: now, updatedAt: now })
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, id)))
    .returning({ authUserId: staffUsers.authUserId })
  // Signed out here, as `archiveStaff` does; `requireActiveStaff` refuses the
  // archived row on its next request either way.
  if (archived?.authUserId) await endStaffSessionsAt(db, tenantId, archived.authUserId)

  return loadById(tenantId, id)
}

export async function unarchiveInstructor(tenantId: string, id: string): Promise<InstructorView> {
  const existing = await loadById(tenantId, id)
  if (existing.status !== 'archived') {
    throw new BadRequestError('instructor_not_archived')
  }
  const now = new Date()
  await db
    .update(staffUsers)
    .set({ status: 'active', archivedAt: null, updatedAt: now })
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, id)))
  return loadById(tenantId, id)
}

/**
 * Soft-delete an instructor. Must be currently archived; row remains in
 * staff_users with deleted_at=now() so audit/FK references keep resolving.
 */
export async function softDeleteInstructor(tenantId: string, id: string): Promise<void> {
  const existing = await loadById(tenantId, id)
  if (existing.status !== 'archived') {
    throw new BadRequestError('instructor_not_archived')
  }
  await db
    .update(staffUsers)
    .set({ deletedAt: sql`now()`, updatedAt: new Date() })
    .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, id)))
}
