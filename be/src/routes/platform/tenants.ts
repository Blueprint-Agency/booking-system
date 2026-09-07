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
import {
  NO_PAYMENT_ACCOUNT,
  providerAccountStatus,
  providerAccountStatuses,
  type ProviderAccountStatus,
} from '../../services/billing/provider-credentials'
import {
  configureProviderAccount,
  releaseProviderAccount,
  ProviderOnboardingError,
  type ConfiguredAccount,
} from '../../services/billing/provider-onboarding'
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

function serialize(
  tenant: TenantRowSummary,
  staffCount: number,
  payments: ProviderAccountStatus = NO_PAYMENT_ACCOUNT,
) {
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
    // Whether this studio takes its own money, and on which account (#100).
    // Both facts and no third one: the account id names the account, which is
    // what lets a human tell the right account from the wrong one, and the
    // credentials that open it are never readable by anybody — including this
    // route, which is the only surface that can set them.
    payments: {
      configured: payments.configured,
      account_id: payments.accountId,
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

/**
 * A studio's own payment-provider credentials, on the way in and never on the
 * way out.
 *
 * Both are trimmed, because a key pasted out of a dashboard carries whitespace
 * often enough that the alternative is a validation failure nobody can see the
 * cause of. Neither is pattern-matched beyond being non-empty: the provider is
 * the authority on whether a key is real, and it is asked directly a few lines
 * later, so a regex here could only ever refuse a key that in fact works.
 */
const credentialsBody = z.object({
  secret_key: z.string().trim().min(1),
  webhook_secret: z.string().trim().min(1),
})

const statusBody = z.object({
  // `archived` is here because the list is the only surface that can see an
  // archived studio, so it must also be the one that can bring it back.
  status: z.enum(['active', 'suspended', 'archived']),
})

const app = new Hono()
  .get('/tenants', async c => {
    const [rows, payments] = await Promise.all([listTenants(), providerAccountStatuses()])
    return c.json({
      tenants: rows.map(row => serialize(row, row.staffCount, payments.get(row.id))),
    })
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
    return c.json({
      tenant: serialize(updated, await staffCountFor(id.data), await providerAccountStatus(id.data)),
    })
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
    return c.json(
      { admin, tenant: serialize(tenant, 1, await providerAccountStatus(id.data)) },
      201,
    )
  })

  /**
   * Move a studio onto its own payment-provider account (#100).
   *
   * The super portal is the only surface that can do this, and after it has
   * been done the super portal can see only that credentials exist and which
   * account they name. There is no route anywhere that reads them back — not
   * here, not masked, not last-four. A key that needs checking is replaced, not
   * inspected.
   *
   * The key is validated against the provider before it is stored, which is the
   * point: a typo is a message on this form, and not a member's checkout
   * failing three weeks later against a key nobody can look at. The account id
   * comes back from the provider rather than from whoever pasted the key, so
   * "these credentials belong to acct_xxx" is a fact.
   *
   * The signing secret is not validated, because it cannot be — the provider
   * offers no way to ask. It is proved by the first delivery that verifies
   * against it, which is why the studio's endpoint refuses every delivery until
   * this is right rather than falling back to the platform's secret.
   */
  .put('/tenants/:id/payment-credentials', zValidator('json', credentialsBody), async c => {
    const id = z.string().uuid().safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'not_found' }, 404)

    const tenant = await loadTenantById(id.data)
    if (!tenant) return c.json({ error: 'not_found' }, 404)

    const body = c.req.valid('json')

    let payments: ConfiguredAccount
    try {
      payments = await configureProviderAccount(id.data, {
        secretKey: body.secret_key,
        webhookSecret: body.webhook_secret,
      })
    } catch (err) {
      if (!(err instanceof ProviderOnboardingError)) throw err
      return err.reason === 'storage_unavailable'
        ? c.json({ error: 'secret_storage_unavailable' }, 503)
        : c.json({ error: 'provider_key_rejected' }, 400)
    }

    // The account, never the key. This line is the audit trail for "who moved
    // this studio onto which account, and when".
    logger.warn(
      {
        tenantId: id.data,
        slug: tenant.slug,
        accountId: payments.accountId,
        by: c.get('platformAdminEmail'),
      },
      'platform: tenant payment credentials set',
    )

    return c.json({
      tenant: serialize(tenant, await staffCountFor(id.data), payments),
      // Where the studio has to point the webhook on its own account. Built
      // from the address this request actually arrived on rather than from
      // configuration, so it cannot name an environment other than the one
      // being configured — the commonest way to wire a studio's live account to
      // a staging server.
      webhook_url: `${new URL(c.req.url).origin}/api/v1/webhooks/stripe/${tenant.slug}`,
    })
  })

  /**
   * Take a studio back off its own account, so it charges on the platform's
   * again.
   *
   * The only way out of credentials that turn out to be wrong, because the way
   * that would seem obvious — look at what is stored — does not exist by
   * design.
   */
  .delete('/tenants/:id/payment-credentials', async c => {
    const id = z.string().uuid().safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'not_found' }, 404)

    const tenant = await loadTenantById(id.data)
    if (!tenant) return c.json({ error: 'not_found' }, 404)

    const payments = await releaseProviderAccount(id.data)

    logger.warn(
      { tenantId: id.data, slug: tenant.slug, by: c.get('platformAdminEmail') },
      'platform: tenant payment credentials cleared',
    )

    return c.json({ tenant: serialize(tenant, await staffCountFor(id.data), payments) })
  })

export default app
