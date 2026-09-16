import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import {
  frontendOrigin,
  HARNESS_PASSWORD,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

const run = Date.now().toString(36)
const OPERATOR = `operator-${run}@platform.test`
const FIRST_TIMER = `first-timer-${run}@platform.test`

// Read once when the platform gate is first imported, so it is set before the app is.
process.env.PLATFORM_ADMIN_EMAIL = `${OPERATOR},${FIRST_TIMER}`

/**
 * The super portal signs in through its own pool (#116).
 *
 * `platform` is a Better Auth instance of its own, so a studio admin's
 * credentials are rows it has never seen: they cannot even produce a session
 * there, let alone reach `PLATFORM_ADMIN_EMAIL`. The allowlist is the second
 * gate, keyed on the session's email on every request.
 */
describe('super portal sign-in', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  const STUDIO_ADMIN = `studio-admin-${run}@platform.test`
  const STRANGER = `stranger-${run}@platform.test`
  const EMAILS = [OPERATOR, STUDIO_ADMIN, STRANGER, FIRST_TIMER]

  const tenants = (headers: Record<string, string>) =>
    harness.app.request('/api/v1/platform/tenants', { headers: { Authorization: headers.Authorization! } })

  /** Sign `email` in at studio one and give it an active staff row there. */
  const staffAtStudioOne = async (email: string, role: 'admin' | 'instructor') => {
    const headers = await harness.signInAs('staff', email, harness.tenants.one)
    const [staffUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    await harness.db.insert(schema.staffUsers).values({
      tenantId: harness.tenants.one.id,
      email,
      name: email.split('@')[0]!,
      role,
      status: 'active',
      authUserId: staffUser!.id,
    })
    return headers
  }

  const expectStatus = async (res: Response, status: number, error?: string) => {
    const body = await res.text()
    assert.equal(res.status, status, body)
    if (error) assert.equal((JSON.parse(body) as { error: string }).error, error)
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.email, EMAILS))
    await harness.db.delete(schema.staffAuthUsers).where(inArray(schema.staffAuthUsers.email, EMAILS))
    await harness.db.delete(schema.platformAuthUsers).where(inArray(schema.platformAuthUsers.email, EMAILS))
    await harness.close()
  })

  test('an allowlisted operator signs in on the platform pool, lists and exports studios', async () => {
    const operator = await harness.signInAs('platform', OPERATOR, null)
    await expectStatus(await tenants(operator), 200)

    // Create shares this gate; tenant-provisioning.test.ts owns what it writes.
    const archive = await harness.app.request(`/api/v1/platform/tenants/${harness.tenants.one.id}/export`, {
      headers: { Authorization: operator.Authorization! },
    })
    assert.equal(archive.status, 200, await archive.clone().text())
    assert.ok((await archive.arrayBuffer()).byteLength > 0, 'the archive has content')
  })

  test("a studio admin's email and password get no platform session", async () => {
    // A real, working studio credential: it signs in at its own studio.
    const atStudio = await staffAtStudioOne(STUDIO_ADMIN, 'admin')

    const attempt = await harness.app.request('/api/v1/auth/platform/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: frontendOrigin('platform', null),
        'X-Forwarded-For': harnessAddress(),
      },
      body: JSON.stringify({ email: STUDIO_ADMIN, password: HARNESS_PASSWORD }),
    })
    assert.equal(attempt.status, 401, await attempt.clone().text())
    assert.equal(attempt.headers.get('set-auth-token'), null)

    const inPlatformPool = await harness.db
      .select()
      .from(schema.platformAuthUsers)
      .where(eq(schema.platformAuthUsers.email, STUDIO_ADMIN))
    assert.equal(inPlatformPool.length, 0, 'no platform user, so no platform session')

    // And the studio session it does have is worthless here.
    await expectStatus(await tenants(atStudio), 404, 'not_found')
  })

  test('a platform account that is not on PLATFORM_ADMIN_EMAIL is refused', async () => {
    // A valid session in the right pool: the allowlist is what refuses it. This
    // is where an address taken off the list lands on its next request — the
    // email is read from the session every time, with nothing remembered.
    const stranger = await harness.signInAs('platform', STRANGER, null)
    await expectStatus(await tenants(stranger), 404, 'not_found')
  })

  test('the email-first step mails a seeded operator their set-password link, and nobody else', async () => {
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const { discardedMail } = await import('../lib/mailer')
    await ensureAuthUser(harness.db, 'platform', { email: FIRST_TIMER, name: FIRST_TIMER })
    await harness.signInAs('platform', OPERATOR, null)

    const step = async (email: string, origin = frontendOrigin('platform', null)) => {
      const res = await harness.app.request('/api/v1/platform/sign-in/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-For': harnessAddress() },
        body: JSON.stringify({ email }),
      })
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    }
    const mailsTo = (email: string) => discardedMail.filter(m => m.to === email).length

    // An operator with a password, a stranger, and an unknown address all just get the password field.
    for (const email of [OPERATOR, STRANGER, `nobody-${run}@platform.test`]) {
      assert.deepEqual(await step(email), { status: 200, body: { step: 'password' } })
    }

    // The seeded, passwordless operator is mailed the link once; a quick repeat waits.
    const first = await step(FIRST_TIMER.toUpperCase())
    assert.equal(first.status, 200)
    assert.deepEqual(first.body, { step: 'set_password', sent: true, retryAfterSeconds: 60 })
    assert.equal(mailsTo(FIRST_TIMER), 1)
    assert.ok(
      discardedMail.at(-1)!.html.includes(`callbackURL=${encodeURIComponent('http://admin.portal.localhost:3001/login')}`),
      'the link lands back on the super portal sign-in',
    )

    const again = await step(FIRST_TIMER)
    assert.equal(again.body.step, 'set_password')
    assert.equal(again.body.sent, false)
    assert.equal(mailsTo(FIRST_TIMER), 1, 'no second mail inside the cooldown')

    // A page that is not ours cannot choose where the link lands.
    assert.equal((await step(FIRST_TIMER, 'https://evil.example')).status, 400)
  })

  test('a token no pool issued is refused, whatever its shape', async () => {
    await expectStatus(await tenants({ Authorization: 'Bearer a.b.c' }), 404, 'not_found')
  })

  test('signing out of the super portal leaves a studio session signed in, and back', async () => {
    const operator = await harness.signInAs('platform', OPERATOR, null)
    const studio = await staffAtStudioOne(OPERATOR, 'admin')
    const studioMe = () => harness.app.request('/api/v1/portal/auth/me', { headers: studio })
    const signOut = (pool: 'platform' | 'staff', headers: Record<string, string>) =>
      harness.app.request(`/api/v1/auth/${pool}/sign-out`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}',
      })

    await expectStatus(await tenants(operator), 200)
    await expectStatus(await studioMe(), 200)

    await expectStatus(await signOut('platform', operator), 200)
    await expectStatus(await tenants(operator), 404, 'not_found')
    await expectStatus(await studioMe(), 200)

    const operatorAgain = await harness.signInAs('platform', OPERATOR, null)
    await expectStatus(await signOut('staff', studio), 200)
    await expectStatus(await studioMe(), 401)
    await expectStatus(await tenants(operatorAgain), 200)
  })
})
