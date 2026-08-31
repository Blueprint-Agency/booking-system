import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'
import type { SeededTenant } from './tenants'

/**
 * Corporate-class package catalogue — the starter "Corporate Class" (in-studio)
 * price card every provisioned tenant begins with. Each tier is a block of
 * corporate sessions a company purchases, and a studio reprices its own from
 * the portal; nothing here is any one studio's card.
 *
 * NOTE: `corporate_packages` has no dedicated session-count column (it is just
 * name + description + price). The number of sessions per tier is therefore
 * encoded in the name + description. If a structured session count is needed,
 * a `num_sessions` column + migration should be added to the table — out of
 * scope for a seed-only change.
 *
 * `created_by_staff_id` is NOT NULL, so each row is attributed to the tenant's
 * OWN superadmin — never another studio's, which would be a foreign key pointing
 * across the isolation boundary. A tenant with no superadmin of its own (today:
 * every tenant but #1, since the bootstrap superadmin is tenant #1's) simply
 * gets no corporate packages seeded.
 *
 * A catalogue belongs to a studio, so this runs once per provisioned tenant and
 * is idempotent on (tenant, name). To start clean, TRUNCATE corporate_packages
 * CASCADE before reseeding.
 */
export async function seedCorporatePackages(
  db: PostgresJsDatabase<typeof schema>,
  tenant: SeededTenant,
) {
  const rows: Array<{
    name: string
    sessions: number
    priceSgd: string
    description: string
  }> = [
    { name: 'Corporate Class · 1 Session',   sessions: 1,  priceSgd: '300.00',  description: 'In-studio corporate class — 1 session.' },
    { name: 'Corporate Class · 10 Sessions', sessions: 10, priceSgd: '2500.00', description: 'In-studio corporate class — 10 sessions.' },
    { name: 'Corporate Class · 20 Sessions', sessions: 20, priceSgd: '3600.00', description: 'In-studio corporate class — 20 sessions.' },
  ]

  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO corporate_packages (tenant_id, name, description, price_sgd, status, created_by_staff_id)
      SELECT ${tenant.id}::uuid, ${r.name}, ${r.description}, ${r.priceSgd}, 'active',
             (SELECT id FROM staff_users
              WHERE tenant_id = ${tenant.id}::uuid AND role = 'superadmin' LIMIT 1)
      WHERE EXISTS (
          SELECT 1 FROM staff_users WHERE tenant_id = ${tenant.id}::uuid AND role = 'superadmin'
        )
        AND NOT EXISTS (
          SELECT 1 FROM corporate_packages WHERE tenant_id = ${tenant.id}::uuid AND name = ${r.name}
        )
    `)
  }
}
