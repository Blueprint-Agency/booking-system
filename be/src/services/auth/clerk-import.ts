import { randomUUID } from 'node:crypto'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../../db/schema'
import type { AuthPool } from '../../db/enums'
import { isBcryptDigest } from './password-hash'

/**
 * The one-off move of Clerk's users into the Better Auth pools (#120). The CLI
 * that fetches the export and prints the report is `scripts/import-clerk-users.ts`;
 * everything that writes is here, so a test can run it on a hand-made export.
 *
 * Per pool, in one transaction:
 *
 *   1. **Users.** One auth user per exported address, found by address first —
 *      a seed or a sign-up since #112 may already have made it, and that user's
 *      id is the one kept.
 *   2. **Passwords** (staff, platform). Clerk's bcrypt digest, stored as it is
 *      on a credential account and verified by `verifyPoolPassword`, for a user
 *      who has no credential yet. One who has chosen a password since is left
 *      alone.
 *   3. **Rows.** `auth_user_id` written onto every `staff_users` / `clients` row
 *      whose `clerk_user_id` is an exported user and that has none. The
 *      platform pool has no rows: the super portal's gate is an email allowlist.
 *
 * Idempotent by construction — every step writes only what is missing — so a
 * second run reports zero of everything and changes nothing.
 *
 * Runs as the owner (`DATABASE_URL`): the mapping reads every Tenant's rows at
 * once, which is exactly what Row-Level Security exists to stop the app doing.
 */

/** One Clerk user, as the import needs them. */
export type ClerkExportedUser = {
  clerkId: string
  /** The primary address; null for a user Clerk holds with none (phone-only). */
  email: string | null
  name: string
  /** The bcrypt digest from Clerk's export, when there is one. */
  passwordDigest: string | null
  /** Clerk says this user has a password — whether or not a digest came with it. */
  passwordEnabled: boolean
  /** Clerk says this user has an authenticator app enrolled. Not exportable. */
  totpEnabled: boolean
}

export type UnmappedRow = {
  table: 'staff_users' | 'clients'
  tenantId: string
  rowId: string
  clerkUserId: string
}

export type PoolReport = {
  pool: AuthPool
  /** Users in Clerk's export. */
  exported: number
  /** Auth users this run created. */
  inserted: number
  /** Exported users whose address already had an auth user. */
  alreadyPresent: number
  /** Clerk ids of exported users with no address, so no auth user. */
  noEmail: string[]
  /** Credential accounts this run wrote from a Clerk digest. */
  passwordsCopied: number
  /** Addresses Clerk says have a password, with no bcrypt digest in the export: they need a reset. */
  passwordsMissing: string[]
  /** Addresses with an authenticator app in Clerk, which must enrol again. */
  totpReenrol: string[]
  /** Rows this run gave an `auth_user_id`. */
  mapped: number
  /** Rows with a `clerk_user_id` and still no `auth_user_id` after the run. */
  unmapped: UnmappedRow[]
}

export type ImportReport = {
  /** `APP_ENV` of the database the run was made against. */
  appEnv: string
  ranAt: string
  pools: Record<AuthPool, PoolReport>
}

export const IMPORT_POOLS: readonly AuthPool[] = ['staff', 'client', 'platform']

export function emptyPoolReport(pool: AuthPool): PoolReport {
  return {
    pool,
    exported: 0,
    inserted: 0,
    alreadyPresent: 0,
    noEmail: [],
    passwordsCopied: 0,
    passwordsMissing: [],
    totpReenrol: [],
    mapped: 0,
    unmapped: [],
  }
}

const TABLES = {
  client: { users: schema.clientAuthUsers, accounts: null, rows: schema.clients, rowTable: 'clients' },
  staff: { users: schema.staffAuthUsers, accounts: schema.staffAuthAccounts, rows: schema.staffUsers, rowTable: 'staff_users' },
  platform: { users: schema.platformAuthUsers, accounts: schema.platformAuthAccounts, rows: null, rowTable: null },
} as const

type Db = PostgresJsDatabase<typeof schema>

export async function importClerkPool(db: Db, pool: AuthPool, exported: ClerkExportedUser[]): Promise<PoolReport> {
  const report = emptyPoolReport(pool)
  report.exported = exported.length
  const { users, accounts, rows, rowTable } = TABLES[pool]

  await db.transaction(async tx => {
    for (const user of exported) {
      const email = user.email?.trim().toLowerCase()
      if (!email) {
        report.noEmail.push(user.clerkId)
        continue
      }

      const created = await tx
        .insert(users)
        .values({ id: randomUUID(), email, name: user.name || email.split('@')[0]!, emailVerified: true })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id })
      if (created.length) report.inserted++
      else report.alreadyPresent++
      const [found] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
      const authUserId = found!.id

      if (accounts) {
        if (user.totpEnabled) report.totpReenrol.push(email)
        const digest = user.passwordDigest && isBcryptDigest(user.passwordDigest) ? user.passwordDigest : null
        if (!digest) {
          if (user.passwordEnabled) report.passwordsMissing.push(email)
        } else {
          const [credential] = await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.userId, authUserId), eq(accounts.providerId, 'credential')))
            .limit(1)
          if (!credential) {
            await tx.insert(accounts).values({
              id: randomUUID(),
              accountId: authUserId,
              providerId: 'credential',
              userId: authUserId,
              password: digest,
            })
            report.passwordsCopied++
          }
        }
      }

      if (rows) {
        // Not where that Tenant already has a row on this auth user — a member who
        // registered through Better Auth beside their Clerk-era row. That row stays
        // unmapped and the report names it, rather than the unique index failing
        // the whole pool.
        const mapped = await tx
          .update(rows)
          .set({ authUserId })
          .where(
            and(
              eq(rows.clerkUserId, user.clerkId),
              isNull(rows.authUserId),
              sql`not exists (select 1 from ${rows} as taken where taken.tenant_id = ${rows.tenantId} and taken.auth_user_id = ${authUserId})`,
            ),
          )
          .returning({ id: rows.id })
        report.mapped += mapped.length
      }
    }

    if (rows && rowTable) {
      const left = await tx
        .select({ tenantId: rows.tenantId, rowId: rows.id, clerkUserId: rows.clerkUserId })
        .from(rows)
        .where(and(isNotNull(rows.clerkUserId), isNull(rows.authUserId)))
      report.unmapped = left.map(row => ({ table: rowTable, ...row, clerkUserId: row.clerkUserId! }))
    }
  })

  return report
}

/**
 * Did the run account for everyone? Every exported user became or found an auth
 * user, and no row with a Clerk id is left without an auth id.
 */
export function reportIsClean(report: ImportReport): boolean {
  // A run that exported nobody at all read the wrong applications, not a clean platform.
  if (IMPORT_POOLS.every(pool => !report.pools[pool]?.exported)) return false
  return IMPORT_POOLS.every(pool => {
    const r = report.pools[pool]
    return r !== undefined && r.unmapped.length === 0 && r.exported === r.inserted + r.alreadyPresent
  })
}

export function changedAnything(report: ImportReport): boolean {
  return Object.values(report.pools).some(r => r.inserted > 0 || r.passwordsCopied > 0 || r.mapped > 0)
}

/**
 * Why a run against this environment must not go ahead, or null.
 *
 * Only production is gated, and only on a staging report that is clean: staging
 * holds the real users until cutover, so it is the rehearsal, and a production
 * run is allowed once the rehearsal accounted for everyone.
 */
export function productionRefusal(appEnv: string, stagingReport: ImportReport | null): string | null {
  // Named, not defaulted: a typo such as `prod` must not read as "not production".
  if (!['development', 'staging', 'production'].includes(appEnv)) {
    return `refused: APP_ENV must be development, staging or production, not "${appEnv}"`
  }
  if (appEnv !== 'production') return null
  if (!stagingReport) return 'production run refused: it needs a clean staging report (--staging-report <file>)'
  if (stagingReport.appEnv !== 'staging') {
    return `production run refused: the report given was made on ${stagingReport.appEnv}, not staging`
  }
  if (!reportIsClean(stagingReport)) {
    return 'production run refused: the staging report is not clean (unmapped rows, or exports not accounted for)'
  }
  return null
}

/**
 * The bcrypt digests in a Clerk dashboard user export (CSV), by Clerk user id.
 *
 * Clerk's API does not return password digests; the dashboard's export does, in
 * `password_digest` beside `password_hasher`. Only `bcrypt` rows are kept — it is
 * the one hasher `verifyPoolPassword` understands.
 */
export function bcryptDigestsFromCsv(csv: string): Map<string, string> {
  const [header, ...lines] = parseCsv(csv)
  const digests = new Map<string, string>()
  if (!header) return digests
  const col = (name: string) => header.indexOf(name)
  const [idCol, digestCol, hasherCol] = [col('id'), col('password_digest'), col('password_hasher')]
  if (idCol < 0 || digestCol < 0) throw new Error('Clerk export: expected `id` and `password_digest` columns')
  for (const line of lines) {
    const id = line[idCol]
    const digest = line[digestCol]
    const hasher = hasherCol < 0 ? 'bcrypt' : line[hasherCol]
    if (id && digest && hasher === 'bcrypt' && isBcryptDigest(digest)) digests.set(id, digest)
  }
  return digests
}

/** RFC 4180: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      record.push(field)
      if (record.some(f => f !== '')) records.push(record)
      record = []
      field = ''
    } else field += ch
  }
  record.push(field)
  if (record.some(f => f !== '')) records.push(record)
  return records
}
