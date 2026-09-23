// Load `.env` here, not incidentally via the app import below: `TEST_DATABASE_URL`
// is read at module load, and without this a developer who set it in `be/.env`
// (as `.env.example` documents) would silently get a skipped integration suite
// and a green `npm run check`.
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import type { Hono } from 'hono'
import * as schema from '../db/schema'
import { APP_ROLE, ensureAppRole, ensureTenantIsolation } from '../db/roles'
import { TENANT_ONE_ID, SECOND_TENANT_ID } from '../db/schema/tenancy'
import { TENANT_ONE_SLUG, SECOND_TENANT_SLUG } from '../db/seed/provisioning'
// Type-only: loading the auth module itself before `stubEnvironment` would fail.
import type { AuthPool } from '../services/auth/better-auth'

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
  /**
   * Sign in through the real auth server, in-process, and get back the headers
   * a frontend on that studio's hostname would send — ready for `app.request()`.
   * `tenant` is null for the `platform` pool, which signs in on no studio.
   */
  signInAs: (pool: AuthPool, email: string, tenant: { slug: string } | null) => Promise<Record<string, string>>
  /**
   * Every line the app logged, parsed, since the last `clear()`. The root logger
   * writes here instead of stdout (`useLogDestination`), synchronously, so the
   * lines a request produced are all present once `app.request()` resolves.
   */
  logs: { lines: () => Array<Record<string, unknown>>; clear: () => void }
  close: () => Promise<void>
}

/**
 * Routes that exist only under the harness, for what no real route does on
 * demand. Under `/api/v1/me/`, so the member middlewares run in front of them
 * exactly as they do for a real member route.
 */
export const HARNESS_ROUTES = {
  /** Throws a plain `Error` — an unhandled error, as the error boundary sees one. */
  throw: '/api/v1/me/__harness/throw',
  /** Writes one `info` line through the root logger, from outside any middleware. */
  log: '/api/v1/me/__harness/log',
} as const

export const HARNESS_SERVICE_LOG_MESSAGE = 'harness: a line from a service'

let harnessRoutesMounted = false

async function mountHarnessRoutes(app: Hono): Promise<void> {
  if (harnessRoutesMounted) return
  harnessRoutesMounted = true
  const { logger } = await import('../shared/logger')
  // The shape of a service: a plain function that logs with the root logger and
  // is handed nothing about the request.
  const service = () => logger.info(HARNESS_SERVICE_LOG_MESSAGE)
  app.get(HARNESS_ROUTES.throw, () => {
    throw new Error('harness: deliberately unhandled')
  })
  app.get(HARNESS_ROUTES.log, c => {
    service()
    return c.json({ ok: true })
  })
}


/** The password every harness-made staff and platform account signs in with. */
export const HARNESS_PASSWORD = 'harness-password-not-a-secret'

/** The origins the local frontends use; `FRONTEND_URLS` below admits them. */
export const frontendOrigin = (pool: AuthPool, tenant: { slug: string } | null): string => {
  if (pool === 'platform') return 'http://admin.portal.localhost:3001'
  if (!tenant) throw new Error(`signInAs: the ${pool} pool signs in on a studio, and none was named`)
  return pool === 'client' ? `http://${tenant.slug}.localhost:3000` : `http://${tenant.slug}.portal.localhost:3001`
}

/**
 * The sign-in a person makes, done by the harness.
 *
 * Every pool gets its auth user and a credential with the harness password
 * written directly (a seeded or imported account has no password, and the
 * set-password flows are `better-auth.test.ts`'s and `member-passwords.test.ts`'s
 * to prove), then signs in with it over HTTP.
 *
 * Every step goes through the app, so the session is stamped by the same hook a
 * real sign-in is. What it does not do is link the auth user to a `clients` or
 * `staff_users` row: which rows a person has is the test's fixture to state.
 */
async function signInAs(
  app: Hono,
  db: PostgresJsDatabase<typeof schema>,
  pool: AuthPool,
  email: string,
  tenant: { slug: string } | null,
): Promise<Record<string, string>> {
  const origin = frontendOrigin(pool, tenant)
  // A client address of its own, as the proxy in front of the API would set.
  // Without one every sign-in in a test process shares the limiter's single
  // no-address bucket (#114), and a suite that signs in a dozen people is
  // throttled for doing so.
  const forwardedFor = harnessAddress()
  const fromFrontend: Record<string, string> =
    pool === 'platform'
      ? { Origin: origin, 'X-Forwarded-For': forwardedFor }
      : { Origin: origin, 'X-Tenant-Slug': tenant!.slug, 'X-Forwarded-For': forwardedFor }
  const post = (path: string, body: unknown) =>
    app.request(`/api/v1/auth/${pool}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...fromFrontend },
      body: JSON.stringify(body),
    })

  await ensureCredential(db, pool, email, tenant)
  const signedIn = await post('/sign-in/email', { email, password: HARNESS_PASSWORD })

  const token = signedIn.headers.get('set-auth-token')
  if (signedIn.status !== 200 || !token) {
    throw new Error(`signInAs: ${pool} sign-in for ${email} failed (${signedIn.status}): ${await signedIn.text()}`)
  }
  return { ...fromFrontend, Authorization: `Bearer ${token}` }
}

/**
 * A client address no other request in this process has used: one from the
 * 198.18.0.0/15 benchmarking range, which no real client comes from.
 */
let harnessAddresses = Math.floor(Math.random() * 60_000)
export function harnessAddress(): string {
  const n = harnessAddresses++
  return `198.${18 + ((n >> 16) & 1)}.${(n >> 8) & 255}.${n & 255}`
}

/**
 * The person's login in `pool` — at `tenant`, for the studio pools, whose logins
 * are per studio (#231) — with the harness password as its credential.
 */
async function ensureCredential(
  db: PostgresJsDatabase<typeof schema>,
  pool: AuthPool,
  email: string,
  tenant: { slug: string } | null,
): Promise<void> {
  const { ensureAuthUser } = await import('../services/auth/auth-users')
  const { hashPassword } = await import('better-auth/crypto')
  const name = email.split('@')[0]!
  const password = await hashPassword(HARNESS_PASSWORD)

  if (pool === 'platform') {
    const accounts = schema.platformAuthAccounts
    const userId = await ensureAuthUser(db, pool, { email, name })
    await db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    await db.insert(accounts).values({ id: randomUUID(), accountId: userId, providerId: 'credential', userId, password })
    return
  }

  const [studio] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, tenant!.slug))
  if (!studio) throw new Error(`signInAs: no studio has the slug ${tenant!.slug}`)
  const tenantId = studio.id
  const accounts = pool === 'client' ? schema.clientAuthAccounts : schema.staffAuthAccounts
  const userId = await ensureAuthUser(db, pool, { tenantId, email, name })
  await db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
  await db
    .insert(accounts)
    .values({ id: randomUUID(), accountId: userId, providerId: 'credential', userId, password, tenantId })
}

/**
 * `src/env.ts` validates the whole environment at import time, and importing
 * the app imports it. Fill in throwaway values for anything the tests don't
 * exercise — real values (a real `DATABASE_URL` above all) still win.
 */
const APP_ROLE_TEST_PASSWORD = 'booking_app_test'

/**
 * The same scratch database, reached as the application role.
 *
 * The harness itself keeps the owner connection — it has to migrate, and its
 * fixtures deliberately write across both tenants — while the app under test
 * gets the role that Row-Level Security actually applies to. Pointing both at
 * the owner is the one mistake that would make every isolation test pass
 * vacuously, so the two URLs are built apart here rather than shared.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function tenantNamedBy(arg: unknown): string | null {
  if (typeof arg === 'string') return UUID.test(arg) ? arg : null
  if (arg && typeof arg === 'object') {
    const candidate = (arg as { tenantId?: unknown }).tenantId
    if (typeof candidate === 'string' && UUID.test(candidate)) return candidate
  }
  return null
}

/**
 * Wrap a service module so each call runs inside the Tenant context it names —
 * the same context `resolveTenant` opens for a real request.
 *
 * Tests written before `signInAs` existed reach past HTTP, because the portal
 * routes were behind a vendor JWT this harness could not mint. A service
 * called that way has no request, and with Row-Level Security live a query with
 * no context set sees nothing — so the test would fail for the wrong reason, on
 * every assertion at once, and stop saying anything about isolation.
 *
 * The tenant is read off the call itself: every one of these functions already
 * takes it as its first argument, or on the input object, precisely because the
 * route has to pass the tenant it resolved. A call that names none is left
 * alone — `unwindRefund` is the deliberate case, since resolving its own tenant
 * from the payment intent is the behaviour under test.
 */
export function inTenantContext<T extends object>(module: T): T {
  return new Proxy(module, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== 'function') return value
      const call = value as (...args: unknown[]) => unknown
      return (...args: unknown[]) => {
        const tenantId = tenantNamedBy(args[0])
        if (!tenantId) return call(...args)
        // Imported here, not at the top of the file: `../db` builds its pool from
        // `DATABASE_APP_URL` at module load, and `stubEnvironment` has not run
        // yet when this file is first evaluated. By the time a test calls a
        // service the module is already resolved, so this is a cache hit.
        return import('../db').then(({ withTenant }) =>
          withTenant(tenantId, async () => call(...args)),
        )
      }
    },
  })
}

export function appRoleUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl)
  url.username = APP_ROLE
  url.password = APP_ROLE_TEST_PASSWORD
  return url.toString()
}

function stubEnvironment() {
  process.env.DATABASE_URL = TEST_DATABASE_URL
  process.env.DATABASE_APP_URL = appRoleUrl(TEST_DATABASE_URL!)
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

  // The database is this file's until `close`. The files share fixtures — the
  // two Tenants, name-matched purges, the row counts a studio delete is checked
  // against — so two at once (a parallel `npm run check`, or a second checkout
  // or session running the suite beside this one) fail each other at random.
  // Taken BEFORE the setup below, not after it: `ensureTenantIsolation` drops
  // and re-creates every table's policy, and a file setting up while another
  // runs left that one's writes, for a moment, facing RLS with no policy at all.
  // Held on this connection, so it goes when the process does even if a file
  // never reaches `close`. One `startTestApp` per process: a second would wait
  // on this one forever.
  await client`select pg_advisory_lock(${HARNESS_FILE_LOCK})`

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
    // Inside the same lock as the migration, and after it: the grants only reach
    // tables that already exist.
    await ensureAppRole(client, APP_ROLE_TEST_PASSWORD)
    // The deploy runs this immediately after the grants, so the harness does
    // too. Skipping it here would give the tests a database whose isolation is
    // *stronger* than production's on old tables and absent on new ones — the
    // one difference guaranteed to make an isolation suite lie.
    await ensureTenantIsolation(client)
    await seedAll(db)
  } finally {
    await client`select pg_advisory_unlock(${HARNESS_SETUP_LOCK})`
  }

  // Before the app is imported, so even its load-time lines are captured.
  const { useLogDestination } = await import('../shared/logger')
  let logged: string[] = []
  useLogDestination({
    write: (line: string) => {
      logged.push(line)
      // An unhandled error still reaches the terminal, or a test failing on a
      // 500 would say nothing about why.
      if (line.includes('"level":"error"')) process.stderr.write(line)
    },
  })

  const { default: app } = await import('../app')
  const { closeDb } = await import('../db')
  await mountHarnessRoutes(app)

  return {
    app,
    db,
    tenants: {
      one: { id: TENANT_ONE_ID, slug: TENANT_ONE_SLUG },
      two: { id: SECOND_TENANT_ID, slug: SECOND_TENANT_SLUG },
    },
    signInAs: (pool, email, tenant) => signInAs(app, db, pool, email, tenant),
    logs: {
      lines: () => logged.map(line => JSON.parse(line) as Record<string, unknown>),
      clear: () => {
        logged = []
      },
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
/** Held from setup to `close`: one harness-using file at a time. */
const HARNESS_FILE_LOCK = 4_120_932

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
