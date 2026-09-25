// First, before anything that could import `src/env.ts` or `src/db`: the test
// environment has to be in place when they are evaluated. See ./environment.
import { APP_ROLE_NAME, APP_ROLE_TEST_PASSWORD, stubEnvironment, TEST_DATABASE_URL, SKIP_REASON } from './environment'
import { randomUUID } from 'node:crypto'
import { after } from 'node:test'
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
export { appRoleUrl, integrationTestsEnabled, SKIP_REASON, TEST_DATABASE_URL } from './environment'

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
  /**
   * What time the app thinks it is (`lib/clock`). `set` stands every service
   * that applies a time window — cancellation policy, package validity, the
   * scheduled jobs — at one fixed instant until the next `set`; `advance` moves
   * it on; `reset` puts the wall clock back. `close` resets it too.
   *
   * Only the rules read it. Postgres defaults (`created_at`) and the auth
   * server's session expiry keep real time, so a test can move far from today
   * without its sign-in going stale.
   */
  clock: { set: (at: Date) => void; advance: (ms: number) => void; now: () => Date; reset: () => void }
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
  // The module, not its `logger`: that binding is replaced per file
  // (`useLogDestination`), and a copy taken here would write to the first
  // file's `logs` for the rest of the run.
  const logging = await import('../shared/logger')
  // The shape of a service: a plain function that logs with the root logger and
  // is handed nothing about the request.
  const service = () => logging.logger.info(HARNESS_SERVICE_LOG_MESSAGE)
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

type Shared = {
  client: postgres.Sql
  db: PostgresJsDatabase<typeof schema>
  app: Hono
  closeDb: () => Promise<void>
  now: () => Date
  setClock: (next: (() => Date) | null) => void
  useLogDestination: (destination: { write: (line: string) => void }) => void
  /** Put back the in-process memos, seams and kept mail a fresh process would start with. */
  forgetCaches: () => void
}

/**
 * The run's one owner connection and app, shared by every file in it.
 *
 * When every test file runs in one process (`--experimental-test-isolation=none`),
 * migrating, seeding and importing the app per file would repeat the expensive
 * part of a run seventy times over. The first `startTestApp` does it;
 * the rest get the same app back. A promise, so two callers racing the first
 * setup share it rather than running it twice.
 */
let shared: Promise<Shared> | null = null
let appLoads = 0

/** How many times this process imported the app: one, however many files ran. */
export function harnessAppLoads(): number {
  return appLoads
}

/**
 * Where the root logger writes between files, and after the last one: errors
 * still reach the terminal, everything else goes nowhere. A file's `logs` stops
 * collecting when the file closes, so it never holds the next file's lines.
 */
const betweenFiles = {
  write: (line: string) => {
    if (line.includes('"level":"error"')) process.stderr.write(line)
  },
}

async function setUp(): Promise<Shared> {
  if (APP_ROLE_NAME !== APP_ROLE) {
    throw new Error(`test/environment.ts names the app role ${APP_ROLE_NAME}, db/roles.ts ${APP_ROLE}: make them agree`)
  }
  stubEnvironment()

  const client = postgres(TEST_DATABASE_URL!, { max: 1 })
  const db = drizzle(client, { schema })

  // The database is this run's until its last file has finished. The files
  // share fixtures — the two Tenants, name-matched purges, the row counts a
  // studio delete is checked against — so two runs at once on one database (a
  // second session running tests in the same checkout) fail each other at
  // random. Taken BEFORE the setup below, not after it: `ensureTenantIsolation`
  // drops and re-creates every table's policy, and a run setting up while
  // another ran left that one's writes, for a moment, facing RLS with no policy
  // at all. Held on this connection, so it goes when the process does even if
  // the run never reaches its teardown.
  //
  // Per run, not per file: the app is loaded once, and releasing the database
  // between files would let another run re-create the policies under this
  // one's next file. `npm run test:db` gives each checkout its own database, so
  // two checkouts never meet here.
  await client`select pg_advisory_lock(${HARNESS_RUN_LOCK})`

  // Serialises migrate-and-seed across processes on one database. Concurrent
  // DDL does not merely race: one transaction holds the lock on a type the
  // other is creating, the loser's migration rolls back, and every test behind
  // it is cancelled. The second holder finds the migrations applied and the
  // seeds idempotent, so it is a wait, not a second run.
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

  // The logger was pointed at the first file's `logs` before this ran, so
  // the app's load-time lines land there, as they did with a process per file.
  const { useLogDestination } = await import('../shared/logger')
  const { default: app } = await import('../app')
  appLoads++
  const { closeDb } = await import('../db')
  const { now, setClock } = await import('../lib/clock')
  const { forgetCachedTenants } = await import('../services/tenants/tenants')
  const { forgetCachedMailIdentity } = await import('../services/tenants/mail-identity')
  const { setProviderCredentialsLoader } = await import('../services/billing/provider-credentials')
  const { setStripeFactory } = await import('../lib/stripe')
  const { discardedMail } = await import('../lib/mailer')
  await mountHarnessRoutes(app)

  return {
    client,
    db,
    app,
    closeDb,
    now,
    setClock,
    useLogDestination,
    forgetCaches: () => {
      forgetCachedTenants()
      forgetCachedMailIdentity()
      // Both put the real one back and clear their memo.
      setProviderCredentialsLoader(null)
      setStripeFactory(null)
      // The mail the null transport kept. It is capped, so once a run has sent
      // that much its length stops growing, and a file counting "mail sent
      // since" by index would see none of its own.
      discardedMail.length = 0
    },
  }
}

/** Files that have started and not yet closed. */
let openFiles = 0
/** Set once the run's root `after` has fired: the next last `close` ends it. */
let runOver = false

/** End both pools, which releases the run lock with the connection holding it. */
async function tearDown(): Promise<void> {
  if (!shared) return
  const pending = shared
  shared = null
  const { client, closeDb, setClock } = await pending
  setClock(null)
  await closeDb()
  await client.end({ timeout: 5 })
}

/**
 * The end of the run: on the root test, so in a one-process run it fires once,
 * after the last file, and with a process per file at the end of each.
 *
 * Reference-counted against `close`: this hook was registered when the harness
 * was first imported, so it runs before any root-level `after` a file
 * registered itself, and that hook may still clean up through `harness.db`
 * before it closes. So a file still open here keeps the pools, and its own
 * `close` ends them.
 */
after(async () => {
  runOver = true
  if (openFiles === 0) await tearDown()
})

/**
 * Migrate + seed the scratch database, then hand back the app.
 *
 * Once per run: the first call does the work, and every later one (the next
 * file, in a one-process run) gets the same app, database and connection back.
 * What belongs to a file is fresh per call: its `logs`, a clock on the wall, and
 * the in-process memos and seams (tenant lookups, mail identities, payment
 * credentials, the Stripe client, the mail the null transport kept) a process
 * of its own would have started with.
 *
 * The app builds its own connection pool from `DATABASE_URL`, so the
 * environment is stubbed *before* it is imported — hence the dynamic import.
 * Anything else that reaches the database (services, seeds) must be imported
 * the same way, after this resolves.
 */
export async function startTestApp(): Promise<TestApp> {
  if (!TEST_DATABASE_URL) throw new Error(SKIP_REASON)

  // This file's lines from here on, the app's load-time lines included when
  // this is the call that loads it. The logger module reads the environment
  // `./environment` has already stubbed, so it is safe to load first.
  let logged: string[] = []
  const { useLogDestination: collectInto } = await import('../shared/logger')
  collectInto({
    write: (line: string) => {
      logged.push(line)
      // An unhandled error still reaches the terminal, or a test failing on a
      // 500 would say nothing about why.
      if (line.includes('"level":"error"')) process.stderr.write(line)
    },
  })

  shared ??= setUp()
  const pending = shared
  let run: Shared
  try {
    run = await pending
  } catch (err) {
    // A failed setup is not kept: the next file tries again, and fails on its
    // own account rather than on this one's stale rejection.
    if (shared === pending) shared = null
    throw err
  }
  const { app, db, now, setClock, useLogDestination, forgetCaches } = run

  openFiles++
  setClock(null)
  forgetCaches()

  const fixClockAt = (at: Date) => {
    const fixed = at.getTime()
    setClock(() => new Date(fixed))
  }
  let closed = false

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
    clock: {
      set: fixClockAt,
      advance: ms => fixClockAt(new Date(now().getTime() + ms)),
      now,
      reset: () => setClock(null),
    },
    // The file is done with the app; the run may not be. The pools stay open
    // for the next file, and end with the run (the root `after` above).
    close: async () => {
      if (closed) return
      closed = true
      openFiles--
      setClock(null)
      useLogDestination(betweenFiles)
      if (runOver && openFiles === 0) await tearDown()
    },
  }
}

/** Arbitrary, but fixed: every harness process has to pick the same number for
 *  the lock to mean anything. */
const HARNESS_SETUP_LOCK = 4_120_931
/** Held from the first `startTestApp` to the end of the run: one run per database. */
const HARNESS_RUN_LOCK = 4_120_932

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
