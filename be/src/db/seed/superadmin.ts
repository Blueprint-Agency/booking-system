import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { clerkStaffApp } from '../../lib/clerk'

/**
 * Seeds the superadmin staff_users row and pre-links it to Clerk when possible.
 *
 * If a Clerk user with SUPERADMIN_EMAIL already exists (typical after a DB wipe
 * or a redeploy that recreates the row), we look them up via the Clerk Backend
 * SDK and write `clerk_user_id` + `status='active'` at seed time. That makes
 * the bootstrap self-healing — no second sign-in needed to escape the bounce
 * loop from `WorkspaceProvider` when /portal/auth/me returns 403.
 *
 * Idempotency: ON CONFLICT (email) only patches the row when it is currently
 * unlinked (`clerk_user_id IS NULL`) AND we just found a Clerk user. Working
 * rows are left untouched.
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

  let clerkUserId: string | null = null
  let name = 'Superadmin'
  let status: 'pending' | 'active' = 'pending'
  let acceptedAt: Date | null = null

  try {
    const { data } = await clerkStaffApp.users.getUserList({ emailAddress: [email] })
    const user = data[0]
    if (user) {
      clerkUserId = user.id
      name = [user.firstName, user.lastName].filter(Boolean).join(' ') || email
      status = 'active'
      acceptedAt = new Date()
    }
  } catch (err) {
    console.warn('[seed] superadmin Clerk pre-link skipped:', err)
  }

  await db
    .insert(schema.staffUsers)
    .values({
      email,
      name,
      role: 'superadmin',
      status,
      clerkUserId,
      acceptedAt,
      grantedLocationIds: sql`'{}'::uuid[]`,
    })
    .onConflictDoUpdate({
      target: schema.staffUsers.email,
      // Patch only when the existing row is unlinked AND we just resolved a
      // Clerk user. Otherwise this becomes a true no-op.
      set: {
        clerkUserId: sql`COALESCE(${schema.staffUsers.clerkUserId}, EXCLUDED.clerk_user_id)`,
        status: sql`CASE
          WHEN ${schema.staffUsers.clerkUserId} IS NULL AND EXCLUDED.clerk_user_id IS NOT NULL
            THEN 'active'::staff_status
          ELSE ${schema.staffUsers.status}
        END`,
        acceptedAt: sql`COALESCE(${schema.staffUsers.acceptedAt}, EXCLUDED.accepted_at)`,
        name: sql`CASE
          WHEN ${schema.staffUsers.name} = 'Superadmin' THEN EXCLUDED.name
          ELSE ${schema.staffUsers.name}
        END`,
        updatedAt: sql`now()`,
      },
    })
}
