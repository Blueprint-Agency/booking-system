import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../../db/schema'

/** The user table of each password pool — the pools a seed provisions into. */
const USERS = {
  staff: schema.staffAuthUsers,
  platform: schema.platformAuthUsers,
} as const

type UserWriter = Pick<PostgresJsDatabase<typeof schema>, 'insert' | 'select'>

/**
 * Make sure a Better Auth user exists for this address, and return its id.
 *
 * **Passwordless, like the Clerk bootstrap it sits beside.** The row is a user
 * with no credential account at all; the person sets their first password
 * through the reset flow (`/request-password-reset`), which creates the
 * credential when there is none. So no password lives in `.env`, CI logs or a
 * deployer's disk. The address is marked verified because whoever wrote the
 * seed vouched for it, and a reset mailed to it is the proof.
 *
 * Idempotent: an existing user — with whatever password they have since chosen
 * — is found by address and left untouched, so re-running a seed on every
 * deploy locks nobody out.
 */
export async function ensureAuthUser(
  db: UserWriter,
  pool: keyof typeof USERS,
  input: { email: string; name: string },
): Promise<string> {
  const users = USERS[pool]
  const email = input.email.trim().toLowerCase()

  await db
    .insert(users)
    .values({ id: randomUUID(), email, name: input.name, emailVerified: true })
    .onConflictDoNothing({ target: users.email })

  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!row) throw new Error(`ensureAuthUser: no ${pool} user for ${email} after insert`)
  return row.id
}
