import type { Context, MiddlewareHandler } from 'hono'
import { withTenant } from '../db'
import { TENANT_ONE_ID } from '../db/schema/tenancy'
import { resolveTenantBySlug } from '../services/tenants/tenants'

declare module 'hono' {
  interface ContextVariableMap {
    tenantId: string
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
 * Two behaviours, deliberately:
 *
 * - **No header** → tenant #1. Every client that exists today (both frontends,
 *   both webhook senders) sends nothing and must keep working unchanged while
 *   the services are migrated batch by batch.
 * - **A header** → the slug is resolved, and an unknown slug is a 404 carrying
 *   the same body as any other 404 on this API, so the header cannot be used to
 *   enumerate tenants.
 *
 * Resolution is also what OPENS the database's Tenant context: the rest of the
 * request runs inside `withTenant`, which is one transaction carrying
 * `app.tenant_id`, and that setting is what the Row-Level Security policies read
 * back (migration 0033). The two are welded together on purpose — policies are
 * live from #63 onwards, so a request that reached a query with no context set
 * would simply see nothing, and the way to make that unreachable is to give the
 * middleware that knows the tenant the job of opening the context.
 *
 * What is *not* here yet: the header is resolved, not **validated**. Checking it
 * against the Clerk organization claim on authenticated routes and against
 * `Origin` on public ones is the backend-resolution ticket (#65), and until that
 * lands a caller who can already reach the API can name any tenant.
 */
export const resolveTenant: MiddlewareHandler = async (c, next) => {
  const slug = c.req.header(TENANT_SLUG_HEADER)?.trim()
  if (!slug) {
    c.set('tenantId', TENANT_ONE_ID)
    return withTenant(TENANT_ONE_ID, () => next())
  }

  const resolved = await resolveTenantBySlug(slug)
  if (!resolved) return c.json({ error: 'not_found' }, 404)

  c.set('tenantId', resolved.tenant.id)
  await withTenant(resolved.tenant.id, () => next())
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
 * row is in hand. A row that predates tenancy and somehow still has no
 * `tenant_id` is treated as tenant #1, which is what it is.
 */
export function tenantMatches(c: Context, rowTenantId: string | null): boolean {
  return (rowTenantId ?? TENANT_ONE_ID) === tenantId(c)
}
