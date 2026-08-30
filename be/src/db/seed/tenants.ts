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
export async function seedTenants(db: PostgresJsDatabase<typeof schema>) {
  await db
    .insert(schema.tenants)
    .values({
      id: TENANT_ONE_ID,
      slug: TENANT_ONE_SLUG,
      name: 'Yoga Sadhana',
      timezone: 'Asia/Singapore',
    })
    .onConflictDoNothing()

  await db
    .insert(schema.tenantSettings)
    .values({ tenantId: TENANT_ONE_ID, displayName: 'Yoga Sadhana' })
    .onConflictDoNothing()

  if (env.APP_ENV === 'production') return

  await db
    .insert(schema.tenants)
    .values({
      id: SECOND_TENANT_ID,
      slug: SECOND_TENANT_SLUG,
      name: 'Acme Yoga',
      timezone: 'Australia/Sydney',
    })
    .onConflictDoNothing()

  await db
    .insert(schema.tenantSettings)
    .values({ tenantId: SECOND_TENANT_ID, displayName: 'Acme Yoga' })
    .onConflictDoNothing()
}
