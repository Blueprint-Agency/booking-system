import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { TENANT_ONE_ID } from '../schema/tenancy'

/**
 * Tenant #1's two rows predate tenancy and carry these fixed ids. Kept so a
 * database seeded before migration 0028 and one seeded after it hold the same
 * rows; every other tenant's are generated.
 */
const POLICY_SINGLETON_ID = '00000000-0000-0000-0000-000000000001'
const PT_CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000002'

/**
 * The cancellation policy every studio starts with (#318): the Cancellation Cap
 * on at 10 cancellations per 30 days, 24-hour class and PT windows. Every column
 * not named here takes its schema default. The seeds, the e2e studio and a studio
 * provisioned from the super portal all start here, so what the tests run against
 * is what a new studio gets.
 */
export const DEFAULT_GLOBAL_POLICY = {
  cancelCapEnabled: true,
  cancelCapCount: 10,
  cancelCapCycleDays: 30,
  classWindowHours: 24,
  ptWindowHours: 24,
  leaveCarryOverCapDays: 14,
} as const

export const DEFAULT_PT_BOOKING_CONFIG = { bookInAdvanceDays: 7, minBookInAdvanceDays: 3 } as const

/** A database or an open transaction — provisioning writes these inside its own. */
type PolicyWriter = Pick<PostgresJsDatabase<typeof schema>, 'insert'>

/**
 * One policy row and one PT config row per tenant — held to one each by the
 * unique index on `tenant_id` (migration 0028), which is what `onConflictDoNothing`
 * lands on for a tenant that already has them: a studio's own policy is never
 * written over.
 */
export async function seedPolicy(db: PolicyWriter, tenant: { id: string }) {
  const isTenantOne = tenant.id === TENANT_ONE_ID

  await db
    .insert(schema.globalPolicy)
    .values({
      ...(isTenantOne ? { id: POLICY_SINGLETON_ID } : {}),
      tenantId: tenant.id,
      ...DEFAULT_GLOBAL_POLICY,
    })
    .onConflictDoNothing()

  await db
    .insert(schema.ptBookingConfig)
    .values({
      ...(isTenantOne ? { id: PT_CONFIG_SINGLETON_ID } : {}),
      tenantId: tenant.id,
      ...DEFAULT_PT_BOOKING_CONFIG,
    })
    .onConflictDoNothing()
}
