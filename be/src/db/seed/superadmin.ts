import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { clerkStaffApp } from '../../lib/clerk'
import { TENANT_ONE_ID } from '../schema/tenancy'

/**
 * Seeds the superadmin staff_users row and bootstraps the matching Clerk user
 * — passwordless. On every deploy:
 *
 *   1. If a Clerk staff-app user with SUPERADMIN_EMAIL already exists, we
 *      leave their credential untouched. (They set their own password on
 *      first sign-in; rotating it on subsequent deploys would lock them out.)
 *   2. If no Clerk user exists, we create one with NO password
 *      (`skipPasswordRequirement: true`). The operator picks their own
 *      password via Clerk's "Forgot password" reset flow on first sign-in
 *      — Clerk emails the reset link to SUPERADMIN_EMAIL.
 *   3. Either way, we write `clerk_user_id` + `status='active'` onto the
 *      staff_users row, so the operator can sign in immediately without a
 *      separate webhook round-trip.
 *
 * Why passwordless: no SUPERADMIN_PASSWORD secret in env / CI / GitHub
 * Actions logs / .env.booking-be on disk. The operator owns the credential;
 * the deployer never sees it. Clerk's password policy (incl. the breach
 * check) is enforced at the right gate — the reset form — where the
 * operator can pick a compliant password.
 *
 * Fault tolerance: if the Clerk Backend API call fails (network, key, rate
 * limit), we log and fall through — the DB row still lands in `pending` so
 * the existing webhook / auto-link middleware path can heal it later.
 *
 * Idempotency: ON CONFLICT (email) only patches the row when it is currently
 * unlinked (`clerk_user_id IS NULL`) AND we just resolved a Clerk user.
 * Working rows are left untouched.
 */
export async function seedSuperadmin(db: PostgresJsDatabase<typeof schema>) {
  const raw = process.env.SUPERADMIN_EMAIL
  if (!raw) {
    throw new Error(
      'SUPERADMIN_EMAIL is required to seed. Set it in .env (e.g. SUPERADMIN_EMAIL=you@example.com).',
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
    let user = data[0] ?? null
    if (!user) {
      // Backend-API-created users have their primary email auto-verified, so
      // the "Forgot password" reset flow will deliver to them immediately on
      // first sign-in without any extra verification step.
      user = await clerkStaffApp.users.createUser({
        emailAddress: [email],
        skipPasswordRequirement: true,
      })
      console.log(
        `[seed] superadmin Clerk user created (${user.id}) — set your password via "Forgot password" on first sign-in`,
      )
    } else {
      console.log(`[seed] superadmin Clerk user already exists (${user.id}) — credential left untouched`)
    }
    clerkUserId = user.id
    name = [user.firstName, user.lastName].filter(Boolean).join(' ') || email
    status = 'active'
    acceptedAt = new Date()
  } catch (err) {
    console.warn('[seed] superadmin Clerk bootstrap skipped:', err)
  }

  await db
    .insert(schema.staffUsers)
    .values({
      // The bootstrap operator belongs to tenant #1. `tenant_id` no longer has a
      // default (migration 0032), so this has to be said rather than assumed.
      tenantId: TENANT_ONE_ID,
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
