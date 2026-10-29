import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { staffUsers } from '../../db/schema/identity'
import { ConflictError, NotFoundError, BadRequestError } from '../../shared/errors'
import { inviterNameFor, mailInvitation, writePendingStaff } from '../auth/invitations'
import { assertBioWithin } from '../auth/staff-bio'
import { requireTenantUrl } from '../tenants/urls'

export type StaffRow = typeof staffUsers.$inferSelect

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

function toView(staff: StaffRow): InstructorView {
  return {
    id: staff.id,
    email: staff.email,
    name: staff.name,
    status: staff.status,
    archivedAt: staff.archivedAt,
    invitedAt: staff.invitedAt,
    acceptedAt: staff.acceptedAt,
    bio: staff.bio,
    phone: staff.phone,
    photoR2Key: staff.photoR2Key,
  }
}

async function loadById(tenantId: string, id: string): Promise<InstructorView> {
  const [row] = await db
    .select()
    .from(staffUsers)
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
  return toView(row)
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

  const rows = await db.select().from(staffUsers).where(and(...filters))
  return rows.map(toView)
}

export const getInstructor = loadById

interface CreateInstructorInput {
  email: string
  name: string
  bio?: string | null
  phone?: string | null
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
 * Class-type eligibility (instructor_class_types) is not modelled in the
 * UI — instructors are assignable to any class type at scheduling time.
 */
export async function createInstructor(
  tenantId: string,
  input: CreateInstructorInput,
): Promise<InstructorView> {
  const email = input.email.trim().toLowerCase()
  if (!email) throw new BadRequestError('email_required')
  assertBioWithin(input.bio)

  // Before the writes, as in `inviteAdmin`: the invitation is only worth
  // anything if there is a portal of this studio's own to point it at.
  const portalUrl = await requireTenantUrl('portal', tenantId)

  const { view, invitation } = await db.transaction(async tx => {
    // Deliberately *not* tenant-scoped: `staff_users.email` still carries a
    // platform-wide unique index, so scoping this check would only trade a
    // clean 409 for a unique violation. Making one person staff at two tenants
    // is a schema change of its own.
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
      photoR2Key: null,
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

const PHONE_MAX = 40

function assertWithin(value: string | null | undefined, what: string, max: number): void {
  if (value != null && value.length > max) {
    throw new BadRequestError('invalid_request', { message: `${what} is at most ${max} characters.` })
  }
}

interface UpdateInstructorInput {
  name?: string
  bio?: string | null
  phone?: string | null
}

export async function updateInstructor(
  tenantId: string,
  id: string,
  patch: UpdateInstructorInput,
): Promise<InstructorView> {
  const current = await loadById(tenantId, id)
  assertBioWithin(patch.bio, current.bio)
  assertWithin(patch.phone, 'A phone number', PHONE_MAX)

  const staffPatch: Partial<StaffRow> = {}
  if (patch.name !== undefined) staffPatch.name = patch.name
  if (patch.bio !== undefined) staffPatch.bio = patch.bio
  if (patch.phone !== undefined) staffPatch.phone = patch.phone
  if (Object.keys(staffPatch).length) {
    await db
      .update(staffUsers)
      .set({ ...staffPatch, updatedAt: new Date() })
      .where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, id)))
  }

  return loadById(tenantId, id)
}
