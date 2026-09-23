import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const OPERATOR = `operator-${run}@sessions.test`

// Read once when the platform gate is first imported, so it is set before the app is.
process.env.PLATFORM_ADMIN_EMAIL = OPERATOR

/**
 * Tenant isolation for signed-in callers (#113), over real HTTP.
 *
 * The half of the isolation suite `isolation.test.ts` could not write while the
 * only sessions were vendor JWTs this harness could not mint. A Better Auth session
 * is stamped at sign-in with the Tenant whose hostname it signed in on, and both
 * studio middlewares refuse it anywhere else — so a session from studio A is
 * worthless at studio B, for staff and, for the first time, for members. Since
 * logins are per studio (#231), studio B cannot even see it: 401.
 */
describe('tenant isolation for sessions', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const MEMBER = `member-${run}@sessions.test`
  const STAFF = `staff-${run}@sessions.test`
  const TWO_STUDIOS = `two-studios-${run}@sessions.test`
  const INACTIVE = `inactive-${run}@sessions.test`
  const EMAILS = [MEMBER, STAFF, TWO_STUDIOS, INACTIVE, OPERATOR]

  /** Present `signedIn`'s session from `tenant`'s own frontend instead. */
  const sentTo = (
    signedIn: Record<string, string>,
    pool: 'client' | 'staff',
    tenant: { slug: string },
  ): Record<string, string> => ({
    Authorization: signedIn.Authorization!,
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin(pool, tenant),
  })

  const get = (path: string, headers: Record<string, string>) => harness.app.request(path, { headers })

  const expectStatus = async (res: Response, status: number, error?: string) => {
    const body = await res.text()
    assert.equal(res.status, status, body)
    if (error) assert.equal((JSON.parse(body) as { error: string }).error, error)
  }

  /** The person's login at `tenantId` — logins are per studio (#231) — made when there is none yet. */
  const authUserId = async (
    table: typeof schema.clientAuthUsers | typeof schema.staffAuthUsers,
    email: string,
    tenantId: string = one.id,
  ) => {
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const pool = table === schema.clientAuthUsers ? 'client' : 'staff'
    return ensureAuthUser(harness.db, pool, { tenantId, email, name: email.split('@')[0]! })
  }

  const addStaffRow = (
    tenantId: string,
    email: string,
    userId: string,
    status: 'active' | 'pending' = 'active',
  ) =>
    harness.db.insert(schema.staffUsers).values({
      tenantId,
      email,
      name: email.split('@')[0]!,
      role: 'admin',
      status,
      authUserId: userId,
    })

  const addClientRow = (tenantId: string, email: string, userId: string) =>
    harness.db.insert(schema.clients).values({
      tenantId,
      email,
      name: 'Probe Member',
      phone: '+10000000000',
      authUserId: userId,
    })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ one, two } = harness.tenants)
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.email, EMAILS))
    await harness.db.delete(schema.clients).where(inArray(schema.clients.email, EMAILS))
    await harness.db.delete(schema.emailLog).where(inArray(schema.emailLog.recipientEmail, EMAILS))
    await harness.db.delete(schema.clientAuthUsers).where(inArray(schema.clientAuthUsers.email, EMAILS))
    await harness.db.delete(schema.staffAuthUsers).where(inArray(schema.staffAuthUsers.email, EMAILS))
    await harness.db.delete(schema.platformAuthUsers).where(inArray(schema.platformAuthUsers.email, EMAILS))
    await harness.close()
  })

  let memberAtOne!: Record<string, string>
  let staffAtOne!: Record<string, string>
  let operator!: Record<string, string>

  test('a sign-in stamps the session with the Tenant its hostname named', async () => {
    memberAtOne = await harness.signInAs('client', MEMBER, one)
    staffAtOne = await harness.signInAs('staff', STAFF, one)

    const memberSessions = await harness.db
      .select({ claim: schema.clientAuthSessions.claimedTenantId })
      .from(schema.clientAuthSessions)
      .where(eq(schema.clientAuthSessions.userId, await authUserId(schema.clientAuthUsers, MEMBER)))
    assert.deepEqual(memberSessions.map(s => s.claim), [one.id])

    const staffSessions = await harness.db
      .select({ claim: schema.staffAuthSessions.claimedTenantId })
      .from(schema.staffAuthSessions)
      .where(eq(schema.staffAuthSessions.userId, await authUserId(schema.staffAuthUsers, STAFF)))
    assert.deepEqual(staffSessions.map(s => s.claim), [one.id])
  })

  test('a sign-in on a hostname that names no studio is refused on both studio pools', async () => {
    const attempt = (pool: 'client' | 'staff', path: string, body: unknown, headers: Record<string, string>) =>
      harness.app.request(`/api/v1/auth/${pool}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })

    // No studio named at all.
    const bare = await attempt('staff', '/sign-in/email', { email: STAFF, password: 'x' }, {})
    await expectStatus(bare, 400, 'tenant_required')
    assert.equal(bare.headers.get('set-auth-token'), null)
    const code = await attempt('client', '/email-otp/send-verification-otp', { email: MEMBER, type: 'sign-in' }, {})
    await expectStatus(code, 400, 'tenant_required')

    // The super portal's hostname is not a studio either.
    const superPortal = await attempt(
      'staff',
      '/sign-in/email',
      { email: STAFF, password: 'x' },
      { Origin: frontendOrigin('platform', null) },
    )
    assert.notEqual(superPortal.status, 200)
    assert.equal(superPortal.headers.get('set-auth-token'), null)
  })

  test('signInAs headers authenticate a real portal and /me request', async () => {
    await addStaffRow(one.id, STAFF, await authUserId(schema.staffAuthUsers, STAFF))
    await addClientRow(one.id, MEMBER, await authUserId(schema.clientAuthUsers, MEMBER))

    const me = await get('/api/v1/portal/auth/me', staffAtOne)
    await expectStatus(me.clone(), 200)
    assert.equal(((await me.json()) as { email: string }).email, STAFF)

    const profile = await get('/api/v1/me', memberAtOne)
    await expectStatus(profile.clone(), 200)
    assert.equal(((await profile.json()) as { email: string }).email, MEMBER)
  })

  test("a staff session from studio one is refused at studio two's portal", async () => {
    // Even with a row at studio two: studio two's context cannot see the session.
    await addStaffRow(two.id, STAFF, await authUserId(schema.staffAuthUsers, STAFF, two.id))
    await expectStatus(await get('/api/v1/portal/auth/me', sentTo(staffAtOne, 'staff', two)), 401, 'invalid_token')
    await expectStatus(
      await get('/api/v1/portal/admin/clients', sentTo(staffAtOne, 'staff', two)),
      401,
      'invalid_token',
    )
  })

  test("TEN-13 a member session from studio one is refused at studio two's /me", async () => {
    await addClientRow(two.id, MEMBER, await authUserId(schema.clientAuthUsers, MEMBER, two.id))
    await expectStatus(await get('/api/v1/me', sentTo(memberAtOne, 'client', two)), 401, 'invalid_token')
  })

  test('staff at two studios have two logins and two sessions — each reaches only its own studio', async () => {
    const atOne = await harness.signInAs('staff', TWO_STUDIOS, one)
    const atTwo = await harness.signInAs('staff', TWO_STUDIOS, two)
    const userAtOne = await authUserId(schema.staffAuthUsers, TWO_STUDIOS, one.id)
    const userAtTwo = await authUserId(schema.staffAuthUsers, TWO_STUDIOS, two.id)
    await addStaffRow(one.id, TWO_STUDIOS, userAtOne)
    await addStaffRow(two.id, TWO_STUDIOS, userAtTwo)

    const [users, sessions] = await Promise.all([
      harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, TWO_STUDIOS)),
      harness.db
        .select()
        .from(schema.staffAuthSessions)
        .where(inArray(schema.staffAuthSessions.userId, [userAtOne, userAtTwo])),
    ])
    assert.equal(users.length, 2, 'a login at each studio')
    assert.notEqual(userAtOne, userAtTwo)
    assert.equal(sessions.length, 2)

    const rowOf = async (headers: Record<string, string>) => {
      const res = await get('/api/v1/portal/auth/me', headers)
      await expectStatus(res.clone(), 200)
      return ((await res.json()) as { id: string }).id
    }
    const staffRowAt = async (tenantId: string) => {
      const [row] = await harness.db
        .select({ id: schema.staffUsers.id })
        .from(schema.staffUsers)
        .where(and(eq(schema.staffUsers.tenantId, tenantId), eq(schema.staffUsers.email, TWO_STUDIOS)))
      return row!.id
    }
    assert.equal(await rowOf(atOne), await staffRowAt(one.id))
    assert.equal(await rowOf(atTwo), await staffRowAt(two.id))

    await expectStatus(await get('/api/v1/portal/auth/me', sentTo(atOne, 'staff', two)), 401, 'invalid_token')
    await expectStatus(await get('/api/v1/portal/auth/me', sentTo(atTwo, 'staff', one)), 401, 'invalid_token')
  })

  test('a session with no active staff row at its own studio is still refused', async () => {
    const headers = await harness.signInAs('staff', INACTIVE, one)
    await expectStatus(await get('/api/v1/portal/auth/me', headers), 403, 'staff_not_provisioned')
    await addStaffRow(one.id, INACTIVE, await authUserId(schema.staffAuthUsers, INACTIVE), 'pending')
    await expectStatus(await get('/api/v1/portal/auth/me', headers), 403, 'staff_inactive')
  })

  test('a member session cannot reach the portal, nor a staff session /me', async () => {
    await expectStatus(await get('/api/v1/portal/auth/me', sentTo(memberAtOne, 'staff', one)), 401, 'invalid_token')
    await expectStatus(await get('/api/v1/me', sentTo(staffAtOne, 'client', one)), 401, 'invalid_token')
  })

  test('a platform session is refused on tenant routes, and a tenant session on the platform', async () => {
    operator = await harness.signInAs('platform', OPERATOR, null)
    await expectStatus(await get('/api/v1/platform/tenants', operator), 200)

    await expectStatus(await get('/api/v1/portal/auth/me', sentTo(operator, 'staff', one)), 401)
    await expectStatus(await get('/api/v1/me', sentTo(operator, 'client', one)), 401)

    // A studio session never reaches the allowlist — even for an allowlisted address.
    const staffOperator = await harness.signInAs('staff', OPERATOR, one)
    for (const headers of [staffAtOne, memberAtOne, staffOperator]) {
      await expectStatus(
        await get('/api/v1/platform/tenants', { Authorization: headers.Authorization! }),
        404,
        'not_found',
      )
    }
  })

  test('a session is read from the bearer token only, never from a cookie beside it', async () => {
    const token = staffAtOne.Authorization!.slice('Bearer '.length)
    await expectStatus(
      await get('/api/v1/portal/auth/me', {
        ...staffAtOne,
        Authorization: 'Bearer not-a-session',
        Cookie: `rt-staff.session_token=${token}`,
      }),
      401,
      'invalid_token',
    )
  })

  test('a token no pool issued is refused, whatever its shape', async () => {
    // A JWT-shaped token once took a second path to a second issuer. There is
    // one issuer now, and a token it has no session for is simply not one.
    for (const token of ['a.b.c', 'not-a-session']) {
      await expectStatus(
        await get('/api/v1/portal/auth/me', { ...staffAtOne, Authorization: `Bearer ${token}` }),
        401,
        'invalid_token',
      )
      await expectStatus(
        await get('/api/v1/me', { ...memberAtOne, Authorization: `Bearer ${token}` }),
        401,
        'invalid_token',
      )
    }
  })
})
