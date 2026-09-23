import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
 * The studio portal's email-first sign-in, and a reset that accepts a pending
 * invitation.
 *
 * The case this exists for: a person who is already staff at one studio is made
 * the first admin of another. They have one account and so one password, which
 * signed them in at the new studio as a pending staff member — "this account
 * isn't active here", with no admin to activate them. The email step now mails
 * them the set-password link instead, and following it accepts the invitation.
 */
describe('staff email-first sign-in', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `staff-step-${run}.test`
  const at = (name: string) => `${name}@${DOMAIN}`
  const NEW_PASSWORD = 'a password of their own'

  const portalHeaders = (tenant: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('staff', tenant),
    'X-Forwarded-For': harnessAddress(),
  })

  const post = (path: string, tenant: { slug: string }, body: unknown) =>
    harness.app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...portalHeaders(tenant) },
      body: JSON.stringify(body),
    })

  const expectStatus = async (res: Response, status: number) => {
    const body = await res.text()
    assert.equal(res.status, status, body)
    return body ? (JSON.parse(body) as Record<string, unknown>) : {}
  }

  const step = async (tenant: { slug: string }, email: string) =>
    expectStatus(await post('/api/v1/public/staff/sign-in-step', tenant, { email }), 200)

  const mailsTo = (email: string) => discardedMail.filter(m => m.to === email)

  /** The reset token in the newest set-password link mailed to `email`. */
  const resetTokenFor = (email: string) => {
    const mail = mailsTo(email).at(-1)
    assert.ok(mail, `no mail was sent to ${email}`)
    const match = mail.html.match(/\/reset-password\/([^?"'\s<]+)/)
    assert.ok(match, 'the message carries no set-password link')
    return match[1]!
  }

  const resetPassword = async (tenant: { slug: string }, token: string) =>
    expectStatus(
      await post('/api/v1/auth/staff/reset-password', tenant, { token, newPassword: NEW_PASSWORD }),
      200,
    )

  /** Sign in with `password` at `tenant` and read `/portal/auth/me` with the session. */
  const meAfterSignIn = async (tenant: { slug: string }, email: string, password: string) => {
    const signedIn = await post('/api/v1/auth/staff/sign-in/email', tenant, { email, password })
    assert.equal(signedIn.status, 200, await signedIn.clone().text())
    const token = signedIn.headers.get('set-auth-token')
    assert.ok(token)
    return harness.app.request('/api/v1/portal/auth/me', {
      headers: { ...portalHeaders(tenant), Authorization: `Bearer ${token}` },
    })
  }

  const authUserId = async (email: string, withPassword: boolean) => {
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    if (withPassword) await harness.signInAs('staff', email, one)
    return ensureAuthUser(harness.db, 'staff', { email, name: email.split('@')[0]! })
  }

  const staffRow = async (tenantId: string, email: string) => {
    const [row] = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.tenantId, tenantId), eq(schema.staffUsers.email, email)))
    return row ?? null
  }

  const invitationStatus = async (staffUserId: string) => {
    const [row] = await harness.db
      .select({ status: schema.staffInvitations.status })
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.staffUserId, staffUserId))
    return row?.status ?? null
  }

  /** A staff row at `tenant`, with a pending invitation when `pending`. */
  const staffAt = async (
    tenant: { id: string },
    email: string,
    userId: string,
    status: 'active' | 'pending',
    invitationExpiresInMs = 7 * 24 * 60 * 60 * 1000,
  ) => {
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: email.split('@')[0]!, role: 'admin', status, authUserId: userId })
      .returning()
    if (status === 'pending') {
      await harness.db.insert(schema.staffInvitations).values({
        tenantId: tenant.id,
        email,
        role: 'admin',
        token: randomUUID(),
        expiresAt: new Date(Date.now() + invitationExpiresInMs),
        staffUserId: row!.id,
      })
    }
    return row!
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    ;({ one, two } = harness.tenants)
  })

  after(async () => {
    if (!harness) return
    const staff = await harness.db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const ids = staff.map(s => s.id)
    if (ids.length) {
      await harness.db.delete(schema.staffInvitations).where(inArray(schema.staffInvitations.staffUserId, ids))
      await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, ids))
    }
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  test('active staff with a password are asked for it, and nothing is mailed', async () => {
    const email = at('active')
    await staffAt(one, email, await authUserId(email, true), 'active')

    assert.deepEqual(await step(one, email), { next: 'password' })
    assert.equal(mailsTo(email).length, 0)
  })

  test('staff with no password are mailed the link, and it signs them in', async () => {
    // Imported staff: active, with an account and no password.
    const email = at('no-password')
    await staffAt(one, email, await authUserId(email, false), 'active')

    assert.deepEqual(await step(one, email), { next: 'link_sent' })
    await resetPassword(one, resetTokenFor(email))
    assert.equal((await meAfterSignIn(one, email, NEW_PASSWORD)).status, 200)
  })

  test('a pending invitee with no password is mailed the link, and the reset accepts the invitation', async () => {
    const email = at('invitee')
    const staff = await staffAt(one, email, await authUserId(email, false), 'pending')

    assert.deepEqual(await step(one, email), { next: 'link_sent' })
    await resetPassword(one, resetTokenFor(email))

    assert.equal((await staffRow(one.id, email))?.status, 'active')
    assert.equal(await invitationStatus(staff.id), 'accepted')
    assert.equal((await meAfterSignIn(one, email, NEW_PASSWORD)).status, 200)
  })

  test('staff elsewhere, pending here, are mailed the link rather than asked for the password they have', async () => {
    const email = at('first-admin')
    const userId = await authUserId(email, true)
    await staffAt(one, email, userId, 'active')
    const pending = await staffAt(two, email, userId, 'pending')

    // Before: their password signs them in at studio two, and the portal refuses them.
    const refused = await meAfterSignIn(two, email, HARNESS_PASSWORD)
    assert.equal(refused.status, 403)
    assert.equal(((await refused.json()) as { error: string }).error, 'staff_inactive')

    assert.deepEqual(await step(two, email), { next: 'link_sent' })
    await resetPassword(two, resetTokenFor(email))

    assert.equal((await staffRow(two.id, email))?.status, 'active')
    assert.equal(await invitationStatus(pending.id), 'accepted')
    assert.equal((await meAfterSignIn(two, email, NEW_PASSWORD)).status, 200)
    assert.equal((await meAfterSignIn(one, email, NEW_PASSWORD)).status, 200, 'still staff at studio one')
    assert.deepEqual(await step(two, email), { next: 'password' }, 'arrived: the password is asked for now')
  })

  test('"Forgot password" on a pending account accepts the invitation too', async () => {
    const email = at('forgot')
    const userId = await authUserId(email, true)
    await staffAt(one, email, userId, 'active')
    await staffAt(two, email, userId, 'pending')

    await expectStatus(
      await post('/api/v1/auth/staff/request-password-reset', two, {
        email,
        redirectTo: `${frontendOrigin('staff', two)}/login`,
      }),
      200,
    )
    await resetPassword(two, resetTokenFor(email))
    assert.equal((await staffRow(two.id, email))?.status, 'active')
  })

  test('an expired invitation is mailed no link, and a reset does not revive it', async () => {
    const email = at('expired')
    const userId = await authUserId(email, true)
    await staffAt(one, email, userId, 'active')
    const staff = await staffAt(two, email, userId, 'pending', -60_000)

    // Not arrived: asked for the password they have, which the portal then refuses.
    assert.deepEqual(await step(two, email), { next: 'password' })
    assert.equal(mailsTo(email).length, 0)

    // "Forgot password" still resets it, but does not accept a lapsed invitation.
    await expectStatus(
      await post('/api/v1/auth/staff/request-password-reset', two, {
        email,
        redirectTo: `${frontendOrigin('staff', two)}/login`,
      }),
      200,
    )
    await resetPassword(two, resetTokenFor(email))
    assert.equal((await staffRow(two.id, email))?.status, 'pending')
    assert.equal(await invitationStatus(staff.id), 'pending')
  })

  test('a spent link budget answers exactly as an unspent one', async () => {
    const email = at('budget')
    await staffAt(one, email, await authUserId(email, false), 'pending')

    for (let i = 0; i < 4; i++) assert.deepEqual(await step(one, email), { next: 'link_sent' })
    assert.equal(mailsTo(email).length, 3, 'three links per email per window, and no refusal to tell them apart')
  })

  test('an address that is not staff here answers the same, and is mailed nothing', async () => {
    const stranger = at('stranger')
    assert.deepEqual(await step(one, stranger), { next: 'link_sent' })
    assert.equal(mailsTo(stranger).length, 0)

    // Staff at another studio only: they have a password, so they are asked for
    // it — the portal then says they have no access here, as before.
    const elsewhere = at('elsewhere')
    await staffAt(one, elsewhere, await authUserId(elsewhere, true), 'active')
    assert.deepEqual(await step(two, elsewhere), { next: 'password' })
    assert.equal(mailsTo(elsewhere).length, 0)
  })
})
