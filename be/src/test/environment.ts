// Load `.env` here, not incidentally via the app import: `TEST_DATABASE_URL` is
// read at module load, and without this a developer who set it in `be/.env`
// (as `.env.example` documents) would silently get a skipped integration suite
// and a green `npm run check`.
import 'dotenv/config'

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
 * Point `TEST_DATABASE_URL` at a scratch database (never a database you care
 * about — the harness migrates it and writes to it; `npm run test:db` makes one
 * for this checkout). Without it nothing here is stubbed, and the integration
 * tests skip.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
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
 * Point the app at the scratch database, and fill in throwaway values for
 * anything the tests don't exercise — real values still win where defaulted.
 * Idempotent.
 */
export function stubEnvironment(): void {
  if (!TEST_DATABASE_URL) return
  process.env.DATABASE_URL = TEST_DATABASE_URL
  process.env.DATABASE_APP_URL = appRoleUrl(TEST_DATABASE_URL)
  // Forced, not defaulted: `.env` (loaded above) says `development`, and this
  // is the one flag the mailer reads to stay off Resend — see
  // lib/mailer.ts. With `??=` every templated email a test triggered went out
  // for real and bounced back into the platform inbox.
  process.env.NODE_ENV = 'test'
  // Never 'production': that is what gates the second tenant, and a one-tenant
  // fixture would let every isolation test pass vacuously.
  process.env.APP_ENV = 'development'
  process.env.IMPERSONATION_SECRET ??= 'test-harness-impersonation-secret-key'
  process.env.BETTER_AUTH_SECRET ??= 'test-harness-better-auth-secret-key-0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:4000'
  // The tenant subdomain shape the local frontends use, so a test can send a
  // real `Origin` and have it name a tenant — which is the whole of the
  // validation on public routes. The two exact origins are the bare local
  // hosts, which name no tenant and fall back to tenant #1.
  process.env.FRONTEND_URLS ??=
    'http://*.localhost:3000,http://*.portal.localhost:3001,http://localhost:3000,http://localhost:3001'
  process.env.RESEND_API_KEY ??= 're_test_harness'
}

stubEnvironment()
