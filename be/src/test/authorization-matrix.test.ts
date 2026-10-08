import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `${run}.authorization-matrix.test`
const OPERATOR = `operator@${DOMAIN}`
const THROWAWAY_SLUG = `matrix-${run}`

/**
 * The authorization matrix (#363): every `/me`, `/public` and `/platform` route
 * the app has, and the portal's admin Receipts routes (#389), called as every
 * kind of caller, each answered by its gate as declared below.
 *
 * The routes come from the app's own route table, never from a list kept here,
 * so a route added without an expectation fails the first test, and an
 * expectation left behind by a removed route fails it too. Who may call each
 * route is the table below: someone has to say so before the route can ship.
 *
 * What a call proves is the gate and only the gate. A caller the gate admits is
 * asserted only to have got past it — path parameters are random ids and bodies
 * are empty, so what the route then does is other tests' business. A caller the
 * gate refuses must get the gate's own status and error code, and the refused
 * calls together must leave every Tenant-scoped table, the sign-in log and the
 * audit log exactly as they were.
 *
 * Maintenance mode and suspension close studios for everyone and have their own
 * tests (`maintenance-mode.test.ts`, `tenant-provisioning.test.ts`).
 */

/**
 * Who is calling. Every caller except `noStudio` is on studio one's hostname:
 * its member app for `/me` and `/public`, its portal for `/portal`.
 */
type Caller = 'anonymous' | 'memberOfOne' | 'memberOfTwo' | 'adminOfOne' | 'instructorOfOne' | 'platformAdmin' | 'noStudio'

const CALLERS: readonly Caller[] = [
  'anonymous', //       nobody signed in
  'memberOfOne', //     a member of studio one, signed in there
  'memberOfTwo', //     a member of studio two, presenting that session on studio one's hostname
  'adminOfOne', //      an Admin of studio one, signed in to its portal
  'instructorOfOne', // an Instructor of studio one, signed in to its portal
  'platformAdmin', //   a Platform administrator, on the PLATFORM_ADMIN_EMAIL allowlist
  'noStudio', //        nobody signed in, and no studio named at all
]

type Refusal = readonly [status: number, error: string]

/** A gate: the callers it admits, and what it answers each one it refuses. */
type Gate = { allowed: readonly Caller[]; refused: Partial<Record<Caller, Refusal>> }

/** `/me/*`: a member of the studio named, and nobody else. */
const MEMBER_OF_THE_STUDIO: Gate = {
  allowed: ['memberOfOne'],
  refused: {
    anonymous: [401, 'missing_bearer_token'],
    memberOfTwo: [401, 'invalid_token'],
    adminOfOne: [401, 'invalid_token'],
    instructorOfOne: [401, 'invalid_token'],
    platformAdmin: [401, 'invalid_token'],
    noStudio: [400, 'tenant_required'],
  },
}

/** `/public/*`: anyone, signed in or not, as long as a studio is named. */
const ANYONE_NAMING_A_STUDIO: Gate = {
  allowed: ['anonymous', 'memberOfOne', 'memberOfTwo', 'adminOfOne', 'instructorOfOne', 'platformAdmin'],
  refused: { noStudio: [400, 'tenant_required'] },
}

/**
 * The staff-only public steps: a studio portal's sign-in email step, and the
 * links mailed to staff (invitation, email change). Public because the person
 * has no session yet — the link's token, or the address, is what they act on —
 * so their gate is the public one: a studio named. A member's or the platform's
 * session buys nothing extra here; the route never reads one.
 */
const STAFF_STEP: Gate = ANYONE_NAMING_A_STUDIO

/** Needs no studio: the slug lookup the frontends' proxies make for every page. */
const ANYONE: Gate = {
  allowed: ['anonymous', 'memberOfOne', 'memberOfTwo', 'adminOfOne', 'instructorOfOne', 'platformAdmin', 'noStudio'],
  refused: {},
}

/**
 * `/platform/*`: a Platform administrator, and nobody else — answered
 * `not_found` rather than `forbidden`, so a studio's session learns nothing
 * about whether the super portal exists.
 */
const PLATFORM_ADMIN_ONLY: Gate = {
  allowed: ['platformAdmin'],
  refused: {
    anonymous: [404, 'not_found'],
    memberOfOne: [404, 'not_found'],
    memberOfTwo: [404, 'not_found'],
    adminOfOne: [404, 'not_found'],
    instructorOfOne: [404, 'not_found'],
    noStudio: [404, 'not_found'],
  },
}

/** The super portal's sign-in step, which runs before anyone has a session. */
const PLATFORM_SIGN_IN: Gate = ANYONE

/**
 * `/portal/admin/*`: an Admin of the studio named, and nobody else. An
 * Instructor's own staff session is refused by the role; a member's or the
 * platform's is no staff session at all. The matrix holds the portal's routes
 * surface by surface, as each is brought under it (`UNDER_THE_MATRIX`).
 */
const STUDIO_ADMIN: Gate = {
  allowed: ['adminOfOne'],
  refused: {
    anonymous: [401, 'missing_bearer_token'],
    memberOfOne: [401, 'invalid_token'],
    memberOfTwo: [401, 'invalid_token'],
    instructorOfOne: [403, 'forbidden_role'],
    platformAdmin: [401, 'invalid_token'],
    noStudio: [400, 'tenant_required'],
  },
}

/**
 * Every refusal any gate gives. An admitted caller's response must be none of
 * them: a business refusal on this surface always names its own code
 * (`booking_not_found`, `card_not_found`, a validation failure, …).
 */
const GATE_REFUSALS: readonly Refusal[] = [
  [400, 'tenant_required'],
  [401, 'missing_bearer_token'],
  [401, 'invalid_token'],
  [403, 'tenant_mismatch'],
  [403, 'forbidden_role'],
  [403, 'staff_not_provisioned'],
  [403, 'client_blocked'],
  [403, 'tenant_suspended'],
  [404, 'client_not_found'],
  [404, 'not_found'],
  [429, 'rate_limited'],
  [503, 'maintenance'],
]

/**
 * How a route is called. Path parameters are filled by name (`params` below);
 * `query` and `body` replace the defaults — no query, and `{}` as the body of
 * anything that takes one.
 */
type Probe = { query?: string; body?: unknown; params?: Record<string, string> }
type Expectation = { gate: Gate; probe?: Probe }

/** One per method and path pattern under the three prefixes. */
const EXPECTATIONS: Record<string, Expectation> = {
  // ── /me ──────────────────────────────────────────────────────────────────
  'GET /api/v1/me': { gate: MEMBER_OF_THE_STUDIO },
  'PATCH /api/v1/me': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/approvals': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/approvals/:kind/:id/seen': { gate: MEMBER_OF_THE_STUDIO, probe: { params: { kind: 'pt' } } },
  'GET /api/v1/me/bookings/upcoming': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/bookings/past': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/bookings/cancelled': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/bookings/attendance': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/bookings/:id': { gate: MEMBER_OF_THE_STUDIO },
  'DELETE /api/v1/me/bookings/:id': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/bookings/class': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/cards': { gate: MEMBER_OF_THE_STUDIO },
  'DELETE /api/v1/me/cards/:id': { gate: MEMBER_OF_THE_STUDIO, probe: { params: { id: 'pm_matrix' } } },
  'POST /api/v1/me/checkout/package': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/checkout/workshop': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/checkout/merch': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/checkout/cross-location': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/checkout/cross-location/quote': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/checkout/validate-promo': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/checkout/sync-session': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/checkout/options': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/classes': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/classes/:id': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/class-packages': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/corporate-packages': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/corporate-requests': { gate: MEMBER_OF_THE_STUDIO },
  'PATCH /api/v1/me/display-prefs': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/merch-orders': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/packages': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/packages/:id/credit-history': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/pt-packages': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/pt-sessions': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/pt-sessions/partner-lookup': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/pt-sessions/request': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/pt-sessions/:id/cancel': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/purchases/open': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/receipts': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/receipts/:id': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/receipts/:id/pdf': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/purchases/:id/resume': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/waitlist': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/waitlist/classes/:classId': { gate: MEMBER_OF_THE_STUDIO },
  'DELETE /api/v1/me/waitlist/:entryId': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/workshop-bookings': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/workshops': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/workshops/:id': { gate: MEMBER_OF_THE_STUDIO },
  // Not built yet (they answer 501), and behind the member gate all the same.
  'GET /api/v1/me/dashboard': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/referral': { gate: MEMBER_OF_THE_STUDIO },
  'GET /api/v1/me/waiver': { gate: MEMBER_OF_THE_STUDIO },
  'POST /api/v1/me/waiver/sign': { gate: MEMBER_OF_THE_STUDIO },

  // ── /public ──────────────────────────────────────────────────────────────
  'GET /api/v1/public/cancellation-policy': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/classes': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/classes/:id': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/class-types': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/corporate-packages': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/instructors': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/locations': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/maintenance': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/merch': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/online-payments': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/packages': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/pt-booking-config': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/tenants/by-slug/:slug': { gate: ANYONE },
  'POST /api/v1/public/members/register': { gate: ANYONE_NAMING_A_STUDIO },
  'POST /api/v1/public/members/sign-in-step': { gate: ANYONE_NAMING_A_STUDIO },
  'POST /api/v1/public/members/password-link': { gate: ANYONE_NAMING_A_STUDIO },
  'POST /api/v1/public/members/set-password': { gate: ANYONE_NAMING_A_STUDIO },
  'POST /api/v1/public/staff/sign-in-step': { gate: STAFF_STEP },
  'GET /api/v1/public/staff-invitation': { gate: STAFF_STEP },
  'POST /api/v1/public/staff-invitation/accept': { gate: STAFF_STEP },
  'GET /api/v1/public/staff-email-change': { gate: STAFF_STEP },
  'POST /api/v1/public/staff-email-change/confirm': { gate: STAFF_STEP },
  // Not built yet (501).
  'GET /api/v1/public/marketing': { gate: ANYONE_NAMING_A_STUDIO },
  'GET /api/v1/public/referral/by-code/:code': { gate: ANYONE_NAMING_A_STUDIO },

  // ── /platform ────────────────────────────────────────────────────────────
  // Each call is shaped so the Platform administrator's answer is never
  // `not_found` — a real studio's id, a real job's id, a body the route refuses
  // before it acts — so the refused callers' `not_found` on the very same
  // request can only be the gate's. And so nothing the administrator is let
  // through to changes a real studio: every write is refused by its validator,
  // or lands on this file's own throwaway studio (`param` below).
  'POST /api/v1/platform/sign-in/step': { gate: PLATFORM_SIGN_IN },
  'GET /api/v1/platform/maintenance': { gate: PLATFORM_ADMIN_ONLY },
  'PUT /api/v1/platform/maintenance': { gate: PLATFORM_ADMIN_ONLY },
  'GET /api/v1/platform/imports': { gate: PLATFORM_ADMIN_ONLY },
  'GET /api/v1/platform/tenants': { gate: PLATFORM_ADMIN_ONLY },
  'POST /api/v1/platform/tenants': { gate: PLATFORM_ADMIN_ONLY },
  'GET /api/v1/platform/tenants/slug-check/:slug': { gate: PLATFORM_ADMIN_ONLY },
  'DELETE /api/v1/platform/tenants/:id': { gate: PLATFORM_ADMIN_ONLY },
  'PATCH /api/v1/platform/tenants/:id/status': { gate: PLATFORM_ADMIN_ONLY },
  'PUT /api/v1/platform/tenants/:id/term': { gate: PLATFORM_ADMIN_ONLY },
  'POST /api/v1/platform/tenants/:id/slug': { gate: PLATFORM_ADMIN_ONLY },
  'POST /api/v1/platform/tenants/:id/admin': { gate: PLATFORM_ADMIN_ONLY },
  'GET /api/v1/platform/tenants/:id/export': { gate: PLATFORM_ADMIN_ONLY, probe: { query: 'include=everything' } },
  'POST /api/v1/platform/tenants/:id/import': { gate: PLATFORM_ADMIN_ONLY },
  'POST /api/v1/platform/tenants/:id/imports': { gate: PLATFORM_ADMIN_ONLY },
  'GET /api/v1/platform/tenants/:id/imports/latest': { gate: PLATFORM_ADMIN_ONLY },
  'PUT /api/v1/platform/tenants/:id/imports/:jobId/archive': { gate: PLATFORM_ADMIN_ONLY },
  'POST /api/v1/platform/tenants/:id/imports/:jobId/dismiss': { gate: PLATFORM_ADMIN_ONLY },
  'PUT /api/v1/platform/tenants/:id/payment-credentials': { gate: PLATFORM_ADMIN_ONLY },
  'DELETE /api/v1/platform/tenants/:id/payment-credentials': { gate: PLATFORM_ADMIN_ONLY },

  // ── /portal ──────────────────────────────────────────────────────────────
  // Every Receipt in the studio (#389): the studio's money, for its admins only.
  'GET /api/v1/portal/admin/receipts': { gate: STUDIO_ADMIN },
  'GET /api/v1/portal/admin/receipts/:id': { gate: STUDIO_ADMIN },
  'GET /api/v1/portal/admin/receipts/:id/pdf': { gate: STUDIO_ADMIN },
}

/** The prefixes the matrix speaks for: every route under them needs a line above. */
const UNDER_THE_MATRIX = /^\/api\/v1\/(me|public|platform|portal\/admin\/receipts)(\/|$)/
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

describe('authorization matrix', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  /** What each caller presents: on a studio's member app, on its portal, and on the super portal. */
  let sessions!: Record<
    Caller,
    { studio: () => Record<string, string>; portal: () => Record<string, string>; platform: () => Record<string, string> }
  >
  /** A studio of this file's own, and an import job of its, for the platform's `:id` and `:jobId`. */
  let throwaway!: { id: string; slug: string }
  let finishedJobId!: string

  /** The route table, as the app has it: one entry per method and path pattern. */
  const routesUnderTheMatrix = (): string[] => {
    const keys = new Set<string>()
    for (const route of harness.app.routes) {
      if (route.method === 'ALL') continue // middleware
      if (!UNDER_THE_MATRIX.test(route.path)) continue
      if (route.path.includes('/__harness/')) continue // mounted by the test harness only
      keys.add(`${route.method} ${route.path}`)
    }
    return [...keys].sort()
  }

  /** The routes the app has that the table speaks for; the first test fails on any it does not. */
  const declaredRoutes = (): string[] => routesUnderTheMatrix().filter(key => key in EXPECTATIONS)

  /** A path parameter's value: random where any id will do, real where the route must find a row. */
  const param = (path: string, name: string): string => {
    if (path.startsWith('/api/v1/platform/')) {
      if (name === 'id') return throwaway.id
      if (name === 'jobId') return finishedJobId
      if (name === 'slug') return `free-${run}`
    }
    if (name === 'slug') return one.slug
    if (name === 'code') return `CODE${run.toUpperCase()}`
    return randomUUID()
  }

  const call = async (key: string, headers: Record<string, string>): Promise<Response> => {
    const [method, pattern] = key.split(' ') as [string, string]
    const probe = EXPECTATIONS[key]!.probe ?? {}
    const path = pattern.replace(/:(\w+)/g, (_, name: string) => probe.params?.[name] ?? param(pattern, name))
    const url = probe.query ? `${path}?${probe.query}` : path
    const body = BODY_METHODS.has(method) || probe.body !== undefined ? JSON.stringify(probe.body ?? {}) : undefined
    return harness.app.request(url, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body }),
    })
  }

  const headersFor = (key: string, caller: Caller) => {
    const path = key.split(' ')[1]!
    if (path.startsWith('/api/v1/platform')) return sessions[caller].platform()
    if (path.startsWith('/api/v1/portal')) return sessions[caller].portal()
    return sessions[caller].studio()
  }

  /** `[status, error]` of a response; `error` is null when the body names no string code. */
  const answer = async (res: Response): Promise<{ status: number; error: string | null; text: string }> => {
    const text = await res.text()
    let error: string | null = null
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      if (typeof parsed?.error === 'string') error = parsed.error
    } catch {
      // Not JSON (an export, an empty 204): no code, so not a gate's refusal.
    }
    return { status: res.status, error, text }
  }

  /**
   * Row count and newest row version (`xmin`) of every table that carries a
   * `tenant_id` — `auth_events` and `audit_log` among them — read as the owner,
   * which sees every studio. A count catches an insert or a delete; `xmin`
   * catches an update.
   */
  const snapshot = async (): Promise<Record<string, string>> => {
    const tables = await harness.db.execute<{ table_name: string }>(sql`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name
    `)
    const names = tables.map(t => t.table_name)
    assert.ok(names.includes('auth_events'), 'the sign-in log is counted')
    assert.ok(names.includes('audit_log'), 'the audit log is counted')
    const out: Record<string, string> = {}
    for (const table of names) {
      const [row] = await harness.db.execute<{ n: number; x: string | null }>(
        sql`SELECT count(*)::int AS n, max(xmin::text::bigint)::text AS x FROM ${sql.identifier(table)}`,
      )
      out[table] = `${row!.n} rows, newest version ${row!.x}`
    }
    return out
  }

  /** A member with a `clients` row at `at`, signed in there. */
  const member = async (at: { id: string; slug: string }, email: string) => {
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Matrix Member', phone: '+6580000000', authUserId: user!.id })
    return headers
  }

  /** An active staff member of `at` with `role`, signed in to its portal. */
  const staff = async (at: { id: string; slug: string }, email: string, role: 'admin' | 'instructor') => {
    const headers = await harness.signInAs('staff', email, at)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, at.id)))
    await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name: `Matrix ${role}`, role, status: 'active', authUserId: user!.id })
    return headers
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ one, two } = harness.tenants)

    const provision = await import('../services/tenants/provision')
    const { tenant } = await provision.provisionTenant({ slug: THROWAWAY_SLUG, name: `Matrix ${run}` })
    throwaway = { id: tenant.id, slug: tenant.slug }
    const [job] = await harness.db
      .insert(schema.tenantImports)
      .values({
        tenantId: throwaway.id,
        status: 'failed',
        phase: 'failed',
        fileName: 'matrix.zip',
        uploadBytes: 1,
        startedBy: OPERATOR,
        finishedAt: new Date(),
        dismissedAt: new Date(),
      })
      .returning({ id: schema.tenantImports.id })
    finishedJobId = job!.id

    const memberOfOne = await member(one, `member-one@${DOMAIN}`)
    const memberOfTwo = await member(two, `member-two@${DOMAIN}`)
    const adminOfOne = await staff(one, `admin-one@${DOMAIN}`, 'admin')
    const instructorOfOne = await staff(one, `instructor-one@${DOMAIN}`, 'instructor')
    const platformAdmin = await harness.signInAs('platform', OPERATOR, null)

    // Studio one's member app, and its portal, as their pages call the API —
    // from a fresh client address each time, so the run's hundreds of calls
    // stay under the limiters.
    const onStudioOne = (pool: 'client' | 'staff') => (token?: string) => (): Record<string, string> => ({
      'X-Tenant-Slug': one.slug,
      Origin: frontendOrigin(pool, one),
      'X-Forwarded-For': harnessAddress(),
      ...(token ? { Authorization: token } : {}),
    })
    const atStudioOne = onStudioOne('client')
    const atPortalOne = onStudioOne('staff')
    // The super portal ignores the hostname; each signed-in caller comes from
    // the frontend they signed in on.
    const asSignedIn = (headers: Record<string, string>) => () => ({ ...headers, 'X-Forwarded-For': harnessAddress() })
    const nobody = () => ({ 'X-Forwarded-For': harnessAddress() })

    const presenting = (headers?: Record<string, string>) => ({
      studio: atStudioOne(headers?.Authorization),
      portal: atPortalOne(headers?.Authorization),
      platform: headers ? asSignedIn(headers) : nobody,
    })
    sessions = {
      anonymous: presenting(),
      memberOfOne: presenting(memberOfOne),
      memberOfTwo: presenting(memberOfTwo),
      adminOfOne: presenting(adminOfOne),
      instructorOfOne: presenting(instructorOfOne),
      platformAdmin: presenting(platformAdmin),
      noStudio: { studio: nobody, portal: nobody, platform: nobody },
    }
  })

  after(async () => {
    if (!harness) return
    try {
      const ours = `%@${DOMAIN}`
      if (throwaway) {
        // The way the super portal removes a studio: suspended, then deleted by its Slug.
        const tenants = await import('../services/tenants/delete')
        const status = await import('../services/tenants/tenants')
        await status.setTenantStatus(throwaway.id, 'suspended')
        await tenants.deleteTenant({ tenantId: throwaway.id, confirmSlug: throwaway.slug })
      }
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
      await harness.db.delete(schema.platformAuthUsers).where(inArray(schema.platformAuthUsers.email, [OPERATOR]))
    } finally {
      await harness.close()
    }
  })

  test('every /me, /public, /platform and admin Receipts route has an expectation, and every expectation a route', () => {
    const routes = routesUnderTheMatrix()
    assert.ok(routes.length > 0, 'the route table was read')
    const declared = Object.keys(EXPECTATIONS).sort()
    assert.deepEqual(
      routes.filter(r => !declared.includes(r)),
      [],
      'routes with no expectation: say who may call each one in EXPECTATIONS',
    )
    assert.deepEqual(
      declared.filter(d => !routes.includes(d)),
      [],
      'expectations with no route: remove them, or the route went missing',
    )
    for (const [key, { gate }] of Object.entries(EXPECTATIONS)) {
      for (const caller of CALLERS) {
        const admitted = gate.allowed.includes(caller)
        const refused = gate.refused[caller] !== undefined
        assert.ok(admitted !== refused, `${key}: ${caller} must be either admitted or refused, and not both`)
      }
    }
  })

  test('a refused caller gets the gate’s own refusal, and the refused calls write nothing', async () => {
    const before = await snapshot()
    const wrong: string[] = []
    for (const key of declaredRoutes()) {
      for (const [caller, [status, error]] of Object.entries(EXPECTATIONS[key]!.gate.refused) as Array<[Caller, Refusal]>) {
        const got = await answer(await call(key, headersFor(key, caller)))
        if (got.status !== status || got.error !== error) {
          wrong.push(`${key} as ${caller}: expected ${status} ${error}, got ${got.status} ${got.text.slice(0, 200)}`)
        }
      }
    }
    assert.deepEqual(wrong, [], 'refusals that were not the gate’s')
    assert.deepEqual(await snapshot(), before, 'a refused call wrote something')
  })

  test('an admitted caller gets past the gate', async () => {
    const wrong: string[] = []
    for (const key of declaredRoutes()) {
      for (const caller of EXPECTATIONS[key]!.gate.allowed) {
        const got = await answer(await call(key, headersFor(key, caller)))
        const refusal = GATE_REFUSALS.find(([status, error]) => got.status === status && got.error === error)
        if (refusal) wrong.push(`${key} as ${caller}: refused ${got.status} ${got.text.slice(0, 200)}`)
      }
    }
    assert.deepEqual(wrong, [], 'admitted callers the gate stopped')
  })
})
