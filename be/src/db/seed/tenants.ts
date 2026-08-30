import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import {
  TENANT_ONE_ID,
  TENANT_ONE_SLUG,
  SECOND_TENANT_ID,
  SECOND_TENANT_SLUG,
} from '../schema/tenancy'
import { env } from '../../env'

/**
 * Tenant #1 (Yoga Sadhana) — the same id migration 0027 backfilled everything
 * to, so seeding a fresh database and migrating an existing one land in the
 * same place.
 *
 * Outside production we also seed a second, empty tenant. A single-tenant
 * environment cannot reveal a cross-tenant leak: every missing
 * `WHERE tenant_id = ?` looks correct when there is only one tenant's data to
 * return. The second tenant is what makes an isolation bug visible the day it
 * is written.
 *
 * The guard reads the *validated* `env.APP_ENV`, not raw `process.env`: a
 * tenant row is the whole of tenant existence — its slug resolves publicly the
 * moment it lands — so a missing or misspelled value must fail at boot rather
 * than quietly publish `acme` on a real deployment.
 */
export type SeededTenant = {
  id: string
  slug: string
  name: string
  timezone: string
}

const TENANT_ONE: SeededTenant = {
  id: TENANT_ONE_ID,
  slug: TENANT_ONE_SLUG,
  name: 'Yoga Sadhana',
  timezone: 'Asia/Singapore',
}

const SECOND_TENANT: SeededTenant = {
  id: SECOND_TENANT_ID,
  slug: SECOND_TENANT_SLUG,
  name: 'Acme Yoga',
  timezone: 'Australia/Sydney',
}

/**
 * The tenants this environment provisions — and therefore the list every
 * per-tenant seeder (locations, rooms, policy) runs once for each of. Production
 * has exactly one; everywhere else has two, so that a missing
 * `WHERE tenant_id = ?` has something to be visibly wrong about.
 */
export function seededTenants(): SeededTenant[] {
  return env.APP_ENV === 'production' ? [TENANT_ONE] : [TENANT_ONE, SECOND_TENANT]
}

export async function seedTenants(db: PostgresJsDatabase<typeof schema>) {
  for (const tenant of seededTenants()) {
    await db
      .insert(schema.tenants)
      .values({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        timezone: tenant.timezone,
      })
      .onConflictDoNothing()

    await db
      .insert(schema.tenantSettings)
      .values({ tenantId: tenant.id, displayName: tenant.name })
      .onConflictDoNothing()
  }
}
