import '../url'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../schema'

import { seedTenants, seededTenants } from './tenants'
import { claimSeededRowsForTenantOne } from './claim-tenant-one'
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
    for (const tenant of seededTenants()) {
      console.log(`[seed] locations, rooms, policy + content for ${tenant.slug}…`)
      await seedLocations(db, tenant)
      await seedRooms(db, tenant)
      await seedPolicy(db, tenant)
      // Content is a tenant's own words — its emails, its waiver, its home page
      // — and each of these tables now holds one row per tenant rather than one
      // row (migration 0031).
      await seedEmailTemplates(db, tenant)
      await seedWaiver(db, tenant)
      await seedMarketing(db, tenant)
    }
    console.log('[seed] class types…')
    await seedClassTypes(db)
    console.log('[seed] class packages…')
    await seedClassPackages(db)
    console.log('[seed] pt packages…')
    await seedPtPackages(db)
    console.log('[seed] corporate packages…')
    await seedCorporatePackages(db)
    // Last: the seeders above write explicit column lists that know nothing
    // about tenancy, so anything they just inserted is still unclaimed.
    console.log('[seed] claiming seeded rows for tenant #1…')
    await claimSeededRowsForTenantOne(db)
    console.log('[seed] done')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('[seed] failed:', err)
  process.exit(1)
})
