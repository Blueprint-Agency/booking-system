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
 * One waiver per tenant — held to one each by the unique index on `tenant_id`
 * (migration 0031), which is what `onConflictDoNothing` lands on for a tenant
 * that already has one. Never an update: the text is edited from the portal,
 * and a deploy must not silently put a studio's members back on placeholder
 * copy they did not sign.
 */
export async function seedWaiver(db: PostgresJsDatabase<typeof schema>, tenant: SeededTenant) {
  const isTenantOne = tenant.id === TENANT_ONE_ID

  await db
    .insert(schema.waiver)
    .values({
      ...(isTenantOne ? { id: WAIVER_SINGLETON_ID } : {}),
      tenantId: tenant.id,
      bodyHtml: `<p><strong>${tenant.name} — Waiver</strong></p><p>Placeholder waiver body. Replace via admin → Waiver editor.</p>`,
    })
    .onConflictDoNothing()
}
