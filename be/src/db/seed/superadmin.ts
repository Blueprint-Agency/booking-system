import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'

/**
 * Seeds (or no-ops) the superadmin staff_users row. Idempotent on email uniqueness.
 *
 * - email comes from SUPERADMIN_EMAIL env (lowercased)
 * - clerk_user_id = NULL until the matching Clerk user signs in for the first time
 *   and the user.created webhook flips status → 'active'
 * - granted_location_ids = [] (empty array means "all locations" — see §4a)
 */
export async function seedSuperadmin(db: PostgresJsDatabase<typeof schema>) {
  const raw = process.env.SUPERADMIN_EMAIL
  if (!raw) {
    throw new Error(
      'SUPERADMIN_EMAIL is required to seed. Set it in .env (e.g. SUPERADMIN_EMAIL=you@yogasadhana.sg).',
    )
  }
  const email = raw.trim().toLowerCase()
  if (!email) throw new Error('SUPERADMIN_EMAIL is blank')

  await db
    .insert(schema.staffUsers)
    .values({
      email,
      name: 'Superadmin',
      role: 'superadmin',
      status: 'pending',
      clerkUserId: null,
      grantedLocationIds: sql`'{}'::uuid[]`,
    })
    .onConflictDoNothing({ target: schema.staffUsers.email })
}
