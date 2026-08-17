import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { globalPolicy, ptBookingConfig } from '../../db/schema/policy'
import { instructors, leaveConflicts } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { BadRequestError, NotFoundError } from '../../shared/errors'

const POLICY_SINGLETON_ID = '00000000-0000-0000-0000-000000000001'
const PT_CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000002'

export type GlobalPolicyRow = typeof globalPolicy.$inferSelect
export type PtBookingConfigRow = typeof ptBookingConfig.$inferSelect

export async function readPolicy(): Promise<{
  global_policy: GlobalPolicyRow
  pt_booking_config: PtBookingConfigRow
}> {
  const [gp] = await db.select().from(globalPolicy).where(eq(globalPolicy.id, POLICY_SINGLETON_ID)).limit(1)
  const [pt] = await db
    .select()
    .from(ptBookingConfig)
    .where(eq(ptBookingConfig.id, PT_CONFIG_SINGLETON_ID))
    .limit(1)
  if (!gp || !pt) throw new NotFoundError('policy_not_seeded')
  return { global_policy: gp, pt_booking_config: pt }
}

export interface UpdateGlobalPolicyInput {
  cancelCapCount?: number
  cancelCapCycleDays?: number
  classWindowHours?: number
  ptWindowHours?: number
  leaveCarryOverCapDays?: number
  studyLeaveCap?: number
  /** The Cross-Location Add-On's monthly rate (§5), as "30.00". */
  crossLocationRateSgd?: string
  /** Every declared **Leave Conflict**, as one replacement set. Absent leaves
   *  the declared pairs alone; present replaces them entirely. */
  leaveConflictPairs?: readonly LeaveConflictPair[]
}

/** One declared pair, in whatever order the admin picked the two. */
export interface LeaveConflictPair {
  instructorAId: string
  instructorBId: string
}

/** The pair as it is stored: lower id first, which is what the table's CHECK
 *  enforces and what makes "Alice and Bob" and "Bob and Alice" one row. */
const canonical = (p: LeaveConflictPair): LeaveConflictPair =>
  p.instructorAId < p.instructorBId
    ? p
    : { instructorAId: p.instructorBId, instructorBId: p.instructorAId }

const pairKey = (p: LeaveConflictPair) => `${p.instructorAId}:${p.instructorBId}`

/**
 * One PATCH, one transaction: the caps and the declared Leave Conflicts are
 * saved together or not at all. They are one screen and one decision — a
 * half-applied save would leave a cap raised over a set that never changed.
 */
export async function updateGlobalPolicy(
  patch: UpdateGlobalPolicyInput,
  staffId: string,
): Promise<GlobalPolicyRow> {
  const { leaveConflictPairs, ...columns } = patch
  return db.transaction(async tx => {
    const [row] = await tx
      .update(globalPolicy)
      .set({ ...columns, updatedAt: new Date(), updatedByStaffId: staffId })
      .where(eq(globalPolicy.id, POLICY_SINGLETON_ID))
      .returning()
    if (!row) throw new NotFoundError('policy_not_seeded')
    if (leaveConflictPairs !== undefined) {
      // Every instructor row, locked in staff-user-id order FIRST: a leave
      // submission locks the applicant and their partners in that same order
      // (services/leave/requests.ts), and taking these locks unordered would
      // deadlock against it — which is the very thing the ordering was bought to
      // prevent.
      await tx
        .select({ id: instructors.staffUserId })
        .from(instructors)
        .orderBy(asc(instructors.staffUserId))
        .for('update')
      const pairs = await validatedConflictPairs(tx, leaveConflictPairs)
      // One replacement set, so the old declarations go and the new ones arrive
      // in the same transaction — there is no add and no remove to drift apart.
      await tx.delete(leaveConflicts)
      if (pairs.length > 0) await tx.insert(leaveConflicts).values(pairs)
    }
    return row
  })
}

/**
 * The arriving set, canonicalised and checked: two DIFFERENT people, both of
 * them active instructors, and no pair declared twice once the ordering is
 * normalised. Each refusal says what an admin can do about it.
 *
 * The table's CHECK and primary key say the same three things, but a constraint
 * violation reaches an admin as a 500 — these run first so it reaches them as a
 * sentence.
 */
async function validatedConflictPairs(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  arriving: readonly LeaveConflictPair[],
): Promise<LeaveConflictPair[]> {
  const pairs = arriving.map(canonical)
  if (pairs.some(p => p.instructorAId === p.instructorBId)) {
    throw new BadRequestError('invalid_leave_conflict', {
      message: 'An instructor cannot be in a leave conflict with themselves. Pick two different people.',
    })
  }
  const seen = new Set<string>()
  for (const p of pairs) {
    if (seen.has(pairKey(p))) {
      throw new BadRequestError('duplicate_leave_conflict', {
        message: 'That pair is already declared. A pair counts once, whichever way round it was picked.',
      })
    }
    seen.add(pairKey(p))
  }
  const ids = [...new Set(pairs.flatMap(p => [p.instructorAId, p.instructorBId]))]
  if (ids.length > 0) {
    const active = await tx
      .select({ id: instructors.staffUserId })
      .from(instructors)
      .innerJoin(staffUsers, eq(staffUsers.id, instructors.staffUserId))
      .where(and(inArray(instructors.staffUserId, ids), eq(staffUsers.status, 'active')))
    if (active.length !== ids.length) {
      throw new BadRequestError('leave_conflict_instructor_not_active', {
        message:
          'One of those people is not an active instructor. Reload the screen and declare the pair again.',
      })
    }
  }
  return pairs
}

/** Every declared **Leave Conflict**, lower id first — the pairs exactly as the
 *  table holds them. */
export async function readLeaveConflicts(): Promise<LeaveConflictPair[]> {
  return db
    .select({
      instructorAId: leaveConflicts.instructorAId,
      instructorBId: leaveConflicts.instructorBId,
    })
    .from(leaveConflicts)
    .orderBy(asc(leaveConflicts.instructorAId), asc(leaveConflicts.instructorBId))
}

export async function updatePtBookingConfig(
  patch: { bookInAdvanceDays?: number },
  staffId: string,
): Promise<PtBookingConfigRow> {
  const [row] = await db
    .update(ptBookingConfig)
    .set({ ...patch, updatedAt: new Date(), updatedByStaffId: staffId })
    .where(eq(ptBookingConfig.id, PT_CONFIG_SINGLETON_ID))
    .returning()
  if (!row) throw new NotFoundError('pt_booking_config_not_seeded')
  return row
}
