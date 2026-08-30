import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { tenants, tenantSettings } from '../../db/schema/tenancy'
import type { TenantRow, TenantSettingsRow } from '../../db/schema/tenancy'
import type { TenantStatus } from '../../db/enums'
import { isUniqueViolation } from '../../db/unique-violation'
import { ConflictError } from '../../shared/errors'
import { assertUsableSlug, normaliseSlug } from './slug'

export type ResolvedTenant = {
  tenant: TenantRow
  settings: TenantSettingsRow | null
}

/**
 * Statuses a slug still resolves for. A `suspended` tenant resolves so the
 * frontends can render a "paused" page; an `archived` one is deliberately
 * indistinguishable from a slug that never existed.
 */
const RESOLVABLE: TenantStatus[] = ['active', 'suspended']

/**
 * Slug → tenant identity + settings. Sits on every request path (the frontend
 * proxy calls it for each incoming hostname), so it is one indexed lookup and
 * a left join, nothing more. Returns null for unknown, archived and malformed
 * slugs alike — the caller must not be able to tell those apart.
 */
export async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const normalised = normaliseSlug(slug)
  if (!normalised) return null

  const [row] = await db
    .select({ tenant: tenants, settings: tenantSettings })
    .from(tenants)
    .leftJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id))
    .where(eq(tenants.slug, normalised))
    .limit(1)

  if (!row) return null
  if (!RESOLVABLE.includes(row.tenant.status)) return null
  return row
}

export type CreateTenantInput = {
  slug: string
  name: string
  timezone?: string
  clerk_client_org_id?: string | null
  clerk_portal_org_id?: string | null
  settings?: Partial<Omit<TenantSettingsRow, 'tenantId' | 'createdAt' | 'updatedAt'>>
}

/**
 * The whole of "creating a tenant": one row in `tenants`, one in
 * `tenant_settings`. No infrastructure, no deployment — the subdomains resolve
 * the moment the row exists, which is exactly why the slug gate lives here and
 * not at the route.
 */
export async function createTenant(input: CreateTenantInput): Promise<ResolvedTenant> {
  const slug = assertUsableSlug(input.slug)

  try {
    return await db.transaction(async tx => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          slug,
          name: input.name,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          clerkClientOrgId: input.clerk_client_org_id ?? null,
          clerkPortalOrgId: input.clerk_portal_org_id ?? null,
        })
        .returning()
      if (!tenant) throw new Error('tenant insert returned no row')

      const [settings] = await tx
        .insert(tenantSettings)
        .values({ ...input.settings, tenantId: tenant.id })
        .returning()

      return { tenant, settings: settings ?? null }
    })
  } catch (err) {
    if (isUniqueViolation(err, 'tenants_slug_unique')) {
      throw new ConflictError('slug_taken', { slug })
    }
    // A Clerk organization belongs to exactly one tenant in each application.
    if (isUniqueViolation(err, 'tenants_clerk_client_org_id_unique')) {
      throw new ConflictError('clerk_client_org_taken')
    }
    if (isUniqueViolation(err, 'tenants_clerk_portal_org_id_unique')) {
      throw new ConflictError('clerk_portal_org_taken')
    }
    throw err
  }
}
