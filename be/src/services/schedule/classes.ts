import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { classes } from '../../db/schema'
import { bookings } from '../../db/schema/bookings'
import { assertRoomAvailable, assertRoomInLocation } from './room-conflicts'
import { assertInstructorsAvailable, plannedInstructorIds } from './occupancy'
import { computeEventState } from '../policy/event-state'
import { ConflictError, NotFoundError } from '../../shared/errors'
import {
  ensureInstructors,
  readRoster,
  replaceRoster,
  type RosterAssignment,
  type RosterPatch,
} from './roster'

export type { RosterAssignment } from './roster'

export interface CreateClassInput {
  classTypeId: string
  mainInstructorId: string
  /** Preferred — per-instructor pay. `supportingInstructorIds` (bare ids) is the older shape. */
  supportingInstructors?: RosterAssignment[]
  supportingInstructorIds?: string[]
  locationId: string
  roomId: string
  startsAt: Date
  endsAt: Date
  capacityOnline: number
  capacityWaitlist: number
  capacityBuffer: number
  creditCost: number
  /**
   * Gross pay to the main instructor for this class, in SGD. null = Unpriced.
   *
   * Deliberately still nullable HERE. Pay is required of an admin scheduling a
   * class, and that is enforced on the admin route — but an instructor may
   * schedule their own class and must never see pay rates, so that path creates
   * the class Unpriced and an admin prices it from Finance's "Needs pay" filter.
   * Who must supply a figure is an audience rule, not a domain invariant, which
   * is why it is not stated here. (The roster module's `instructor_pay_required`
   * rule still covers everyone JOINING a roster later, both audiences alike.)
   * See be/docs/adr/0002-finance-replaces-payroll.md.
   */
  instructorPaySgd?: number | null
  createdByStaffId: string
}

export type ClassRow = typeof classes.$inferSelect

export async function createClass(input: CreateClassInput): Promise<ClassRow> {
  await assertRoomInLocation(input.roomId, input.locationId)
  await assertRoomAvailable(input.roomId, input.startsAt, input.endsAt)
  // Nobody on the roster may already be teaching then — supporting included.
  await assertInstructorsAvailable(
    [
      input.mainInstructorId,
      ...(input.supportingInstructors?.map(s => s.instructorId) ??
        input.supportingInstructorIds ??
        []),
    ],
    { startsAt: input.startsAt, endsAt: input.endsAt },
  )

  return db.transaction(async tx => {
    // The class row's own main_instructor_id FK points at instructors.staff_user_id,
    // so the profile row has to exist before there is a class to hang a roster on.
    await ensureInstructors([input.mainInstructorId], tx)
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
        // Initial value on a brand-new row, not a movement — nothing to merge
        // against yet. Every later change goes through the roster module.
        instructorPaySgd:
          input.instructorPaySgd == null ? null : input.instructorPaySgd.toFixed(2),
        createdByStaffId: input.createdByStaffId,
      })
      .returning()
    const row = rows[0]
    // Unreachable DB invariant, not a client error — deliberately left untyped so
    // errorBoundary logs + reports it as a 500 rather than blaming the caller.
    if (!row) throw new Error('insert returned no rows')

    if (input.supportingInstructors !== undefined || input.supportingInstructorIds !== undefined) {
      await replaceRoster(
        tx,
        { kind: 'class', id: row.id },
        {
          ...(input.supportingInstructors !== undefined
            ? { supporting: input.supportingInstructors }
            : {}),
          ...(input.supportingInstructorIds !== undefined
            ? { supportingInstructorIds: input.supportingInstructorIds }
            : {}),
        },
      )
    }
    return row
  })
}

export interface UpdateClassInput {
  classTypeId?: string
  mainInstructorId?: string
  supportingInstructors?: RosterAssignment[]
  supportingInstructorIds?: string[]
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
  if (!existing) throw new NotFoundError('class_not_found')

  // Once a class has started it is a record of what happened, not a plan — moving,
  // repricing or resizing it rewrites history under the people who already sat in it.
  // Same predicate every read path uses (policy/event-state.ts).
  const state = computeEventState({
    startsAt: existing.startsAt,
    endsAt: existing.endsAt,
    lifecycle: existing.lifecycle,
    now: new Date(),
  })
  if (state !== 'scheduled') throw new ConflictError(`class_${state}`)

  // Capacity can't drop below the people already holding a seat.
  if (patch.capacityOnline !== undefined) {
    const [seats] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.classId, id), eq(bookings.state, 'confirmed')))
    const confirmed = Number(seats?.cnt ?? 0)
    if (patch.capacityOnline < confirmed) {
      throw new ConflictError('capacity_below_bookings', { confirmed })
    }
  }

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
      await assertRoomAvailable(newRoomId, newStartsAt, newEndsAt, { kind: 'class', id })
    }
  }

  // Who is on the class, and what they're paid, belongs to the roster module —
  // including main_instructor_id and instructor_pay_sgd, which live on this row.
  const touchesMain = patch.mainInstructorId !== undefined || patch.instructorPaySgd !== undefined
  const touchesRoster =
    touchesMain ||
    patch.supportingInstructors !== undefined ||
    patch.supportingInstructorIds !== undefined

  const rosterPatch: RosterPatch = {
    ...(touchesMain
      ? {
          main: {
            ...(patch.mainInstructorId !== undefined
              ? { instructorId: patch.mainInstructorId }
              : {}),
            ...(patch.instructorPaySgd !== undefined ? { paySgd: patch.instructorPaySgd } : {}),
          },
        }
      : {}),
    ...(patch.supportingInstructors !== undefined
      ? { supporting: patch.supportingInstructors }
      : {}),
    ...(patch.supportingInstructorIds !== undefined
      ? { supportingInstructorIds: patch.supportingInstructorIds }
      : {}),
  }

  // A new roster, or the same roster at a new time, can put someone in two
  // places at once. Ask about whoever the class will END UP with.
  if (touchesRoster || patch.startsAt !== undefined || patch.endsAt !== undefined) {
    await assertInstructorsAvailable(
      await plannedInstructorIds({ kind: 'class', id }, rosterPatch),
      { startsAt: newStartsAt, endsAt: newEndsAt },
      { kind: 'class', id },
    )
  }

  return db.transaction(async tx => {
    const set: Partial<typeof classes.$inferInsert> = {}
    if (patch.classTypeId !== undefined) set.classTypeId = patch.classTypeId
    if (patch.locationId !== undefined) set.locationId = patch.locationId
    if (patch.roomId !== undefined) set.roomId = patch.roomId
    if (patch.startsAt !== undefined) set.startsAt = patch.startsAt
    if (patch.endsAt !== undefined) set.endsAt = patch.endsAt
    if (patch.capacityOnline !== undefined) set.capacityOnline = patch.capacityOnline
    if (patch.capacityWaitlist !== undefined) set.capacityWaitlist = patch.capacityWaitlist
    if (patch.capacityBuffer !== undefined) set.capacityBuffer = patch.capacityBuffer
    if (patch.creditCost !== undefined) set.creditCost = patch.creditCost

    let row = existing
    if (Object.keys(set).length) {
      const rows = await tx.update(classes).set(set).where(eq(classes.id, id)).returning()
      // Unreachable DB invariant (row existence checked above) — see note above.
      if (!rows[0]) throw new Error('update returned no rows')
      row = rows[0]
    }

    if (touchesRoster) {
      await replaceRoster(tx, { kind: 'class', id }, rosterPatch)
      // main_instructor_id / instructor_pay_sgd may have moved under us.
      const [fresh] = await tx.select().from(classes).where(eq(classes.id, id)).limit(1)
      if (fresh) row = fresh
    }
    return row
  })
}

export async function listSupportingInstructors(
  classId: string,
): Promise<{ instructorId: string; paySgd: number | null }[]> {
  const roster = await readRoster({ kind: 'class', id: classId })
  return roster
    .filter(r => r.role === 'supporting')
    .map(r => ({ instructorId: r.instructorId, paySgd: r.paySgd }))
}
