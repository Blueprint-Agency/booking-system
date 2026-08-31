// Load `.env` here, not incidentally via the app import below: `TEST_DATABASE_URL`
// is read at module load, and without this a developer who set it in `be/.env`
// (as `.env.example` documents) would silently get a skipped integration suite
// and a green `npm run check`.
import 'dotenv/config'
import path from 'node:path'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import type { Hono } from 'hono'
import * as schema from '../db/schema'
import {
  TENANT_ONE_ID,
  TENANT_ONE_SLUG,
  SECOND_TENANT_ID,
  SECOND_TENANT_SLUG,
} from '../db/schema/tenancy'

/**
 * The one integration seam: the real Hono app, invoked in-process with
 * `app.request()`, against a real Postgres holding **two** tenants.
 *
 * Two, not one. A single-tenant fixture cannot reveal a leak — every missing
 * `WHERE tenant_id = ?` looks correct when there is only one tenant's data to
 * return. Every isolation test written from here on depends on the second
 * tenant existing.
 *
 * Point `TEST_DATABASE_URL` at a scratch database (never a database you care
 * about — the harness migrates it and writes to it). Without it the
 * integration tests skip, so `npm run check` still runs everywhere.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
export const integrationTestsEnabled = Boolean(TEST_DATABASE_URL)
export const SKIP_REASON =
  'set TEST_DATABASE_URL to a scratch Postgres database to run the integration tests'

export type TestApp = {
  app: Hono
  db: PostgresJsDatabase<typeof schema>
  /** The two tenants every isolation test compares against. */
  tenants: {
    one: { id: string; slug: string }
    two: { id: string; slug: string }
  }
  close: () => Promise<void>
}

/**
 * `src/env.ts` validates the whole environment at import time, and importing
 * the app imports it. Fill in throwaway values for anything the tests don't
 * exercise — real values (a real `DATABASE_URL` above all) still win.
 */
function stubEnvironment() {
  process.env.DATABASE_URL = TEST_DATABASE_URL
  process.env.NODE_ENV ??= 'test'
  // Never 'production': that is what gates the second tenant, and a one-tenant
  // fixture would let every isolation test pass vacuously.
  process.env.APP_ENV = 'development'
  process.env.SUPERADMIN_EMAIL ??= 'superadmin@example.test'
  process.env.CLERK_STAFF_PUBLISHABLE_KEY ??= 'pk_test_harness'
  process.env.CLERK_STAFF_SECRET_KEY ??= 'sk_test_harness'
  process.env.CLERK_STAFF_WEBHOOK_SECRET ??= 'whsec_test_harness'
  process.env.IMPERSONATION_SECRET ??= 'test-harness-impersonation-secret-key'
  process.env.PORTAL_ORIGIN ??= 'http://localhost:3001'
  process.env.CLIENT_ORIGIN ??= 'http://localhost:3000'
  process.env.SMTP_USER ??= 'smtp@example.test'
  process.env.SMTP_PASSWORD ??= 'smtp-password'
}

/**
 * Migrate + seed the scratch database, then hand back the app.
 *
 * The app builds its own connection pool from `DATABASE_URL`, so the
 * environment is stubbed *before* it is imported — hence the dynamic import.
 * Anything else that reaches the database (services, seeds) must be imported
 * the same way, after this resolves.
 */
export async function startTestApp(): Promise<TestApp> {
  if (!TEST_DATABASE_URL) throw new Error(SKIP_REASON)
  stubEnvironment()

  const client = postgres(TEST_DATABASE_URL, { max: 1 })
  const db = drizzle(client, { schema })

  // `node --test` runs one process per file, and every harness-using file points
  // at the SAME scratch database — so two of them migrate it at the same time.
  // Concurrent DDL does not merely race: one transaction holds the lock on a
  // type the other is creating, the loser's migration rolls back, its `before`
  // throws, and the whole file's tests are cancelled with the runner hanging on
  // the dead child. Serialising migrate-and-seed behind one advisory lock is
  // what makes `npm run check` finish with `TEST_DATABASE_URL` set; the second
  // holder finds the migrations applied and the seeds idempotent, so it is a
  // wait, not a second run.
  await client`select pg_advisory_lock(${HARNESS_SETUP_LOCK})`
  try {
    // Same folder `npm run db:migrate` uses, and the same assumption: run from
    // the `be/` package root.
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'src/db/migrations') })
    await seedAll(db)
  } finally {
    await client`select pg_advisory_unlock(${HARNESS_SETUP_LOCK})`
  }

  const { default: app } = await import('../app')
  const { closeDb } = await import('../db')

  return {
    app,
    db,
    tenants: {
      one: { id: TENANT_ONE_ID, slug: TENANT_ONE_SLUG },
      two: { id: SECOND_TENANT_ID, slug: SECOND_TENANT_SLUG },
    },
    close: async () => {
      await closeDb()
      await client.end({ timeout: 5 })
    },
  }
}

/** Arbitrary, but fixed: every harness process has to pick the same number for
 *  the lock to mean anything. */
const HARNESS_SETUP_LOCK = 4_120_931

async function seedAll(db: PostgresJsDatabase<typeof schema>): Promise<void> {
  // Dynamic: the seed validates `env.APP_ENV`, so it must not be imported
  // before the environment above is in place.
  const { seedTenants, seededTenants } = await import('../db/seed/tenants')
  await seedTenants(db)

  // The per-tenant provisioning seeds, so both tenants own the fixtures an
  // isolation test compares: their own premises, their own rooms and their own
  // policy row. Without them the second tenant is an empty shell and "one tenant
  // cannot read another's rows" passes for the wrong reason.
  const { seedLocations } = await import('../db/seed/locations')
  const { seedRooms } = await import('../db/seed/rooms')
  const { seedPolicy } = await import('../db/seed/policy')
  const { seedEmailTemplates } = await import('../db/seed/email-templates')
  const { seedWaiver } = await import('../db/seed/waiver')
  const { seedMarketing } = await import('../db/seed/marketing')
  for (const tenant of seededTenants()) {
    await seedLocations(db, tenant)
    await seedRooms(db, tenant)
    await seedPolicy(db, tenant)
    // A tenant's own content, for the same reason: an email template resolved
    // by (tenant, slug) is missing for tenant #2 unless it is seeded for
    // tenant #2, and a leave decision that cannot render is a test failure
    // about the wrong thing.
    await seedEmailTemplates(db, tenant)
    await seedWaiver(db, tenant)
    await seedMarketing(db, tenant)
  }
}
