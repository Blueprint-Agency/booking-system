import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  HARNESS_PASSWORD,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * Per-studio logins (#231): the same email at two studios is two accounts.
 *
 * Each studio's member app and portal has its own login for an address — its
 * own password, sign-up codes and set-password links — and nothing done at one
 * studio (a registration, a reset, a block, a deletion, an email change)
 * reaches the other. Driven over real HTTP, on each studio's own hostname, and
 * judged by who can then sign in where, with what.
 */
describe('per-studio logins', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `per-studio-${run}.test`
  const at = (name: string) => `${name}@${DOMAIN}`

  const PASSWORD_A = 'the password at studio a'
  const PASSWORD_B = 'the password at studio b'

  /** Each studio's admin, signed in on its own portal. */
  const admins: Record<string, Record<string, string>> = {}

  const memberHeaders = (tenant: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('client', tenant),
    'X-Forwarded-For': harnessAddress(),
  })

  const portalHeaders = (tenant: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('staff', tenant),
    'X-Forwarded-For': harnessAddress(),
  })

  const send = (path: string, init: { body?: unknown; headers: Record<string, string>; method?: string }) =>
    harness.app.request(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })

  const expectStatus = async (res: Response, status: number, error?: string) => {
    const body = await res.text()
    assert.equal(res.status, status, body)
    const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {}
    if (error) assert.equal(parsed.error ?? parsed.message, error)
    return parsed
  }

  /* ── members ─────────────────────────────────────────────────────────── */

  const requestCode = async (tenant: { slug: string }, email: string) => {
    await expectStatus(
      await send('/api/v1/auth/client/email-otp/send-verification-otp', {
        body: { email, type: 'sign-in' },
        headers: memberHeaders(tenant),
      }),
      200,
    )
    const otp = [...discardedMail].reverse().find(m => m.to === email)?.html.match(/>(\d{6})</)?.[1]
    assert.ok(otp, `no code was mailed to ${email}`)
    return otp
  }

  const registerBody = (email: string, otp: string, password: string) => ({
    email,
    otp,
    first_name: 'Ada',
    last_name: 'Lovelace',
    phone: '+6591234567',
    password,
  })

  /** Register `email` at `tenant` with `password`, the way the member app does. */
  const register = async (tenant: { slug: string }, email: string, password: string) => {
    const otp = await requestCode(tenant, email)
    await expectStatus(
      await send('/api/v1/public/members/register', {
        body: registerBody(email, otp, password),
        headers: memberHeaders(tenant),
      }),
      200,
    )
  }

  const memberSignIn = (tenant: { slug: string }, email: string, password: string) =>
    send('/api/v1/auth/client/sign-in/email', { body: { email, password }, headers: memberHeaders(tenant) })

  /** Whether `password` signs `email` in to `tenant`'s member app, and reaches its member there. */
  const memberCanSignIn = async (tenant: { slug: string }, email: string, password: string) => {
    const res = await memberSignIn(tenant, email, password)
    const token = res.headers.get('set-auth-token')
    if (res.status !== 200 || !token) return false
    const me = await send('/api/v1/me', { headers: { ...memberHeaders(tenant), Authorization: `Bearer ${token}` } })
    return me.status === 200
  }

  /** "Forgot password" at `tenant`, then the link from the inbox, then a new password. */
  const resetMemberPassword = async (tenant: { slug: string }, email: string, password: string) => {
    const mailedBefore = discardedMail.filter(m => m.to === email).length
    await expectStatus(
      await send('/api/v1/public/members/password-link', { body: { email }, headers: memberHeaders(tenant) }),
      200,
    )
    const mails = discardedMail.filter(m => m.to === email)
    assert.equal(mails.length, mailedBefore + 1, 'a set-password link was mailed')
    const link = new URL(mails.at(-1)!.html.match(/href="([^"]*\/reset-password\/[^"]+)"/)![1]!.replace(/&amp;/g, '&'))
    const opened = await harness.app.request(link.pathname + link.search)
    const token = new URL(opened.headers.get('location')!).searchParams.get('token')
    await expectStatus(
      await send('/api/v1/public/members/set-password', { body: { token, password }, headers: memberHeaders(tenant) }),
      200,
    )
  }

  const clientRow = async (tenantId: string, email: string) => {
    const [row] = await harness.db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, tenantId), eq(schema.clients.email, email)))
    return row ?? null
  }

  /* ── staff ───────────────────────────────────────────────────────────── */

  const staffSignIn = (tenant: { slug: string }, email: string, password: string) =>
    send('/api/v1/auth/staff/sign-in/email', { body: { email, password }, headers: portalHeaders(tenant) })

  /** Whether `password` signs `email` in to `tenant`'s portal, and reaches their staff record there. */
  const staffCanSignIn = async (tenant: { slug: string }, email: string, password: string) => {
    const res = await staffSignIn(tenant, email, password)
    const token = res.headers.get('set-auth-token')
    if (res.status !== 200 || !token) return false
    const me = await send('/api/v1/portal/auth/me', {
      headers: { ...portalHeaders(tenant), Authorization: `Bearer ${token}` },
    })
    return me.status === 200
  }

  /** An active staff member at `tenant`, on that studio's own login, with no password yet. */
  const staffWithoutPassword = async (tenant: { id: string }, email: string) => {
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const authUserId = await ensureAuthUser(harness.db, 'staff', {
      tenantId: tenant.id,
      email,
      name: email.split('@')[0]!,
    })
    await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: email.split('@')[0]!, role: 'admin', status: 'active', authUserId })
  }

  /** The email step at `tenant`, then the link it mailed, then a new password. */
  const setStaffPasswordThroughStep = async (tenant: { slug: string }, email: string, password: string) => {
    const step = await expectStatus(
      await send('/api/v1/public/staff/sign-in-step', { body: { email }, headers: portalHeaders(tenant) }),
      200,
    )
    assert.deepEqual(step, { next: 'link_sent' })
    const mail = discardedMail.filter(m => m.to === email).at(-1)
    assert.ok(mail, `no mail was sent to ${email}`)
    const token = mail.html.match(/\/reset-password\/([^?"'\s<]+)/)![1]!
    await expectStatus(
      await send('/api/v1/auth/staff/reset-password', {
        body: { token, newPassword: password },
        headers: portalHeaders(tenant),
      }),
      200,
    )
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    ;({ one, two } = harness.tenants)

    for (const tenant of [one, two]) {
      const email = at(`admin-${tenant.slug}`)
      admins[tenant.slug] = await harness.signInAs('staff', email, tenant)
      const [login] = await harness.db
        .select()
        .from(schema.staffAuthUsers)
        .where(eq(schema.staffAuthUsers.email, email))
      await harness.db.insert(schema.staffUsers).values({
        tenantId: tenant.id,
        email,
        name: 'Probe Admin',
        role: 'admin',
        status: 'active',
        authUserId: login!.id,
      })
    }
  })

  after(async () => {
    if (!harness) return
    const members = await harness.db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(like(schema.clients.email, `%@${DOMAIN}`))
    const staff = await harness.db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const staffIds = staff.map(s => s.id)
    if (staffIds.length) {
      await harness.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
    }
    if (members.length) {
      await harness.db.delete(schema.clients).where(inArray(schema.clients.id, members.map(m => m.id)))
    }
    if (staffIds.length) await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  test('TEN-17 a member registered at two studios has a password at each, and neither opens the other', async () => {
    const email = at('two-studios')
    await register(one, email, PASSWORD_A)
    await register(two, email, PASSWORD_B)

    assert.ok(await memberCanSignIn(one, email, PASSWORD_A), "registering at B left A's password working")
    assert.ok(await memberCanSignIn(two, email, PASSWORD_B))
    assert.equal(await memberCanSignIn(two, email, PASSWORD_A), false, "A's password does not sign in at B")
    assert.equal(await memberCanSignIn(one, email, PASSWORD_B), false, "B's password does not sign in at A")

    const [a, b] = [await clientRow(one.id, email), await clientRow(two.id, email)]
    assert.ok(a && b)
    assert.notEqual(a.authUserId, b.authUserId, 'two records, on two logins')
  })

  test("TEN-18 a member's reset at one studio leaves their password at the other alone", async () => {
    const email = at('reset-at-a')
    await register(one, email, PASSWORD_A)
    await register(two, email, PASSWORD_B)

    await resetMemberPassword(one, email, 'a brand new password')

    assert.ok(await memberCanSignIn(one, email, 'a brand new password'))
    assert.equal(await memberCanSignIn(two, email, 'a brand new password'), false)
    assert.ok(await memberCanSignIn(two, email, PASSWORD_B), "B's password is unchanged")
  })

  test('TEN-19 a sign-up code requested at one studio does not register anyone at another', async () => {
    const email = at('code-at-a')
    const otp = await requestCode(one, email)

    const refused = await send('/api/v1/public/members/register', {
      body: registerBody(email, otp, PASSWORD_B),
      headers: memberHeaders(two),
    })
    assert.equal(refused.status, 400, await refused.text())
    assert.equal(await clientRow(two.id, email), null, 'no member was written at B')

    // The code is still A's to spend.
    await expectStatus(
      await send('/api/v1/public/members/register', {
        body: registerBody(email, otp, PASSWORD_A),
        headers: memberHeaders(one),
      }),
      200,
    )
  })

  test('TEN-20 the email step asks for a password only when the address has one at this studio', async () => {
    const email = at('step')
    await register(one, email, PASSWORD_A)
    // Added at B by its admin: a member there, with no password there yet.
    await expectStatus(
      await send('/api/v1/portal/admin/clients', {
        body: { name: 'Ada Lovelace', email, phone: '+6591234567' },
        headers: admins[two.slug]!,
      }),
      201,
    )

    const step = (tenant: { slug: string }) =>
      send('/api/v1/public/members/sign-in-step', { body: { email }, headers: memberHeaders(tenant) })
    assert.deepEqual(await expectStatus(await step(one), 200), { next: 'password' })
    assert.deepEqual(await expectStatus(await step(two), 200), { next: 'link_sent' })
  })

  test("TEN-21 blocking, deleting or moving a member at one studio leaves their other studio's login whole", async () => {
    const blocked = at('blocked-at-a')
    const deleted = at('deleted-at-a')
    const moved = at('moved-at-a')
    for (const email of [blocked, deleted, moved]) {
      await register(one, email, PASSWORD_A)
      await register(two, email, PASSWORD_B)
    }
    const admin = admins[one.slug]!

    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${(await clientRow(one.id, blocked))!.id}`, {
        method: 'DELETE',
        headers: admin,
      }),
      200,
    )
    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${(await clientRow(one.id, deleted))!.id}/permanently`, {
        method: 'DELETE',
        headers: admin,
      }),
      200,
    )
    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${(await clientRow(one.id, moved))!.id}/email`, {
        body: { email: at('moved-new') },
        headers: admin,
      }),
      200,
    )

    for (const email of [blocked, deleted, moved]) {
      assert.ok(await memberCanSignIn(two, email, PASSWORD_B), `${email} still signs in at B`)
      assert.equal(await memberCanSignIn(one, email, PASSWORD_A), false, `${email} no longer signs in at A`)
    }
  })

  test('TEN-22 staff at two studios have a password at each: setting one at a studio does not sign in at the other', async () => {
    const email = at('staff-two-studios')
    await staffWithoutPassword(one, email)
    await staffWithoutPassword(two, email)

    await setStaffPasswordThroughStep(one, email, PASSWORD_A)
    assert.ok(await staffCanSignIn(one, email, PASSWORD_A))
    assert.equal(await staffCanSignIn(two, email, PASSWORD_A), false, "A's password does not sign in at B")

    // B's own first password, through B's own email step.
    await setStaffPasswordThroughStep(two, email, PASSWORD_B)
    assert.ok(await staffCanSignIn(two, email, PASSWORD_B))
    assert.ok(await staffCanSignIn(one, email, PASSWORD_A), "setting B's password left A's alone")
    assert.equal(await staffCanSignIn(one, email, PASSWORD_B), false)
  })

  test("TEN-23 a staff reset at one studio leaves the other studio's password alone", async () => {
    const email = at('staff-reset')
    for (const tenant of [one, two]) {
      await harness.signInAs('staff', email, tenant)
      const [login] = await harness.db
        .select()
        .from(schema.staffAuthUsers)
        .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, tenant.id)))
      await harness.db.insert(schema.staffUsers).values({
        tenantId: tenant.id,
        email,
        name: 'Two Studio Staff',
        role: 'admin',
        status: 'active',
        authUserId: login!.id,
      })
    }

    await expectStatus(
      await send('/api/v1/auth/staff/request-password-reset', {
        body: { email, redirectTo: `${frontendOrigin('staff', one)}/login` },
        headers: portalHeaders(one),
      }),
      200,
    )
    const token = discardedMail.filter(m => m.to === email).at(-1)!.html.match(/\/reset-password\/([^?"'\s<]+)/)![1]!
    await expectStatus(
      await send('/api/v1/auth/staff/reset-password', {
        body: { token, newPassword: 'a new staff password' },
        headers: portalHeaders(one),
      }),
      200,
    )

    assert.ok(await staffCanSignIn(one, email, 'a new staff password'))
    assert.ok(await staffCanSignIn(two, email, HARNESS_PASSWORD), "B's password is unchanged")
    assert.equal(await staffCanSignIn(two, email, 'a new staff password'), false)
  })
})
