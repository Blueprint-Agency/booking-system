import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * Members sign in with email and password (#173), through the routes a browser
 * calls. The form asks for the email first: an address with a password is asked
 * for it; any other address is mailed a set-password link if it is a member
 * here, and nothing if it is not — and both answers look the same.
 */
describe('member passwords', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `passwords-${run}.test`
  const ADMIN = `admin@${DOMAIN}`
  const at = (name: string) => `${name}@${DOMAIN}`
  const PASSWORD = 'correct horse battery'

  let admin!: Record<string, string>

  const memberHeaders = (tenant: { slug: string }, address = harnessAddress()): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('client', tenant),
    'X-Forwarded-For': address,
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
    // Our routes answer `{ error }`; Better Auth's own answer `{ message }`.
    if (error) assert.equal(parsed.error ?? parsed.message, error)
    return parsed
  }

  const mailsTo = (email: string) => discardedMail.filter(m => m.to === email)
  const resetLinkIn = (html: string) => {
    const match = html.match(/href="([^"]*\/reset-password\/[^"]+)"/)
    assert.ok(match, 'the message carries no set-password link')
    return match[1]!.replace(/&amp;/g, '&')
  }

  const signInStep = (tenant: { slug: string }, email: string, address?: string) =>
    send('/api/v1/public/members/sign-in-step', { body: { email }, headers: memberHeaders(tenant, address) })

  const signInWithPassword = (tenant: { slug: string }, email: string, password: string, address?: string) =>
    send('/api/v1/auth/client/sign-in/email', { body: { email, password }, headers: memberHeaders(tenant, address) })

  /** Follow the newest set-password link mailed to `email` to the token the member app receives. */
  const tokenFromLink = async (email: string) => {
    const mail = mailsTo(email).at(-1)
    assert.ok(mail, `no mail was sent to ${email}`)
    const link = new URL(resetLinkIn(mail.html))
    // Opened from an inbox: no tenant header, no Origin.
    const opened = await harness.app.request(link.pathname + link.search)
    assert.equal(opened.status, 302, await opened.clone().text())
    const location = new URL(opened.headers.get('location')!)
    assert.equal(location.pathname, '/set-password')
    const token = location.searchParams.get('token')
    assert.ok(token, `the link handed over no token: ${location}`)
    return token
  }

  const setPassword = (tenant: { slug: string }, token: string, password: string) =>
    send('/api/v1/public/members/set-password', { body: { token, password }, headers: memberHeaders(tenant) })

  const bearerAt = (tenant: { slug: string }, token: string) => ({
    ...memberHeaders(tenant),
    Authorization: `Bearer ${token}`,
  })

  const me = (headers: Record<string, string>) => send('/api/v1/me', { headers })

  /** A member added by an admin: a `clients` row and an auth user with no password — as the import writes. */
  const memberWithoutPassword = async (tenant: { id: string; slug: string }, email: string) => {
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const authUserId = await ensureAuthUser(harness.db, 'client', { email, name: 'Imported Member' })
    const [row] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: tenant.id, authUserId, email, name: 'Imported Member', phone: '+6590000000', status: 'active' })
      .returning()
    return { row: row!, authUserId }
  }

  /** Take a member with no password through the link to a password, returning their session. */
  const passwordSetThroughLink = async (tenant: { id: string; slug: string }, email: string) => {
    await expectStatus(await signInStep(tenant, email), 200)
    const res = await setPassword(tenant, await tokenFromLink(email), PASSWORD)
    const body = await expectStatus(res, 200)
    return bearerAt(tenant, body.token as string)
  }

  const codeFor = async (tenant: { slug: string }, email: string) => {
    await expectStatus(
      await send('/api/v1/auth/client/email-otp/send-verification-otp', {
        body: { email, type: 'sign-in' },
        headers: memberHeaders(tenant),
      }),
      200,
    )
    const otp = mailsTo(email).at(-1)?.html.match(/>(\d{6})</)?.[1]
    assert.ok(otp, `no code was mailed to ${email}`)
    return otp
  }

  const authEvents = (userId: string, kind: string) =>
    harness.db
      .select()
      .from(schema.authEvents)
      .where(and(eq(schema.authEvents.actorUserId, userId), eq(schema.authEvents.kind, kind as never)))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    ;({ one, two } = harness.tenants)

    admin = await harness.signInAs('staff', ADMIN, one)
    const [staffUser] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, ADMIN))
    await harness.db.insert(schema.staffUsers).values({
      tenantId: one.id,
      email: ADMIN,
      name: 'Probe Admin',
      role: 'admin',
      status: 'active',
      authUserId: staffUser!.id,
    })
  })

  after(async () => {
    if (!harness) return
    const members = await harness.db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(like(schema.clients.email, `%@${DOMAIN}`))
    const ids = members.map(m => m.id)
    const staff = await harness.db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const staffIds = staff.map(s => s.id)
    if (staffIds.length) await harness.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
    if (ids.length) await harness.db.delete(schema.clients).where(inArray(schema.clients.id, ids))
    if (staffIds.length) await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  test('a member with no password is mailed a set-password link, and setting it signs them in to the studio', async () => {
    const email = at('imported')
    await memberWithoutPassword(one, email)
    const before = mailsTo(email).length

    const step = await expectStatus(await signInStep(one, email), 200)
    assert.deepEqual(step, { next: 'link_sent' })
    assert.equal(mailsTo(email).length, before + 1, 'one mail went out')
    const mail = mailsTo(email).at(-1)!
    assert.match(mail.html, /reset-password\//)

    // Worded by the studio's own `password_reset` template, and filed under it.
    const [logged] = await harness.db
      .select()
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.tenantId, one.id), eq(schema.emailLog.recipientEmail, email)))
    assert.equal(logged?.templateSlug, 'password_reset')

    const res = await setPassword(one, await tokenFromLink(email), PASSWORD)
    const body = await expectStatus(res, 200)
    assert.equal(typeof body.token, 'string')
    assert.equal(res.headers.get('set-auth-token'), body.token)

    const headers = bearerAt(one, body.token as string)
    const profile = await expectStatus(await me(headers), 200)
    assert.equal(profile.email, email)
    // The session carries this studio's claim, so it is refused at another.
    await expectStatus(await me({ ...headers, ...memberHeaders(two) }), 403, 'tenant_mismatch')
  })

  test('once set, the email step asks for the password, and a wrong one is refused and recorded', async () => {
    const email = at('returning')
    const { authUserId } = await memberWithoutPassword(one, email)
    await passwordSetThroughLink(one, email)
    const before = mailsTo(email).length

    assert.deepEqual(await expectStatus(await signInStep(one, email), 200), { next: 'password' })
    assert.equal(mailsTo(email).length, before, 'no mail for an address that has a password')

    const wrong = await signInWithPassword(one, email, 'not the password')
    await expectStatus(wrong, 401)
    assert.equal(wrong.headers.get('set-auth-token'), null)
    const failed = await authEvents(authUserId, 'sign_in_failed')
    assert.equal(failed.length, 1, 'the refused password is an auth event')
    assert.equal(failed[0]!.pool, 'client')
    assert.equal(failed[0]!.tenantId, one.id)

    const right = await signInWithPassword(one, email, PASSWORD)
    await expectStatus(right, 200)
    const token = right.headers.get('set-auth-token')
    assert.ok(token)
    await expectStatus(await me(bearerAt(one, token)), 200)
  })

  test('an address that is no member here gets the same answer, and no link', async () => {
    const stranger = at('stranger')
    const elsewhere = at('member-elsewhere')
    await memberWithoutPassword(two, elsewhere)

    for (const email of [stranger, elsewhere]) {
      const before = mailsTo(email).length
      assert.deepEqual(await expectStatus(await signInStep(one, email), 200), { next: 'link_sent' })
      assert.equal(mailsTo(email).length, before, `no link was mailed to ${email}`)
    }
  })

  test('a used link and an expired link are refused', async () => {
    const email = at('link-once')
    const { authUserId } = await memberWithoutPassword(one, email)
    await expectStatus(await signInStep(one, email), 200)
    const token = await tokenFromLink(email)
    await expectStatus(await setPassword(one, token, PASSWORD), 200)
    await expectStatus(await setPassword(one, token, 'another password'), 400, 'invalid_token')

    const expiring = at('link-expired')
    await memberWithoutPassword(one, expiring)
    await expectStatus(await signInStep(one, expiring), 200)
    const stale = await tokenFromLink(expiring)
    await harness.db
      .update(schema.clientAuthVerifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.clientAuthVerifications.identifier, `reset-password:${stale}`))
    await expectStatus(await setPassword(one, stale, PASSWORD), 400, 'invalid_token')
    assert.ok(authUserId)
  })

  test('a link works only at a studio its owner is a member of, and a refusal leaves it usable there', async () => {
    const email = at('link-elsewhere')
    await memberWithoutPassword(one, email)
    await expectStatus(await signInStep(one, email), 200)
    const token = await tokenFromLink(email)

    await expectStatus(await setPassword(two, token, PASSWORD), 400, 'invalid_token')
    await expectStatus(await setPassword(one, token, PASSWORD), 200)
  })

  test('the email step is limited per email even when it answers "password"', async () => {
    const email = at('probed')
    await memberWithoutPassword(one, email)
    await passwordSetThroughLink(one, email)
    const answers: number[] = []
    for (let i = 0; i < 12; i++) answers.push((await signInStep(one, email)).status)
    assert.ok(answers.includes(429), `the probing was never slowed down: ${answers}`)
  })

  test('a password shorter than 8 characters is refused', async () => {
    const email = at('short')
    await memberWithoutPassword(one, email)
    await expectStatus(await signInStep(one, email), 200)
    await expectStatus(await setPassword(one, await tokenFromLink(email), 'seven77'), 400, 'password_too_short')
  })

  test('sign-up takes a password, and the account exists only once the emailed code is confirmed', async () => {
    const email = at('sign-up')
    const details = { email, first_name: 'Ada', last_name: 'Lovelace', phone: '+6591234567', password: PASSWORD }

    await codeFor(one, email)
    await expectStatus(
      await send('/api/v1/public/members/register', { body: { ...details, otp: '000000' }, headers: memberHeaders(one) }),
      400,
      'invalid_otp',
    )
    await expectStatus(await signInWithPassword(one, email, PASSWORD), 401)

    const res = await send('/api/v1/public/members/register', {
      body: { ...details, otp: await codeFor(one, email) },
      headers: memberHeaders(one),
    })
    const body = await expectStatus(res, 200)
    await expectStatus(await me(bearerAt(one, body.token as string)), 200)

    const again = await signInWithPassword(one, email, PASSWORD)
    await expectStatus(again, 200)
    assert.deepEqual(await expectStatus(await signInStep(one, email), 200), { next: 'password' })
  })

  test('sign-up refuses a password shorter than 8 characters', async () => {
    const email = at('sign-up-short')
    await expectStatus(
      await send('/api/v1/public/members/register', {
        body: { email, otp: await codeFor(one, email), first_name: 'A', last_name: 'B', phone: '+65', password: 'short' },
        headers: memberHeaders(one),
      }),
      400,
    )
  })

  test('the emailed code no longer signs a member in', async () => {
    const email = at('code-only')
    await memberWithoutPassword(one, email)
    const otp = await codeFor(one, email)
    const res = await send('/api/v1/auth/client/sign-in/email-otp', { body: { email, otp }, headers: memberHeaders(one) })
    assert.equal(res.status, 404, await res.text())
    assert.equal(res.headers.get('set-auth-token'), null)
  })

  test('forgot password mails a link to a member who has one, and the new password replaces it', async () => {
    const email = at('forgot')
    await memberWithoutPassword(one, email)
    await passwordSetThroughLink(one, email)

    assert.deepEqual(
      await expectStatus(
        await send('/api/v1/public/members/password-link', { body: { email }, headers: memberHeaders(one) }),
        200,
      ),
      { next: 'link_sent' },
    )
    await expectStatus(await setPassword(one, await tokenFromLink(email), 'a brand new one'), 200)
    await expectStatus(await signInWithPassword(one, email, PASSWORD), 401)
    await expectStatus(await signInWithPassword(one, email, 'a brand new one'), 200)
  })

  test('a member changes their password with the current one', async () => {
    const email = at('changer')
    await memberWithoutPassword(one, email)
    const headers = await passwordSetThroughLink(one, email)

    await expectStatus(
      await send('/api/v1/auth/client/change-password', {
        body: { currentPassword: 'not it at all', newPassword: 'the next password' },
        headers,
      }),
      400,
    )
    await expectStatus(
      await send('/api/v1/auth/client/change-password', {
        body: { currentPassword: PASSWORD, newPassword: 'short' },
        headers,
      }),
      400,
    )
    await expectStatus(
      await send('/api/v1/auth/client/change-password', {
        body: { currentPassword: PASSWORD, newPassword: 'the next password' },
        headers,
      }),
      200,
    )
    await expectStatus(await signInWithPassword(one, email, PASSWORD), 401)
    await expectStatus(await signInWithPassword(one, email, 'the next password'), 200)
  })

  test('link requests are limited per email, whatever the address', async () => {
    const email = at('flooded')
    await memberWithoutPassword(one, email)
    const before = mailsTo(email).length
    const answers: number[] = []
    for (let i = 0; i < 6; i++) answers.push((await signInStep(one, email)).status)
    assert.ok(answers.every(s => s === 200 || s === 429), `unexpected answers ${answers}`)
    assert.ok(answers.includes(429), 'the flood was slowed down')
    assert.ok(mailsTo(email).length - before <= 3, `too many links went out: ${mailsTo(email).length - before}`)
  })

  test('password attempts are limited per email, whatever the address', async () => {
    const email = at('guessed')
    await memberWithoutPassword(one, email)
    await passwordSetThroughLink(one, email)
    const answers: number[] = []
    for (let i = 0; i < 12; i++) answers.push((await signInWithPassword(one, email, `guess ${i}`)).status)
    assert.ok(answers.includes(429), `the guessing was never slowed down: ${answers}`)
  })

  test('password attempts and link requests are limited per address', async () => {
    const address = harnessAddress()
    const answers: number[] = []
    for (let i = 0; i < 12; i++) answers.push((await signInWithPassword(one, at(`nobody-${i}`), 'whatever it is', address)).status)
    assert.ok(answers.includes(429), `password attempts from one address were never slowed: ${answers}`)

    const linkAddress = harnessAddress()
    const links: number[] = []
    for (let i = 0; i < 8; i++) links.push((await signInStep(one, at(`nobody-link-${i}`), linkAddress)).status)
    assert.ok(links.includes(429), `link requests from one address were never slowed: ${links}`)
  })

  test('an admin sends a member a set-password link from the member detail', async () => {
    const email = at('helped')
    const { row } = await memberWithoutPassword(one, email)
    const before = mailsTo(email).length

    const res = await expectStatus(
      await send(`/api/v1/portal/admin/clients/${row.id}/send-set-password`, { body: {}, headers: admin }),
      200,
    )
    assert.deepEqual(res, { sent: true })
    assert.equal(mailsTo(email).length, before + 1)
    const signedIn = await setPassword(one, await tokenFromLink(email), PASSWORD)
    await expectStatus(signedIn, 200)
  })

  test('an admin cannot send a link to another studio\'s member', async () => {
    const { row } = await memberWithoutPassword(two, at('not-yours'))
    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${row.id}/send-set-password`, { body: {}, headers: admin }),
      404,
    )
  })

  test('a blocked member is refused, by password and by link', async () => {
    const email = at('blocked')
    const { row } = await memberWithoutPassword(one, email)
    await passwordSetThroughLink(one, email)
    await expectStatus(await send(`/api/v1/portal/admin/clients/${row.id}`, { method: 'DELETE', headers: admin }), 200)

    await expectStatus(await signInWithPassword(one, email, PASSWORD), 403, 'client_blocked')
    const before = mailsTo(email).length
    await expectStatus(
      await send('/api/v1/public/members/password-link', { body: { email }, headers: memberHeaders(one) }),
      200,
    )
    assert.equal(mailsTo(email).length, before, 'a blocked member is mailed no link')
  })

  test('impersonation opens a session without the member\'s password, and cannot change it', async () => {
    const email = at('impersonated')
    const { row } = await memberWithoutPassword(one, email)
    await passwordSetThroughLink(one, email)

    const minted = await expectStatus(
      await send(`/api/v1/portal/admin/clients/${row.id}/impersonate`, { body: {}, headers: admin }),
      200,
    )
    const headers = {
      ...bearerAt(one, minted.token as string),
      'X-Impersonation-Grant': minted.grant as string,
    }
    await expectStatus(await me(headers), 200)
    await expectStatus(
      await send('/api/v1/auth/client/change-password', {
        body: { currentPassword: PASSWORD, newPassword: 'taken over now' },
        headers,
      }),
      403,
      'impersonation_forbidden',
    )
  })
})
