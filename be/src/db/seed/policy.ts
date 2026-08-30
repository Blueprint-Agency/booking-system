import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { TENANT_ONE_ID } from '../schema/tenancy'
import type { SeededTenant } from './tenants'

/**
 * Tenant #1's two rows predate tenancy and carry these fixed ids. Kept so a
 * database seeded before migration 0028 and one seeded after it hold the same
 * rows; every other tenant's are generated.
 */
const POLICY_SINGLETON_ID = '00000000-0000-0000-0000-000000000001'
const PT_CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000002'

/**
 * One policy row and one PT config row per tenant — held to one each by the
 * unique index on `tenant_id` (migration 0028), which is what `onConflictDoNothing`
 * lands on for a tenant that already has them.
 */
export async function seedPolicy(db: PostgresJsDatabase<typeof schema>, tenant: SeededTenant) {
  const isTenantOne = tenant.id === TENANT_ONE_ID

  await db
    .insert(schema.globalPolicy)
    .values({
      ...(isTenantOne ? { id: POLICY_SINGLETON_ID } : {}),
      tenantId: tenant.id,
      cancelCapCount: 3,
      cancelCapCycleDays: 30,
      classWindowHours: 24,
      ptWindowHours: 24,
      leaveCarryOverCapDays: 14,
    })
    .onConflictDoNothing()

  await db
    .insert(schema.ptBookingConfig)
    .values({
      ...(isTenantOne ? { id: PT_CONFIG_SINGLETON_ID } : {}),
      tenantId: tenant.id,
      bookInAdvanceDays: 7,
    })
    .onConflictDoNothing()
}
