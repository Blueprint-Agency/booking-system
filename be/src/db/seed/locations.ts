import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'

/**
 * Two Yoga Sadhana locations. Idempotent via WHERE NOT EXISTS check on name.
 * (locations has no unique constraint on name — we filter explicitly.)
 */
export async function seedLocations(db: PostgresJsDatabase<typeof schema>) {
  const rows = [
    {
      name: 'Breadtalk IHQ (Tai Seng)',
      address: '30 Tai Seng Street, #09-01 Breadtalk IHQ, Singapore 534013',
      gmapsUrl: 'https://maps.google.com/?q=Breadtalk+IHQ+Tai+Seng',
      phone: null,
    },
    {
      name: 'Outram Park',
      address: '1 Cantonment Road, #09-01, Singapore 085101',
      gmapsUrl: 'https://maps.google.com/?q=Outram+Park+Singapore',
      phone: null,
    },
  ]
  for (const row of rows) {
    await db.execute(sql`
      INSERT INTO locations (name, address, gmaps_url, phone)
      SELECT ${row.name}, ${row.address}, ${row.gmapsUrl}, ${row.phone}
      WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = ${row.name})
    `)
  }
}
