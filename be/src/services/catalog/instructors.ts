import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from '../../db'
import { staffUsers } from '../../db/schema/identity'
import { instructors } from '../../db/schema/catalog'
import { classes, ptSessions, workshops, workshopInstructors } from '../../db/schema/schedule'
import { ConflictError, NotFoundError, BadRequestError } from '../../shared/errors'

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

async function loadById(id: string): Promise<InstructorView> {
  const [row] = await db
    .select({
      staff: staffUsers,
      ins: instructors,
    })
    .from(staffUsers)
    .innerJoin(instructors, eq(instructors.staffUserId, staffUsers.id))
    .where(eq(staffUsers.id, id))
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
    bio: row.ins.bio,
    phone: row.ins.phone,
    photoR2Key: row.ins.photoR2Key,
  }
}

export async function listInstructors(opts: {
  status?: 'pending' | 'active' | 'archived'
}): Promise<InstructorView[]> {
  const filters = [eq(staffUsers.role, 'instructor')]
  if (opts.status) filters.push(eq(staffUsers.status, opts.status))

  const rows = await db
    .select({ staff: staffUsers, ins: instructors })
    .from(staffUsers)
    .innerJoin(instructors, eq(instructors.staffUserId, staffUsers.id))
    .where(and(...filters))

  return rows.map(r => ({
    id: r.staff.id,
    email: r.staff.email,
    name: r.staff.name,
    status: r.staff.status,
    archivedAt: r.staff.archivedAt,
    invitedAt: r.staff.invitedAt,
    acceptedAt: r.staff.acceptedAt,
    bio: r.ins.bio,
    phone: r.ins.phone,
    photoR2Key: r.ins.photoR2Key,
  }))
}

export const getInstructor = loadById

export interface CreateInstructorInput {
  email: string
  name: string
  bio?: string | null
  phone?: string | null
  photoR2Key?: string | null
}

/**
 * Create an instructor. v0 does NOT call Clerk — we only insert the DB rows.
 *  - staff_users (role=instructor, status=pending, clerk_user_id=NULL)
 *  - instructors (profile)
 *
 * Clerk invitation wiring lands in a later slice. The pending staff_users row
 * will link up when the matching email signs into Clerk and the webhook fires.
 *
 * Class-type eligibility (instructor_class_types) is no longer modelled in the
 * UI — instructors are assignable to any class type at scheduling time.
 */
export async function createInstructor(input: CreateInstructorInput): Promise<InstructorView> {
  const email = input.email.trim().toLowerCase()
  if (!email) throw new BadRequestError('email_required')

  return db.transaction(async tx => {
    // Reject if email already exists across staff_users (case-insensitive).
    const existing = await tx
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(sql`lower(${staffUsers.email}) = ${email}`)
      .limit(1)
    if (existing.length) throw new ConflictError('staff_email_exists')

    const [staffRow] = await tx
      .insert(staffUsers)
      .values({
        email,
        name: input.name,
        role: 'instructor',
        status: 'pending',
        clerkUserId: null,
      })
      .returning()

    await tx.insert(instructors).values({
      staffUserId: staffRow!.id,
      bio: input.bio ?? null,
      phone: input.phone ?? null,
      photoR2Key: input.photoR2Key ?? null,
    })

    return {
      id: staffRow!.id,
      email: staffRow!.email,
      name: staffRow!.name,
      status: staffRow!.status,
      archivedAt: staffRow!.archivedAt,
      invitedAt: staffRow!.invitedAt,
      acceptedAt: staffRow!.acceptedAt,
      bio: input.bio ?? null,
      phone: input.phone ?? null,
      photoR2Key: input.photoR2Key ?? null,
    }
  })
}

export interface UpdateInstructorInput {
  name?: string
  bio?: string | null
  phone?: string | null
  photoR2Key?: string | null
}

export async function updateInstructor(id: string, patch: UpdateInstructorInput): Promise<InstructorView> {
  await loadById(id) // 404 if missing

  await db.transaction(async tx => {
    if (patch.name !== undefined) {
      await tx
        .update(staffUsers)
        .set({ name: patch.name, updatedAt: new Date() })
        .where(eq(staffUsers.id, id))
    }

    const profilePatch: Partial<InstructorProfile> = {}
    if (patch.bio !== undefined) profilePatch.bio = patch.bio
    if (patch.phone !== undefined) profilePatch.phone = patch.phone
    if (patch.photoR2Key !== undefined) profilePatch.photoR2Key = patch.photoR2Key
    if (Object.keys(profilePatch).length) {
      await tx.update(instructors).set(profilePatch).where(eq(instructors.staffUserId, id))
    }
  })

  return loadById(id)
}

export async function archiveInstructor(id: string): Promise<InstructorView> {
  await loadById(id)
  const now = new Date()

  const futureClasses = await db
    .select({ id: classes.id })
    .from(classes)
    .where(
      and(eq(classes.instructorId, id), eq(classes.lifecycle, 'active'), gt(classes.endsAt, now)),
    )

  const futurePtSessions = await db
    .select({ id: ptSessions.id })
    .from(ptSessions)
    .where(
      and(
        eq(ptSessions.instructorId, id),
        eq(ptSessions.lifecycle, 'active'),
        gt(ptSessions.endsAt, now),
      ),
    )

  const futureWorkshops = await db
    .select({ id: workshops.id })
    .from(workshops)
    .innerJoin(workshopInstructors, eq(workshopInstructors.workshopId, workshops.id))
    .where(and(eq(workshopInstructors.instructorId, id), eq(workshops.lifecycle, 'active')))

  if (futureClasses.length || futurePtSessions.length || futureWorkshops.length) {
    throw new ConflictError('instructor_in_use', {
      class_ids: futureClasses.map(r => r.id),
      pt_session_ids: futurePtSessions.map(r => r.id),
      workshop_ids: futureWorkshops.map(r => r.id),
    })
  }

  await db
    .update(staffUsers)
    .set({ status: 'archived', archivedAt: now, updatedAt: now })
    .where(eq(staffUsers.id, id))

  return loadById(id)
}
