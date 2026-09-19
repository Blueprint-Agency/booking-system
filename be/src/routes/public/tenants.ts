import { Hono } from 'hono'
import { redirectForFormerSlug } from '../../services/tenants/former-slugs'
import { resolveTenantBySlug, type ResolvedTenant } from '../../services/tenants/tenants'
import { ERROR_CODES } from '../../shared/error-codes'

/**
 * Slug resolution for the frontend proxies.
 *
 * `fe-client` and `fe-portal` read the tenant slug off the incoming Host header
 * and have to turn it into a tenant — but they may not touch the database (the
 * three apps stay fully decoupled; the frontends reach the backend over HTTP
 * only). So this route is the lookup, and it sits on *every* request path:
 * unauthenticated, one indexed query, and cacheable.
 *
 * An unknown slug gets the same `{ error: 'not_found' }` body as any other 404
 * on this API — nothing in the response distinguishes "no such tenant" from
 * "archived tenant", and nothing enumerates which slugs exist.
 */

// Short enough that a newly created tenant appears within a minute, long
// enough that the proxy isn't asking on every single request.
const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300'

function serialize({ tenant, settings }: ResolvedTenant) {
  return {
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      status: tenant.status,
    },
    // Display settings only. The mail-from identity and waiver text are not
    // display data and have no business on a public, cached endpoint.
    settings: {
      display_name: settings?.displayName ?? null,
      logo_url: settings?.logoUrl ?? null,
      favicon_url: settings?.faviconUrl ?? null,
      og_image_url: settings?.ogImageUrl ?? null,
      tagline: settings?.tagline ?? null,
      theme: settings?.theme ?? {},
      copy: settings?.copy ?? {},
    },
  }
}

const app = new Hono().get('/tenants/by-slug/:slug', async c => {
  const slug = c.req.param('slug')
  const resolved = await resolveTenantBySlug(slug)
  if (resolved) {
    c.header('Cache-Control', CACHE_CONTROL)
    return c.json(serialize(resolved))
  }

  // A renamed studio's old address, still inside its redirect window. The
  // answer is where it went and nothing else — no Tenant, so a proxy has
  // nothing to open a context with and can only redirect. It discloses no
  // more than the redirect itself will: anyone following the old link lands on
  // the new address anyway.
  const movedTo = await redirectForFormerSlug(slug)
  if (movedTo) {
    c.header('Cache-Control', CACHE_CONTROL)
    return c.json({ moved_to: { slug: movedTo } })
  }

  return c.json({ error: ERROR_CODES.not_found }, 404)
})

export default app
