/**
 * Renaming a studio's Slug — changing its web address — from the super portal.
 *
 * What moves and what does not:
 *
 *  - **`tenants.slug` moves**, and the old Slug is recorded in `former_slugs`
 *    with who renamed it and until when it redirects (`./former-slugs.ts`),
 *    plus a lasting `audit_log` entry in the studio's own trail. All in one
 *    transaction, so there is never a moment when the old address neither
 *    resolves nor redirects.
 *  - **Stored email copy moves with it.** Template bodies have the studio's
 *    origins baked in at seeding (`db/seed/email-templates.ts`); every one that
 *    names the old member or portal address is rewritten to the new one in the
 *    same transaction. Links built at send time already read the Slug by id.
 *  - **Sessions do not move, and need not.** A session carries the Tenant id,
 *    not the Slug, so it stays valid; its token lives in the old host's storage,
 *    so members and staff sign in once at the new address.
 *  - **Payments do not care.** Stripe routes its webhooks by Tenant id; a
 *    checkout in flight completes, and its return URL on the old host redirects.
 *  - **Renaming back is immediate.** A studio's own former Slug is free to it at
 *    any time (`claimSlug` with the studio's id); taking it back drops its
 *    former-Slug row, and the address it is leaving starts a redirect of its
 *    own. What stays: every *other* studio is kept off a live former Slug for
 *    the whole window, and the ordinary rules (well-formed, not reserved, not
 *    another studio's current Slug) apply to the way back as to the way out.
 */
import { and, eq, sql } from 'drizzle-orm'
import { currentTenantId, db } from '../../db'
import { emailTemplates } from '../../db/schema/content'
import { auditLog } from '../../db/schema/ledger'
import { formerSlugs, tenants } from '../../db/schema/tenancy'
import type { TenantRow } from '../../db/schema/tenancy'
import { tenantOrigin } from '../../lib/allowed-origins'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { claimSlug, clearExpired, releaseOwn, REDIRECT_WINDOW_DAYS } from './former-slugs'
import { assertUsableSlug } from './slug'
import { forgetCachedTenants } from './tenants'

export interface RenameTenantInput {
  tenantId: string
  slug: string
  /** The platform administrator's email, for the record. */
  renamedBy: string
}

export interface RenamedTenant {
  tenant: TenantRow
  former: { slug: string; redirectUntil: Date }
}

const DAY_MS = 86_400_000

/**
 * Each of the studio's origins, old → new, for the apps this environment
 * serves. An environment with no wildcard for an app has no such origin to
 * rewrite, and `lib/allowed-origins.ts` refuses to boot without both anyway.
 */
function originMoves(formerSlug: string, newSlug: string): Array<{ from: string; to: string }> {
  const moves: Array<{ from: string; to: string }> = []
  for (const app of ['client', 'portal'] as const) {
    const from = tenantOrigin(app, formerSlug)
    const to = tenantOrigin(app, newSlug)
    if (from && to) moves.push({ from, to })
  }
  return moves
}

export async function renameTenant(input: RenameTenantInput): Promise<RenamedTenant> {
  // The same refusal `provisionTenant` makes, for the same reason: this sets
  // `app.tenant_id` inside its own transaction, which inside an open Tenant
  // context would be a savepoint whose setting outlives it.
  const openTenant = currentTenantId()
  if (openTenant) {
    throw new Error(`renameTenant must not run inside a Tenant context (open: ${openTenant})`)
  }

  const slug = assertUsableSlug(input.slug)

  const renamed = await db.transaction(async tx => {
    const [tenant] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .for('update')
      .limit(1)
    if (!tenant) throw new NotFoundError('not_found')
    if (tenant.slug === slug) throw new BadRequestError('slug_unchanged', { slug })
    // An archived studio answers on no address, so moving it would only hold a
    // slug from everyone else for 90 days in exchange for nothing.
    if (tenant.status === 'archived') throw new ConflictError('tenant_archived')

    // Named as this studio's claim, so one of its own former Slugs is free to
    // it: renaming straight back needs no wait. Another studio's live one is
    // still refused.
    await claimSlug(tx, slug, tenant.id)

    // An expired row for either slug is dead weight that would collide with the
    // primary key: the new slug may have been some studio's former address, and
    // the old one may have been a former address of this studio before it was
    // taken again.
    await clearExpired(tx, [tenant.slug, slug])
    // And this studio's own row for the slug it is taking back, live or not: it
    // is the studio's current address again, not a former one.
    await releaseOwn(tx, tenant.id, [tenant.slug, slug])

    const now = new Date()
    const redirectUntil = new Date(now.getTime() + REDIRECT_WINDOW_DAYS * DAY_MS)

    const [updated] = await tx
      .update(tenants)
      .set({ slug, updatedAt: now })
      .where(eq(tenants.id, tenant.id))
      .returning()
    if (!updated) throw new Error('tenant update returned no row')

    await tx.insert(formerSlugs).values({
      slug: tenant.slug,
      renamedTenantId: tenant.id,
      newSlug: slug,
      renamedAt: now,
      redirectUntil,
      renamedBy: input.renamedBy,
    })

    // Into the studio's own context for its email copy — the Row-Level
    // Security policies refuse the update otherwise, as they should for every
    // other caller. `true`: transaction-local, never riding the pooled
    // connection into the next request.
    await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`)
    for (const { from, to } of originMoves(tenant.slug, slug)) {
      await tx
        .update(emailTemplates)
        .set({ bodyHtml: sql`replace(${emailTemplates.bodyHtml}, ${from}, ${to})` })
        // Scoped by hand as well as by the policy, so a run as the table owner
        // — which the policies exempt — still touches this studio's copy only.
        .where(
          and(
            eq(emailTemplates.tenantId, tenant.id),
            sql`strpos(${emailTemplates.bodyHtml}, ${from}) > 0`,
          ),
        )
    }

    // The lasting record. The `former_slugs` row is released after its window;
    // this stays with the studio's own audit trail. `system`, with no staff
    // actor: the platform administrator is nobody on the studio's staff, so
    // their email rides in the payload instead.
    await tx.insert(auditLog).values({
      tenantId: tenant.id,
      actorStaffId: null,
      actorType: 'system',
      action: 'tenant.slug_renamed',
      targetTable: 'tenants',
      targetId: tenant.id,
      payload: {
        from: tenant.slug,
        to: slug,
        renamedBy: input.renamedBy,
        redirectUntil: redirectUntil.toISOString(),
      },
      createdAt: now,
    })

    return { tenant: updated, former: { slug: tenant.slug, redirectUntil } }
  })

  forgetCachedTenants()
  return renamed
}
