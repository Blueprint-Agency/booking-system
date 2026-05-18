import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'

/** Idempotent via WHERE NOT EXISTS on (lower(name)). */
export async function seedClassTypes(db: PostgresJsDatabase<typeof schema>) {
  const names = ['Hatha', 'Vinyasa', 'Yin', 'Restorative', 'Aerial Yoga', 'Pilates']
  for (const name of names) {
    await db.execute(sql`
      INSERT INTO class_types (name)
      SELECT ${name}
      WHERE NOT EXISTS (SELECT 1 FROM class_types WHERE lower(name) = lower(${name}))
    `)
  }
}
