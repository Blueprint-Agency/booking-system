import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'

/**
 * Class-package catalogue — mirrors the fe-client PACKAGE_CATALOGUE
 * (`fe-client/src/lib/mock-state.ts`) for the bundle + unlimited tiers.
 *
 * Idempotent on name. Re-running is safe; rows already in the DB are skipped.
 * To start clean, TRUNCATE class_packages CASCADE before reseeding.
 */
export async function seedClassPackages(db: PostgresJsDatabase<typeof schema>) {
  const rows: Array<{
    name: string
    kind: 'credit_bundle' | 'unlimited' | 'trial'
    credits: number | null
    validityDays: number | null
    durationDays: number | null
    priceSgd: string
    description: string | null
  }> = [
    // --- Credit bundles (Price List → CLASS BUNDLES) ---
    { name: 'One-time Pass',      kind: 'credit_bundle', credits: 1,    validityDays: 1,    durationDays: null, priceSgd: '40.00',   description: null },
    { name: 'Bundle of 10',       kind: 'credit_bundle', credits: 10,   validityDays: 60,   durationDays: null, priceSgd: '340.00',  description: null },
    { name: 'Bundle of 20',       kind: 'credit_bundle', credits: 20,   validityDays: 120,  durationDays: null, priceSgd: '630.00',  description: null },
    { name: 'Bundle of 30',       kind: 'credit_bundle', credits: 30,   validityDays: 180,  durationDays: null, priceSgd: '860.00',  description: null },
    { name: 'Bundle of 50',       kind: 'credit_bundle', credits: 50,   validityDays: 260,  durationDays: null, priceSgd: '1270.00', description: null },
    { name: 'Bundle of 100',      kind: 'credit_bundle', credits: 100,  validityDays: 450,  durationDays: null, priceSgd: '2300.00', description: null },
    // --- Unlimited memberships (Price List → UNLIMITED MEMBERSHIP) ---
    { name: '3-Month Unlimited',  kind: 'unlimited',     credits: null, validityDays: null, durationDays: 90,   priceSgd: '690.00',  description: null },
    { name: '6-Month Unlimited',  kind: 'unlimited',     credits: null, validityDays: null, durationDays: 180,  priceSgd: '1150.00', description: null },
    { name: '12-Month Unlimited', kind: 'unlimited',     credits: null, validityDays: null, durationDays: 365,  priceSgd: '1955.00', description: null },
  ]

  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO class_packages (name, description, kind, credits, validity_days, duration_days, price_sgd, status)
      SELECT ${r.name}, ${r.description}, ${r.kind}, ${r.credits}, ${r.validityDays}, ${r.durationDays}, ${r.priceSgd}, 'active'
      WHERE NOT EXISTS (SELECT 1 FROM class_packages WHERE name = ${r.name})
    `)
  }
}
