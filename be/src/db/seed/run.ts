import '../url'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../schema'
import { seedPlatformAdmins } from './platform-admin'

/**
 * What a fresh deployment provisions: the super portal's way in, and nothing
 * else.
 *
 * This used to seed a real studio — its premises, catalogue, waiver and email
 * copy — because the platform was built for exactly one. On a multi-tenant
 * platform that is one customer's *data* shipped inside every other customer's
 * product, and every new deployment started life holding it.
 *
 * So a new platform is empty. A studio arrives one of two ways, both from the
 * super portal and neither from this file:
 *
 *  1. **Created** — a name, a slug and a first admin, in one transaction
 *     (`services/tenants/provision.ts`). It starts with no premises and no
 *     catalogue, and its own admins fill those in.
 *  2. **Restored** — from an archive of a studio that existed before
 *     (`services/tenants/transfer.ts`). This is how a studio that predates the
 *     super portal comes back after the seeders that used to invent it were
 *     removed, and how any studio survives being deleted.
 *
 * The per-tenant seeders that used to run here still exist, and are mostly what
 * they always really were: **fixtures for the test harness**, which needs two
 * studios with data in order to prove that neither can see the other's.
 *
 * One is not a fixture. `./email-templates.ts` is called by `provisionTenant`
 * itself, because a studio with no template rows cannot send a single
 * transactional email — `sendTemplatedEmail` throws rather than reach for
 * another studio's wording — so the copy is part of creating a studio rather
 * than something a deploy hands out. It runs there, per tenant, on that
 * tenant's own origins; it does not run here, because a deployment has no
 * studios to run it for.
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to seed')

  // As the owner, like every seed: the auth pools carry no Row-Level Security,
  // but the seed is provisioning, not the app.
  const client = postgres(process.env.DATABASE_URL, { max: 1 })
  try {
    console.log('[seed] platform administrators…')
    await seedPlatformAdmins(drizzle(client, { schema }))
    console.log('[seed] done — the platform has no studios; create one from the super portal')
  } finally {
    await client.end({ timeout: 5 })
  }
}

main().catch(err => {
  console.error('[seed] failed:', err)
  process.exit(1)
})
