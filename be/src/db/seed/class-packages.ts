import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'

/**
 * Idempotent on name. Includes a Trial Pass row per spec.
 * Kind-specific column constraints enforced by DB CHECK.
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
    { name: '5-Class Pack',     kind: 'credit_bundle', credits: 5,  validityDays: 60,  durationDays: null, priceSgd: '120.00', description: null },
    { name: '10-Class Pack',    kind: 'credit_bundle', credits: 10, validityDays: 90,  durationDays: null, priceSgd: '220.00', description: null },
    { name: '20-Class Pack',    kind: 'credit_bundle', credits: 20, validityDays: 180, durationDays: null, priceSgd: '400.00', description: null },
    { name: '1-Month Unlimited', kind: 'unlimited',    credits: null, validityDays: null, durationDays: 30,  priceSgd: '180.00', description: null },
    { name: '3-Month Unlimited', kind: 'unlimited',    credits: null, validityDays: null, durationDays: 90,  priceSgd: '480.00', description: null },
    { name: 'Trial Pass',        kind: 'trial',        credits: 3,    validityDays: 30,   durationDays: null, priceSgd: '30.00',  description: 'First-timer trial' },
  ]

  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO class_packages (name, description, kind, credits, validity_days, duration_days, price_sgd, status)
      SELECT ${r.name}, ${r.description}, ${r.kind}, ${r.credits}, ${r.validityDays}, ${r.durationDays}, ${r.priceSgd}, 'active'
      WHERE NOT EXISTS (SELECT 1 FROM class_packages WHERE name = ${r.name})
    `)
  }
}
