import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { and, eq } from 'drizzle-orm'
import * as schema from '../schema'
import type { SeededTenant } from './tenants'
import { provisioningFor } from './provisioning'

type SeedLocation = {
  name: string
  address: string | null
  gmapsUrl: string | null
  phone: string | null
}

/**
 * Premises are a tenant's own, not the platform's — which studio has which
 * addresses is provisioning data (`./provisioning.ts`), never a fixture here.
 *
 * A tenant with no premises on record still gets one, named after itself, so
 * its schedule, rooms and plans have somewhere to hang from the first minute.
 */
export function locationsFor(tenant: SeededTenant): SeedLocation[] {
  const provisioned = provisioningFor(tenant)?.locations
  if (provisioned?.length) return provisioned
  return [{ name: `${tenant.name} Studio`, address: null, gmapsUrl: null, phone: null }]
}

/**
 * Idempotent on (tenant_id, name) — `locations` has no unique constraint on
 * name, and the check has to be per-tenant or the second tenant's studio would
 * be skipped because some *other* tenant already has one by that name.
 */
export async function seedLocations(db: PostgresJsDatabase<typeof schema>, tenant: SeededTenant) {
  for (const row of locationsFor(tenant)) {
    const existing = await db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(
        and(eq(schema.locations.tenantId, tenant.id), eq(schema.locations.name, row.name)),
      )
      .limit(1)
    if (existing.length) continue

    await db.insert(schema.locations).values({
      tenantId: tenant.id,
      name: row.name,
      address: row.address,
      gmapsUrl: row.gmapsUrl,
      phone: row.phone,
    })
  }
}
