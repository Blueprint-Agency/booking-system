import './url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { appRolePassword } from './url'
import { APP_ROLE, ensureAppRole, ensureTenantIsolation } from './roles'

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

  // Beside the grants, and for the same reason. The grants reach a new table
  // automatically; its Row-Level Security policy does not. Left to a migration
  // author to remember, the failure is a table readable across every studio
  // that no test notices, because an absent policy refuses nothing.
  console.log('Enforcing tenant isolation...')
  const policed = await ensureTenantIsolation(client)
  console.log(`Tenant isolation enforced on ${policed.length} tables.`)

  await client.end()
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
