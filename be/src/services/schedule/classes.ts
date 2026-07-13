import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { classes, classSupportingInstructors } from '../../db/schema'
import { instructors } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { assertRoomAvailable, assertRoomInLocation } from './room-conflicts'
import { BadRequestError } from '../../shared/errors'

/**
 * Ensure every staff_user referenced as an instructor has the matching
 * `instructors` profile row. Heals orphans created before the inviteAdmin
 * flow began auto-inserting the profile row (see 0008_backfill_instructor_profiles.sql)
 * and rejects ids that don't belong to an active instructor.
 */
async function ensureInstructorRows(
  tx: typeof db,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  const unique = Array.from(new Set(ids))
  const valid = await tx
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(
      and(
        inArray(staffUsers.id, unique),
        eq(staffUsers.role, 'instructor'),
        isNull(staffUsers.deletedAt),
      ),
    )
  if (valid.length !== unique.length) {
    throw new BadRequestError('invalid_instructor_id')
  }
  await tx
    .insert(instructors)
    .values(unique.map(staffUserId => ({ staffUserId })))
    .onConflictDoNothing({ target: instructors.staffUserId })
}

export interface CreateClassInput {
  classTypeId: string
  mainInstructorId: string
  /** Preferred — per-instructor pay. `supportingInstructorIds` (bare, pay null) kept for back-compat callers. */
  supportingInstructors?: SupportingInstructorInput[]
  supportingInstructorIds?: string[]
  locationId: string
  roomId: string
  startsAt: Date
  endsAt: Date
  capacityOnline: number
  capacityWaitlist: number
  capacityBuffer: number
  creditCost: number
  /** Gross pay to the main instructor for this class, in SGD. null/undefined = unpriced. */
  instructorPaySgd?: number | null
  createdByStaffId: string
}

export type ClassRow = typeof classes.$inferSelect

function normalizeSupporting(
  mainInstructorId: string,
  supportingInstructorIds: string[] | undefined,
): string[] {
  const supports = Array.from(new Set(supportingInstructorIds ?? []))
  if (supports.includes(mainInstructorId)) {
    throw new Error('main instructor cannot also appear in supportingInstructorIds')
  }
  return supports
}

export interface SupportingInstructorInput {
  instructorId: string
  /** null/undefined = unpriced. */
  paySgd?: number | null
}

function normalizeSupportingWithPay(
  mainInstructorId: string,
  supports: SupportingInstructorInput[] | undefined,
): { instructorId: string; paySgd: number | null }[] {
  const byId = new Map<string, number | null>()
  for (const s of supports ?? []) byId.set(s.instructorId, s.paySgd ?? null)
  const result = Array.from(byId, ([instructorId, paySgd]) => ({ instructorId, paySgd }))
  if (result.some(r => r.instructorId === mainInstructorId)) {
    throw new Error('main instructor cannot also appear in supportingInstructorIds')
  }
  return result
}

export async function createClass(input: CreateClassInput): Promise<ClassRow> {
  await assertRoomInLocation(input.roomId, input.locationId)
  await assertRoomAvailable(input.roomId, input.startsAt, input.endsAt)
  const supports =
    input.supportingInstructors !== undefined
      ? normalizeSupportingWithPay(input.mainInstructorId, input.supportingInstructors)
      : normalizeSupporting(input.mainInstructorId, input.supportingInstructorIds).map(
          instructorId => ({ instructorId, paySgd: null as number | null }),
        )

  return db.transaction(async tx => {
    await ensureInstructorRows(tx as unknown as typeof db, [
      input.mainInstructorId,
      ...supports.map(s => s.instructorId),
    ])
    const rows = await tx
      .insert(classes)
      .values({
        classTypeId: input.classTypeId,
        mainInstructorId: input.mainInstructorId,
        locationId: input.locationId,
        roomId: input.roomId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        capacityOnline: input.capacityOnline,
        capacityWaitlist: input.capacityWaitlist,
        capacityBuffer: input.capacityBuffer,
        creditCost: input.creditCost,
        instructorPaySgd:
          input.instructorPaySgd == null ? null : input.instructorPaySgd.toFixed(2),
        createdByStaffId: input.createdByStaffId,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('insert returned no rows')

    if (supports.length > 0) {
      await tx.insert(classSupportingInstructors).values(
        supports.map(s => ({
          classId: row.id,
          instructorId: s.instructorId,
          paySgd: s.paySgd == null ? null : s.paySgd.toFixed(2),
        })),
      )
    }
    return row
  })
}

export interface UpdateClassInput {
  classTypeId?: string
  mainInstructorId?: string
  supportingInstructors?: SupportingInstructorInput[]
  locationId?: string
  roomId?: string
  startsAt?: Date
  endsAt?: Date
  capacityOnline?: number
  capacityWaitlist?: number
  capacityBuffer?: number
  creditCost?: number
  /** undefined = leave unchanged; null = clear; number = set (SGD). */
  instructorPaySgd?: number | null
}

export async function updateClass(id: string, patch: UpdateClassInput): Promise<ClassRow> {
  const [existing] = await db.select().from(classes).where(eq(classes.id, id)).limit(1)
  if (!existing) throw new Error('class_not_found')

  const newRoomId = patch.roomId ?? existing.roomId
  const newLocationId = patch.locationId ?? existing.locationId
  const newStartsAt = patch.startsAt ?? existing.startsAt
  const newEndsAt = patch.endsAt ?? existing.endsAt

  if (
    patch.roomId !== undefined ||
    patch.locationId !== undefined ||
    patch.startsAt !== undefined ||
    patch.endsAt !== undefined
  ) {
    if (newRoomId) {
      await assertRoomInLocation(newRoomId, newLocationId)
      await assertRoomAvailable(newRoomId, newStartsAt, newEndsAt, { excludeClassId: id })
    }
  }

  let supports: { instructorId: string; paySgd: number | null }[] | undefined
  if (patch.supportingInstructors !== undefined) {
    const mainForCheck = patch.mainInstructorId ?? existing.mainInstructorId
    supports = normalizeSupportingWithPay(mainForCheck, patch.supportingInstructors)
  } else if (patch.mainInstructorId !== undefined) {
    // If main changes but supporting list is not provided, ensure new main isn't in existing supporting set.
    const existingSupports = await listSupportingInstructorIds(id)
    if (existingSupports.includes(patch.mainInstructorId)) {
      throw new Error('main instructor cannot also appear in supportingInstructorIds')
    }
  }

  return db.transaction(async tx => {
    const idsToEnsure: string[] = []
    if (patch.mainInstructorId !== undefined) idsToEnsure.push(patch.mainInstructorId)
    if (supports !== undefined) idsToEnsure.push(...supports.map(s => s.instructorId))
    if (idsToEnsure.length > 0) {
      await ensureInstructorRows(tx as unknown as typeof db, idsToEnsure)
    }

    const set: Partial<typeof classes.$inferInsert> = {}
    if (patch.classTypeId !== undefined) set.classTypeId = patch.classTypeId
    if (patch.mainInstructorId !== undefined) set.mainInstructorId = patch.mainInstructorId
    if (patch.locationId !== undefined) set.locationId = patch.locationId
    if (patch.roomId !== undefined) set.roomId = patch.roomId
    if (patch.startsAt !== undefined) set.startsAt = patch.startsAt
    if (patch.endsAt !== undefined) set.endsAt = patch.endsAt
    if (patch.capacityOnline !== undefined) set.capacityOnline = patch.capacityOnline
    if (patch.capacityWaitlist !== undefined) set.capacityWaitlist = patch.capacityWaitlist
    if (patch.capacityBuffer !== undefined) set.capacityBuffer = patch.capacityBuffer
    if (patch.creditCost !== undefined) set.creditCost = patch.creditCost
    if (patch.instructorPaySgd !== undefined)
      set.instructorPaySgd =
        patch.instructorPaySgd == null ? null : patch.instructorPaySgd.toFixed(2)

    let row = existing
    if (Object.keys(set).length) {
      const rows = await tx.update(classes).set(set).where(eq(classes.id, id)).returning()
      if (!rows[0]) throw new Error('update returned no rows')
      row = rows[0]
    }

    if (supports !== undefined) {
      await tx
        .delete(classSupportingInstructors)
        .where(eq(classSupportingInstructors.classId, id))
      if (supports.length > 0) {
        await tx.insert(classSupportingInstructors).values(
          supports.map(s => ({
            classId: id,
            instructorId: s.instructorId,
            paySgd: s.paySgd == null ? null : s.paySgd.toFixed(2),
          })),
        )
      }
    }
    return row
  })
}

export async function listSupportingInstructorIds(classId: string): Promise<string[]> {
  const rows = await db
    .select({ instructorId: classSupportingInstructors.instructorId })
    .from(classSupportingInstructors)
    .where(eq(classSupportingInstructors.classId, classId))
  return rows.map(r => r.instructorId).sort()
}

export async function listSupportingInstructors(
  classId: string,
): Promise<{ instructorId: string; paySgd: number | null }[]> {
  const rows = await db
    .select({
      instructorId: classSupportingInstructors.instructorId,
      paySgd: classSupportingInstructors.paySgd,
    })
    .from(classSupportingInstructors)
    .where(eq(classSupportingInstructors.classId, classId))
  return rows
    .map(r => ({ instructorId: r.instructorId, paySgd: r.paySgd == null ? null : Number(r.paySgd) }))
    .sort((a, b) => a.instructorId.localeCompare(b.instructorId))
}
