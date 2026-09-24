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
import { totp } from './totp'

/**
 * Staff onboarding through Better Auth (#115), over real HTTP.
 *
 * Invitation-only in fact: inviting an admin, and creating an instructor, each
 * write the staff auth user and the `staff_users` row together and mail a link
 * that sets a password. There is no sign-up and no webhook to link anyone by
 * address. Archiving ends the person's sessions at that studio; a second factor
 * travels as a header, because a portal on another host cannot hold the API's
 * cookie.
 */
describe('staff onboarding', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `onboarding-${run}.test`
  const ADMIN = `admin@${DOMAIN}`
  const at = (name: string) => `${name}@${DOMAIN}`
  const NEW_PASSWORD = 'a password of their own'

  let admin!: Record<string, string>

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
    if (error) assert.equal((JSON.parse(body) as { error: string }).error, error)
    return body ? (JSON.parse(body) as Record<string, unknown>) : {}
  }

  const staffRow = async (tenantId: string, email: string) => {
    const [row] = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.tenantId, tenantId), eq(schema.staffUsers.email, email)))
    return row ?? null
  }

  /** The person's login at `tenantId` (studio one unless named): logins are per studio (#231). */
  const authUser = async (email: string, tenantId: string = one.id) => {
    const [row] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, tenantId), eq(schema.staffAuthUsers.email, email)))
    return row ?? null
  }

  const credentials = async (userId: string) =>
    harness.db
      .select()
      .from(schema.staffAuthAccounts)
      .where(and(eq(schema.staffAuthAccounts.userId, userId), eq(schema.staffAuthAccounts.providerId, 'credential')))

  /** The invitation token in the newest mail to `email`, and how many mails it has had. */
  const invitationMail = (email: string) => {
    const mails = discardedMail.filter(m => m.to === email)
    assert.ok(mails.length > 0, `no mail was sent to ${email}`)
    const match = mails.at(-1)!.html.match(/\/signup\?[^"'\s<]*invite_token=([A-Za-z0-9_-]+)/)
    assert.ok(match, 'the mail carries no set-password link')
    return { token: match[1]!, count: mails.length }
  }

  const invite = async (email: string, role: 'admin' | 'instructor' = 'admin') =>
    expectStatus(
      await send('/api/v1/portal/admin/staff/invite', { body: { email, role }, headers: admin}),
      201,
    )

  const accept = (tenant: { slug: string }, token: string, password?: string, extra: Record<string, string> = {}) =>
    send('/api/v1/public/staff-invitation/accept', {
      body: { token, ...(password === undefined ? {} : { password }), ...extra },
      headers: portalHeaders(tenant),
    })

  const signIn = (tenant: { slug: string }, email: string, password: string) =>
    send('/api/v1/auth/staff/sign-in/email', { body: { email, password }, headers: portalHeaders(tenant) })

  const bearerAt = (tenant: { slug: string }, token: string) => ({
    ...portalHeaders(tenant),
    Authorization: `Bearer ${token}`,
  })

  const me = (headers: Record<string, string>) => send('/api/v1/portal/auth/me', { headers })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    ;({ one, two } = harness.tenants)

    admin = await harness.signInAs('staff', ADMIN, one)
    const adminUser = await authUser(ADMIN)
    await harness.db.insert(schema.staffUsers).values({
      tenantId: one.id,
      email: ADMIN,
      name: 'Probe Admin',
      role: 'admin',
      status: 'active',
      authUserId: adminUser!.id,
    })
  })

  after(async () => {
    if (!harness) return
    const staff = await harness.db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const ids = staff.map(s => s.id)
    if (ids.length) {
      await harness.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, ids))
      await harness.db.delete(schema.staffInvitations).where(inArray(schema.staffInvitations.staffUserId, ids))
      await harness.db.delete(schema.instructors).where(inArray(schema.instructors.staffUserId, ids))
      await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, ids))
    }
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  test('inviting an admin writes the auth user and the staff row together, and mails a set-password link', async () => {
    const email = at('invited-admin')
    await invite(email)

    const user = await authUser(email)
    assert.ok(user, 'the invitation created the auth user')
    const row = await staffRow(one.id, email)
    assert.equal(row?.status, 'pending')
    assert.equal(row?.authUserId, user.id, 'the staff row is linked to it from the start')
    assert.deepEqual(await credentials(user.id), [], 'nobody has chosen a password yet')
    invitationMail(email)
  })

  test('the link sets a password, and that password signs into the portal with the invited role', async () => {
    const email = at('accepting-admin')
    await invite(email)
    const { token } = invitationMail(email)

    const lookup = await expectStatus(
      await send(`/api/v1/public/staff-invitation?token=${token}`, { headers: portalHeaders(one) }),
      200,
    )
    assert.equal(lookup.status, 'valid')
    assert.equal(lookup.password_set, false)

    const accepted = await expectStatus(
      await accept(one, token, NEW_PASSWORD, { first_name: 'Ada', last_name: 'Lovelace' }),
      200,
    )
    assert.equal(accepted.email, email)

    const row = await staffRow(one.id, email)
    assert.equal(row?.status, 'active')
    assert.ok(row?.acceptedAt)
    assert.equal(row?.name, 'Ada Lovelace', 'the name they gave replaces the address placeholder')
    assert.equal((await authUser(email))?.name, 'Ada Lovelace')
    const [invitation] = await harness.db
      .select()
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.staffUserId, row!.id))
    assert.equal(invitation?.status, 'accepted')

    const signedIn = await signIn(one, email, NEW_PASSWORD)
    assert.equal(signedIn.status, 200, await signedIn.clone().text())
    const session = signedIn.headers.get('set-auth-token')!
    const profile = await expectStatus(await me(bearerAt(one, session)), 200)
    assert.equal(profile.role, 'admin')

    await expectStatus(await accept(one, token, 'another password entirely'), 409, 'invitation_used')
  })

  test('an invitation is accepted only on the portal of the studio that sent it', async () => {
    const email = at('wrong-studio')
    await invite(email)
    const { token } = invitationMail(email)

    await expectStatus(await accept(two, token, NEW_PASSWORD), 404, 'invitation_not_found')
    assert.deepEqual(await credentials((await authUser(email))!.id), [])
  })

  test('an expired invitation sets no password until it is resent', async () => {
    const email = at('expired')
    await invite(email)
    const { token, count } = invitationMail(email)
    const row = await staffRow(one.id, email)
    await harness.db
      .update(schema.staffInvitations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.staffInvitations.staffUserId, row!.id))

    await expectStatus(await accept(one, token, NEW_PASSWORD), 409, 'invitation_expired')
    assert.deepEqual(await credentials(row!.authUserId!), [])

    const [invitation] = await harness.db
      .select()
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.staffUserId, row!.id))
    await expectStatus(
      await send(`/api/v1/portal/admin/staff/invitations/${invitation!.id}/resend`, { body: {}, headers: admin}),
      200,
    )
    const resent = invitationMail(email)
    assert.equal(resent.count, count + 1, 'resending sends the mail again')
    assert.equal(resent.token, token, 'with the same link')
    await expectStatus(await accept(one, token, NEW_PASSWORD), 200)
  })

  test('a password shorter than the pool allows is refused, and the invitation stays open', async () => {
    const email = at('short-password')
    await invite(email)
    const { token } = invitationMail(email)

    await expectStatus(await accept(one, token, 'short'), 400, 'password_too_short')
    assert.equal((await staffRow(one.id, email))?.status, 'pending')
  })

  test('creating an instructor writes both rows and mails the same kind of link', async () => {
    const email = at('instructor')
    await expectStatus(
      await send('/api/v1/portal/admin/instructors', {
        body: { email, name: 'Probe Instructor' },
        headers: admin,
      }),
      201,
    )

    const user = await authUser(email)
    assert.ok(user)
    const row = await staffRow(one.id, email)
    assert.equal(row?.role, 'instructor')
    assert.equal(row?.authUserId, user.id)

    const { token } = invitationMail(email)
    await expectStatus(await accept(one, token, NEW_PASSWORD), 200)
    const signedIn = await signIn(one, email, NEW_PASSWORD)
    const profile = await expectStatus(await me(bearerAt(one, signedIn.headers.get('set-auth-token')!)), 200)
    assert.equal(profile.role, 'instructor')
  })

  test('STF-04 revoking an invitation before it is accepted removes the staff row and the auth user', async () => {
    const email = at('revoked')
    const invitation = await invite(email)

    await expectStatus(
      await send(`/api/v1/portal/admin/staff/invitations/${invitation.id}/revoke`, { body: {}, headers: admin}),
      200,
    )
    assert.equal(await staffRow(one.id, email), null)
    assert.equal(await authUser(email), null)

    // The invitation went with the staff row it belonged to, so the link finds nothing.
    const { token } = invitationMail(email)
    await expectStatus(await accept(one, token, NEW_PASSWORD), 404, 'invitation_not_found')
  })

  test('archiving a staff member ends their sessions at that studio and no other', async () => {
    const email = at('archived')
    const atOne = await harness.signInAs('staff', email, one)
    const atTwo = await harness.signInAs('staff', email, two)
    // Staff at both studios, on a login at each (#231).
    for (const tenant of [one, two]) {
      const user = await authUser(email, tenant.id)
      await harness.db.insert(schema.staffUsers).values({
        tenantId: tenant.id,
        email,
        name: 'Probe Archived',
        role: 'admin',
        status: 'active',
        authUserId: user!.id,
      })
    }
    await expectStatus(await me(atOne), 200)

    const row = await staffRow(one.id, email)
    await expectStatus(
      await send(`/api/v1/portal/admin/staff/${row!.id}/archive`, { body: {}, headers: admin}),
      200,
    )

    await expectStatus(await me(atOne), 401, 'invalid_token')
    await expectStatus(await me(atTwo), 200)
  })

  test('a second factor is finished with the challenge in a header, not a cookie', async () => {
    const email = at('two-factor')
    const signedIn = await harness.signInAs('staff', email, one)
    const user = await authUser(email)
    await harness.db.insert(schema.staffUsers).values({
      tenantId: one.id,
      email,
      name: 'Probe Two Factor',
      role: 'admin',
      status: 'active',
      authUserId: user!.id,
    })

    const enabled = await send('/api/v1/auth/staff/two-factor/enable', {
      body: { password: HARNESS_PASSWORD },
      headers: signedIn,
    })
    assert.equal(enabled.status, 200, await enabled.clone().text())
    const { totpURI } = (await enabled.json()) as { totpURI: string }
    const rotated = { ...signedIn, Authorization: `Bearer ${enabled.headers.get('set-auth-token') ?? signedIn.Authorization!.slice(7)}` }
    const secret = new URL(totpURI).searchParams.get('secret')!
    const confirmed = await send('/api/v1/auth/staff/two-factor/verify-totp', {
      body: { code: totp(secret) },
      headers: rotated,
    })
    assert.equal(confirmed.status, 200, await confirmed.clone().text())

    const challenged = await signIn(one, email, HARNESS_PASSWORD)
    assert.equal(((await challenged.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect, true)
    const challenge = challenged.headers.get('set-two-factor-challenge')
    assert.ok(challenge, 'the challenge is handed back in a header a cross-origin page can read')

    const withoutIt = await send('/api/v1/auth/staff/two-factor/verify-totp', {
      body: { code: totp(secret) },
      headers: portalHeaders(one),
    })
    assert.equal(withoutIt.status, 401)

    const verified = await send('/api/v1/auth/staff/two-factor/verify-totp', {
      body: { code: totp(secret) },
      headers: { ...portalHeaders(one), 'X-Two-Factor-Challenge': challenge },
    })
    assert.equal(verified.status, 200, await verified.clone().text())
    const session = verified.headers.get('set-auth-token')
    assert.ok(session)
    await expectStatus(await me(bearerAt(one, session)), 200)

    // A challenge still held beside the new token must not cost the session:
    // both would be written into the same request cookie header.
    const both = await send('/api/v1/auth/staff/get-session', {
      headers: { ...bearerAt(one, session), 'X-Two-Factor-Challenge': challenge },
    })
    assert.equal(((await both.json()) as { user?: { email: string } } | null)?.user?.email, email)
  })
})
