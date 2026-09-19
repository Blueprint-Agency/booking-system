import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, desc, eq, inArray, like } from 'drizzle-orm'
import {
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * An admin manages a person's access from their detail view (#119), over real
 * HTTP: the sessions a member or staff member holds at this studio, signing them
 * out everywhere, blocking and unblocking, and resending a staff invitation.
 * Each act is logged in `auth_events` as the acting staff member's.
 */
describe('account access from the detail views', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `account-access-${run}.test`
  const at = (name: string) => `${name}@${DOMAIN}`

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
    if (error) assert.equal(parsed.error ?? parsed.message, error)
    return parsed
  }

  type StaffFixture = { headers: Record<string, string>; row: { id: string }; authUserId: string }

  /** A staff member of `tenant` with `role`, signed in on its portal. */
  const staffAt = async (
    tenant: { id: string; slug: string },
    email: string,
    role: 'admin' | 'instructor',
  ): Promise<StaffFixture> => {
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: email, role, status: 'active', authUserId: user!.id })
      .returning()
    return { headers, row: row!, authUserId: user!.id }
  }

  /** A member of `tenant`, added through the portal, signed in on its member app. */
  const memberAt = async (tenant: { id: string; slug: string }, admin: Record<string, string>, email: string) => {
    const created = await expectStatus(
      await send('/api/v1/portal/admin/clients', { body: { name: 'Ada Lovelace', email, phone: '+6591234567' }, headers: admin }),
      201,
    )
    const headers = await harness.signInAs('client', email, tenant)
    const [row] = await harness.db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, tenant.id), eq(schema.clients.id, created.id as string)))
    return { id: row!.id, authUserId: row!.authUserId!, headers }
  }

  const eventsFor = (subjectUserId: string, kind: typeof schema.authEvents.$inferSelect.kind) =>
    harness.db
      .select()
      .from(schema.authEvents)
      .where(and(eq(schema.authEvents.subjectUserId, subjectUserId), eq(schema.authEvents.kind, kind)))
      .orderBy(desc(schema.authEvents.createdAt))

  type SessionView = { id: string; user_agent: string | null; last_seen_at: string; signed_in_at: string }

  /** Two admins at studio one, so one can act on the other. */
  let owner!: StaffFixture
  let admin!: StaffFixture
  let adminTwo!: StaffFixture

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    ;({ one, two } = harness.tenants)
    owner = await staffAt(one, at('owner'), 'admin')
    admin = await staffAt(one, at('admin'), 'admin')
    adminTwo = await staffAt(two, at('admin-two'), 'admin')
  })

  after(async () => {
    if (!harness) return
    const staff = await harness.db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const staffIds = staff.map(s => s.id)
    const staffAuth = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    const clientAuth = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    const authIds = [...staffAuth, ...clientAuth].map(u => u.id)
    if (authIds.length) {
      await harness.db.delete(schema.authEvents).where(inArray(schema.authEvents.actorUserId, authIds))
      await harness.db.delete(schema.authEvents).where(inArray(schema.authEvents.subjectUserId, authIds))
    }
    if (staffIds.length) {
      await harness.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
      await harness.db.delete(schema.staffInvitations).where(inArray(schema.staffInvitations.staffUserId, staffIds))
    }
    await harness.db.delete(schema.clients).where(like(schema.clients.email, `%@${DOMAIN}`))
    if (staffIds.length) await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  test('member detail lists the member\'s sessions here; signing them out everywhere makes their next request 401', async () => {
    const member = await memberAt(one, owner.headers, at('member'))
    // A second device.
    const phone = await harness.signInAs('client', at('member'), one)

    const listed = await expectStatus(
      await send(`/api/v1/portal/admin/clients/${member.id}/sessions`, { headers: admin.headers }),
      200,
    )
    const sessions = listed.sessions as SessionView[]
    assert.equal(sessions.length, 2, 'both devices are listed')
    for (const s of sessions) {
      assert.equal(typeof s.id, 'string')
      assert.ok(s.last_seen_at && s.signed_in_at)
      assert.ok('user_agent' in s)
    }

    // An admin signs the member out.
    const revoked = await expectStatus(
      await send(`/api/v1/portal/admin/clients/${member.id}/sessions/revoke`, { body: {}, headers: admin.headers }),
      200,
    )
    assert.equal(revoked.revoked, 2)

    await expectStatus(await send('/api/v1/me', { headers: member.headers }), 401)
    await expectStatus(await send('/api/v1/me', { headers: phone }), 401)
    const after = await expectStatus(
      await send(`/api/v1/portal/admin/clients/${member.id}/sessions`, { headers: admin.headers }),
      200,
    )
    assert.deepEqual(after.sessions, [])

    const [event] = await eventsFor(member.authUserId, 'sessions_revoked')
    assert.ok(event, 'sessions_revoked was written')
    assert.equal(event.actorUserId, admin.authUserId)
    assert.equal(event.tenantId, one.id)
  })

  test('signing a member out at one studio leaves their session at another', async () => {
    const member = await memberAt(one, owner.headers, at('two-studios'))
    const elsewhere = await memberAt(two, adminTwo.headers, at('two-studios'))
    assert.equal(elsewhere.authUserId, member.authUserId, 'one auth user, two rows')

    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${member.id}/sessions/revoke`, { body: {}, headers: owner.headers }),
      200,
    )
    await expectStatus(await send('/api/v1/me', { headers: member.headers }), 401)
    await expectStatus(await send('/api/v1/me', { headers: elsewhere.headers }), 200)
  })

  test('staff detail lists a staff member\'s sessions; an admin signs another admin out everywhere', async () => {
    const target = await staffAt(one, at('signed-out-admin'), 'admin')

    const listed = await expectStatus(
      await send(`/api/v1/portal/admin/staff/${target.row.id}/sessions`, { headers: admin.headers }),
      200,
    )
    assert.equal((listed.sessions as SessionView[]).length, 1)

    const revoked = await expectStatus(
      await send(`/api/v1/portal/admin/staff/${target.row.id}/sessions/revoke`, { body: {}, headers: owner.headers }),
      200,
    )
    assert.equal(revoked.revoked, 1)
    await expectStatus(await send('/api/v1/portal/admin/staff', { headers: target.headers }), 401)

    const [event] = await eventsFor(target.authUserId, 'sessions_revoked')
    assert.ok(event, 'sessions_revoked was written')
    assert.equal(event.actorUserId, owner.authUserId)
    assert.equal(event.pool, 'staff')
  })

  test('an instructor cannot sign staff out', async () => {
    const actor = await staffAt(one, at('instructor-actor'), 'instructor')
    const target = await staffAt(one, at('instructor'), 'instructor')
    await expectStatus(
      await send(`/api/v1/portal/admin/staff/${target.row.id}/sessions/revoke`, { body: {}, headers: actor.headers }),
      403,
    )
  })

  test('blocking a member ends their sessions and is logged; unblocking reverses it', async () => {
    const member = await memberAt(one, owner.headers, at('blocked'))

    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${member.id}`, { method: 'DELETE', headers: owner.headers }),
      200,
    )
    await expectStatus(await send('/api/v1/me', { headers: member.headers }), 401)
    const [blocked] = await eventsFor(member.authUserId, 'user_blocked')
    assert.ok(blocked, 'user_blocked was written')
    assert.equal(blocked.actorUserId, owner.authUserId)

    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${member.id}/restore`, { body: {}, headers: owner.headers }),
      200,
    )
    const [unblocked] = await eventsFor(member.authUserId, 'user_unblocked')
    assert.ok(unblocked, 'user_unblocked was written')
    assert.equal(unblocked.actorUserId, owner.authUserId)
    const again = await harness.signInAs('client', at('blocked'), one)
    await expectStatus(await send('/api/v1/me', { headers: again }), 200)
  })

  test('blocking a staff member (archive) ends their sessions and is logged; unblocking reverses it', async () => {
    const target = await staffAt(one, at('archived-admin'), 'admin')

    await expectStatus(
      await send(`/api/v1/portal/admin/staff/${target.row.id}/archive`, { body: {}, headers: owner.headers }),
      200,
    )
    await expectStatus(await send('/api/v1/portal/admin/staff', { headers: target.headers }), 401)
    const [blocked] = await eventsFor(target.authUserId, 'user_blocked')
    assert.ok(blocked, 'user_blocked was written')
    assert.equal(blocked.actorUserId, owner.authUserId)

    await expectStatus(
      await send(`/api/v1/portal/admin/staff/${target.row.id}/unarchive`, { body: {}, headers: owner.headers }),
      200,
    )
    const [unblocked] = await eventsFor(target.authUserId, 'user_unblocked')
    assert.ok(unblocked, 'user_unblocked was written')
    const again = await harness.signInAs('staff', at('archived-admin'), one)
    await expectStatus(await send('/api/v1/portal/admin/staff', { headers: again }), 200)
  })

  test('resend from staff detail re-mails a pending invitation\'s set-password link', async () => {
    const email = at('invitee')
    await expectStatus(
      await send('/api/v1/portal/admin/staff/invite', { body: { email, role: 'admin' }, headers: owner.headers }),
      201,
    )
    const [pending] = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.tenantId, one.id), eq(schema.staffUsers.email, email)))
    const before = discardedMail.filter(m => m.to === email).length

    const res = await expectStatus(
      await send(`/api/v1/portal/admin/staff/${pending!.id}/resend-invitation`, { body: {}, headers: owner.headers }),
      200,
    )
    assert.equal(res.sent, 'invitation')
    const mails = discardedMail.filter(m => m.to === email)
    assert.equal(mails.length, before + 1, 'one more mail went out')
    assert.match(mails.at(-1)!.html, /\/signup\?[^"'\s<]*invite_token=/)

    const [event] = await eventsFor(pending!.authUserId!, 'invitation_resent')
    assert.ok(event, 'invitation_resent was written')
    assert.equal(event.actorUserId, owner.authUserId)
  })

  test('resend for a staff member with no invitation pending mails a set-password link', async () => {
    const target = await staffAt(one, at('no-invite'), 'admin')
    const res = await expectStatus(
      await send(`/api/v1/portal/admin/staff/${target.row.id}/resend-invitation`, { body: {}, headers: owner.headers }),
      200,
    )
    assert.equal(res.sent, 'set_password')
    const mail = discardedMail.filter(m => m.to === at('no-invite')).at(-1)
    assert.ok(mail, 'a mail went out')
    assert.match(mail.html, /reset-password\//)
    const [event] = await eventsFor(target.authUserId, 'invitation_resent')
    assert.ok(event, 'invitation_resent was written')
    assert.equal(event.actorUserId, owner.authUserId)
  })

  test('a set-password link the pool rate-limits is a named refusal, not a 500', async () => {
    const target = await staffAt(one, at('link-limited'), 'admin')
    // An address of its own, so this bucket is nobody else's: the pool allows three a minute.
    const headers = { ...owner.headers, 'X-Forwarded-For': '203.0.113.165' }
    const resend = () => send(`/api/v1/portal/admin/staff/${target.row.id}/resend-invitation`, { body: {}, headers })
    for (let i = 0; i < 3; i++) await expectStatus(await resend(), 200)
    await expectStatus(await resend(), 403, 'password_link_refused')
  })

  test('a studio cannot list or revoke the sessions of another studio\'s member or staff (404)', async () => {
    const member = await memberAt(two, adminTwo.headers, at('elsewhere'))
    const staff = await staffAt(two, at('elsewhere-admin'), 'admin')

    for (const path of [`/api/v1/portal/admin/clients/${member.id}/sessions`, `/api/v1/portal/admin/staff/${staff.row.id}/sessions`]) {
      await expectStatus(await send(path, { headers: owner.headers }), 404)
      await expectStatus(await send(`${path}/revoke`, { body: {}, headers: owner.headers }), 404)
    }
    await expectStatus(
      await send(`/api/v1/portal/admin/staff/${staff.row.id}/resend-invitation`, { body: {}, headers: owner.headers }),
      404,
    )

    await expectStatus(await send('/api/v1/me', { headers: member.headers }), 200)
    await expectStatus(await send('/api/v1/portal/admin/staff', { headers: staff.headers }), 200)
  })
})
