import '../url'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../schema'

import { seedTenants, seededTenants } from './tenants'
import { seedSuperadmin } from './superadmin'
import { seedLocations } from './locations'
import { seedRooms } from './rooms'
import { seedClassTypes } from './class-types'
import { seedClassPackages } from './class-packages'
import { seedPtPackages } from './pt-packages'
import { seedCorporatePackages } from './corporate-packages'
import { seedPolicy } from './policy'
import { seedEmailTemplates } from './email-templates'
import { seedWaiver } from './waiver'
import { seedMarketing } from './marketing'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required to seed')

  const client = postgres(url)
  const db = drizzle(client, { schema })

  try {
    console.log('[seed] tenants…')
    await seedTenants(db)
    console.log('[seed] superadmin…')
    await seedSuperadmin(db)
    // Premises and policy belong to a tenant, not to the platform: each is
    // seeded once per provisioned tenant rather than once for the studio.
    //
    // Every seeder below takes a tenant. `tenant_id` lost its default in
    // migration 0032, so an insert that does not name one no longer lands under
    // Yoga Sadhana — it fails, which is the point. The tenant-#1 claiming pass
    // that used to run last is gone with the default that made it necessary.
    for (const tenant of seededTenants()) {
      console.log(`[seed] premises, policy, content + catalogue for ${tenant.slug}…`)
      await seedLocations(db, tenant)
      await seedRooms(db, tenant)
      await seedPolicy(db, tenant)
      // Content is a tenant's own words — its emails, its waiver, its home page
      // — and each of these tables now holds one row per tenant rather than one
      // row (migration 0031).
      await seedEmailTemplates(db, tenant)
      await seedWaiver(db, tenant)
      await seedMarketing(db, tenant)
      // So is its catalogue: a studio prices its own classes.
      await seedClassTypes(db, tenant)
      await seedClassPackages(db, tenant)
      await seedPtPackages(db, tenant)
      await seedCorporatePackages(db, tenant)
    }
    console.log('[seed] done')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('[seed] failed:', err)
  process.exit(1)
})
