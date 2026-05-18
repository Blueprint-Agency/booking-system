import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from '../schema'

export async function seedPtPackages(db: PostgresJsDatabase<typeof schema>) {
  const rows: Array<{
    name: string
    sessionType: '1on1' | '2on1'
    numSessions: number
    priceSgd: string
  }> = [
    { name: '5-Session 1-on-1',  sessionType: '1on1', numSessions: 5,  priceSgd: '450.00' },
    { name: '10-Session 1-on-1', sessionType: '1on1', numSessions: 10, priceSgd: '850.00' },
    { name: '5-Session 2-on-1',  sessionType: '2on1', numSessions: 5,  priceSgd: '300.00' },
    { name: '10-Session 2-on-1', sessionType: '2on1', numSessions: 10, priceSgd: '560.00' },
  ]

  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO pt_packages (name, session_type, num_sessions, price_sgd, status)
      SELECT ${r.name}, ${r.sessionType}, ${r.numSessions}, ${r.priceSgd}, 'active'
      WHERE NOT EXISTS (SELECT 1 FROM pt_packages WHERE name = ${r.name})
    `)
  }
}
