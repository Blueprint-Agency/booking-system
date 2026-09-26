import assert from 'node:assert/strict'
import { after, afterEach, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import {
  frontendOrigin,
  HARNESS_PASSWORD,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * An admin changes a staff member's sign-in email — another's, or their own.
 * The new address is saved as Unverified and mailed a confirmation link, and
 * nothing moves until that link is confirmed.
 *
 * Over the real sign-in, because the claim is about the door: until the link is
 * confirmed the old address is the one that gets in; after it, the person gets
 * in at the new address with the password they already had, and the old
 * address opens nothing. Each test runs in a studio of its own.
 */
describe('staff email change', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let discardedMail!: typeof import('../lib/mailer').discardedMail

  const run = Date.now().toString(36)
  let studios = 0

  type Studio = { id: string; slug: string }
  type StaffFixture = { headers: Record<string, string>; id: string; authUserId: string; email: string }
  type Pending = { email: string; sent_at: string; expires_at: string; expired: boolean }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ;({ discardedMail } = await import('../lib/mailer'))
  })

  afterEach(() => harness.clock.reset())

  after(async () => {
    await harness?.close()
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
    if (error) assert.equal(parsed.error, error, body)
    return parsed
  }

  const freshStudio = async (): Promise<Studio> => {
    const slug = `staff-email-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Staff Email Studio', adminEmail: `owner@${slug}.test` })
    return { id: tenant.id, slug }
  }

  const staffAt = async (studio: Studio, name: string, role: 'admin' | 'instructor'): Promise<StaffFixture> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, studio.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    return { headers, id: row!.id, authUserId: user!.id, email }
  }

  /** Nobody signed in: a browser on the studio's portal, as the confirmation page sends it. */
  const portalHeaders = (studio: Studio): Record<string, string> => ({
    'X-Tenant-Slug': studio.slug,
    Origin: frontendOrigin('staff', studio),
    'X-Forwarded-For': harnessAddress(),
  })

  /** A password sign-in on the studio's portal, as the login form sends it. */
  const signInStatus = async (studio: Studio, email: string) => {
    const res = await send('/api/v1/auth/staff/sign-in/email', {
      body: { email, password: HARNESS_PASSWORD },
      headers: portalHeaders(studio),
    })
    return res.status
  }

  const emailPath = (id: string) => `/api/v1/portal/admin/staff/${id}/email`

  /** The last message the null transport dropped for this address. */
  const lastMailTo = (email: string) => [...discardedMail].reverse().find(m => m.to === email)
  const linkMailedTo = (email: string) => {
    const token = lastMailTo(email)?.html.match(/\/confirm-email\?token=([A-Za-z0-9._-]+)/)?.[1]
    assert.ok(token, `no confirmation link was mailed to ${email}`)
    return token
  }

  const lookup = async (studio: Studio, token: string) =>
    expectStatus(
      await send(`/api/v1/public/staff-email-change?token=${encodeURIComponent(token)}`, { headers: portalHeaders(studio) }),
      200,
    )
  const confirm = (studio: Studio, token: string) =>
    send('/api/v1/public/staff-email-change/confirm', { body: { token }, headers: portalHeaders(studio) })

  const staffRow = async (id: string) => {
    const [row] = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, id))
    return row!
  }

  /** The staff member as the admin's staff list shows them. */
  const listed = async (admin: StaffFixture, id: string) => {
    const body = await expectStatus(await send('/api/v1/portal/admin/staff', { headers: admin.headers }), 200)
    const row = (body.staff as Array<{ id: string; email: string; pending_email: Pending | null }>).find(s => s.id === id)
    assert.ok(row, 'the staff member is listed')
    return row
  }

  test('STF-24 an admin saves an instructor\'s new address as Unverified, and it moves only once its link is confirmed, password and all', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const newEmail = `teacher-new@${studio.slug}.test`

    const started = await expectStatus(
      await send(emailPath(instructor.id), { body: { email: `Teacher-New@${studio.slug}.test` }, headers: admin.headers }),
      200,
    )
    assert.equal((started.pending_email as Pending).email, newEmail)
    assert.equal((started.pending_email as Pending).expired, false)
    const token = linkMailedTo(newEmail)

    // Saved and labelled, and nothing else has moved: the old address still signs in, the new one does not.
    const unverified = await listed(admin, instructor.id)
    assert.equal(unverified.email, instructor.email)
    assert.equal(unverified.pending_email?.email, newEmail)
    assert.equal(unverified.pending_email?.expired, false)
    assert.equal((await staffRow(instructor.id)).email, instructor.email)
    assert.equal(await signInStatus(studio, instructor.email), 200)
    assert.notEqual(await signInStatus(studio, newEmail), 200)

    // A set-password link already mailed to the old address, as Better Auth stores one.
    const oldResetLink = `reset-password:${run}-${instructor.id}`
    await harness.db.insert(schema.staffAuthVerifications).values({
      id: crypto.randomUUID(),
      tenantId: studio.id,
      identifier: oldResetLink,
      value: instructor.authUserId,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    })

    const shown = await lookup(studio, token)
    assert.equal(shown.status, 'valid')
    assert.equal(shown.email, newEmail)

    const confirmed = await expectStatus(await confirm(studio, token), 200)
    assert.equal(confirmed.email, newEmail)

    const [login] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.id, instructor.authUserId))
    assert.equal(login!.email, newEmail, 'the same login is re-addressed, not replaced')
    const leftover = await harness.db
      .select()
      .from(schema.staffAuthVerifications)
      .where(eq(schema.staffAuthVerifications.identifier, oldResetLink))
    assert.equal(leftover.length, 0, 'a link mailed to the old address no longer opens the account')

    const verified = await listed(admin, instructor.id)
    assert.equal(verified.email, newEmail)
    assert.equal(verified.pending_email, null, 'no longer Unverified')

    assert.equal(await signInStatus(studio, newEmail), 200, 'the new address signs in with the old password')
    assert.notEqual(await signInStatus(studio, instructor.email), 200, 'the old address signs in no one')
    await expectStatus(await send('/api/v1/portal/instructor/profile', { headers: instructor.headers }), 200)

    const notice = lastMailTo(instructor.email)
    assert.ok(notice, 'the old address is told')
    assert.match(notice.html, new RegExp(newEmail.replace(/[.]/g, '\\.')))

    // Used once: the same link cannot confirm again.
    await expectStatus(await confirm(studio, token), 400, 'email_change_link_invalid')
    assert.equal((await lookup(studio, token)).status, 'invalid')
  })

  test('STF-24 an admin changes their own email and stays signed in', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const newEmail = `admin-new@${studio.slug}.test`

    await expectStatus(await send(emailPath(admin.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    await expectStatus(await confirm(studio, linkMailedTo(newEmail)), 200)

    assert.equal((await staffRow(admin.id)).email, newEmail)
    await expectStatus(await send('/api/v1/portal/admin/staff', { headers: admin.headers }), 200)
    assert.equal(await signInStatus(studio, newEmail), 200)
  })

  test('STF-24 an admin changes another admin\'s email', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const peer = await staffAt(studio, 'peer', 'admin')
    const newEmail = `peer-new@${studio.slug}.test`

    await expectStatus(await send(emailPath(peer.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    await expectStatus(await confirm(studio, linkMailedTo(newEmail)), 200)
    assert.equal((await staffRow(peer.id)).email, newEmail)
  })

  test('STF-24 an invitee\'s pending invitation moves to the new address with a new link', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const typo = `teacher@${studio.slug}.tset`
    const invited = await expectStatus(
      await send('/api/v1/portal/admin/staff/invite', { body: { email: typo, role: 'admin' }, headers: admin.headers }),
      201,
    )
    const [before] = await harness.db
      .select()
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.id, String(invited.id)))
    const newEmail = `teacher@${studio.slug}.test`

    await expectStatus(await send(emailPath(before!.staffUserId!), { body: { email: newEmail }, headers: admin.headers }), 200)
    await expectStatus(await confirm(studio, linkMailedTo(newEmail)), 200)

    const [after] = await harness.db
      .select()
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.id, before!.id))
    assert.equal(after!.email, newEmail)
    assert.equal(after!.status, 'pending')
    assert.notEqual(after!.token, before!.token, 'the link mailed to the mistyped address is dead')
  })

  test('STF-24 a link works only on the portal of the studio that sent it', async () => {
    const studio = await freshStudio()
    const elsewhere = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const newEmail = `teacher-new@${studio.slug}.test`

    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    const token = linkMailedTo(newEmail)

    assert.equal((await lookup(elsewhere, token)).status, 'invalid')
    await expectStatus(await confirm(elsewhere, token), 400, 'email_change_link_invalid')
    assert.equal((await staffRow(instructor.id)).email, instructor.email)
    // Still good where it was sent from.
    await expectStatus(await confirm(studio, token), 200)
  })

  test('STF-25 revoking an Unverified address kills its link and its label, and does not reset the wait for another', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const newEmail = `teacher-new@${studio.slug}.test`

    harness.clock.set(new Date())
    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    const token = linkMailedTo(newEmail)
    await expectStatus(await send(emailPath(instructor.id), { method: 'DELETE', headers: admin.headers }), 204)

    assert.equal((await listed(admin, instructor.id)).pending_email, null, 'no longer shown as Unverified')
    assert.equal((await lookup(studio, token)).status, 'invalid')
    await expectStatus(await confirm(studio, token), 400, 'email_change_link_invalid')
    assert.equal((await staffRow(instructor.id)).email, instructor.email)
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }),
      429,
      'too_many_requests',
    )
  })

  test('STF-25 a resend, or a different address, replaces the link, and the old one confirms nothing', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const typo = `teacher-new@${studio.slug}.tset`
    const newEmail = `teacher-new@${studio.slug}.test`

    harness.clock.set(new Date())
    await expectStatus(await send(emailPath(instructor.id), { body: { email: typo }, headers: admin.headers }), 200)
    const toTypo = linkMailedTo(typo)

    harness.clock.advance(31_000)
    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    const first = linkMailedTo(newEmail)
    assert.equal((await listed(admin, instructor.id)).pending_email?.email, newEmail, 'the new address replaces the old one')
    await expectStatus(await confirm(studio, toTypo), 400, 'email_change_link_invalid')

    harness.clock.advance(31_000)
    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    const resent = linkMailedTo(newEmail)
    assert.notEqual(resent, first)
    await expectStatus(await confirm(studio, first), 400, 'email_change_link_invalid')
    assert.equal((await staffRow(instructor.id)).email, instructor.email)

    await expectStatus(await confirm(studio, resent), 200)
    assert.equal((await staffRow(instructor.id)).email, newEmail)
  })

  test('STF-25 after 24 hours the link is expired and shows so, a second link inside 30 seconds is refused, and a resend works', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const newEmail = `teacher-new@${studio.slug}.test`

    harness.clock.set(new Date())
    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }),
      429,
      'too_many_requests',
    )
    const token = linkMailedTo(newEmail)

    harness.clock.advance(24 * 60 * 60_000 + 1_000)
    const listedExpired = await listed(admin, instructor.id)
    assert.equal(listedExpired.pending_email?.email, newEmail, 'still shown, so it can be resent or revoked')
    assert.equal(listedExpired.pending_email?.expired, true)
    assert.equal((await lookup(studio, token)).status, 'expired')
    await expectStatus(await confirm(studio, token), 400, 'email_change_link_expired')
    assert.equal((await staffRow(instructor.id)).email, instructor.email)

    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    assert.equal((await listed(admin, instructor.id)).pending_email?.expired, false)
    await expectStatus(await confirm(studio, linkMailedTo(newEmail)), 200)
    assert.equal((await staffRow(instructor.id)).email, newEmail)
  })

  test('STF-26 an address in use, the same address, a placeholder, or a blocked staff member is refused', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const other = await staffAt(studio, 'other', 'instructor')
    const mailed = discardedMail.length

    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: other.email.toUpperCase() }, headers: admin.headers }),
      409,
      'email_in_use',
    )
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: instructor.email }, headers: admin.headers }),
      400,
      'email_unchanged',
    )
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: `teacher@${studio.slug}.invalid` }, headers: admin.headers }),
      400,
      'email_placeholder_not_allowed',
    )
    // Checked before the block: the staff list leaves blocked staff out.
    assert.equal((await listed(admin, instructor.id)).pending_email, null, 'no refusal saves an Unverified address')
    await expectStatus(await send(`/api/v1/portal/admin/staff/${instructor.id}/archive`, { body: {}, headers: admin.headers }), 200)
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: `teacher-new@${studio.slug}.test` }, headers: admin.headers }),
      409,
      'staff_archived',
    )
    assert.equal(discardedMail.length, mailed, 'no refusal mails anything')
  })

  test('STF-26 a link sent before the staff member was blocked, or to an address taken since, confirms nothing', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const blocked = await staffAt(studio, 'teacher', 'instructor')
    const raced = await staffAt(studio, 'second', 'instructor')
    const blockedNew = `teacher-new@${studio.slug}.test`
    const shared = `shared@${studio.slug}.test`

    await expectStatus(await send(emailPath(blocked.id), { body: { email: blockedNew }, headers: admin.headers }), 200)
    const blockedLink = linkMailedTo(blockedNew)
    await expectStatus(await send(`/api/v1/portal/admin/staff/${blocked.id}/archive`, { body: {}, headers: admin.headers }), 200)
    await expectStatus(await confirm(studio, blockedLink), 409, 'staff_archived')
    assert.equal((await staffRow(blocked.id)).email, blocked.email)

    // Two admins, one address: the first link confirmed takes it.
    const peer = await staffAt(studio, 'peer', 'admin')
    await expectStatus(await send(emailPath(raced.id), { body: { email: shared }, headers: admin.headers }), 200)
    const racedLink = linkMailedTo(shared)
    await expectStatus(await send(emailPath(peer.id), { body: { email: shared }, headers: admin.headers }), 200)
    await expectStatus(await confirm(studio, linkMailedTo(shared)), 200)
    await expectStatus(await confirm(studio, racedLink), 409, 'email_in_use')
    assert.equal((await staffRow(raced.id)).email, raced.email)
  })

  test('STF-26 a link sent by an admin who has since been blocked confirms nothing', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const rogue = await staffAt(studio, 'rogue', 'admin')
    const peer = await staffAt(studio, 'peer', 'admin')
    const rogueInbox = `rogue-inbox@${studio.slug}.test`

    await expectStatus(await send(emailPath(peer.id), { body: { email: rogueInbox }, headers: rogue.headers }), 200)
    const token = linkMailedTo(rogueInbox)
    await expectStatus(await send(`/api/v1/portal/admin/staff/${rogue.id}/archive`, { body: {}, headers: admin.headers }), 200)

    // Nobody signs in to confirm, so the sender's authority is what the link carries.
    assert.equal((await lookup(studio, token)).status, 'invalid')
    await expectStatus(await confirm(studio, token), 400, 'email_change_link_invalid')
    assert.equal((await staffRow(peer.id)).email, peer.email)
    assert.equal(await signInStatus(studio, peer.email), 200)
  })

  test('STF-26 an instructor cannot change anyone\'s email', async () => {
    const studio = await freshStudio()
    await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: `teacher-new@${studio.slug}.test` }, headers: instructor.headers }),
      403,
    )
  })
})
