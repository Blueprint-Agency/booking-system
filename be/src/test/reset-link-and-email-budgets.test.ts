import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, inArray, like } from 'drizzle-orm'
import { AUTH_EMAIL_RATE_LIMITS } from '../services/auth/rate-limit'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * Two things per-studio logins (#228) need before the auth tables go behind
 * Row-Level Security (#230):
 *
 *   - A set-password link opened from an inbox carries no studio, so the GET it
 *     lands on runs outside any Tenant context — where a token lookup would find
 *     nothing. It makes none: it checks the callback is one of our frontends and
 *     hands the token over. The page's POST, inside the studio's context, is
 *     where the token is judged.
 *   - A budget kept per email is kept per studio and email, so attempts at one
 *     studio do not spend the same address's budget at another.
 */
describe('reset link from the inbox, and per-studio email budgets', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `reset-budgets-${run}.test`
  const at = (name: string) => `${name}@${DOMAIN}`
  const PASSWORD = 'a password of their own'

  const headersAt = (pool: 'client' | 'staff', tenant: { slug: string }): Record<string, string> => ({
    'Content-Type': 'application/json',
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin(pool, tenant),
    // A fresh address per request, so only the per-email budgets are in play.
    'X-Forwarded-For': harnessAddress(),
  })

  const post = (pool: 'client' | 'staff', path: string, tenant: { slug: string }, body: unknown) =>
    harness.app.request(path, { method: 'POST', headers: headersAt(pool, tenant), body: JSON.stringify(body) })

  /** Open a reset link the way a mail client does: a bare GET, no studio, no Origin. */
  const openFromInbox = (pool: 'client' | 'staff', token: string, callbackURL: string | null) => {
    const query = callbackURL === null ? '' : `?callbackURL=${encodeURIComponent(callbackURL)}`
    return harness.app.request(`/api/v1/auth/${pool}/reset-password/${token}${query}`)
  }

  const mailsTo = (email: string) => discardedMail.filter(m => m.to === email)

  /** Follow the newest link mailed to `email` from the inbox, to the token the frontend is handed. */
  const tokenFromInbox = async (pool: 'client' | 'staff', email: string, landsOn: string) => {
    const mail = mailsTo(email).at(-1)
    assert.ok(mail, `no mail was sent to ${email}`)
    const href = mail.html.match(/href="([^"]*\/reset-password\/[^"]+)"/)?.[1]
    assert.ok(href, 'the message carries no set-password link')
    const link = new URL(href.replace(/&amp;/g, '&'))
    assert.equal(link.pathname.startsWith(`/api/v1/auth/${pool}/reset-password/`), true, link.pathname)
    const opened = await harness.app.request(link.pathname + link.search)
    assert.equal(opened.status, 302, await opened.clone().text())
    const location = new URL(opened.headers.get('location')!)
    assert.equal(location.pathname, landsOn)
    const token = location.searchParams.get('token')
    assert.ok(token, `the link handed over no token: ${location}`)
    return token
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    ;({ one, two } = harness.tenants)
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.staffUsers).where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.clients).where(like(schema.clients.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    const staffAuth = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    if (staffAuth.length) {
      await harness.db.delete(schema.staffAuthUsers).where(
        inArray(
          schema.staffAuthUsers.id,
          staffAuth.map(u => u.id),
        ),
      )
    }
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  for (const [pool, page] of [
    ['client', '/set-password'],
    ['staff', '/login'],
  ] as const) {
    test(`AUTH-16 a ${pool} reset link opened from the inbox hands its token to an allowed frontend, looking nothing up`, async () => {
      // A token no pool ever issued: a lookup would have turned it away here.
      const token = randomUUID()
      const callback = `${frontendOrigin(pool, one)}${page}?from=mail`
      const opened = await openFromInbox(pool, token, callback)
      assert.equal(opened.status, 302, await opened.clone().text())
      const location = new URL(opened.headers.get('location')!)
      assert.equal(location.origin, frontendOrigin(pool, one))
      assert.equal(location.pathname, page)
      assert.equal(location.searchParams.get('token'), token)
      assert.equal(location.searchParams.get('from'), 'mail', "the callback's own query survives")
    })

    test(`AUTH-17 a ${pool} reset link whose callback is not one of our frontends is refused, with no redirect`, async () => {
      for (const callback of [
        'https://evil.example/set-password',
        `${frontendOrigin(pool, one)}.evil.example/set-password`,
        '/set-password',
        'javascript:alert(1)',
        null,
      ]) {
        const opened = await openFromInbox(pool, randomUUID(), callback)
        assert.equal(opened.status, 403, `${callback}: ${await opened.clone().text()}`)
        assert.equal(opened.headers.get('location'), null, `${callback} was redirected`)
        assert.equal(((await opened.json()) as { error?: string }).error, 'origin_not_allowed')
      }
    })
  }

  test('AUTH-16 a member sets their password through a link opened from the inbox; a made-up token is refused', async () => {
    const email = at('member-link')
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const authUserId = await ensureAuthUser(harness.db, 'client', { tenantId: one.id, email, name: 'Linked Member' })
    await harness.db
      .insert(schema.clients)
      .values({ tenantId: one.id, authUserId, email, name: 'Linked Member', phone: '+6590000000', status: 'active' })

    const step = await post('client', '/api/v1/public/members/sign-in-step', one, { email })
    assert.equal(step.status, 200, await step.clone().text())
    const token = await tokenFromInbox('client', email, '/set-password')

    const made = await post('client', '/api/v1/public/members/set-password', one, { token: randomUUID(), password: PASSWORD })
    assert.equal(made.status, 400, await made.clone().text())
    assert.equal(((await made.json()) as { error?: string }).error, 'invalid_token')

    const set = await post('client', '/api/v1/public/members/set-password', one, { token, password: PASSWORD })
    assert.equal(set.status, 200, await set.clone().text())
    assert.ok(((await set.json()) as { token?: string }).token, 'setting the password signs the member in')
  })

  test('AUTH-16 staff set their password through a link opened from the inbox; a made-up or expired token is refused', async () => {
    const email = at('staff-link')
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const authUserId = await ensureAuthUser(harness.db, 'staff', { tenantId: one.id, email, name: 'Linked Staff' })
    await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: one.id, email, name: 'Linked Staff', role: 'admin', status: 'active', authUserId })

    const step = await post('staff', '/api/v1/public/staff/sign-in-step', one, { email })
    assert.equal(step.status, 200, await step.clone().text())
    const token = await tokenFromInbox('staff', email, '/login')

    const made = await post('staff', '/api/v1/auth/staff/reset-password', one, { token: randomUUID(), newPassword: PASSWORD })
    assert.equal(made.status, 400, await made.clone().text())

    // An expired link got through the GET too: the POST is what refuses it.
    await harness.db
      .update(schema.staffAuthVerifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.staffAuthVerifications.identifier, `reset-password:${token}`))
    const expired = await post('staff', '/api/v1/auth/staff/reset-password', one, { token, newPassword: PASSWORD })
    assert.equal(expired.status, 400, await expired.clone().text())

    const again = await post('staff', '/api/v1/public/staff/sign-in-step', one, { email })
    assert.equal(again.status, 200, await again.clone().text())
    const fresh = await tokenFromInbox('staff', email, '/login')
    const set = await post('staff', '/api/v1/auth/staff/reset-password', one, { token: fresh, newPassword: PASSWORD })
    assert.equal(set.status, 200, await set.clone().text())
    const signedIn = await post('staff', '/api/v1/auth/staff/sign-in/email', one, { email, password: PASSWORD })
    assert.equal(signedIn.status, 200, await signedIn.clone().text())
  })

  const { linkRequest, signInAttempt, signInStep } = AUTH_EMAIL_RATE_LIMITS

  test("AUTH-18 spending an email's password attempts at one studio leaves its budget at another", async () => {
    const email = at('guessed')
    const attempt = (tenant: { slug: string }) =>
      post('client', '/api/v1/auth/client/sign-in/email', tenant, { email, password: 'not the password' })

    for (let i = 0; i < signInAttempt.max; i++) assert.notEqual((await attempt(one)).status, 429, `attempt ${i + 1} at one`)
    assert.equal((await attempt(one)).status, 429, 'the budget at one is spent')
    assert.notEqual((await attempt(two)).status, 429, 'the budget at two is untouched')
  })

  test("AUTH-18 spending an email's member sign-in step at one studio leaves its budget at another", async () => {
    // With a password, so the step answers `password` and asks the pool for no link.
    const email = at('stepped')
    await harness.signInAs('client', email, one)
    const step = (tenant: { slug: string }) => post('client', '/api/v1/public/members/sign-in-step', tenant, { email })

    for (let i = 0; i < signInStep.max; i++) assert.equal((await step(one)).status, 200, `step ${i + 1} at one`)
    assert.equal((await step(one)).status, 429, 'the budget at one is spent')
    assert.equal((await step(two)).status, 200, 'the budget at two is untouched')
  })

  test("AUTH-18 spending an email's member link budget at one studio leaves its budget at another", async () => {
    // No password, so every step asks the pool for a set-password link.
    const email = at('linked-twice')
    const step = (tenant: { slug: string }) => post('client', '/api/v1/public/members/sign-in-step', tenant, { email })

    for (let i = 0; i < linkRequest.max; i++) assert.equal((await step(one)).status, 200, `step ${i + 1} at one`)
    assert.equal((await step(one)).status, 429, 'the link budget at one is spent')
    assert.equal((await step(two)).status, 200, 'the link budget at two is untouched')
  })

  test("AUTH-18 spending an email's staff link budget at one studio still mails its link at another", async () => {
    const email = at('staff-twice')
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    // Staff at both studios, with a login at each (#231).
    for (const tenant of [one, two]) {
      const authUserId = await ensureAuthUser(harness.db, 'staff', { tenantId: tenant.id, email, name: 'Staff Twice' })
      await harness.db
        .insert(schema.staffUsers)
        .values({ tenantId: tenant.id, email, name: 'Staff Twice', role: 'admin', status: 'active', authUserId })
    }
    const step = async (tenant: { slug: string }) => {
      const res = await post('staff', '/api/v1/public/staff/sign-in-step', tenant, { email })
      assert.equal(res.status, 200, await res.clone().text())
    }

    for (let i = 0; i < linkRequest.max; i++) await step(one)
    assert.equal(mailsTo(email).length, linkRequest.max)
    await step(one)
    assert.equal(mailsTo(email).length, linkRequest.max, 'the link budget at one is spent')
    await step(two)
    assert.equal(mailsTo(email).length, linkRequest.max + 1, 'the link budget at two is untouched')
  })
})
