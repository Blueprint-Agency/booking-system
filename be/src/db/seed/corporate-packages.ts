import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'

/**
 * Corporate-class package catalogue — mirrors the Yoga Sadhana "Corporate
 * Class" (in-studio) price card. Each tier is a block of corporate sessions a
 * company purchases.
 *
 * NOTE: `corporate_packages` has no dedicated session-count column (it is just
 * name + description + price). The number of sessions per tier is therefore
 * encoded in the name + description. If a structured session count is needed,
 * a `num_sessions` column + migration should be added to the table — out of
 * scope for a seed-only change.
 *
 * `created_by_staff_id` is NOT NULL, so each row is attributed to the
 * superadmin. If no superadmin row exists yet (Clerk bootstrap failed), the
 * insert is skipped — seedSuperadmin runs first in run.ts, so this is normally
 * satisfied.
 *
 * Idempotent on name. Re-running is safe; rows already in the DB are skipped.
 * To start clean, TRUNCATE corporate_packages CASCADE before reseeding.
 */
export async function seedCorporatePackages(db: PostgresJsDatabase<typeof schema>) {
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
      INSERT INTO corporate_packages (name, description, price_sgd, status, created_by_staff_id)
      SELECT ${r.name}, ${r.description}, ${r.priceSgd}, 'active',
             (SELECT id FROM staff_users WHERE role = 'superadmin' LIMIT 1)
      WHERE EXISTS (SELECT 1 FROM staff_users WHERE role = 'superadmin')
        AND NOT EXISTS (SELECT 1 FROM corporate_packages WHERE name = ${r.name})
    `)
  }
}
