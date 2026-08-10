import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { globalPolicy, ptBookingConfig } from '../../db/schema/policy'
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
  /** Yearly instructor leave allowances, in days. Global — no per-instructor override. */
  annualLeaveDays?: number
  medicalLeaveDays?: number
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
