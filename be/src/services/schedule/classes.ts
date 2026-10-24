import { and, eq } from 'drizzle-orm'
import { afterCommit, db } from '../../db'
import { classes } from '../../db/schema'
import { countSeats } from '../bookings/seats'
import { assertRoomInLocation } from './room-conflicts'
import { assertAvailable, eventSubjects, plannedInstructorIds } from './occupancy'
import { computeEventState } from '../policy/event-state'
import { now as clockNow } from '../../lib/clock'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import {
  ensureInstructors,
  readRoster,
  replaceRoster,
  type RosterAssignment,
  type RosterPatch,
} from './roster'

import { ACCEPTS_ALL, validateRule, writeClassRule, type PackageRule } from './package-rules'
import { applyRuleChange, previewRuleChange, sendRuleCancelledEmails } from './package-rule-change'
import { sendPromotionEmails } from '../waitlist/promote'

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
   * Gross pay to the main instructor for this class, in SGD. null = Unpriced,
   * never S$0: an admin may leave it blank, and an instructor scheduling their
   * own class never sees pay at all. Either way an admin prices it later from
   * Finance's "Needs pay" filter. See
   * be/docs/adr/0008-instructor-pay-is-optional-when-scheduling.md.
   */
  instructorPaySgd?: number | null
  /** Which packages may pay for the class. Absent = accepts all. */
  packageRule?: PackageRule
  createdByStaffId: string
}

export type ClassRow = typeof classes.$inferSelect

/** A class ends after it starts — on create, and on every edit of either end. */
function assertEndsAfterStart(startsAt: Date, endsAt: Date): void {
  if (endsAt <= startsAt) throw new BadRequestError('ends_at_must_be_after_starts_at')
}

export async function createClass(tenantId: string, input: CreateClassInput): Promise<ClassRow> {
  assertEndsAfterStart(input.startsAt, input.endsAt)
  // The room gate doubles as the location gate: a room only passes if it is this
  // tenant's and sits in the location named, so neither can be borrowed.
  await assertRoomInLocation(tenantId, input.roomId, input.locationId)

  return db.transaction(async tx => {
    await assertAvailable(
      tx,
      tenantId,
      eventSubjects(input.roomId, [
        input.mainInstructorId,
        ...(input.supportingInstructors?.map(s => s.instructorId) ??
          input.supportingInstructorIds ??
          []),
      ]),
      { startsAt: input.startsAt, endsAt: input.endsAt },
    )
    const rule = input.packageRule ? await validateRule(tx, tenantId, input.packageRule) : ACCEPTS_ALL
    // The class row's own main_instructor_id FK points at instructors.staff_user_id,
    // so the profile row has to exist before there is a class to hang a roster on.
    await ensureInstructors(tenantId, [input.mainInstructorId], tx)
    const rows = await tx
      .insert(classes)
      .values({
        tenantId,
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
    let row = rows[0]
    // Unreachable DB invariant, not a client error — deliberately left untyped so
    // errorBoundary logs + reports it as a 500 rather than blaming the caller.
    if (!row) throw new Error('insert returned no rows')
    if (rule.mode !== 'all') {
      await writeClassRule(tx, tenantId, [row.id], rule)
      row = { ...row, packageRuleMode: rule.mode }
    }

    if (input.supportingInstructors !== undefined || input.supportingInstructorIds !== undefined) {
      await replaceRoster(
        tx,
        tenantId,
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
  /**
   * undefined = leave unchanged. A new rule cancels the bookings paid by a
   * package it no longer accepts (./package-rule-change) — preview the count
   * first with `previewClassRuleChange`.
   */
  packageRule?: PackageRule
}

/**
 * How many bookings setting this rule on the class would cancel. Validates the
 * rule as saving it would, and writes nothing.
 */
export async function previewClassRuleChange(tenantId: string, id: string, rule: PackageRule): Promise<number> {
  const [existing] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.tenantId, tenantId), eq(classes.id, id)))
    .limit(1)
  if (!existing) throw new NotFoundError('class_not_found')
  return previewRuleChange(tenantId, id, await validateRule(db, tenantId, rule))
}

export async function updateClass(
  tenantId: string,
  id: string,
  patch: UpdateClassInput,
  /** Who made the edit — named on the refunds a rule change makes. */
  actorStaffId?: string,
): Promise<ClassRow> {
  const { row, ruleChange } = await db.transaction(async tx => {
    // The lock booking takes (bookings/book.ts `lockClass`), before anything is
    // read: a booking made meanwhile is counted below, and one made after
    // waits and is judged by the edit.
    const [existing] = await tx
      .select()
      .from(classes)
      .where(and(eq(classes.tenantId, tenantId), eq(classes.id, id)))
      .for('update')
      .limit(1)
    if (!existing) throw new NotFoundError('class_not_found')

    // Once a class has started it is a record of what happened, not a plan — moving,
    // repricing or resizing it rewrites history under the people who already sat in it.
    // Same predicate every read path uses (policy/event-state.ts).
    const now = clockNow()
    const state = computeEventState({
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      lifecycle: existing.lifecycle,
      now,
    })
    if (state !== 'scheduled') throw new ConflictError(`class_${state}`)

    const newStartsAt = patch.startsAt ?? existing.startsAt
    const newEndsAt = patch.endsAt ?? existing.endsAt
    assertEndsAfterStart(newStartsAt, newEndsAt)
    // Nor may an edit make an upcoming class one that has already started: that is
    // the guard above's state reached by a typo, and from it there is no way back —
    // no edit, no class cancel to refund its bookings, and its Instructor Pay owed.
    if (newStartsAt <= now) throw new BadRequestError('starts_at_in_past')

    // Online capacity can't drop below the members already holding an online seat.
    // Buffer and overbook seats are staff's and don't count against it.
    if (patch.capacityOnline !== undefined) {
      const { onlineUsed } = await countSeats(tx, tenantId, id)
      if (patch.capacityOnline < onlineUsed) {
        throw new ConflictError('capacity_below_bookings', { confirmed: onlineUsed })
      }
    }

    const newRoomId = patch.roomId ?? existing.roomId
    const newLocationId = patch.locationId ?? existing.locationId
    const movesRoom =
      patch.roomId !== undefined ||
      patch.locationId !== undefined ||
      patch.startsAt !== undefined ||
      patch.endsAt !== undefined
    if (movesRoom && newRoomId) await assertRoomInLocation(tenantId, newRoomId, newLocationId)

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
    const movesRoster = touchesRoster || patch.startsAt !== undefined || patch.endsAt !== undefined
    await assertAvailable(
      tx,
      tenantId,
      eventSubjects(
        movesRoom ? newRoomId : null,
        movesRoster ? await plannedInstructorIds(tenantId, { kind: 'class', id }, rosterPatch) : [],
      ),
      { startsAt: newStartsAt, endsAt: newEndsAt },
      { kind: 'class', id },
    )
    const rule = patch.packageRule ? await validateRule(tx, tenantId, patch.packageRule) : undefined

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
      const rows = await tx
        .update(classes)
        .set(set)
        .where(and(eq(classes.tenantId, tenantId), eq(classes.id, id)))
        .returning()
      row = rows[0]!
    }

    if (touchesRoster) {
      await replaceRoster(tx, tenantId, { kind: 'class', id }, rosterPatch)
      // main_instructor_id / instructor_pay_sgd may have moved under us.
      const [fresh] = await tx
        .select()
        .from(classes)
        .where(and(eq(classes.tenantId, tenantId), eq(classes.id, id)))
        .limit(1)
      if (fresh) row = fresh
    }

    // Last: a booking made meanwhile is waiting on the class row locked above,
    // and is then judged by the new rule.
    let ruleChange: Awaited<ReturnType<typeof applyRuleChange>> | null = null
    if (rule) {
      ruleChange = await applyRuleChange(tx, tenantId, id, rule, actorStaffId ?? null)
      row = { ...row, packageRuleMode: rule.mode }
    }
    return { row, ruleChange }
  })

  // Once the request's transaction has committed (`afterCommit`), never inside
  // it: this transaction is only a savepoint of the request's.
  if (ruleChange) {
    const { promotions, cancellations } = ruleChange
    if (promotions.length) afterCommit(() => sendPromotionEmails(tenantId, promotions))
    if (cancellations.length) afterCommit(() => sendRuleCancelledEmails(tenantId, cancellations))
  }
  return row
}

export async function listSupportingInstructors(
  tenantId: string,
  classId: string,
): Promise<{ instructorId: string; paySgd: number | null }[]> {
  const roster = await readRoster(tenantId, { kind: 'class', id: classId })
  return roster
    .filter(r => r.role === 'supporting')
    .map(r => ({ instructorId: r.instructorId, paySgd: r.paySgd }))
}
