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
 * Members sign in through Better Auth (#117), over real HTTP, with the password
 * they chose at registration or through the set-password link (#173).
 *
 * A member's account at a studio is two rows written together: the `client`
 * pool's auth user and the studio's `clients` row. Self-registration writes both
 * in the request that spends the code; an admin adding a member writes both in
 * the request that adds them. Nothing provisions a row on a member's first
 * request any more, and blocking a member is a fact about one studio: it ends
 * their sessions there and refuses their sign-in there, and nowhere else.
 */
describe('member sign-in', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `members-${run}.test`
  const ADMIN = `admin@${DOMAIN}`
  const at = (name: string) => `${name}@${DOMAIN}`

  let admin!: Record<string, string>

  const memberHeaders = (tenant: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('client', tenant),
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
    // Our routes answer `{ error }`; Better Auth's own answer `{ message }`.
    if (error) assert.equal(parsed.error ?? parsed.message, error)
    return parsed
  }

  /** Ask for a code on `tenant`'s hostname and read it back from the null transport. */
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

  const register = (tenant: { slug: string }, body: Record<string, string>) =>
    send('/api/v1/public/members/register', { body, headers: memberHeaders(tenant) })

  const PASSWORD = 'member-password-1'

  const signIn = (tenant: { slug: string }, email: string, password = PASSWORD) =>
    send('/api/v1/auth/client/sign-in/email', { body: { email, password }, headers: memberHeaders(tenant) })

  const bearerAt = (tenant: { slug: string }, token: string) => ({
    ...memberHeaders(tenant),
    Authorization: `Bearer ${token}`,
  })

  /** Sign in with the password and return the headers the member app would then send. */
  const signedInAt = async (tenant: { slug: string }, email: string) => {
    const res = await signIn(tenant, email)
    await expectStatus(res, 200)
    const token = res.headers.get('set-auth-token')
    assert.ok(token, 'the sign-in issued no token')
    return bearerAt(tenant, token)
  }

  const me = (headers: Record<string, string>) => send('/api/v1/me', { headers })

  const clientRow = async (tenantId: string, email: string) => {
    const [row] = await harness.db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, tenantId), eq(schema.clients.email, email)))
    return row ?? null
  }

  const authUser = async (email: string) => {
    const [row] = await harness.db.select().from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    return row ?? null
  }

  const registerBody = (email: string, otp: string) => ({
    email,
    otp,
    first_name: 'Ada',
    last_name: 'Lovelace',
    phone: '+6591234567',
    password: PASSWORD,
  })

  /** Register `email` at `tenant` and return the member's bearer headers there. */
  const registered = async (tenant: { slug: string }, email: string) => {
    const res = await register(tenant, registerBody(email, await requestCode(tenant, email)))
    const body = await expectStatus(res, 200)
    assert.equal(typeof body.token, 'string')
    return bearerAt(tenant, body.token as string)
  }

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
    if (staffIds.length) {
      await harness.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
    }
    if (ids.length) await harness.db.delete(schema.clients).where(inArray(schema.clients.id, ids))
    if (staffIds.length) await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  test('registering with a code writes the auth user and the clients row together, and signs the member in', async () => {
    const email = at('new-member')
    const headers = await registered(one, email)

    const user = await authUser(email)
    assert.ok(user, 'registration created the auth user')
    const row = await clientRow(one.id, email)
    assert.equal(row?.authUserId, user.id, 'the clients row is linked to it from the start')
    assert.equal(row?.name, 'Ada Lovelace')
    assert.equal(row?.phone, '+6591234567')
    assert.equal(row?.status, 'active')

    const profile = await expectStatus(await me(headers), 200)
    assert.equal(profile.email, email)
    await expectStatus(await send('/api/v1/me/packages', { headers }), 200)
  })

  test('a wrong code registers nobody', async () => {
    const email = at('wrong-code')
    await requestCode(one, email)
    const res = await register(one, registerBody(email, '000000'))
    assert.equal(res.status, 400, await res.text())
    assert.equal(res.headers.get('set-auth-token'), null)
    assert.equal(await clientRow(one.id, email), null)
    assert.equal(await authUser(email), null)
  })

  test('registering again at the same studio is refused, and signing in is the way back', async () => {
    const email = at('twice')
    await registered(one, email)
    const again = await register(one, registerBody(email, await requestCode(one, email)))
    await expectStatus(again, 409, 'already_member')

    const headers = await signedInAt(one, email)
    await expectStatus(await me(headers), 200)
  })

  test('one person joins a second studio as a second record, on the same auth user', async () => {
    const email = at('two-studios')
    const atOne = await registered(one, email)
    const atTwo = await registered(two, email)

    const rowOne = await clientRow(one.id, email)
    const rowTwo = await clientRow(two.id, email)
    assert.ok(rowOne && rowTwo)
    assert.notEqual(rowOne.id, rowTwo.id)
    assert.equal(rowOne.authUserId, rowTwo.authUserId)

    // Each session reaches only the studio it was signed in on.
    await expectStatus(await me(atOne), 200)
    await expectStatus(await me(atTwo), 200)
    await expectStatus(await me({ ...atOne, ...memberHeaders(two) }), 403, 'tenant_mismatch')
  })

  test('an admin adding a member writes a Better Auth user, and that member sets a password through the link', async () => {
    const email = at('added-by-admin')
    const created = await expectStatus(
      await send('/api/v1/portal/admin/clients', {
        body: { name: 'Grace Hopper', email, phone: '+6598765432' },
        headers: admin,
      }),
      201,
    )

    const user = await authUser(email)
    assert.ok(user, 'adding the member created the auth user')
    const row = await clientRow(one.id, email)
    assert.equal(row?.id, created.id)
    assert.equal(row?.authUserId, user.id)

    const step = await expectStatus(
      await send('/api/v1/public/members/sign-in-step', { body: { email }, headers: memberHeaders(one) }),
      200,
    )
    assert.deepEqual(step, { next: 'link_sent' }, 'an added member has no password yet')
    const link = new URL(
      [...discardedMail].reverse().find(m => m.to === email)!.html.match(/href="([^"]*\/reset-password\/[^"]+)"/)![1]!
        .replace(/&amp;/g, '&'),
    )
    const opened = await harness.app.request(link.pathname + link.search)
    const token = new URL(opened.headers.get('location')!).searchParams.get('token')
    const set = await expectStatus(
      await send('/api/v1/public/members/set-password', { body: { token, password: PASSWORD }, headers: memberHeaders(one) }),
      200,
    )
    const profile = await expectStatus(await me(bearerAt(one, set.token as string)), 200)
    assert.equal(profile.name, 'Grace Hopper')
  })

  test('an address already a member at the studio cannot be added again', async () => {
    const email = at('added-twice')
    await registered(one, email)
    await expectStatus(
      await send('/api/v1/portal/admin/clients', {
        body: { name: 'Again', email, phone: '+6598765432' },
        headers: admin,
      }),
      409,
      'email_in_use',
    )
  })

  test('blocking ends the member\'s session and refuses their sign-in; restoring reverses both', async () => {
    const email = at('blocked')
    const headers = await registered(one, email)
    const row = await clientRow(one.id, email)

    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${row!.id}`, { method: 'DELETE', headers: admin }),
      200,
    )
    await expectStatus(await me(headers), 401)
    const refused = await signIn(one, email)
    await expectStatus(refused, 403, 'client_blocked')
    assert.equal(refused.headers.get('set-auth-token'), null)

    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${row!.id}/restore`, { method: 'POST', headers: admin }),
      200,
    )
    const restored = await signedInAt(one, email)
    await expectStatus(await me(restored), 200)
  })

  test('blocking at one studio leaves the member signed in at another', async () => {
    const email = at('blocked-at-one')
    await registered(one, email)
    const atTwo = await registered(two, email)
    const row = await clientRow(one.id, email)

    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${row!.id}`, { method: 'DELETE', headers: admin }),
      200,
    )
    await expectStatus(await me(atTwo), 200)
    await expectStatus(await me(await signedInAt(two, email)), 200)
  })

  test('editing the name on the profile persists on the member\'s row', async () => {
    const email = at('renamed')
    const headers = await registered(one, email)
    const patched = await expectStatus(
      await send('/api/v1/me', { method: 'PATCH', body: { name: 'Augusta King' }, headers }),
      200,
    )
    assert.equal(patched.name, 'Augusta King')
    const profile = await expectStatus(await me(headers), 200)
    assert.equal(profile.name, 'Augusta King')
  })
})
