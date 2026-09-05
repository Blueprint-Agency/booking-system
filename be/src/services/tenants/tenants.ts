import { and, eq, inArray, sql } from 'drizzle-orm'
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
/** Same memo, keyed by id and by Clerk organization id — both sit on the authed
 *  request path, once per request, for a row that changes about never. */
const tenantRowCache = new Map<string, { at: number; value: TenantRow }>()

/** Called whenever a tenant row is written, so the memo cannot serve a ghost. */
export function forgetCachedTenants() {
  resolveCache.clear()
  tenantRowCache.clear()
}

/** Positive-only memo, for the same reason as `resolveCache`: a flood of
 *  unknown keys must not be able to pin arbitrary strings in memory. */
async function memoisedTenant(
  key: string,
  load: () => Promise<TenantRow | undefined>,
): Promise<TenantRow | null> {
  const cached = tenantRowCache.get(key)
  if (cached && Date.now() - cached.at < RESOLVE_CACHE_TTL_MS) return cached.value
  if (cached) tenantRowCache.delete(key)

  const row = await load()
  if (!row) return null
  tenantRowCache.set(key, { at: Date.now(), value: row })
  return row
}

/**
 * The tenant row for an id already resolved. Read on every authenticated
 * request, to find out which Clerk Organization this studio is.
 */
export async function loadTenantById(id: string): Promise<TenantRow | null> {
  return memoisedTenant(`id:${id}`, async () => {
    const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1)
    return row
  })
}

/**
 * Clerk Organization → Tenant, in one of the two Clerk applications.
 *
 * Each application has its own organization for a studio, and the two ids are
 * distinct namespaces — so the column is chosen by which application minted the
 * token or sent the webhook, never searched across both. A staff token naming a
 * *member* organization must not resolve.
 */
export async function resolveTenantByClerkOrg(
  app: 'client' | 'portal',
  orgId: string,
): Promise<TenantRow | null> {
  const trimmed = orgId.trim()
  if (!trimmed) return null
  const column = app === 'client' ? tenants.clerkClientOrgId : tenants.clerkPortalOrgId
  const row = await memoisedTenant(`org:${app}:${trimmed}`, async () => {
    const [found] = await db.select().from(tenants).where(eq(column, trimmed)).limit(1)
    return found
  })
  if (!row) return null
  return RESOLVABLE.includes(row.status) ? row : null
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

/** What a background job needs to know about a tenant: which one, and whose
 *  clock its daily schedule is on. */
export type JobTenant = { id: string; timezone: string }

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
 * The timezone comes along because a daily job's "01:00" is the tenant's 01:00,
 * decided per tick — see jobs/local-time.ts. The list is read fresh on every
 * tick rather than cached at boot, so a tenant added (or moved to another zone)
 * after the server started is picked up on the next tick with no job wiring.
 *
 * Archived tenants are skipped; suspended ones are not — a studio that is paused
 * for its members still needs its members' credits returned on time.
 */
export async function listJobTenants(): Promise<JobTenant[]> {
  return db
    .select({ id: tenants.id, timezone: tenants.timezone })
    .from(tenants)
    .where(inArray(tenants.status, RESOLVABLE))
    .orderBy(tenants.createdAt)
}

/**
 * Every tenant on the platform, oldest first, for the super portal's list —
 * so Tenant #1 heads it.
 *
 * Archived tenants are included — this is the one surface that has to be able to
 * see them, because it is the surface that archived them. Everywhere else they
 * are indistinguishable from a slug that never existed.
 *
 * Unpaginated on purpose: the platform has tens of studios, not thousands, and
 * a page control here would be scaffolding for a problem nobody has. Revisit
 * when the list stops fitting on a screen.
 */
/** A studio's own row, as the super portal reads it. */
export type TenantRowSummary = {
  id: string
  slug: string
  name: string
  timezone: string
  status: TenantStatus
  createdAt: Date
  clerkClientOrgId: string | null
  clerkPortalOrgId: string | null
}

export type TenantSummary = TenantRowSummary & {
  /** Staff who could sign in — active or invited, never archived. Zero means a
   *  studio nobody can get into. */
  staffCount: number
}

export async function listTenants(): Promise<TenantSummary[]> {
  const [rows, staff] = await Promise.all([
    db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        timezone: tenants.timezone,
        status: tenants.status,
        createdAt: tenants.createdAt,
        clerkClientOrgId: tenants.clerkClientOrgId,
        clerkPortalOrgId: tenants.clerkPortalOrgId,
      })
      .from(tenants)
      .orderBy(tenants.createdAt),
    staffCounts(),
  ])
  return rows.map(row => ({ ...row, staffCount: staff.get(row.id) ?? 0 }))
}

/**
 * How many staff each studio has, across every studio.
 *
 * Through migration 0041's owner-owned function, because this runs outside any
 * Tenant context — the super portal is cross-tenant — and the policies from
 * 0033 therefore show the application role nothing in `staff_users` at all. The
 * alternative is one `withTenant` transaction per studio on every refresh of
 * the list.
 *
 * A studio absent from the result has no staff. That is the case worth seeing:
 * a studio provisioned without a first admin, waiting for one or for the archive
 * that carries its own.
 */
async function staffCounts(): Promise<Map<string, number>> {
  const rows = await db.execute<{ tenant_id: string; staff_count: number }>(
    sql`SELECT tenant_id, staff_count FROM public.tenant_staff_counts()`,
  )
  return new Map(rows.map(r => [r.tenant_id, Number(r.staff_count)]))
}

/** The same count, for one studio. Zero when it has nobody. */
export async function staffCountFor(id: string): Promise<number> {
  const [row] = await db.execute<{ staff_count: number }>(
    sql`SELECT staff_count FROM public.tenant_staff_counts() WHERE tenant_id = ${id}`,
  )
  return Number(row?.staff_count ?? 0)
}

/**
 * Open a studio that was closed only because nobody could get into it.
 *
 * Provisioning without a first admin leaves a studio `suspended`, because a
 * studio nobody can sign in to should not be answering on its hostnames as
 * though it were open for business. This is the other half of that: the moment
 * it has staff — invited by the super portal, or restored from an archive that
 * brought its own — the reason for the suspension is gone and so is the
 * suspension.
 *
 * Narrow on purpose. It only ever moves `suspended` to `active`, and the caller
 * has to have established that the studio just gained its first staff. A studio
 * suspended for any other reason is not touched, because this cannot tell the
 * two apart and guessing would reopen a studio somebody deliberately closed.
 */
export async function activateAfterFirstStaff(id: string): Promise<TenantRow | null> {
  const [row] = await db
    .update(tenants)
    .set({ status: 'active', updatedAt: new Date() })
    .where(and(eq(tenants.id, id), eq(tenants.status, 'suspended')))
    .returning()

  if (row) forgetCachedTenants()
  return row ?? null
}

/**
 * Suspend, reactivate or archive a studio.
 *
 * Status is the *only* thing that changes: suspending retains every row the
 * studio owns, and reactivating is the same call in reverse. Deleting a tenant
 * is deliberately not offered here — `tenant_id` is `ON DELETE RESTRICT`
 * everywhere, so a delete would have to cascade through 53 tables, and the
 * decision to destroy a business's data is not a button.
 *
 * The memo is dropped afterwards, because every one of those caches would
 * otherwise keep serving the old status for up to a minute — including
 * `resolveTenantByClerkOrg`, which is what refuses an archived studio's tokens.
 */
export async function setTenantStatus(
  id: string,
  status: TenantStatus,
): Promise<TenantRowSummary | null> {
  const [row] = await db
    .update(tenants)
    .set({ status, updatedAt: new Date() })
    .where(eq(tenants.id, id))
    .returning({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      timezone: tenants.timezone,
      status: tenants.status,
      createdAt: tenants.createdAt,
      clerkClientOrgId: tenants.clerkClientOrgId,
      clerkPortalOrgId: tenants.clerkPortalOrgId,
    })

  forgetCachedTenants()
  return row ?? null
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
