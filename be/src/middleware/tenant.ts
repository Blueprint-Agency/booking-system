import type { Context, MiddlewareHandler } from 'hono'
import { withTenant } from '../db'
import { originTenantSlug } from '../lib/allowed-origins'
import { normaliseSlug } from '../services/tenants/slug'
import { loadTenantById, resolveTenantByClerkOrg, resolveTenantBySlug } from '../services/tenants/tenants'
import { orgClaimVerdict, orgIdFromClaims } from '../services/tenants/org-claim'
import { logger } from '../shared/logger'

declare module 'hono' {
  interface ContextVariableMap {
    tenantId: string
    tenantCorroborated: boolean
  }
}

/**
 * The header the frontend proxies send. The API hostname never contains the
 * tenant — one backend serves everyone at `api.reservetoday.app`, so its own
 * Host header carries no tenant information and the caller has to say.
 */
export const TENANT_SLUG_HEADER = 'x-tenant-slug'

/**
 * Resolves the tenant for a request and attaches its id to the context.
 *
 * The header is **validated, never trusted**. It is set by our own proxies, and
 * a proxy is one forged header away from being impersonated, so every request
 * gets whichever corroboration it can carry:
 *
 * - **`Origin`, here.** A browser sets it and a page cannot lie about it, and
 *   under the subdomain scheme the origin *contains* the tenant —
 *   `https://acme.reservetoday.app`. So a header that disagrees with the origin
 *   is refused outright, which is the whole of the check for public routes.
 *   An origin that names no tenant (a server-side call from the proxy, which
 *   sends none at all; the bare local `http://localhost:3000`) is not evidence
 *   and refuses nothing.
 * - **The Clerk organization claim, later.** Authenticated routes carry a
 *   signed statement of which studio the caller is signed into; the two Clerk
 *   middlewares run `assertTenantOrgClaim` at the point they have it.
 *
 * A request that names no tenant at all is refused with `tenant_required`. The
 * paths that genuinely have no tenant never reach here — `app.ts` exempts them
 * by name before mounting this — so on every other path the absence is a caller
 * bug, and 400 is what turns it into one someone fixes.
 *
 * Resolution is also what OPENS the database's Tenant context: the rest of the
 * request runs inside `withTenant`, which is one transaction carrying
 * `app.tenant_id`, and that setting is what the Row-Level Security policies read
 * back (migration 0033). The two are welded together on purpose — a request that
 * reached a query with no context set would simply see nothing, and the way to
 * make that unreachable is to give the middleware that knows the tenant the job
 * of opening the context.
 */
export const resolveTenant: MiddlewareHandler = async (c, next) => {
  const headerSlug = normaliseSlug(c.req.header(TENANT_SLUG_HEADER) ?? '')
  const origin = c.req.header('origin')
  const originSlug = origin ? normaliseSlug(originTenantSlug(origin) ?? '') : null

  // The two statements about the tenant must agree. They are compared before
  // either is resolved, so the answer cannot depend on whether a slug happens
  // to exist — a forged header is refused identically whether it names a real
  // studio or an invented one.
  if (headerSlug && originSlug && headerSlug !== originSlug) {
    logger.warn(
      { headerSlug, originSlug, origin, path: c.req.path },
      'tenant: X-Tenant-Slug disagrees with Origin',
    )
    return c.json({ error: 'tenant_mismatch' }, 403)
  }

  // Either may stand alone. The origin is preferred when only it names a tenant
  // — a browser reaching `acme.reservetoday.app` without the proxy's header is
  // still unambiguously asking about `acme`.
  const slug = headerSlug || originSlug
  if (!slug) {
    // Nothing named a studio, so there is no honest answer to give. This used
    // to fall back to tenant #1 — a compatibility shim from the single-tenant
    // era, when "no tenant" and "the tenant" were the same thing. They stopped
    // being the same thing the moment a second studio existed, and what the
    // shim did after that was hand one studio's data to a request that had
    // simply forgotten to say whose data it wanted. A caller cannot notice
    // that; it gets a plausible answer about the wrong studio.
    //
    // Every path that legitimately carries no tenant is already exempted before
    // this middleware runs — health, the two webhooks, the whole super portal
    // branch, tenant lookup (`TENANT_CONTEXT_EXEMPT` in app.ts) — so anything
    // arriving here without a tenant is a bug in the caller, and saying so is
    // the only way it gets fixed rather than silently mis-answered.
    return c.json({ error: 'tenant_required' }, 400)
  }

  // An unknown slug is a 404 carrying the same body as any other 404 on this
  // API, so the header cannot be used to enumerate tenants.
  const resolved = await resolveTenantBySlug(slug)
  if (!resolved) return c.json({ error: 'not_found' }, 404)

  c.set('tenantId', resolved.tenant.id)
  c.set('tenantCorroborated', originSlug !== null)
  await withTenant(resolved.tenant.id, () => next())
}

/**
 * Has anything other than the header itself vouched for this tenant?
 *
 * True when the browser's `Origin` named it, when the Clerk organization claim
 * named it (`assertTenantOrgClaim` sets this on its way through), or when the
 * request claimed no tenant at all and fell back to tenant #1 — where there is
 * nothing to have forged.
 *
 * False means the *only* statement about the tenant is the header, which every
 * caller can set. Reads in that state are already fenced by Row-Level Security,
 * so the gate exists for the one thing a read cannot undo: **creating a row.**
 * Provisioning a member into a studio is joining it, and joining a studio on the
 * strength of a header nobody corroborated is how a forged header stops being a
 * failed read and becomes a write.
 */
export function tenantCorroborated(c: Context): boolean {
  return c.get('tenantCorroborated') === true
}

/**
 * Read the resolved tenant inside a route handler.
 *
 * Throws rather than falling back: a route that reached a service without a
 * tenant would query across every tenant on the platform, and a loud 500 is the
 * only acceptable way for that to fail.
 */
export function tenantId(c: Context): string {
  const id = c.get('tenantId')
  if (!id) throw new Error('tenant not resolved — is the resolveTenant middleware mounted?')
  return id
}

/**
 * Does the tenant this request claims match the tenant the authenticated caller
 * actually belongs to?
 *
 * Called from the two Clerk middlewares, at the first moment the caller's own
 * row is in hand. A null `rowTenantId` used to be read as tenant #1 — the right
 * reading while the column was still nullable and an un-backfilled row really
 * did belong to the first studio. `tenant_id` is `NOT NULL` on all 53 tables
 * now (`tenantIdColumn`), so null is no longer a pre-tenancy row; it is a row
 * that should not exist. Matching it against a studio would let it through, so
 * it matches nothing.
 */
export function tenantMatches(c: Context, rowTenantId: string | null): boolean {
  return rowTenantId !== null && rowTenantId === tenantId(c)
}

/**
 * The organization half of the check: is the caller's Clerk session actually
 * inside this tenant's organization?
 *
 * Returns a refusal reason, or null when the request may proceed. The rules and
 * the rollout seam are in `services/tenants/org-claim.ts`; this only does the
 * two lookups that turn ids into tenants.
 *
 * This is the membership enforcement the spec asks for: a staff member of one
 * studio who reaches another studio's portal presents a token whose
 * organization belongs to their own, and is refused here — before the
 * `staff_users` row is even read, and regardless of what the header said.
 *
 * **Portal only.** The client application has no organizations at all
 * (`docs/adr/0003-no-client-side-clerk-organizations.md`), so for a member token
 * this check could never *grant* anything — no claim can match an organization
 * no tenant has. It could only refuse, and it would: a member left over in some
 * organization the platform no longer maps carries that id on their token and
 * would be turned away from their own studio with `tenant_mismatch`, on every
 * request, with no way to recover. So member requests do not consult it. Their
 * tenant is corroborated by `Origin` and fenced by Row-Level Security.
 */
export async function assertTenantOrgClaim(
  c: Context,
  claims: unknown,
): Promise<'tenant_mismatch' | 'organization_required' | null> {
  const requestTenantId = tenantId(c)
  const claimedOrgId = orgIdFromClaims(claims)

  const [tenant, claimedTenant] = await Promise.all([
    loadTenantById(requestTenantId),
    claimedOrgId ? resolveTenantByClerkOrg('portal', claimedOrgId) : Promise.resolve(null),
  ])

  const verdict = orgClaimVerdict({
    requestTenantId,
    configuredOrgId: tenant?.clerkPortalOrgId ?? null,
    claimedOrgId,
    claimedOrgTenantId: claimedTenant?.id ?? null,
  })
  if (verdict === 'ok') {
    // A claim that named this tenant is corroboration in its own right — the
    // strongest kind, since it came out of a signature.
    if (claimedTenant?.id === requestTenantId) c.set('tenantCorroborated', true)
    return null
  }

  logger.warn(
    { requestTenantId, claimedOrgId, claimedTenantId: claimedTenant?.id ?? null, verdict },
    'tenant: clerk organization claim refused',
  )
  return verdict
}
