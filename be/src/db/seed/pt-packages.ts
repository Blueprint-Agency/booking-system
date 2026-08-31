import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'
import type { SeededTenant } from './tenants'

/**
 * PT (private-training) package catalogue — mirrors the fe-client
 * PACKAGE_CATALOGUE (`fe-client/src/lib/mock-state.ts`) VIP 1-on-1 and
 * VIP 2-on-1 tiers. `numSessions` reflects user-facing session count
 * (matches the "·N" suffix in the package name); each booking decrements
 * one session.
 *
 * A catalogue belongs to a studio, so this runs once per provisioned tenant and
 * is idempotent on (tenant, name). To start clean, TRUNCATE pt_packages CASCADE
 * before reseeding.
 */
export async function seedPtPackages(
  db: PostgresJsDatabase<typeof schema>,
  tenant: SeededTenant,
) {
  const rows: Array<{
    name: string
    sessionType: '1on1' | '2on1'
    numSessions: number
    priceSgd: string
  }> = [
    // --- VIP 1-on-1 (Price List → PERSONAL TRAINING) ---
    { name: 'VIP 1-on-1 · 10',  sessionType: '1on1', numSessions: 10,  priceSgd: '1840.00' },
    { name: 'VIP 1-on-1 · 20',  sessionType: '1on1', numSessions: 20,  priceSgd: '3450.00' },
    { name: 'VIP 1-on-1 · 30',  sessionType: '1on1', numSessions: 30,  priceSgd: '4830.00' },
    { name: 'VIP 1-on-1 · 40',  sessionType: '1on1', numSessions: 40,  priceSgd: '5980.00' },
    { name: 'VIP 1-on-1 · 50',  sessionType: '1on1', numSessions: 50,  priceSgd: '6900.00' },
    { name: 'VIP 1-on-1 · 100', sessionType: '1on1', numSessions: 100, priceSgd: '12650.00' },
    // --- VIP 2-on-1 ---
    { name: 'VIP 2-on-1 · 10',  sessionType: '2on1', numSessions: 10,  priceSgd: '2000.00' },
    { name: 'VIP 2-on-1 · 20',  sessionType: '2on1', numSessions: 20,  priceSgd: '3600.00' },
    { name: 'VIP 2-on-1 · 30',  sessionType: '2on1', numSessions: 30,  priceSgd: '4800.00' },
    { name: 'VIP 2-on-1 · 50',  sessionType: '2on1', numSessions: 50,  priceSgd: '7500.00' },
  ]

  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO pt_packages (tenant_id, name, session_type, num_sessions, price_sgd, status)
      SELECT ${tenant.id}::uuid, ${r.name}, ${r.sessionType}, ${r.numSessions}, ${r.priceSgd}, 'active'
      WHERE NOT EXISTS (
        SELECT 1 FROM pt_packages WHERE tenant_id = ${tenant.id}::uuid AND name = ${r.name}
      )
    `)
  }
}
