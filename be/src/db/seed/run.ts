import '../url'
import { seedPlatformAdmins } from './platform-admin'

/**
 * What a fresh deployment provisions: the super portal's way in, and nothing
 * else.
 *
 * This used to seed a studio — Yoga Sadhana's premises, catalogue, waiver and
 * email copy — because the platform was built for exactly one. On a multi-tenant
 * platform that is one studio's *data* shipped in another studio's product, and
 * every new deployment started life holding it.
 *
 * So a new platform is empty. A studio arrives one of two ways, both from the
 * super portal and neither from this file:
 *
 *  1. **Created** — a name, a slug and a first admin, in one transaction
 *     (`services/tenants/provision.ts`). It starts with no premises and no
 *     catalogue, and its own admins fill those in.
 *  2. **Restored** — from an archive of a studio that existed before
 *     (`services/tenants/transfer.ts`). This is how Yoga Sadhana comes back
 *     after the seeders that used to invent it were removed, and how a studio
 *     survives being deleted.
 *
 * The per-tenant seeders that used to run here still exist, and are now what
 * they always really were: **fixtures for the test harness**, which needs two
 * studios with data in order to prove that neither can see the other's. Nothing
 * in a deployment reads them.
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to seed')

  console.log('[seed] platform administrators…')
  await seedPlatformAdmins()
  console.log('[seed] done — the platform has no studios; create one from the super portal')
}

main().catch(err => {
  console.error('[seed] failed:', err)
  process.exit(1)
})
