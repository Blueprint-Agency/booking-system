import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { env } from '../../env'
import { PROVISIONED, provisioningFor } from './provisioning'

/**
 * The two invented studios a seeded environment runs on, and nothing else.
 *
 * A single-tenant environment cannot reveal a cross-tenant leak: every missing
 * `WHERE tenant_id = ?` looks correct when there is only one tenant's data to
 * return. Two fixtures are what make an isolation bug visible the day it is
 * written. Which studios they are is in `./provisioning.ts`; both are invented,
 * and no file in this repo names a real one.
 *
 * **Production seeds no tenant at all.** It used to seed one, because the
 * platform had been built for exactly one and that studio was in the repo; a
 * deployment therefore came up already knowing who it was. A studio now arrives
 * by being created or restored from the super portal (`./run.ts`), so there is
 * nothing here for production to do — and `./run.ts` does not call this file
 * anyway. The guard is belt and braces on a function that writes studios.
 *
 * The guard reads the *validated* `env.APP_ENV`, not raw `process.env`: a
 * tenant row is the whole of tenant existence — its slug resolves publicly the
 * moment it lands — so a missing or misspelled value must fail at boot rather
 * than quietly publish a fixture on a real deployment.
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
  return env.APP_ENV === 'production' ? [] : [TENANT_ONE, SECOND_TENANT]
}

/**
 * Writes the fixture studios. **Never in production**, where `seededTenants()`
 * is empty and this does nothing at all.
 *
 * That guard is what lets the tenant row below be an *upsert* rather than an
 * insert. A fresh database arrives at this point already holding the placeholder
 * tenant #1 that migration 0027 leaves behind, under the same fixed id, so an
 * `onConflictDoNothing` would keep the placeholder's slug and the fixture would
 * silently not exist — every test that resolves it by slug then 404s. Overwriting
 * is right for a fixture and would be very wrong for a studio, which is why it
 * may only ever run where there are no studios.
 *
 * `tenant_settings` below stays insert-only for the opposite reason: it is the
 * half a studio edits from the portal, and even in a seeded environment a deploy
 * must not put back branding somebody has since changed.
 */
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
      .onConflictDoUpdate({
        target: schema.tenants.id,
        set: { slug: tenant.slug, name: tenant.name, timezone: tenant.timezone },
      })

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
      // `displayName` alone is overwritten, for the same reason the tenant row
      // above is: migration 0027 leaves a settings row under this id carrying
      // the placeholder's name, so insert-only would leave the fixture rendering
      // as "Tenant One" while its `tenants` row said otherwise — two names for
      // one studio, which is exactly what a display-name bug looks like.
      //
      // Branding and copy stay insert-only even here. They are what a studio
      // edits from the portal, and re-running the seed against a local database
      // must not put back a logo somebody has just changed.
      .onConflictDoUpdate({
        target: schema.tenantSettings.tenantId,
        set: { displayName: tenant.name },
      })
  }
}
