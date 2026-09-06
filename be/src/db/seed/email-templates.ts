import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'
import { tenantOrigin } from '../../lib/allowed-origins'
import { buildEmailTemplates } from './email-copy'
import { provisioningFor } from './provisioning'
import type { SeededTenant } from './tenants'

/**
 * Anything that can run a statement — the pool, a `withTenant` transaction, or
 * the `tx` inside `provisionTenant`'s. Structural rather than the concrete
 * database type because the seeder is now called from inside the transaction
 * that creates a studio, and that transaction must be the one it writes on: a
 * template written outside it would survive a rollback that took the studio.
 */
type TemplateWriter = Pick<PostgresJsDatabase<typeof schema>, 'execute'>

/**
 * Write every email template for one tenant.
 *
 * Called when a studio is *created* (`services/tenants/provision.ts`) and by the
 * test harness — no longer by `db:seed`, which has no studios to run it for. So
 * the UPSERT on (tenant, slug) is idempotence, not a copy-refresh channel: a
 * deploy no longer rewrites anybody's copy, which is what a studio that has
 * edited its own wording needs, and means a fix to the shipped copy reaches only
 * studios created after it. Refreshing an existing studio's is a separate act
 * with a separate question to answer — which edits it is allowed to overwrite —
 * and there is deliberately no code here that quietly answers it.
 *
 * The copy itself is in `./email-copy.ts`; this file is the half that knows the
 * database and the environment.
 *
 * **The origins are the tenant's own, derived from its slug.** They used to be
 * `CLIENT_URL` and `env.PORTAL_ORIGIN`, which are single global values naming
 * one studio's apps — so the second studio's instructor got an "Open the
 * schedule" button pointing at the first studio's portal, baked into
 * `body_html` where nothing would notice until it was clicked. `tenantOrigin`
 * reads the same `TENANT_ORIGIN_PATTERNS` wildcards CORS accepts, so the link
 * mailed out and the origin the backend trusts cannot drift apart.
 *
 * **An environment with no wildcard for an app is refused, not fallen back
 * on.** `tenantOrigin` returns null there, and the only two things a fallback
 * could bake in are the platform env vars — which is precisely the cross-tenant
 * link this change removes — or a dead relative href, which is a broken button
 * in thirty emails discovered by a member rather than by us. Neither is worth
 * having, and neither is a loss: in an environment with no per-tenant hostname
 * the frontends read no slug from the hostname either, so a studio created
 * there has no reachable app for the link to point at in the first place. So it
 * fails loudly, at the one moment an operator is watching — naming the variable
 * they have to set.
 *
 * That is stricter than `provisionTenant`'s own handling of the same null,
 * which returns `urls: { client: null, portal: null }` and carries on, and the
 * difference is deliberate: that URL is handed to the operator standing there,
 * who can see it is missing. This one is frozen into stored HTML and mailed for
 * as long as the studio exists, and nobody is standing there when it is read.
 */
export async function seedEmailTemplates(db: TemplateWriter, tenant: SeededTenant) {
  const clientUrl = tenantOrigin('client', tenant.slug)
  const portalUrl = tenantOrigin('portal', tenant.slug)
  if (!clientUrl || !portalUrl) {
    throw new Error(
      `cannot seed email templates for ${tenant.slug}: this environment configures no tenant ` +
        `origin wildcard for the ${clientUrl ? 'portal' : 'client'} app, so there is no honest ` +
        'URL to bake into the copy. Set TENANT_ORIGIN_PATTERNS.',
    )
  }

  const templates = buildEmailTemplates({
    clientUrl,
    portalUrl,
    // Whose words these are. The name is the tenant's own, so a studio's
    // members never read another studio's name in their inbox; the footer is
    // provisioning data (`./provisioning.ts`) and is omitted for a tenant that
    // has none, because naming no premises beats naming the wrong ones.
    //
    // Looked up **by id, never by slug**. `provisioningFor` prefers the slug,
    // and its records are keyed on `yogasadhana` and `acme` — neither of which
    // is a reserved slug. Now that this runs while a studio is being created,
    // an operator who onboards a new studio as `acme` would otherwise have
    // Yoga Sadhana's real premises printed in the footer of all thirty of its
    // emails. An id is generated and cannot be typed into the create form.
    studio: { name: tenant.name, footer: provisioningFor({ id: tenant.id })?.emailFooter },
  })
  for (const t of templates) {
    await db.execute(sql`
      INSERT INTO email_templates (tenant_id, slug, subject, body_html)
      VALUES (${tenant.id}::uuid, ${t.slug}, ${t.subject}, ${t.bodyHtml})
      ON CONFLICT (tenant_id, slug) DO UPDATE
        SET subject = EXCLUDED.subject,
            body_html = EXCLUDED.body_html,
            updated_at = now()
    `)
  }
}
