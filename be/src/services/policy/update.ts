import { eq, inArray } from 'drizzle-orm'
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
}

export async function updateGlobalPolicy(
  patch: UpdateGlobalPolicyInput,
  staffId: string,
): Promise<GlobalPolicyRow> {
  const [row] = await db
    .update(globalPolicy)
    .set({ ...patch, updatedAt: new Date(), updatedByStaffId: staffId })
    .where(eq(globalPolicy.id, POLICY_SINGLETON_ID))
    .returning()
  if (!row) throw new NotFoundError('policy_not_seeded')
  return row
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

/**
 * The Cover Group is ONE ticked set, so an admin sends the whole set and every
 * instructor outside it is unticked in the same statement — there is no add and
 * no remove to get out of step with each other.
 */
export async function setCoverGroup(staffUserIds: readonly string[]): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(instructors).set({ inCoverGroup: false })
    if (staffUserIds.length > 0) {
      await tx
        .update(instructors)
        .set({ inCoverGroup: true })
        .where(inArray(instructors.staffUserId, [...staffUserIds]))
    }
  })
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
