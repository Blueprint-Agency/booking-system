/**
 * A studio's own URLs, for anything the backend hands to a human.
 *
 * Every link the platform mails, redirects to, or gives Stripe to send a member
 * back to has to name the studio the request is *for*. It used to name whichever
 * studio the deployment's `PORTAL_ORIGIN` / `CLIENT_ORIGIN` happened to be set
 * to — one pair of values for the whole platform, so a staff member invited to
 * the second studio got a link into the first studio's portal, where their token
 * is refused, and a member of the second studio was returned to the first
 * studio's app after paying.
 *
 * The origins come from the tenant's own slug through `tenantOrigin`, which
 * reads the same `TENANT_ORIGIN_PATTERNS` wildcards CORS and the Clerk `azp`
 * check accept. That is the point of deriving rather than configuring: the link
 * handed out and the origin the backend trusts cannot drift apart, and creating
 * a studio stays a row insert with no deploy behind it.
 *
 * The slug is read by id, never taken from the caller — a request states which
 * studio it is for and the middleware has already resolved that to a row, so the
 * origin is built from what the database says the studio is called.
 */
import { tenantOrigin } from '../../lib/allowed-origins'
import { loadTenantById } from './tenants'

export type TenantApp = 'client' | 'portal'

/**
 * The origin serving one studio's member or staff app, or null.
 *
 * Null means one of two things, and a caller that can proceed without a URL may
 * treat them alike: there is no such tenant, or this environment configures no
 * wildcard for that app. A caller that cannot proceed uses `requireTenantUrl`.
 */
export async function tenantUrl(app: TenantApp, tenantId: string): Promise<string | null> {
  const tenant = await loadTenantById(tenantId)
  if (!tenant) return null
  return tenantOrigin(app, tenant.slug)
}

/**
 * The same, refusing rather than falling back.
 *
 * There is nothing honest to fall back to. The platform-wide origins are
 * precisely the cross-tenant link being removed, and an empty or relative href
 * is a dead button discovered by a member rather than by us. Nor is refusing a
 * loss: an environment with no per-tenant hostname serves that studio no app for
 * the link to point at, because the frontends read the slug from the hostname.
 *
 * So it throws, naming the variable an operator has to set. `seedEmailTemplates`
 * makes the same argument for the same reason; the difference is only that its
 * URLs are frozen into stored HTML while these are built per send.
 */
export async function requireTenantUrl(app: TenantApp, tenantId: string): Promise<string> {
  const url = await tenantUrl(app, tenantId)
  if (!url) {
    throw new Error(
      `no ${app} URL for tenant ${tenantId}: either the tenant does not exist or this ` +
        `environment configures no tenant origin wildcard for the ${app} app. ` +
        'Set TENANT_ORIGIN_PATTERNS.',
    )
  }
  return url
}
