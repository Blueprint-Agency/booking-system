import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { and, eq } from 'drizzle-orm'
import * as schema from '../schema'
import { TENANT_ONE_SLUG } from '../schema/tenancy'
import type { SeededTenant } from './tenants'

type SeedLocation = {
  name: string
  address: string | null
  gmapsUrl: string | null
  phone: string | null
}

/**
 * Premises are a tenant's own, not the platform's. Yoga Sadhana's two are real
 * addresses; any other tenant gets one placeholder studio so its schedule,
 * rooms and plans have somewhere to hang.
 */
const YOGA_SADHANA: SeedLocation[] = [
  {
    name: 'Breadtalk IHQ (Tai Seng)',
    address: '30 Tai Seng Street, #09-01 Breadtalk IHQ, Singapore 534013',
    gmapsUrl: 'https://maps.google.com/?q=Breadtalk+IHQ+Tai+Seng',
    phone: null,
  },
  {
    name: 'Outram Park',
    address: '1 Cantonment Road, #09-01, Singapore 085101',
    gmapsUrl: 'https://maps.google.com/?q=Outram+Park+Singapore',
    phone: null,
  },
]

export function locationsFor(tenant: SeededTenant): SeedLocation[] {
  if (tenant.slug === TENANT_ONE_SLUG) return YOGA_SADHANA
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
