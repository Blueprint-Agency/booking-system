import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.paused.test`
const REFUSED = [403, { error: 'tenant_suspended', status: 'suspended' }]

describe('a suspended studio refuses its member surface', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let tenants!: typeof import('../services/tenants/tenants')
  let discardedMail!: typeof import('../lib/mailer')['discardedMail']

  type Studio = { id: string; slug: string }
  type Reply = { status: number; body: unknown }
  let studio!: Studio
  let member!: { email: string; headers: Record<string, string> }

  const visitorAt = (at: Studio): Record<string, string> => ({
    Origin: frontendOrigin('client', at),
    'X-Tenant-Slug': at.slug,
  })

  async function send(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Reply> {
    const res = await harness.app.request(path, {
      method,
      headers: {
        ...headers,
        'X-Forwarded-For': harnessAddress(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  async function rowsHeldBy(tenantId: string): Promise<Record<string, number>> {
    const tables = await harness.db.execute<{ t: string }>(sql`
      SELECT c.table_name AS t FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
      ORDER BY 1
    `)
    const out: Record<string, number> = {}
    for (const { t } of tables) {
      const [row] = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)} WHERE tenant_id = ${tenantId}`,
      )
      if (row!.n > 0) out[t] = row!.n
    }
    return out
  }

  async function memberAt(at: Studio, name: string) {
    const email = `${name}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
    return { email, headers }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    tenants = await import('../services/tenants/tenants')
    ;({ discardedMail } = await import('../lib/mailer'))
    const provision = await import('../services/tenants/provision')
    const slug = `paused-${run}`
    const { tenant } = await provision.provisionTenant({ slug, name: `Paused ${run}`, adminEmail: `owner@${slug}.${DOMAIN}` })
    studio = { id: tenant.id, slug }
    member = await memberAt(studio, 'mia')
    await tenants.setTenantStatus(studio.id, 'suspended')
  })

  after(async () => {
    if (!harness) return
    try {
      const { deleteTenant } = await import('../services/tenants/delete')
      if (studio) await deleteTenant({ tenantId: studio.id, confirmSlug: studio.slug })
      const ours = `%@${DOMAIN}`
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test("SUP-31 a suspended studio refuses a visitor's sign-up code, registration, sign-in and password link 403 tenant_suspended, and mails and writes nothing", async () => {
    const email = `newcomer-${studio.slug}@${DOMAIN}`
    const visitor = visitorAt(studio)
    const writes: Array<[what: string, method: string, path: string, body: unknown]> = [
      ['a sign-up code', 'POST', '/api/v1/auth/client/email-otp/send-verification-otp', { email, type: 'email-verification' }],
      ['a sign-in code', 'POST', '/api/v1/auth/client/email-otp/send-verification-otp', { email: member.email, type: 'sign-in' }],
      ['registration', 'POST', '/api/v1/public/members/register', { email, otp: '000000', first_name: 'New', last_name: 'Comer', phone: '+6580000001', password: 'a-long-enough-password' }],
      ['the sign-in email step', 'POST', '/api/v1/public/members/sign-in-step', { email: member.email }],
      ['a password link', 'POST', '/api/v1/public/members/password-link', { email: member.email }],
      ['setting a password', 'POST', '/api/v1/public/members/set-password', { token: 'none', password: 'a-long-enough-password' }],
      ['a password sign-in', 'POST', '/api/v1/auth/client/sign-in/email', { email: member.email, password: 'a-long-enough-password' }],
    ]

    const held = await rowsHeldBy(studio.id)
    const mailBefore = discardedMail.length
    for (const [what, method, path, body] of writes) {
      const reply = await send(method, path, visitor, body)
      assert.deepEqual([reply.status, reply.body], REFUSED, `${what}: ${JSON.stringify(reply.body)}`)
    }
    assert.deepEqual(await rowsHeldBy(studio.id), held, 'no row was written at the studio')
    assert.deepEqual(
      discardedMail.slice(mailBefore).filter(m => m.to === email || m.to === member.email),
      [],
      'no code or link was mailed',
    )
  })

  test("SUP-32 a suspended studio refuses its signed-in member's account, checkout, booking and session read 403 tenant_suspended", async () => {
    const held = await rowsHeldBy(studio.id)
    const calls: Array<[what: string, method: string, path: string, body?: unknown]> = [
      ['their account', 'GET', '/api/v1/me'],
      ['their packages', 'GET', '/api/v1/me/packages'],
      ['a package checkout', 'POST', '/api/v1/me/checkout/package', {}],
      ['a class booking', 'POST', '/api/v1/me/bookings/class', {}],
      ['their session', 'GET', '/api/v1/auth/client/get-session'],
    ]
    for (const [what, method, path, body] of calls) {
      const reply = await send(method, path, member.headers, body)
      assert.deepEqual([reply.status, reply.body], REFUSED, `${what}: ${JSON.stringify(reply.body)}`)
    }
    assert.deepEqual(await rowsHeldBy(studio.id), held, 'no row was written at the studio')
  })

  test("SUP-33 a suspended studio's slug lookup still answers, reporting it suspended; its public catalogue is refused 403 tenant_suspended; its portal sign-in step still answers", async () => {
    const lookup = await send('GET', `/api/v1/public/tenants/by-slug/${studio.slug}`, {})
    assert.equal(lookup.status, 200, JSON.stringify(lookup.body))
    assert.equal((lookup.body as { tenant: { status: string } }).tenant.status, 'suspended')

    const visitor = visitorAt(studio)
    for (const path of ['/api/v1/public/classes', '/api/v1/public/packages', '/api/v1/public/locations']) {
      const reply = await send('GET', path, visitor)
      assert.deepEqual([reply.status, reply.body], REFUSED, `${path}: ${JSON.stringify(reply.body)}`)
    }

    const maintenance = await send('GET', '/api/v1/public/maintenance', visitor)
    assert.equal(maintenance.status, 200, 'the maintenance re-check is the platform, not the studio')

    const portal = { Origin: frontendOrigin('staff', studio), 'X-Tenant-Slug': studio.slug }
    const staffStep = await send('POST', '/api/v1/public/staff/sign-in-step', portal, { email: `owner@${studio.slug}.${DOMAIN}` })
    assert.equal(staffStep.status, 200, `the portal's sign-in step: ${JSON.stringify(staffStep.body)}`)

    const other = harness.tenants.one
    const elsewhere = await send('GET', '/api/v1/public/classes', visitorAt(other))
    assert.equal(elsewhere.status, 200, 'another studio is not paused with it')
  })

  test("TEN-43 a member's session from studio two, sent on studio one's hostname, is no session there: /me answers 401 invalid_token and the pool's get-session answers none", async () => {
    const one = harness.tenants.one
    const two = harness.tenants.two
    const fromTwo = await memberAt(two, 'visitor')
    const onOne = { ...visitorAt(one), Authorization: fromTwo.headers.Authorization! }

    const me = await send('GET', '/api/v1/me', onOne)
    assert.deepEqual([me.status, me.body], [401, { error: 'invalid_token' }])

    const session = await send('GET', '/api/v1/auth/client/get-session', onOne)
    assert.deepEqual([session.status, session.body], [200, null])

    assert.equal((await send('GET', '/api/v1/me', { ...visitorAt(two), Authorization: fromTwo.headers.Authorization! })).status, 200, 'the same session at its own studio')
  })
})
