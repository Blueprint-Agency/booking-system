import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'

const POLICY_SINGLETON_ID = '00000000-0000-0000-0000-000000000001'
const PT_CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000002'

export async function seedPolicy(db: PostgresJsDatabase<typeof schema>) {
  await db
    .insert(schema.globalPolicy)
    .values({
      id: POLICY_SINGLETON_ID,
      cancelCapCount: 3,
      cancelCapCycleDays: 30,
      classWindowHours: 2,
      ptWindowHours: 24,
    })
    .onConflictDoNothing()

  await db
    .insert(schema.ptBookingConfig)
    .values({
      id: PT_CONFIG_SINGLETON_ID,
      bookInAdvanceDays: 7,
    })
    .onConflictDoNothing()
}
