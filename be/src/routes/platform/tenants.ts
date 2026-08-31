import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantOrigin } from '../../lib/allowed-origins'
import { checkSlug } from '../../services/tenants/slug'
import { provisionTenant, slugAvailable } from '../../services/tenants/provision'
import { listTenants, setTenantStatus, type TenantSummary } from '../../services/tenants/tenants'
import { logger } from '../../shared/logger'

/**
 * The super portal's route surface: create a studio, list them, change one's
 * status. Three routes, because onboarding a studio should be a one-minute job
 * and everything else about a studio is administered from inside it.
 *
 * Every route here is cross-tenant, which is why the whole branch is exempt from
 * `resolveTenant` in app.ts — there is no single tenant these requests are
 * *about*, and opening tenant #1's context to list every tenant would be a lie
 * the Row-Level Security policies would then have to be talked out of.
 */

function serialize(tenant: TenantSummary) {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    timezone: tenant.timezone,
    status: tenant.status,
    created_at: tenant.createdAt.toISOString(),
    // Whether the Clerk organization is wired, not which one — the id is
    // operational detail, and its absence is the thing worth seeing. Portal
    // only: a studio has no client-side organization by design, so reporting
    // one would be reporting a permanent, expected absence as a fault.
    clerk: {
      portal: Boolean(tenant.clerkPortalOrgId),
    },
    urls: {
      client: tenantOrigin('client', tenant.slug),
      portal: tenantOrigin('portal', tenant.slug),
    },
  }
}

const createBody = z.object({
  slug: z.string().min(1),
  name: z.string().min(1).max(200),
  // IANA zone. Validated against the runtime's own database rather than a list
  // we would have to maintain — a zone this process cannot resolve would make
  // every scheduled job for the studio fire at the wrong hour.
  timezone: z
    .string()
    .optional()
    .refine(
      value => {
        if (!value) return true
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value })
          return true
        } catch {
          return false
        }
      },
      { message: 'timezone must be an IANA zone like Asia/Singapore' },
    ),
  admin_email: z.string().email(),
  admin_name: z.string().max(200).optional(),
})

const statusBody = z.object({
  // `archived` is here because the list is the only surface that can see an
  // archived studio, so it must also be the one that can bring it back.
  status: z.enum(['active', 'suspended', 'archived']),
})

const app = new Hono()
  .get('/tenants', async c => {
    const rows = await listTenants()
    return c.json({ tenants: rows.map(serialize) })
  })

  /**
   * Is a slug usable? Answers the create form before it submits, so a reserved
   * or taken slug is a message next to the field rather than a failed create.
   *
   * Platform-admin-gated like everything else here: the same question asked
   * publicly would enumerate every studio on the platform.
   */
  .get('/tenants/slug-check/:slug', async c => {
    const verdict = checkSlug(c.req.param('slug'))
    if (!verdict.ok) return c.json({ available: false, reason: verdict.reason })
    const free = await slugAvailable(verdict.slug)
    return c.json({
      available: free,
      slug: verdict.slug,
      ...(free ? {} : { reason: 'slug_taken' as const }),
    })
  })

  .post('/tenants', zValidator('json', createBody), async c => {
    const body = c.req.valid('json')
    const result = await provisionTenant({
      slug: body.slug,
      name: body.name,
      timezone: body.timezone,
      adminEmail: body.admin_email,
      adminName: body.admin_name,
    })

    logger.info(
      {
        tenantId: result.tenant.id,
        slug: result.tenant.slug,
        by: c.get('platformAdminEmail'),
      },
      'platform: tenant provisioned',
    )

    return c.json(
      {
        tenant: serialize(result.tenant),
        admin: result.admin,
        urls: result.urls,
      },
      201,
    )
  })

  .patch('/tenants/:id/status', zValidator('json', statusBody), async c => {
    // Parsed, not passed through: a malformed id must be a 400 here rather than
    // a Postgres cast error surfacing as a 500.
    const id = z.string().uuid().safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'not_found' }, 404)
    const { status } = c.req.valid('json')
    const updated = await setTenantStatus(id.data, status)
    if (!updated) return c.json({ error: 'not_found' }, 404)

    logger.warn(
      { tenantId: id.data, slug: updated.slug, status, by: c.get('platformAdminEmail') },
      'platform: tenant status changed',
    )
    return c.json({ tenant: serialize(updated) })
  })

export default app
