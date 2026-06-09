import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../schema'

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
    console.log('[seed] superadmin…')
    await seedSuperadmin(db)
    console.log('[seed] locations…')
    await seedLocations(db)
    console.log('[seed] rooms…')
    await seedRooms(db)
    console.log('[seed] class types…')
    await seedClassTypes(db)
    console.log('[seed] class packages…')
    await seedClassPackages(db)
    console.log('[seed] pt packages…')
    await seedPtPackages(db)
    console.log('[seed] corporate packages…')
    await seedCorporatePackages(db)
    console.log('[seed] policy + pt booking config…')
    await seedPolicy(db)
    console.log('[seed] email templates…')
    await seedEmailTemplates(db)
    console.log('[seed] waiver singleton…')
    await seedWaiver(db)
    console.log('[seed] marketing singleton…')
    await seedMarketing(db)
    console.log('[seed] done')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('[seed] failed:', err)
  process.exit(1)
})
