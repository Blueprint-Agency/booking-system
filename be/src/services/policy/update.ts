import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { globalPolicy, ptBookingConfig } from '../../db/schema/policy'
import { instructors } from '../../db/schema/catalog'
import { NotFoundError } from '../../shared/errors'

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
  coverGroupLeaveCap?: number
  studyLeaveCap?: number
  /** The whole **Cover Group**, as one ticked set of instructor staff user ids.
   *  Absent leaves membership alone; present replaces it entirely. */
  coverGroupStaffIds?: readonly string[]
}

/**
 * One PATCH, one transaction: the caps and the Cover Group are saved together or
 * not at all. They are one screen and one decision — a half-applied save would
 * leave a cap raised over a set that never changed.
 */
export async function updateGlobalPolicy(
  patch: UpdateGlobalPolicyInput,
  staffId: string,
): Promise<GlobalPolicyRow> {
  const { coverGroupStaffIds, ...columns } = patch
  return db.transaction(async tx => {
    const [row] = await tx
      .update(globalPolicy)
      .set({ ...columns, updatedAt: new Date(), updatedByStaffId: staffId })
      .where(eq(globalPolicy.id, POLICY_SINGLETON_ID))
      .returning()
    if (!row) throw new NotFoundError('policy_not_seeded')
    if (coverGroupStaffIds !== undefined) {
      // Every instructor row, locked in staff-user-id order FIRST: a leave
      // submission locks the same rows in that order (services/leave/requests.ts),
      // and an unordered whole-table UPDATE here would deadlock against it —
      // which is the very thing the ordering was bought to prevent.
      await tx
        .select({ id: instructors.staffUserId })
        .from(instructors)
        .orderBy(asc(instructors.staffUserId))
        .for('update')
      // The Cover Group is ONE ticked set, so the whole set arrives and every
      // instructor outside it is unticked in the same breath — there is no add
      // and no remove to get out of step with each other.
      await tx.update(instructors).set({ inCoverGroup: false })
      if (coverGroupStaffIds.length > 0) {
        await tx
          .update(instructors)
          .set({ inCoverGroup: true })
          .where(inArray(instructors.staffUserId, [...coverGroupStaffIds]))
      }
    }
    return row
  })
}

/** Who is in the **Cover Group** — the staff user ids of every instructor in it. */
export async function readCoverGroup(): Promise<string[]> {
  return (
    await db
      .select({ id: instructors.staffUserId })
      .from(instructors)
      .where(eq(instructors.inCoverGroup, true))
  ).map(r => r.id)
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
