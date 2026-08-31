import './url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { appRolePassword } from './url'
import { APP_ROLE, ensureAppRole } from './roles'

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 })
  const db = drizzle(client)

  console.log('Applying migrations...')
  await migrate(db, { migrationsFolder: './src/db/migrations' })
  console.log('Migrations applied.')

  // After the migrations, never before: `GRANT … ON ALL TABLES` only reaches the
  // tables that exist when it runs, so a migration that adds one needs this to
  // follow it or the app role cannot see the new table at all.
  console.log(`Provisioning the ${APP_ROLE} role...`)
  await ensureAppRole(client, appRolePassword(process.env))
  console.log('Role provisioned.')

  await client.end()
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
