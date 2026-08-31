import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'
import type { SeededTenant } from './tenants'

/**
 * A studio's own class types. Idempotent via WHERE NOT EXISTS on
 * (tenant_id, lower(name)) — per tenant, because "Hatha" existing for Yoga
 * Sadhana says nothing about whether Acme has one.
 */
export async function seedClassTypes(
  db: PostgresJsDatabase<typeof schema>,
  tenant: SeededTenant,
) {
  const names = ['Hatha', 'Vinyasa', 'Yin', 'Restorative', 'Aerial Yoga', 'Pilates']
  for (const name of names) {
    await db.execute(sql`
      INSERT INTO class_types (tenant_id, name)
      SELECT ${tenant.id}::uuid, ${name}
      WHERE NOT EXISTS (
        SELECT 1 FROM class_types
        WHERE tenant_id = ${tenant.id}::uuid AND lower(name) = lower(${name})
      )
    `)
  }
}
