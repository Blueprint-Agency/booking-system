/**
 * Verification scaffolding, run by `stack.mjs up` against the throwaway
 * database only: give the super portal's operator (PLATFORM_ADMIN_EMAIL, set by
 * stack.mjs to a sink address) a password, hashed as Better Auth hashes one.
 *
 * A real operator sets theirs from an emailed link; under NODE_ENV=test that
 * mail is discarded, so the run writes the credential the link would have.
 * Run with be/'s tsx and the environment stack.mjs builds.
 */
import '../../../../be/src/db/url'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as schema from '../../../../be/src/db/schema'
import { ensureAuthUser, hasPassword } from '../../../../be/src/services/auth/auth-users'

const beRequire = createRequire(path.resolve(__dirname, '../../../../be/package.json'))
const postgres = beRequire('postgres')
const { drizzle } = beRequire('drizzle-orm/postgres-js')
const { hashPassword } = beRequire('better-auth/crypto')

async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL
  const password = process.env.VERIFY_SUPER_PASSWORD
  if (!email || !password) throw new Error('PLATFORM_ADMIN_EMAIL and VERIFY_SUPER_PASSWORD are required')
  if (!process.env.POSTGRES_DB?.startsWith('reservetoday-verify')) throw new Error('refusing: only the verification database')

  const client = postgres(process.env.DATABASE_URL!, { max: 1 })
  try {
    const db = drizzle(client, { schema })
    const userId = await ensureAuthUser(db, 'platform', { email, name: 'Verify super admin' })
    if (!(await hasPassword(db, 'platform', userId))) {
      await db.insert(schema.platformAuthAccounts).values({
        id: randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: await hashPassword(password),
      })
    }
    console.log(`[verify] super portal operator ${email} has a password`)
  } finally {
    await client.end({ timeout: 5 })
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
