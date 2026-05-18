import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'

const WAIVER_SINGLETON_ID = '00000000-0000-0000-0000-000000000003'

export async function seedWaiver(db: PostgresJsDatabase<typeof schema>) {
  await db
    .insert(schema.waiver)
    .values({
      id: WAIVER_SINGLETON_ID,
      bodyHtml:
        '<p><strong>Yoga Sadhana — Waiver</strong></p><p>Placeholder waiver body. Replace via admin → Waiver editor.</p>',
    })
    .onConflictDoNothing()
}
