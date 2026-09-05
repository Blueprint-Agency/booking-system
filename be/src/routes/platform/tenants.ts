import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantOrigin } from '../../lib/allowed-origins'
import { checkSlug } from '../../services/tenants/slug'
import { inviteFirstAdmin, provisionTenant, slugAvailable } from '../../services/tenants/provision'
import {
  listTenants,
  loadTenantById,
  setTenantStatus,
  staffCountFor,
  type TenantRowSummary,
} from '../../services/tenants/tenants'
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

function serialize(tenant: TenantRowSummary, staffCount: number) {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    timezone: tenant.timezone,
    status: tenant.status,
    created_at: tenant.createdAt.toISOString(),
    // Zero is the number that matters: a studio nobody can sign in to. It is a
    // legitimate step — a studio created to receive an archive starts here — and
    // a terrible resting place, so the list has to be able to say so.
    staff_count: staffCount,
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
  // Optional, and an empty string means "none" rather than "invalid": a studio
  // created to receive an archive must be left with no `staff_users` rows at
  // all, because the archive brings its own and the import refuses to merge.
  admin_email: z.union([z.string().email(), z.literal('')]).optional(),
  admin_name: z.string().max(200).optional(),
})

/** Required here, unlike at creation: naming nobody would be a no-op. */
const firstAdminBody = z.object({
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
    return c.json({ tenants: rows.map(row => serialize(row, row.staffCount)) })
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
        tenant: serialize(result.tenant, result.admin ? 1 : 0),
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
    return c.json({ tenant: serialize(updated, await staffCountFor(id.data)) })
  })

  /**
   * Give a studio that has nobody its first admin.
   *
   * The other half of provisioning without one. It refuses a studio that already
   * has staff — inviting into a working studio is that studio's own job, done
   * from inside it — so this is a bootstrap and not a standing way in.
   */
  .post('/tenants/:id/admin', zValidator('json', firstAdminBody), async c => {
    const id = z.string().uuid().safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'not_found' }, 404)
    const body = c.req.valid('json')

    const admin = await inviteFirstAdmin(id.data, {
      email: body.admin_email,
      name: body.admin_name,
    })

    logger.info(
      { tenantId: id.data, admin: admin.email, by: c.get('platformAdminEmail') },
      'platform: first admin invited',
    )

    // Re-read rather than reuse: the invitation may have lifted the suspension
    // a studio with nobody in it was opened under, and the list has to show that.
    const tenant = await loadTenantById(id.data)
    if (!tenant) return c.json({ error: 'not_found' }, 404)
    return c.json({ admin, tenant: serialize(tenant, 1) }, 201)
  })

export default app
