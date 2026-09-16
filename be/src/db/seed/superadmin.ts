import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { TENANT_ONE_ID } from '../schema/tenancy'
import { ensureAuthUser } from '../../services/auth/auth-users'

/**
 * Seeds the superadmin staff_users row and the matching Better Auth staff user
 * — passwordless. On every deploy:
 *
 *   1. The `staff` pool user for SUPERADMIN_EMAIL is found, or created with NO
 *      credential. The operator picks their own password through "Forgot
 *      password" on first sign-in, which creates the credential; an existing
 *      user's password is left untouched, so a re-run locks nobody out.
 *   2. The staff_users row is written `active`, linked to that user by
 *      `auth_user_id`, so the operator can sign in the moment they have a
 *      password.
 *
 * Why passwordless: no SUPERADMIN_PASSWORD secret in env / CI / GitHub
 * Actions logs / .env.booking-be on disk. The operator owns the credential;
 * the deployer never sees it.
 *
 * Idempotency: ON CONFLICT (tenant_id, email) only lifts a row still `pending`
 * to `active`, and never re-points a linked row or undoes an archive.
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

  const name = 'Superadmin'
  const authUserId = await ensureAuthUser(db, 'staff', { email, name })

  await db
    .insert(schema.staffUsers)
    .values({
      // The bootstrap operator belongs to tenant #1. `tenant_id` no longer has a
      // default (migration 0032), so this has to be said rather than assumed.
      tenantId: TENANT_ONE_ID,
      email,
      name,
      role: 'superadmin',
      status: 'active',
      authUserId,
      acceptedAt: new Date(),
      grantedLocationIds: sql`'{}'::uuid[]`,
    })
    .onConflictDoUpdate({
      // `(tenant_id, email)`, not `email` alone. Migration 0035 replaced the
      // platform-wide unique index with a per-Tenant one — the same person may
      // be an instructor at one studio and an admin at another — and
      // `ON CONFLICT` names an index, not a column list it can approximate.
      // Naming the old one made every deploy fail on `there is no unique or
      // exclusion constraint matching the ON CONFLICT specification`, which the
      // test suite never caught because the harness does not run this seed.
      target: [schema.staffUsers.tenantId, schema.staffUsers.email],
      set: {
        status: sql`CASE
          WHEN ${schema.staffUsers.status} = 'pending' THEN 'active'::staff_status
          ELSE ${schema.staffUsers.status}
        END`,
        acceptedAt: sql`COALESCE(${schema.staffUsers.acceptedAt}, EXCLUDED.accepted_at)`,
        updatedAt: sql`now()`,
      },
    })
}
