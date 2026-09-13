import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const OPERATOR = `operator-${run}@sessions.test`

// Read once when the platform gate is first imported, so it is set before the app is.
process.env.PLATFORM_ADMIN_EMAILS = OPERATOR

/**
 * Tenant isolation for signed-in callers (#113), over real HTTP.
 *
 * The half of the isolation suite `isolation.test.ts` could not write while the
 * only sessions were Clerk JWTs this harness cannot mint. A Better Auth session
 * is stamped at sign-in with the Tenant whose hostname it signed in on, and both
 * studio middlewares refuse it anywhere else — so a session from studio A is
 * worthless at studio B, for staff and, for the first time, for members.
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

  const authUserId = async (table: typeof schema.clientAuthUsers | typeof schema.staffAuthUsers, email: string) => {
    const [row] = await harness.db.select({ id: table.id }).from(table).where(eq(table.email, email))
    assert.ok(row, `no auth user for ${email}`)
    return row.id
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
      clerkUserId: `harness_${randomUUID()}`,
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
    // Even with a row at studio two, which is what makes the claim the refusal.
    await addStaffRow(two.id, STAFF, await authUserId(schema.staffAuthUsers, STAFF))
    await expectStatus(await get('/api/v1/portal/auth/me', sentTo(staffAtOne, 'staff', two)), 403, 'tenant_mismatch')
    await expectStatus(
      await get('/api/v1/portal/admin/clients', sentTo(staffAtOne, 'staff', two)),
      403,
      'tenant_mismatch',
    )
  })

  test("a member session from studio one is refused at studio two's /me", async () => {
    await addClientRow(two.id, MEMBER, await authUserId(schema.clientAuthUsers, MEMBER))
    await expectStatus(await get('/api/v1/me', sentTo(memberAtOne, 'client', two)), 403, 'tenant_mismatch')
  })

  test('one user, two staff rows, two sessions — each reaches only its own studio', async () => {
    const atOne = await harness.signInAs('staff', TWO_STUDIOS, one)
    const atTwo = await harness.signInAs('staff', TWO_STUDIOS, two)
    const userId = await authUserId(schema.staffAuthUsers, TWO_STUDIOS)
    await addStaffRow(one.id, TWO_STUDIOS, userId)
    await addStaffRow(two.id, TWO_STUDIOS, userId)

    const [users, sessions] = await Promise.all([
      harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, TWO_STUDIOS)),
      harness.db.select().from(schema.staffAuthSessions).where(eq(schema.staffAuthSessions.userId, userId)),
    ])
    assert.equal(users.length, 1)
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

    await expectStatus(await get('/api/v1/portal/auth/me', sentTo(atOne, 'staff', two)), 403, 'tenant_mismatch')
    await expectStatus(await get('/api/v1/portal/auth/me', sentTo(atTwo, 'staff', one)), 403, 'tenant_mismatch')
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

  test('a JWT-shaped token still takes the Clerk path', async () => {
    await expectStatus(
      await get('/api/v1/portal/auth/me', { ...staffAtOne, Authorization: 'Bearer a.b.c' }),
      401,
      'invalid_token',
    )
  })
})
