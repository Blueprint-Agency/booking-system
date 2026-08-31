import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'
import { CLIENT_URL, env } from '../../env'
import { buildEmailTemplates } from './email-copy'
import type { SeededTenant } from './tenants'

/**
 * Write every email template for one tenant. UPSERT on (tenant, slug), so a
 * copy change ships with the deploy (`deploy-be.yml` runs `db:seed` after
 * `db:migrate`) without one studio's edit reaching another's outbox — the pair
 * is what migration 0031 made unique.
 *
 * The copy itself is in `./email-copy.ts`; this file is the half that knows the
 * database and the environment. The origins come from `../../env` — `CLIENT_URL`
 * is documented there as "the one place any link mailed or redirected to a
 * member is built from", and `PORTAL_ORIGIN` is a required var, so an
 * environment missing it fails at boot rather than baking `localhost` hrefs into
 * `body_html` where nobody sees them until a member clicks one.
 */
export async function seedEmailTemplates(
  db: PostgresJsDatabase<typeof schema>,
  tenant: SeededTenant,
) {
  const templates = buildEmailTemplates({
    clientUrl: CLIENT_URL,
    portalUrl: env.PORTAL_ORIGIN.replace(/\/+$/, ''),
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
