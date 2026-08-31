import { eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { tenants, tenantSettings } from '../../db/schema/tenancy'
import type { TenantRow, TenantSettingsRow } from '../../db/schema/tenancy'
import type { TenantStatus } from '../../db/enums'
import { isUniqueViolation } from '../../db/unique-violation'
import { ConflictError } from '../../shared/errors'
import { assertUsableSlug, normaliseSlug } from './slug'

/**
 * What a studio publishes about itself: the branding both frontends render
 * before anyone has signed in.
 *
 * `tenant_settings` is the one Tenant-scoped table with no Row-Level Security
 * policy, because slug resolution reads it *before* any Tenant context exists —
 * so this narrow shape is what stands in for one. The rest of the row (the
 * mail-from identity, the waiver text) is not display data and is not read here;
 * `db/roles.ts` grants the application role SELECT on these columns only, so the
 * omission is enforced rather than merely observed, and a column added later is
 * unreadable until someone decides it is public.
 */
export type TenantDisplaySettings = {
  displayName: string | null
  logoUrl: string | null
  faviconUrl: string | null
  ogImageUrl: string | null
  tagline: string | null
  theme: unknown
  copy: unknown
}

const DISPLAY_SETTINGS = {
  displayName: tenantSettings.displayName,
  logoUrl: tenantSettings.logoUrl,
  faviconUrl: tenantSettings.faviconUrl,
  ogImageUrl: tenantSettings.ogImageUrl,
  tagline: tenantSettings.tagline,
  theme: tenantSettings.theme,
  copy: tenantSettings.copy,
}

export type ResolvedTenant = {
  tenant: TenantRow
  settings: TenantDisplaySettings | null
}

/**
 * Statuses a slug still resolves for. A `suspended` tenant resolves so the
 * frontends can render a "paused" page; an `archived` one is deliberately
 * indistinguishable from a slug that never existed.
 */
const RESOLVABLE: TenantStatus[] = ['active', 'suspended']

/**
 * Short-TTL memo in front of the lookup. Slug resolution now runs twice on a
 * request that names a tenant — once at the proxy's public call, once in the
 * backend's own tenant middleware — and a tenant row changes about never, so
 * the query is worth spending once a minute rather than once a request.
 *
 * Deliberately positive-only: a miss stays a query, so a flood of unknown slugs
 * cannot pin arbitrary strings in memory.
 */
const RESOLVE_CACHE_TTL_MS = 60_000
const resolveCache = new Map<string, { at: number; value: ResolvedTenant }>()

/** Called whenever a tenant row is written, so the memo cannot serve a ghost. */
export function forgetCachedTenants() {
  resolveCache.clear()
}

/**
 * Slug → tenant identity + settings. Sits on every request path (the frontend
 * proxy calls it for each incoming hostname), so it is one indexed lookup and
 * a left join, nothing more. Returns null for unknown, archived and malformed
 * slugs alike — the caller must not be able to tell those apart.
 */
export async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const normalised = normaliseSlug(slug)
  if (!normalised) return null

  const cached = resolveCache.get(normalised)
  if (cached && Date.now() - cached.at < RESOLVE_CACHE_TTL_MS) return cached.value
  if (cached) resolveCache.delete(normalised)

  const [row] = await db
    .select({ tenant: tenants, settings: DISPLAY_SETTINGS })
    .from(tenants)
    .leftJoin(tenantSettings, eq(tenantSettings.tenantId, tenants.id))
    .where(eq(tenants.slug, normalised))
    .limit(1)

  if (!row) return null
  if (!RESOLVABLE.includes(row.tenant.status)) return null
  resolveCache.set(normalised, { at: Date.now(), value: row })
  return row
}

/**
 * Every tenant a background job should run for, oldest first.
 *
 * Cron jobs used to be one cross-tenant sweep each — `UPDATE … WHERE expires_at
 * < now()` over the whole table. With Row-Level Security live that sweep sees
 * nothing at all, because a job has no request and therefore no Tenant context.
 * Rather than granting jobs a bypass (which is a hole shaped exactly like the
 * one this ticket closes), each job runs once per tenant inside that tenant's
 * context and the policy does the filtering the job never had to express.
 *
 * Archived tenants are skipped; suspended ones are not — a studio that is paused
 * for its members still needs its members' credits returned on time.
 */
export async function listJobTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(inArray(tenants.status, RESOLVABLE))
    .orderBy(tenants.createdAt)
  return rows.map(r => r.id)
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
        // Display columns only, for the same reason the resolver reads only
        // those: the application role has SELECT on nothing else here.
        .returning(DISPLAY_SETTINGS)

      forgetCachedTenants()
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
