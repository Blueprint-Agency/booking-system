import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'dotenv'

/**
 * The test run's environment, in place before any module reads it.
 *
 * `src/env.ts` validates the environment once, at import, and `src/db/index.ts`
 * builds its pool from `DATABASE_APP_URL` the same way. In a run of one process
 * (`--experimental-test-isolation=none`) every test file is imported
 * before the first test runs, and a unit test that imports a service imports
 * both. So stubbing when the first integration test starts is too late: the app
 * would already hold the developer's `.env` database and `NODE_ENV`.
 *
 * Hence a module of its own that imports nothing from the project (a relative
 * import is not resolved in a `--import` preload under `node --test`):
 * `npm run check` preloads it (`--import ./src/test/environment.ts`), and the
 * harness imports it first, so a file run on its own gets the same.
 *
 * It is the whole of the test run's environment, the same locally as in CI:
 * the one value read from `be/.env` is `TEST_DATABASE_URL`. Everything else a
 * developer's `.env` holds — real Stripe and R2 keys, their own
 * `PLATFORM_ADMIN_EMAIL` — never reaches a test, because `src/db/url.ts` loads
 * no `.env` when `NODE_ENV` is `test`, and this sets it.
 *
 * Point `TEST_DATABASE_URL` at a scratch database (never a database you care
 * about — the harness migrates it and writes to it; `npm run test:db` makes one
 * for this checkout). Without it the integration tests skip.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || dotenvTestDatabaseUrl()
export const integrationTestsEnabled = Boolean(TEST_DATABASE_URL)
export const SKIP_REASON =
  'set TEST_DATABASE_URL to a scratch Postgres database to run the integration tests (npm run test:db)'

/**
 * `APP_ROLE` in `src/db/roles.ts`, written out because this file imports nothing.
 * The harness refuses to start if the two differ.
 */
export const APP_ROLE_NAME = 'booking_app'

/** The password the harness gives the app role on the scratch database. */
export const APP_ROLE_TEST_PASSWORD = 'booking_app_test'

/**
 * The same scratch database, reached as the application role.
 *
 * The harness itself keeps the owner connection — it has to migrate, and its
 * fixtures deliberately write across both tenants — while the app under test
 * gets the role that Row-Level Security actually applies to. Pointing both at
 * the owner is the one mistake that would make every isolation test pass
 * vacuously, so the two URLs are built apart here rather than shared.
 */
export function appRoleUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl)
  url.username = APP_ROLE_NAME
  url.password = APP_ROLE_TEST_PASSWORD
  return url.toString()
}

/**
 * Every setting that would reach a real service: a payment provider, the R2
 * bucket, a webhook's signing secret, the super portal's allowlist. Unset for a
 * test run; a test that needs one sets it itself, through `withEnv`
 * (`./with-env.ts`).
 */
export const REAL_SERVICE_SETTINGS = [
  'STRIPE_API_URL',
  'PAYMENT_CREDENTIALS_KEY',
  'RESEND_WEBHOOK_SECRET',
  'PLATFORM_ADMIN_EMAIL',
] as const

/**
 * Stands in for the database URLs when there is no `TEST_DATABASE_URL`: the
 * integration tests skip, and a unit test that queried anyway fails to connect
 * rather than reaching whatever database the shell names. `.invalid` never
 * resolves (RFC 2606).
 */
const NO_DATABASE_URL = 'postgres://no-test-database.invalid/unset'

/** `TEST_DATABASE_URL` from `be/.env`, wherever the run starts, and nothing else from it. */
function dotenvTestDatabaseUrl(): string | undefined {
  let text: string
  try {
    text = readFileSync(join(__dirname, '..', '..', '.env'), 'utf8')
  } catch {
    return undefined
  }
  return parse(text).TEST_DATABASE_URL?.trim() || undefined
}

/**
 * Put the test run's environment in place: set, never defaulted, so a value in
 * the shell cannot make a local run differ from CI's.
 *
 * Once, at this module's load, and never again: a later call would undo a
 * `withEnv` that has since set one of the values cleared here.
 */
function stubEnvironment(): void {
  if (TEST_DATABASE_URL) {
    process.env.TEST_DATABASE_URL = TEST_DATABASE_URL
    process.env.DATABASE_URL = TEST_DATABASE_URL
    process.env.DATABASE_APP_URL = appRoleUrl(TEST_DATABASE_URL)
  } else {
    process.env.DATABASE_URL = NO_DATABASE_URL
    process.env.DATABASE_APP_URL = NO_DATABASE_URL
  }
  // The one flag the mailer reads to stay off Resend — see lib/mailer.ts.
  // When it was defaulted rather than set, every templated email a test
  // triggered went out for real and bounced back into the platform inbox. It is
  // also what keeps `src/db/url.ts` from loading `.env`.
  process.env.NODE_ENV = 'test'
  // Never 'production': that is what gates the second tenant, and a one-tenant
  // fixture would let every isolation test pass vacuously.
  process.env.APP_ENV = 'development'
  process.env.IMPERSONATION_SECRET = 'test-harness-impersonation-secret-key'
  process.env.BETTER_AUTH_SECRET = 'test-harness-better-auth-secret-key-0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:4000'
  // The tenant subdomain shape the local frontends use, so a test can send a
  // real `Origin` and have it name a tenant — which is the whole of the
  // validation on public routes. The two exact origins are the bare local
  // hosts, which name no tenant and fall back to tenant #1.
  process.env.FRONTEND_URLS =
    'http://*.localhost:3000,http://*.portal.localhost:3001,http://localhost:3000,http://localhost:3001'
  process.env.RESEND_API_KEY = 're_test_harness'
  for (const name of REAL_SERVICE_SETTINGS) delete process.env[name]
  for (const name of Object.keys(process.env)) if (name.startsWith('R2_')) delete process.env[name]
}

stubEnvironment()
