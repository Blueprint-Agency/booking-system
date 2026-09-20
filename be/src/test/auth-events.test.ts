import assert from 'node:assert/strict'
import { after, before, describe, mock, test } from 'node:test'
import { eq, inArray, sql } from 'drizzle-orm'
import {
  HARNESS_PASSWORD,
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'
import { totp } from './totp'

/**
 * The sign-in audit log and the sign-in rate limits (#114), over real HTTP.
 *
 * Every flow is driven from a client address of its own, so "the rows this
 * flow wrote" is `WHERE ip = …` and no other test's traffic can be counted, nor
 * spend its budget.
 */
describe('auth events and sign-in limits', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let AUTH_RATE_LIMITS!: typeof import('../services/auth/rate-limit').AUTH_RATE_LIMITS

  const run = Date.now().toString(36)
  const MEMBER = `audit-member-${run}@auth.test`
  const STAFF = `audit-staff-${run}@auth.test`
  const PLATFORM = `audit-platform-${run}@auth.test`
  const OTHER_MEMBER = `audit-other-${run}@auth.test`

  type Pool = 'client' | 'staff' | 'platform'

  /** A request from one pool's frontend, at one client address. */
  const call = (pool: Pool, ip: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const tenant = pool === 'platform' ? null : harness.tenants.one
    return harness.app.request(`/api/v1/auth/${pool}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: frontendOrigin(pool, tenant),
        ...(tenant ? { 'X-Tenant-Slug': tenant.slug } : {}),
        'X-Forwarded-For': ip,
        'User-Agent': 'audit-test/1.0',
        ...init.headers,
      },
      body: JSON.stringify(init.body ?? {}),
    })
  }

  const lastCodeTo = (email: string) => {
    const message = [...discardedMail].reverse().find(m => m.to === email)
    const code = message?.html.match(/>(\d{6})</)?.[1]
    assert.ok(code, `no code was mailed to ${email}`)
    return code
  }

  const eventsFrom = (ip: string) =>
    harness.db.select().from(schema.authEvents).where(eq(schema.authEvents.ip, ip))

  const userId = async (pool: Pool, email: string) => {
    const table = { client: schema.clientAuthUsers, staff: schema.staffAuthUsers, platform: schema.platformAuthUsers }[pool]
    const [row] = await harness.db.select({ id: table.id }).from(table).where(eq(table.email, email))
    assert.ok(row, `no ${pool} user ${email}`)
    return row.id
  }

  const kinds = (rows: Array<{ kind: string }>) => rows.map(r => r.kind).sort()

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    ;({ AUTH_RATE_LIMITS } = await import('../services/auth/rate-limit'))
    // Accounts exist before the flows under test, so each flow has an actor to name.
    await harness.signInAs('client', MEMBER, harness.tenants.one)
    await harness.signInAs('client', OTHER_MEMBER, harness.tenants.two)
    await harness.signInAs('staff', STAFF, harness.tenants.one)
    await harness.signInAs('platform', PLATFORM, null)
  })

  after(async () => {
    if (!harness) return
    const actors = await Promise.all([
      harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(inArray(schema.clientAuthUsers.email, [MEMBER, OTHER_MEMBER])),
      harness.db.select({ id: schema.staffAuthUsers.id }).from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, STAFF)),
      harness.db.select({ id: schema.platformAuthUsers.id }).from(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, PLATFORM)),
    ])
    const ids = actors.flat().map(r => r.id)
    if (ids.length) await harness.db.delete(schema.authEvents).where(inArray(schema.authEvents.actorUserId, ids))
    await harness.db.delete(schema.clientAuthUsers).where(inArray(schema.clientAuthUsers.email, [MEMBER, OTHER_MEMBER]))
    await harness.db.delete(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, STAFF))
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, PLATFORM))
    await harness.close()
  })

  test('a member asks for a code, gets a password wrong, signs in and out: one row of each, at their studio', async () => {
    const ip = harnessAddress()
    const member = await userId('client', MEMBER)
    // Gives the member the harness password, from an address of its own.
    await harness.signInAs('client', MEMBER, harness.tenants.one)

    assert.equal((await call('client', ip, '/email-otp/send-verification-otp', { body: { email: MEMBER, type: 'sign-in' } })).status, 200)
    lastCodeTo(MEMBER)
    assert.equal((await call('client', ip, '/sign-in/email', { body: { email: MEMBER, password: 'not-the-password' } })).status, 401)
    const signedIn = await call('client', ip, '/sign-in/email', { body: { email: MEMBER, password: HARNESS_PASSWORD } })
    assert.equal(signedIn.status, 200, await signedIn.clone().text())
    const token = signedIn.headers.get('set-auth-token')!
    const signedOut = await call('client', ip, '/sign-out', { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(signedOut.status, 200, await signedOut.clone().text())

    const rows = await eventsFrom(ip)
    assert.deepEqual(kinds(rows), ['code_sent', 'sign_in', 'sign_in_failed', 'sign_out'])
    for (const row of rows) {
      assert.equal(row.pool, 'client')
      assert.equal(row.tenantId, harness.tenants.one.id, `${row.kind} filed under the wrong studio`)
      assert.equal(row.actorUserId, member, `${row.kind} names the wrong actor`)
      assert.equal(row.userAgent, 'audit-test/1.0')
    }
  })

  test('staff get a password wrong, sign in and out: one row of each, at their studio', async () => {
    const ip = harnessAddress()
    const staff = await userId('staff', STAFF)

    assert.equal((await call('staff', ip, '/sign-in/email', { body: { email: STAFF, password: 'not-the-password' } })).status, 401)
    const signedIn = await call('staff', ip, '/sign-in/email', { body: { email: STAFF, password: HARNESS_PASSWORD } })
    assert.equal(signedIn.status, 200)
    const token = signedIn.headers.get('set-auth-token')!
    assert.equal((await call('staff', ip, '/sign-out', { headers: { Authorization: `Bearer ${token}` } })).status, 200)

    const rows = await eventsFrom(ip)
    assert.deepEqual(kinds(rows), ['sign_in', 'sign_in_failed', 'sign_out'])
    for (const row of rows) {
      assert.equal(row.pool, 'staff')
      assert.equal(row.tenantId, harness.tenants.one.id)
      assert.equal(row.actorUserId, staff)
    }
  })

  test('a second factor mailed, mistyped and then entered: one row of each, the password step none', async () => {
    const staff = await userId('staff', STAFF)

    // Enrol, from an address whose rows are not asserted on.
    const enrolFrom = harnessAddress()
    const session = await call('staff', enrolFrom, '/sign-in/email', { body: { email: STAFF, password: HARNESS_PASSWORD } })
    const bearer = { Authorization: `Bearer ${session.headers.get('set-auth-token')}` }
    const enabled = await call('staff', enrolFrom, '/two-factor/enable', { body: { password: HARNESS_PASSWORD }, headers: bearer })
    assert.equal(enabled.status, 200, await enabled.clone().text())
    const { totpURI } = (await enabled.json()) as { totpURI: string }
    const rotated = { Authorization: `Bearer ${enabled.headers.get('set-auth-token') ?? session.headers.get('set-auth-token')}` }
    const secret = new URL(totpURI).searchParams.get('secret')!
    assert.equal((await call('staff', enrolFrom, '/two-factor/verify-totp', { body: { code: totp(secret) }, headers: rotated })).status, 200)
    assert.deepEqual(kinds(await eventsFrom(enrolFrom)), ['sign_in'], 'enrolling is not a sign-in, nor a code')

    const ip = harnessAddress()
    const challenged = await call('staff', ip, '/sign-in/email', { body: { email: STAFF, password: HARNESS_PASSWORD } })
    assert.equal(((await challenged.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect, true)
    const cookie = { Cookie: challenged.headers.getSetCookie().map(c => c.split(';')[0]!).join('; ') }

    assert.equal((await call('staff', ip, '/two-factor/send-otp', { headers: cookie })).status, 200)
    const code = lastCodeTo(STAFF)
    const wrong = code === '000000' ? '111111' : '000000'
    assert.notEqual((await call('staff', ip, '/two-factor/verify-otp', { body: { code: wrong }, headers: cookie })).status, 200)
    assert.equal((await call('staff', ip, '/two-factor/verify-otp', { body: { code }, headers: cookie })).status, 200)

    const rows = await eventsFrom(ip)
    assert.deepEqual(kinds(rows), ['code_failed', 'code_sent', 'sign_in'])
    for (const row of rows) assert.equal(row.actorUserId, staff, `${row.kind} names the wrong actor`)
  })

  test('a platform operator signs in and fails to: rows with no studio', async () => {
    const ip = harnessAddress()
    assert.equal((await call('platform', ip, '/sign-in/email', { body: { email: PLATFORM, password: 'nope-nope-nope' } })).status, 401)
    assert.equal((await call('platform', ip, '/sign-in/email', { body: { email: PLATFORM, password: HARNESS_PASSWORD } })).status, 200)

    const rows = await eventsFrom(ip)
    assert.deepEqual(kinds(rows), ['sign_in', 'sign_in_failed'])
    const operator = await userId('platform', PLATFORM)
    for (const row of rows) {
      assert.equal(row.pool, 'platform')
      assert.equal(row.tenantId, null)
      assert.equal(row.actorUserId, operator)
    }
  })

  test('a failed sign-in keeps neither the address tried nor the password', async () => {
    const ip = harnessAddress()
    const password = `tried-${run}-hunter2`
    const stranger = `nobody-${run}@auth.test`
    await call('staff', ip, '/sign-in/email', { body: { email: STAFF, password } })
    await call('staff', ip, '/sign-in/email', { body: { email: stranger, password } })

    const rows = await eventsFrom(ip)
    assert.equal(rows.length, 2)
    for (const row of rows) {
      const stored = JSON.stringify(row)
      assert.ok(!stored.includes(password), 'the password is in the audit row')
      assert.ok(!stored.includes(STAFF) && !stored.includes(stranger), 'the address is in the audit row')
      assert.ok(!stored.includes('audit-staff') && !stored.includes('nobody-'), 'part of the address is in the audit row')
    }
    const [unknown] = rows.filter(r => r.actorUserId === null)
    assert.ok(unknown, 'an address with no account names no actor')
  })

  test('the code-request budget is refused with 429, and the next window is not', async () => {
    const ip = harnessAddress()
    const ask = () => call('client', ip, '/email-otp/send-verification-otp', { body: { email: MEMBER, type: 'sign-in' } })

    mock.timers.enable({ apis: ['Date'], now: Date.now() })
    try {
      for (let i = 0; i < AUTH_RATE_LIMITS.codeRequest.max; i++) assert.equal((await ask()).status, 200, `request ${i + 1}`)
      const refused = await ask()
      assert.equal(refused.status, 429)
      assert.ok(Number(refused.headers.get('x-retry-after')) > 0)
      // Another address is not throttled for this one's traffic.
      assert.equal((await call('client', harnessAddress(), '/email-otp/send-verification-otp', { body: { email: MEMBER, type: 'sign-in' } })).status, 200)

      mock.timers.tick(AUTH_RATE_LIMITS.codeRequest.window * 1000)
      assert.equal((await ask()).status, 200, 'the next window has a fresh budget')
    } finally {
      mock.timers.reset()
    }

    const sent = (await eventsFrom(ip)).filter(r => r.kind === 'code_sent')
    assert.equal(sent.length, AUTH_RATE_LIMITS.codeRequest.max + 1, 'a refused request sent nothing and filed nothing')
  })

  test('the sign-in-attempt budget is refused with 429', async () => {
    const ip = harnessAddress()
    for (let i = 0; i < AUTH_RATE_LIMITS.signInAttempt.max; i++) {
      const res = await call('staff', ip, '/sign-in/email', { body: { email: STAFF, password: `guess-${i}` } })
      assert.equal(res.status, 401, `attempt ${i + 1}`)
    }
    const refused = await call('staff', ip, '/sign-in/email', { body: { email: STAFF, password: HARNESS_PASSWORD } })
    assert.equal(refused.status, 429, 'even the right password waits out the window')
    assert.equal(refused.headers.get('set-auth-token'), null)

    // Each pool counts its own: the platform pool's `/sign-in/email` from the same address is untouched.
    assert.equal((await call('platform', ip, '/sign-in/email', { body: { email: PLATFORM, password: HARNESS_PASSWORD } })).status, 200)
  })

  test('impersonation has its kinds and its writer, naming who and whom', async () => {
    // Nothing drives impersonation through Better Auth until #118; this is the
    // writer that ticket calls.
    const { recordAuthEvent } = await import('../services/auth/auth-events')
    const { withTenant } = await import('../db')
    const ip = harnessAddress()
    const member = await userId('client', MEMBER)
    const staff = await userId('staff', STAFF)
    await withTenant(harness.tenants.one.id, async () => {
      for (const kind of ['impersonation_started', 'impersonation_ended'] as const) {
        await recordAuthEvent({ pool: 'client', kind, actorUserId: staff, subjectUserId: member, ip, userAgent: null })
      }
    })
    const rows = await eventsFrom(ip)
    assert.deepEqual(kinds(rows), ['impersonation_ended', 'impersonation_started'])
    for (const row of rows) {
      assert.equal(row.tenantId, harness.tenants.one.id)
      assert.equal(row.actorUserId, staff)
      assert.equal(row.subjectUserId, member)
    }

    await assert.rejects(
      recordAuthEvent({ pool: 'client', kind: 'sign_in', actorUserId: member, ip, userAgent: null }),
      /outside a Tenant context/,
      "a studio event with no studio open is refused, not filed as the platform's",
    )
  })

  describe('row-level security', () => {
    let appDb!: typeof import('../db').db
    let withTenant!: typeof import('../db').withTenant

    before(async () => {
      ;({ db: appDb, withTenant } = await import('../db'))
    })

    const tenantsSeen = (rows: Array<{ tenant_id: string | null }>) => [...new Set(rows.map(r => r.tenant_id))]
    const readAll = () => appDb.execute<{ tenant_id: string | null }>(sql`SELECT tenant_id::text AS tenant_id FROM auth_events`)

    test("a studio reads its own rows: not another studio's, not the platform's", async () => {
      const { one, two } = harness.tenants
      const [owner] = await harness.db.execute<{ one: number; two: number; platform: number }>(sql`
        SELECT count(*) FILTER (WHERE tenant_id = ${one.id})::int AS one,
               count(*) FILTER (WHERE tenant_id = ${two.id})::int AS two,
               count(*) FILTER (WHERE tenant_id IS NULL)::int AS platform
        FROM auth_events`)
      assert.ok(owner!.one > 0 && owner!.two > 0 && owner!.platform > 0, 'the fixture has rows of all three to hide')

      assert.deepEqual(tenantsSeen(await withTenant(one.id, readAll)), [one.id])
      assert.deepEqual(tenantsSeen(await withTenant(two.id, readAll)), [two.id])
    })

    test("outside every studio — the super portal's context — only the platform's rows", async () => {
      assert.deepEqual(tenantsSeen(await readAll()), [null])
    })

    test('a row cannot be written under a studio whose context is not open', async () => {
      const { one, two } = harness.tenants
      const row = (tenantId: string | null) => ({ tenantId, pool: 'client' as const, kind: 'sign_in' as const, ip: harnessAddress() })
      await assert.rejects(withTenant(one.id, () => appDb.insert(schema.authEvents).values(row(two.id))))
      await assert.rejects(withTenant(one.id, () => appDb.insert(schema.authEvents).values(row(null))))
      await assert.rejects(appDb.insert(schema.authEvents).values(row(one.id)))
    })
  })
})
