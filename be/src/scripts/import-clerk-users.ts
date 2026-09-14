import '../db/url'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createClerkClient, type User } from '@clerk/backend'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'
import type { AuthPool } from '../db/enums'
import {
  bcryptDigestsFromCsv,
  changedAnything,
  IMPORT_POOLS,
  importClerkPool,
  productionRefusal,
  reportIsClean,
  type ClerkExportedUser,
  type ImportReport,
} from '../services/auth/clerk-import'

/**
 * Move every Clerk user into the Better Auth pools, once per environment (#120).
 * Staging first, with a backup taken; then production, which refuses to run
 * without the clean report staging wrote.
 *
 *   npm run auth:import-clerk -- \
 *     --staff-csv staff-export.csv --platform-csv platform-export.csv \
 *     [--report clerk-import-staging.json] [--staging-report clerk-import-staging.json]
 *
 * Reads, from the environment:
 *   - `DATABASE_URL`  the owner, as for migrations and seeds
 *   - `APP_ENV`       `staging` or `production`; production is gated
 *   - `CLERK_STAFF_SECRET_KEY`, `CLERK_CLIENT_SECRET_KEY`, `CLERK_PLATFORM_SECRET_KEY`
 *                     one per Clerk application. The platform key left `env.ts`
 *                     with #116, so it is read here only, for this run.
 *
 * The users come from each application's Backend API. Their password digests do
 * not — Clerk's API never returns them — so the staff and platform CSVs are the
 * dashboard's user export, which carries `password_digest`. Members sign in by
 * code and need no CSV. A staff member Clerk says has a password but whose digest
 * is missing is listed, and sets one through the reset.
 *
 * Every pool is written in its own transaction; the report is printed, and saved
 * to `--report` for the production run to be handed.
 */

const SECRET_KEYS: Record<AuthPool, string> = {
  staff: 'CLERK_STAFF_SECRET_KEY',
  client: 'CLERK_CLIENT_SECRET_KEY',
  platform: 'CLERK_PLATFORM_SECRET_KEY',
}

async function exportPool(pool: AuthPool, csvPath: string | undefined): Promise<ClerkExportedUser[]> {
  const secretKey = process.env[SECRET_KEYS[pool]]
  if (!secretKey) throw new Error(`${SECRET_KEYS[pool]} is required to export the ${pool} Clerk application`)
  const clerk = createClerkClient({ secretKey })
  const digests = csvPath ? bcryptDigestsFromCsv(readFileSync(csvPath, 'utf8')) : new Map<string, string>()

  const users: User[] = []
  const limit = 500
  for (let offset = 0; ; offset += limit) {
    const page = await clerk.users.getUserList({ limit, offset, orderBy: 'created_at' })
    users.push(...page.data)
    if (page.data.length < limit) break
  }

  return users.map(user => ({
    clerkId: user.id,
    email: user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null,
    name: user.fullName ?? '',
    passwordDigest: digests.get(user.id) ?? null,
    passwordEnabled: user.passwordEnabled,
    totpEnabled: user.totpEnabled,
  }))
}

function printReport(report: ImportReport): void {
  console.log(`\n[clerk-import] ${report.appEnv}, ${report.ranAt}`)
  for (const pool of IMPORT_POOLS) {
    const r = report.pools[pool]
    console.log(
      `  ${pool.padEnd(8)} exported ${r.exported}  inserted ${r.inserted}  already present ${r.alreadyPresent}` +
        `  passwords copied ${r.passwordsCopied}  mapped ${r.mapped}  unmapped ${r.unmapped.length}`,
    )
    if (r.noEmail.length) console.log(`    no email, not imported: ${r.noEmail.join(', ')}`)
    for (const row of r.unmapped) {
      console.log(`    unmapped: ${row.table} ${row.rowId} (tenant ${row.tenantId}, clerk ${row.clerkUserId})`)
    }
    if (r.passwordsMissing.length) console.log(`    no digest, must reset password: ${r.passwordsMissing.join(', ')}`)
    if (r.totpReenrol.length) console.log(`    had an authenticator app, must re-enrol 2FA: ${r.totpReenrol.join(', ')}`)
  }
  console.log(changedAnything(report) ? '  changes written.' : '  nothing changed — already imported.')
  console.log(reportIsClean(report) ? '  clean: every export accounted for, unmapped = 0.' : '  NOT CLEAN — see above.')
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      'staff-csv': { type: 'string' },
      'platform-csv': { type: 'string' },
      report: { type: 'string' },
      'staging-report': { type: 'string' },
    },
  })
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (the owner) is required')
  const appEnv = process.env.APP_ENV ?? 'development'

  const stagingReport = args['staging-report']
    ? (JSON.parse(readFileSync(args['staging-report'], 'utf8')) as ImportReport)
    : null
  const refusal = productionRefusal(appEnv, stagingReport)
  if (refusal) throw new Error(refusal)

  // Every export before any write, so an unreachable application stops the run
  // before a single pool has changed.
  const exports = {
    staff: await exportPool('staff', args['staff-csv']),
    client: await exportPool('client', undefined),
    platform: await exportPool('platform', args['platform-csv']),
  }

  const client = postgres(process.env.DATABASE_URL, { max: 1 })
  try {
    const db = drizzle(client, { schema })
    const pools = {} as ImportReport['pools']
    for (const pool of IMPORT_POOLS) pools[pool] = await importClerkPool(db, pool, exports[pool])
    const report: ImportReport = { appEnv, ranAt: new Date().toISOString(), pools }

    printReport(report)
    const reportPath = args.report ?? `clerk-import-${appEnv}.json`
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`  report saved to ${reportPath}`)
    if (!reportIsClean(report)) process.exitCode = 1
  } finally {
    await client.end({ timeout: 5 })
  }
}

main().catch(err => {
  console.error('[clerk-import] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
