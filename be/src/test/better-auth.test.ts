import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { totp } from './totp'

/**
 * The Better Auth foundation (#112), over real HTTP, in-process.
 *
 * Three pools boot with the app, each on its own base path; each signs a user
 * in and hands back a bearer token; none accepts another's token. The mail each
 * sends is the studio's mail — its words, its name, its `Reply-To`, the right
 * envelope and an `email_log` row — except the super portal's, which speaks for
 * no studio. And the one-time codes exist only in the message: hashed in the
 * auth tables, redacted in the log.
 */
describe('better auth pools', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let tenant!: { id: string; slug: string }
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let schema!: typeof import('../db/schema')
  let ensureAuthUser!: typeof import('../services/auth/auth-users').ensureAuthUser

  const run = Date.now().toString(36)
  const MEMBER = `member-${run}@auth.test`
  const STAFF = `staff-${run}@auth.test`
  const PLATFORM = `platform-${run}@auth.test`
  const REPLY_TO = `front-desk-${run}@studio.test`
  const PASSWORD = 'correct horse battery staple'

  const clientOrigin = () => `http://${tenant.slug}.localhost:3000`
  const portalOrigin = () => `http://${tenant.slug}.portal.localhost:3001`
  /** The super portal's hostname, which names no studio the backend resolves. */
  const superPortalOrigin = 'http://admin.portal.localhost:3001'

  /** The headers each frontend sends from its own hostname. */
  const fromFrontend = (pool: 'client' | 'staff' | 'platform'): Record<string, string> =>
    pool === 'platform'
      ? { Origin: superPortalOrigin }
      : { 'X-Tenant-Slug': tenant.slug, Origin: pool === 'client' ? clientOrigin() : portalOrigin() }

  const call = (
    pool: 'client' | 'staff' | 'platform',
    path: string,
    init: { body?: unknown; headers?: Record<string, string>; method?: string } = {},
  ) =>
    harness.app.request(`/api/v1/auth/${pool}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...fromFrontend(pool),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

  /** The newest message the null transport dropped for this address. */
  const lastMailTo = (email: string) => {
    const message = [...discardedMail].reverse().find(m => m.to === email)
    assert.ok(message, `no mail was sent to ${email}`)
    return message
  }
  const codeIn = (html: string) => {
    const match = html.match(/>(\d{6})</)
    assert.ok(match, 'the message carries no six-digit code')
    return match[1]!
  }
  const resetLinkIn = (html: string) => {
    const match = html.match(/href="([^"]*\/reset-password\/[^"]+)"/)
    assert.ok(match, 'the message carries no reset link')
    return match[1]!.replace(/&amp;/g, '&')
  }

  const tokenOf = async (res: Response) => {
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${await res.clone().text()}`)
    const token = res.headers.get('set-auth-token')
    assert.ok(token, 'a signed-in response hands back a bearer token')
    return token
  }

  const sessionEmail = async (pool: 'client' | 'staff' | 'platform', token: string) => {
    const res = await call(pool, '/get-session', { headers: bearer(token) })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { user?: { email: string } } | null
    return body?.user?.email ?? null
  }

  const logRows = (email: string) =>
    harness.db
      .select()
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.tenantId, tenant.id), eq(schema.emailLog.recipientEmail, email)))

  /**
   * Set a first password the way a seeded account does: ask for a reset, follow
   * the mailed link, choose one.
   */
  const setFirstPassword = async (pool: 'staff' | 'platform', email: string) => {
    const redirectTo = `${fromFrontend(pool).Origin}/reset-password`
    const requested = await call(pool, '/request-password-reset', { body: { email, redirectTo } })
    assert.equal(requested.status, 200, await requested.clone().text())

    const link = new URL(resetLinkIn(lastMailTo(email).html))
    // Opened from an inbox: no tenant header, no Origin.
    const opened = await harness.app.request(link.pathname + link.search)
    assert.equal(opened.status, 302, 'the link checks the token and hands over to the frontend')
    const token = new URL(opened.headers.get('location')!).searchParams.get('token')
    assert.ok(token)

    const reset = await call(pool, '/reset-password', { body: { token, newPassword: PASSWORD } })
    assert.equal(reset.status, 200, await reset.clone().text())
  }

  before(async () => {
    harness = await startTestApp()
    tenant = harness.tenants.one
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    ;({ ensureAuthUser } = await import('../services/auth/auth-users'))

    await harness.db
      .update(schema.tenantSettings)
      .set({ mailReplyTo: REPLY_TO })
      .where(eq(schema.tenantSettings.tenantId, tenant.id))
    const { forgetCachedMailIdentity } = await import('../services/tenants/mail-identity')
    forgetCachedMailIdentity()

    await ensureAuthUser(harness.db, 'staff', { tenantId: tenant.id, email: STAFF, name: 'Probe Staff' })
    await ensureAuthUser(harness.db, 'platform', { email: PLATFORM, name: 'Probe Operator' })
  })

  after(async () => {
    if (!harness) return
    await harness.db
      .update(schema.tenantSettings)
      .set({ mailReplyTo: null })
      .where(eq(schema.tenantSettings.tenantId, tenant.id))
    await harness.db
      .delete(schema.emailLog)
      .where(inArray(schema.emailLog.recipientEmail, [MEMBER, STAFF, PLATFORM]))
    await harness.db.delete(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, MEMBER))
    await harness.db.delete(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, STAFF))
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, PLATFORM))
    await harness.close()
  })

  let memberToken!: string
  let staffToken!: string
  let platformToken!: string

  test('each pool answers on its own base path', async () => {
    for (const pool of ['client', 'staff', 'platform'] as const) {
      const res = await call(pool, '/ok')
      assert.equal(res.status, 200, `${pool} did not answer`)
      assert.deepEqual(await res.json(), { ok: true })
    }
  })

  test('an emailed code creates no member and signs no one in; a password does (#173)', async () => {
    const sent = await call('client', '/email-otp/send-verification-otp', {
      body: { email: MEMBER, type: 'sign-in' },
    })
    assert.equal(sent.status, 200, await sent.clone().text())
    const code = codeIn(lastMailTo(MEMBER).html)
    const byCode = await call('client', '/sign-in/email-otp', { body: { email: MEMBER, otp: code } })
    assert.equal(byCode.status, 404, 'signing in by code is switched off')
    const none = await harness.db
      .select()
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, MEMBER))
    assert.equal(none.length, 0, 'a code alone creates nobody')

    const headers = await harness.signInAs('client', MEMBER, tenant)
    memberToken = headers.Authorization!.replace(/^Bearer /, '')
    assert.equal(await sessionEmail('client', memberToken), MEMBER)
  })

  test("a member's code is the studio's mail, on the member envelope, logged without the code", async () => {
    const message = lastMailTo(MEMBER)
    const code = codeIn(message.html)
    const [studio] = await harness.db
      .select({ name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenant.id))

    assert.equal(message.from, `"${studio!.name}" <noreply@reservetoday.app>`)
    assert.equal(message.kind, 'credential', 'a sign-in code jumps the send queue')
    assert.equal(message.replyTo, REPLY_TO)
    assert.ok(message.html.includes(studio!.name), "worded by the studio's own template")

    const rows = await logRows(MEMBER)
    assert.ok(rows.length >= 1, 'every code files an email_log row')
    for (const row of rows) {
      assert.equal(row.templateSlug, 'sign_in_code')
      assert.equal(row.recipientUserKind, 'client')
      assert.equal(row.status, 'sent')
      assert.ok(!row.bodyRendered.includes(code), 'the code is not readable in the log')
      assert.ok(row.bodyRendered.includes('[redacted]'))
    }

    const stored = await harness.db
      .select({ value: schema.clientAuthVerifications.value })
      .from(schema.clientAuthVerifications)
    assert.ok(stored.every(v => !v.value.includes(code)), 'the code is hashed at rest')
  })

  test('a staff member sets a first password through the reset flow and signs in with it', async () => {
    await setFirstPassword('staff', STAFF)

    const reset = lastMailTo(STAFF)
    assert.match(reset.from, /<noreply@reservetoday\.app>$/, 'staff mail leaves on the one envelope')
    assert.equal(reset.replyTo, REPLY_TO)
    const [row] = await logRows(STAFF)
    assert.equal(row?.templateSlug, 'staff_password_reset')
    assert.ok(!row!.bodyRendered.includes('/reset-password/'), 'the reset link is not readable in the log')

    staffToken = await tokenOf(await call('staff', '/sign-in/email', { body: { email: STAFF, password: PASSWORD } }))
    assert.equal(await sessionEmail('staff', staffToken), STAFF)
  })

  test('a reset cannot be pointed at an origin that is not ours', async () => {
    const res = await call('staff', '/request-password-reset', {
      body: { email: STAFF, redirectTo: 'https://evil.example/reset-password' },
    })
    assert.equal(res.status, 403)
  })

  test('staff cannot sign themselves up', async () => {
    const res = await call('staff', '/sign-up/email', {
      body: { email: `walk-in-${run}@auth.test`, password: PASSWORD, name: 'Walk In' },
    })
    assert.notEqual(res.status, 200)
  })

  test('a platform operator signs in on a pool with no studio', async () => {
    await setFirstPassword('platform', PLATFORM)

    const reset = lastMailTo(PLATFORM)
    assert.equal(reset.from, '"ReserveToday" <noreply@reservetoday.app>')
    assert.equal(reset.replyTo, undefined, "no studio's Reply-To on platform mail")
    assert.equal(reset.kind, 'credential')
    assert.ok(!reset.tags.some(t => t.name === 'tenant'), 'super portal mail carries no tenant tag')
    assert.match(reset.idempotencyKey, /^platform-mail\//)

    platformToken = await tokenOf(
      await call('platform', '/sign-in/email', { body: { email: PLATFORM, password: PASSWORD } }),
    )
    assert.equal(await sessionEmail('platform', platformToken), PLATFORM)
  })

  test("no pool accepts another pool's token", async () => {
    const tokens = { client: memberToken, staff: staffToken, platform: platformToken }
    for (const [issuer, token] of Object.entries(tokens)) {
      for (const pool of ['client', 'staff', 'platform'] as const) {
        if (pool === issuer) continue
        assert.equal(await sessionEmail(pool, token), null, `${pool} accepted a ${issuer} token`)
      }
    }
  })

  test('staff enrol an authenticator app, then finish a sign-in by emailed code or backup code', async () => {
    const enabled = await call('staff', '/two-factor/enable', {
      body: { password: PASSWORD },
      headers: bearer(staffToken),
    })
    assert.equal(enabled.status, 200, await enabled.clone().text())
    const { totpURI, backupCodes } = (await enabled.json()) as { totpURI: string; backupCodes: string[] }
    staffToken = enabled.headers.get('set-auth-token') ?? staffToken

    const secret = new URL(totpURI).searchParams.get('secret')!
    const verified = await call('staff', '/two-factor/verify-totp', {
      body: { code: totp(secret) },
      headers: bearer(staffToken),
    })
    assert.equal(verified.status, 200, await verified.clone().text())

    // The second factor lives in the staff pool's own table. Pins the
    // `withTwoFactorTable` workaround: without it, the last pool built renames
    // the table for all of them.
    const [staffUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, STAFF))
    const staffFactors = await harness.db
      .select()
      .from(schema.staffAuthTwoFactors)
      .where(eq(schema.staffAuthTwoFactors.userId, staffUser!.id))
    assert.equal(staffFactors.length, 1, "staff 2FA went to another pool's table")

    /** A password sign-in now stops at the second factor, holding a challenge cookie. */
    const challenge = async () => {
      const res = await call('staff', '/sign-in/email', { body: { email: STAFF, password: PASSWORD } })
      assert.equal(res.status, 200)
      assert.equal(((await res.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect, true)
      // The bearer plugin may still echo the half-made session's token; what
      // matters is that it opens nothing until the second factor is in.
      const early = res.headers.get('set-auth-token')
      if (early) assert.equal(await sessionEmail('staff', early), null, 'no session before the second factor')
      const cookie = res.headers
        .getSetCookie()
        .map(c => c.split(';')[0]!)
        .join('; ')
      assert.ok(cookie.includes('two_factor'), 'the challenge travels as a cookie')
      return { Cookie: cookie }
    }

    // Emailed code.
    const cookie = await challenge()
    const sent = await call('staff', '/two-factor/send-otp', { body: {}, headers: cookie })
    assert.equal(sent.status, 200, await sent.clone().text())
    const mail = lastMailTo(STAFF)
    assert.match(mail.from, /<noreply@reservetoday\.app>$/)
    assert.equal(mail.replyTo, REPLY_TO)
    const rows = await logRows(STAFF)
    assert.ok(rows.some(r => r.templateSlug === 'staff_two_factor_code'), 'the second factor is logged')
    const byCode = await call('staff', '/two-factor/verify-otp', {
      body: { code: codeIn(mail.html) },
      headers: cookie,
    })
    assert.equal(await sessionEmail('staff', await tokenOf(byCode)), STAFF)

    // Backup code.
    const again = await challenge()
    const byBackup = await call('staff', '/two-factor/verify-backup-code', {
      body: { code: backupCodes[0] },
      headers: again,
    })
    assert.equal(await sessionEmail('staff', await tokenOf(byBackup)), STAFF)
  })
})
