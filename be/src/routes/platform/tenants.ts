import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantOrigin } from '../../lib/allowed-origins'
import { checkSlug } from '../../services/tenants/slug'
import { inviteFirstAdmin, provisionTenant, slugConflictFor } from '../../services/tenants/provision'
import { renameTenant } from '../../services/tenants/rename'
import { deleteTenant } from '../../services/tenants/delete'
import { isIsoDate, setTenantTerm, termEnded } from '../../services/tenants/term'
import {
  listTenants,
  loadTenantById,
  setTenantStatus,
  staffCountFor,
  type TenantRowSummary,
} from '../../services/tenants/tenants'
import { ERROR_CODES } from '../../shared/error-codes'
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
 * status, its Term or its address, and delete one that is already suspended. Few routes, because onboarding a studio should be a
 * one-minute job and everything else about a studio is administered from inside
 * it.
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
    // The studio's Term (services/tenants/term.ts). `ended` is decided here on
    // the studio's own clock, so the list says so the moment it happens even
    // though `status` above only changes when the sweep writes it.
    term: {
      start_date: tenant.termStartDate,
      end_date: tenant.termEndDate,
      ended: termEnded(tenant),
    },
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
  // How long the first Term runs from today. Omitted leaves it open-ended.
  term_months: z.union([z.literal(3), z.literal(6), z.literal(12)]).optional(),
})

/** A calendar date, `YYYY-MM-DD`, that exists. */
const isoDate = z.string().refine(isIsoDate, { message: 'a date like 2026-01-31' })

const termBody = z.object({
  start_date: isoDate,
  months: z.union([z.literal(3), z.literal(6), z.literal(12)]),
})

/**
 * Deleting takes the studio's Slug, typed out, as well as its id — the id says
 * which row, the Slug says the operator meant it.
 */
const deleteQuery = z.object({ confirm: z.string().min(1) })

const slugCheckQuery = z.object({
  // The studio being renamed, when the check is the rename form's: its own old
  // addresses are free to it.
  tenant: z.string().uuid().optional(),
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

const renameBody = z.object({ slug: z.string().min(1) })

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
  .get('/tenants/slug-check/:slug', zValidator('query', slugCheckQuery), async c => {
    const verdict = checkSlug(c.req.param('slug'))
    if (!verdict.ok) return c.json({ available: false, reason: verdict.reason })
    const conflict = await slugConflictFor(verdict.slug, c.req.valid('query').tenant)
    return c.json({
      available: conflict === null,
      slug: verdict.slug,
      ...(conflict ? { reason: conflict } : {}),
      // The addresses the slug would give a studio — what the rename form's
      // confirm step shows beside the old ones, so a typo is seen before it is
      // made.
      urls: {
        client: tenantOrigin('client', verdict.slug),
        portal: tenantOrigin('portal', verdict.slug),
      },
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
      termMonths: body.term_months,
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
    if (!id.success) return c.json({ error: ERROR_CODES.not_found }, 404)
    const { status } = c.req.valid('json')
    const updated = await setTenantStatus(id.data, status)
    if (!updated) return c.json({ error: ERROR_CODES.not_found }, 404)

    logger.warn(
      { tenantId: id.data, slug: updated.slug, status, by: c.get('platformAdminEmail') },
      'platform: tenant status changed',
    )
    return c.json({
      tenant: serialize(updated, await staffCountFor(id.data), await providerAccountStatus(id.data)),
    })
  })

  /**
   * Set a studio's Term: a start date and a duration of 3, 6 or 12 months. The
   * end date is computed and stored (services/tenants/term.ts).
   *
   * Changes the Term only. Extending an ended Term does not reopen the studio —
   * reactivating is the operator's separate act, through the status route.
   */
  .put('/tenants/:id/term', zValidator('json', termBody), async c => {
    const id = z.string().uuid().safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: ERROR_CODES.not_found }, 404)
    const body = c.req.valid('json')

    const tenant = await setTenantTerm(id.data, { startDate: body.start_date, months: body.months })

    logger.warn(
      {
        tenantId: tenant.id,
        termStartDate: tenant.termStartDate,
        termEndDate: tenant.termEndDate,
        by: c.get('platformAdminEmail'),
      },
      'platform: tenant term set',
    )
    return c.json({
      tenant: serialize(tenant, await staffCountFor(tenant.id), await providerAccountStatus(tenant.id)),
    })
  })

  /**
   * Delete a studio and everything it owns (services/tenants/delete.ts).
   *
   * Refused while the studio is active (`tenant_not_suspended`) and unless
   * `?confirm=` repeats its current Slug (`confirmation_mismatch`). Cannot be
   * undone — export first.
   */
  .delete('/tenants/:id', zValidator('query', deleteQuery), async c => {
    const id = z.string().uuid().safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: ERROR_CODES.not_found }, 404)
    const by = c.get('platformAdminEmail')

    const deleted = await deleteTenant({ tenantId: id.data, confirmSlug: c.req.valid('query').confirm })

    // The record of the deletion. The studio's own audit trail went with it, so
    // this line — who, which studio, how much — is what remains.
    logger.warn(
      {
        tenantId: deleted.id,
        slug: deleted.slug,
        rows: deleted.rows,
        accounts: deleted.accounts,
        objects: deleted.objects,
        by,
      },
      'platform: tenant deleted',
    )
    return c.json({
      deleted: {
        id: deleted.id,
        slug: deleted.slug,
        rows: deleted.rows,
        tables: deleted.tables,
        accounts: deleted.accounts,
        objects: deleted.objects,
      },
    })
  })

  /**
   * Rename a studio's Slug — change its web address.
   *
   * The old address keeps redirecting for 90 days and is held from every other
   * studio meanwhile; the studio itself may be renamed straight back to it. See
   * services/tenants/rename.ts. Platform administrators only: a studio's own
   * admins ask the operator.
   */
  .post('/tenants/:id/slug', zValidator('json', renameBody), async c => {
    const id = z.string().uuid().safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'not_found' }, 404)
    const { slug } = c.req.valid('json')
    const by = c.get('platformAdminEmail')

    const { tenant, former } = await renameTenant({ tenantId: id.data, slug, renamedBy: by })

    logger.warn(
      { tenantId: tenant.id, from: former.slug, to: tenant.slug, by },
      'platform: tenant slug renamed',
    )
    return c.json({
      tenant: serialize(tenant, await staffCountFor(tenant.id)),
      former: { slug: former.slug, redirect_until: former.redirectUntil.toISOString() },
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
    if (!id.success) return c.json({ error: ERROR_CODES.not_found }, 404)
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
    if (!tenant) return c.json({ error: ERROR_CODES.not_found }, 404)
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
    if (!id.success) return c.json({ error: ERROR_CODES.not_found }, 404)

    const tenant = await loadTenantById(id.data)
    if (!tenant) return c.json({ error: ERROR_CODES.not_found }, 404)

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
        ? c.json({ error: ERROR_CODES.secret_storage_unavailable }, 503)
        : c.json({ error: ERROR_CODES.provider_key_rejected }, 400)
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
    if (!id.success) return c.json({ error: ERROR_CODES.not_found }, 404)

    const tenant = await loadTenantById(id.data)
    if (!tenant) return c.json({ error: ERROR_CODES.not_found }, 404)

    const payments = await releaseProviderAccount(id.data)

    logger.warn(
      { tenantId: id.data, slug: tenant.slug, by: c.get('platformAdminEmail') },
      'platform: tenant payment credentials cleared',
    )

    return c.json({ tenant: serialize(tenant, await staffCountFor(id.data), payments) })
  })

export default app
