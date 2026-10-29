import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { TENANT_ONE_ID } from '../schema/tenancy'
import type { SeededTenant } from './tenants'

/**
 * Tenant #1's row predates tenancy and carries this fixed id. Kept so a
 * database seeded before migration 0031 and one seeded after it hold the same
 * row; every other tenant's is generated.
 */
const WAIVER_SINGLETON_ID = '00000000-0000-0000-0000-000000000003'

/**
 * Writes one waiver row per tenant. The unique index on `tenant_id` holds the
 * table to one row each, and the insert's conflict clause lands on that index,
 * so a tenant that already has one keeps it: this never updates.
 *
 * Only the test harness calls it, for the two fixture studios. Waivers are not
 * being built (#233), so no studio gets a row from anywhere else.
 */
export async function seedWaiver(db: PostgresJsDatabase<typeof schema>, tenant: SeededTenant) {
  const isTenantOne = tenant.id === TENANT_ONE_ID

  await db
    .insert(schema.waiver)
    .values({
      ...(isTenantOne ? { id: WAIVER_SINGLETON_ID } : {}),
      tenantId: tenant.id,
      bodyHtml: `<p><strong>${tenant.name} — Waiver</strong></p><p>Placeholder waiver body.</p>`,
    })
    .onConflictDoNothing()
}
