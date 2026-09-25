/**
 * `npm run test:db`: give this checkout a test database of its own.
 *
 * The integration harness takes a Postgres advisory lock on its database for
 * a whole run, so two checkouts pointed at one database wait on each other, or
 * worse. This creates `reservetoday-test-<checkout folder>` on the local
 * Postgres named by the POSTGRES_* values in `be/.env`, and writes
 * `TEST_DATABASE_URL` into `be/.env` when it is blank or missing. Safe to
 * re-run: an existing database is left alone, and a `TEST_DATABASE_URL`
 * already set is never rewritten; its database is created if it is missing.
 *
 * The harness migrates and seeds the database on first use; this only makes
 * it exist.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'
import postgres from 'postgres'

const beDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = join(beDir, '.env')

/** `reservetoday-test-<folder>`, lowercased, within Postgres's 63-byte limit. */
export function testDatabaseName(checkoutDir) {
  const folder = basename(checkoutDir)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!folder) throw new Error(`cannot name a database after the folder ${checkoutDir}`)
  return `reservetoday-test-${folder}`.slice(0, 63)
}

/** The owner URL for `database` on the server the POSTGRES_* values name. */
export function ownerUrl(vars, database) {
  const { POSTGRES_USER, POSTGRES_PASSWORD } = vars
  if (!POSTGRES_USER || !POSTGRES_PASSWORD) {
    throw new Error('be/.env needs POSTGRES_USER and POSTGRES_PASSWORD (see .env.example)')
  }
  const host = vars.POSTGRES_HOST || 'localhost'
  const port = vars.POSTGRES_PORT || '5432'
  const auth = `${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}`
  return `postgres://${auth}@${host}:${port}/${encodeURIComponent(database)}`
}

/**
 * `text` with `TEST_DATABASE_URL=<url>`: the blank line filled in place, or the
 * line added at the end. Keeps the file's own line endings.
 */
export function withTestDatabaseUrl(text, url) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const line = `TEST_DATABASE_URL=${url}`
  if (/^TEST_DATABASE_URL=[ \t]*$/m.test(text)) return text.replace(/^TEST_DATABASE_URL=[ \t]*$/m, line)
  const sep = text === '' || text.endsWith('\n') ? '' : eol
  return `${text}${sep}${line}${eol}`
}

async function main() {
  if (!existsSync(envFile)) {
    throw new Error('be/.env does not exist: copy be/.env.example to be/.env and fill in the [required] values first')
  }
  const text = readFileSync(envFile, 'utf8')
  const vars = parse(text)

  let url = vars.TEST_DATABASE_URL?.trim()
  const writeUrl = !url
  if (!url) url = ownerUrl(vars, testDatabaseName(dirname(beDir)))

  const target = new URL(url)
  const database = decodeURIComponent(target.pathname.replace(/^\//, ''))
  if (!database) throw new Error(`TEST_DATABASE_URL names no database: ${target.host}`)
  // The harness migrates, seeds and purges this database. Never the dev one.
  if (vars.POSTGRES_DB && database === vars.POSTGRES_DB) {
    throw new Error(`TEST_DATABASE_URL points at the development database ${database}; use a scratch database`)
  }

  const server = new URL(url)
  server.pathname = '/postgres'
  const sql = postgres(server.toString(), { max: 1, onnotice: () => {} })
  try {
    const [found] = await sql`select 1 from pg_database where datname = ${database}`
    if (found) console.log(`test database ${database} already exists on ${target.host}`)
    else {
      await sql`create database ${sql(database)}`
      console.log(`created test database ${database} on ${target.host}`)
    }
  } finally {
    await sql.end({ timeout: 5 })
  }

  if (writeUrl) {
    writeFileSync(envFile, withTestDatabaseUrl(text, url))
    console.log('wrote TEST_DATABASE_URL to be/.env')
  } else {
    console.log('TEST_DATABASE_URL was already set in be/.env; left as it is')
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error(`test:db: ${err.message}`)
    process.exit(1)
  })
}
