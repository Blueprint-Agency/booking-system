import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { env } from '../../env'
import { PROVISIONED, provisioningFor } from './provisioning'

/**
 * Tenant #1 carries the same id migration 0027 backfilled everything to, so
 * seeding a fresh database and migrating an existing one land in the same
 * place.
 *
 * Which studio it *is* — its name, its timezone, its premises — is not here.
 * That is provisioning data and lives in `./provisioning.ts`, the one file that
 * names a studio; this file only knows how to write a tenant row.
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

const [TENANT_ONE, SECOND_TENANT] = PROVISIONED.map(
  (p): SeededTenant => ({ id: p.id, slug: p.slug, name: p.name, timezone: p.timezone }),
) as [SeededTenant, SeededTenant]

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

    // Branding is the studio's own — its wordmark, its photography, its line —
    // and it is what both frontends read to render as that studio rather than
    // as the product. Inserted only, never updated: past the first seed the
    // studio edits its own branding from the portal, and a deploy must not put
    // it back on whatever was written here.
    const provisioned = provisioningFor(tenant)
    const branding = provisioned?.branding
    await db
      .insert(schema.tenantSettings)
      .values({
        tenantId: tenant.id,
        displayName: tenant.name,
        logoUrl: branding?.logoUrl ?? null,
        ogImageUrl: branding?.ogImageUrl ?? null,
        tagline: branding?.tagline ?? null,
        // Same insert-only rule: a deploy must not put back a string the studio
        // has since edited. A database that already has the row is reached by a
        // migration instead — 0042 is the first of those.
        ...(provisioned?.copy ? { copy: provisioned.copy } : {}),
      })
      .onConflictDoNothing()
  }
}
