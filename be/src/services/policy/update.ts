import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { globalPolicy, ptBookingConfig } from '../../db/schema/policy'
import { instructors, leaveConflicts } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { BadRequestError, NotFoundError } from '../../shared/errors'

export type GlobalPolicyRow = typeof globalPolicy.$inferSelect
export type PtBookingConfigRow = typeof ptBookingConfig.$inferSelect

/**
 * Both rows are singletons *per tenant* — one policy row and one PT config row
 * each, held to one by a unique index on `tenant_id` (db/schema/policy.ts). So
 * the tenant is the whole of the lookup key; there is no id to pass.
 */
export async function readPolicy(tenantId: string): Promise<{
  global_policy: GlobalPolicyRow
  pt_booking_config: PtBookingConfigRow
}> {
  const [gp] = await db
    .select()
    .from(globalPolicy)
    .where(eq(globalPolicy.tenantId, tenantId))
    .limit(1)
  const [pt] = await db
    .select()
    .from(ptBookingConfig)
    .where(eq(ptBookingConfig.tenantId, tenantId))
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
  tenantId: string,
  patch: UpdateGlobalPolicyInput,
  staffId: string,
): Promise<GlobalPolicyRow> {
  const { leaveConflictPairs, ...columns } = patch
  return db.transaction(async tx => {
    const [row] = await tx
      .update(globalPolicy)
      .set({ ...columns, updatedAt: new Date(), updatedByStaffId: staffId })
      .where(eq(globalPolicy.tenantId, tenantId))
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
        .where(eq(instructors.tenantId, tenantId))
        .orderBy(asc(instructors.staffUserId))
        .for('update')
      const pairs = await validatedConflictPairs(tx, tenantId, leaveConflictPairs)
      // One replacement set, so the old declarations go and the new ones arrive
      // in the same transaction — there is no add and no remove to drift apart.
      // Scoped: replacing this tenant's set must not clear anyone else's.
      await tx.delete(leaveConflicts).where(eq(leaveConflicts.tenantId, tenantId))
      if (pairs.length > 0)
        await tx.insert(leaveConflicts).values(pairs.map(p => ({ ...p, tenantId })))
    }
    return row
  })
}

/**
 * The arriving set, canonicalised and checked: two DIFFERENT people, no pair
 * declared twice once the ordering is normalised, and — for a pair not already
 * stored — both of them active instructors. Each refusal says what an admin can
 * do about it.
 *
 * The table's CHECK and primary key say the same three things, but a constraint
 * violation reaches an admin as a 500 — these run first so it reaches them as a
 * sentence.
 */
async function validatedConflictPairs(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
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
  // Only NEWLY declared pairs are checked against active instructors. A pair
  // already stored survives an archiving — an archived instructor's conflicts
  // refuse no leave, but the declaration is kept so that un-archiving restores
  // it — and re-checking it here would refuse every later save of the screen
  // over a row the admin never touched, with a message they could not act on.
  const stored = new Set(
    (
      await tx
        .select({
          instructorAId: leaveConflicts.instructorAId,
          instructorBId: leaveConflicts.instructorBId,
        })
        .from(leaveConflicts)
        .where(eq(leaveConflicts.tenantId, tenantId))
    ).map(pairKey),
  )
  const ids = [
    ...new Set(
      pairs.filter(p => !stored.has(pairKey(p))).flatMap(p => [p.instructorAId, p.instructorBId]),
    ),
  ]
  if (ids.length > 0) {
    const active = await tx
      .select({ id: instructors.staffUserId })
      .from(instructors)
      .innerJoin(staffUsers, eq(staffUsers.id, instructors.staffUserId))
      .where(
        and(
          eq(instructors.tenantId, tenantId),
          inArray(instructors.staffUserId, ids),
          eq(staffUsers.status, 'active'),
        ),
      )
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
export async function readLeaveConflicts(tenantId: string): Promise<LeaveConflictPair[]> {
  return db
    .select({
      instructorAId: leaveConflicts.instructorAId,
      instructorBId: leaveConflicts.instructorBId,
    })
    .from(leaveConflicts)
    .where(eq(leaveConflicts.tenantId, tenantId))
    .orderBy(asc(leaveConflicts.instructorAId), asc(leaveConflicts.instructorBId))
}

export async function updatePtBookingConfig(
  tenantId: string,
  patch: { bookInAdvanceDays?: number },
  staffId: string,
): Promise<PtBookingConfigRow> {
  const [row] = await db
    .update(ptBookingConfig)
    .set({ ...patch, updatedAt: new Date(), updatedByStaffId: staffId })
    .where(eq(ptBookingConfig.tenantId, tenantId))
    .returning()
  if (!row) throw new NotFoundError('pt_booking_config_not_seeded')
  return row
}
