import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  HARNESS_PASSWORD,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'
import { connectPayments, usePaymentKey } from './attention-payments'

/**
 * Staff attention, the Updates tab: `leave_decided` is written in
 * the transaction of the act that caused it, once per recipient, never for the
 * person who did the act; read and read-all touch only the caller's own rows;
 * the panel pages them; a daily job deletes those older than 90 days.
 *
 * Every test makes a studio of its own, so what a count says is about the
 * updates that test made and nobody else's.
 */
describe('Staff attention: Updates', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  usePaymentKey()
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let jobs!: typeof import('../jobs')

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const DAY = 24 * 60 * 60 * 1000

  type Studio = { id: string; slug: string }
  type Staff = { headers: Record<string, string>; id: string; email: string; name: string }

  let studios = 0

  const send = (path: string, headers: Record<string, string>, method = 'GET', body?: unknown) =>
    harness.app.request(`/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as Record<string, any>
  }

  const portalHeaders = (studio: Studio) => ({
    Origin: frontendOrigin('staff', studio),
    'X-Tenant-Slug': studio.slug,
    'X-Forwarded-For': harnessAddress(),
  })

  const freshStudio = async (): Promise<Studio> => {
    const slug = `upd-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Updates Studio', adminEmail: `owner@${slug}.test` })
    await connectPayments(tenant.id)
    return { id: tenant.id, slug }
  }

  const adminAt = async (studio: Studio, name = 'admin'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role: 'admin', status: 'active', authUserId: user!.id })
      .returning()
    return { headers, id: row!.id, email, name }
  }

  const instructorAt = async (studio: Studio, admin: Staff, name: string): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    await json(await send('/portal/admin/staff/invite', admin.headers, 'POST', { email, role: 'instructor' }), 201)
    const [invitation] = await harness.db
      .select({ token: schema.staffInvitations.token, staffUserId: schema.staffInvitations.staffUserId })
      .from(schema.staffInvitations)
      .where(and(eq(schema.staffInvitations.tenantId, studio.id), eq(schema.staffInvitations.email, email)))
    await json(
      await send('/public/staff-invitation/accept', portalHeaders(studio), 'POST', {
        token: invitation!.token,
        password: HARNESS_PASSWORD,
      }),
      200,
    )
    const headers = await harness.signInAs('staff', email, studio)
    return { headers, id: invitation!.staffUserId!, email, name }
  }

  /** A pending annual-leave request for `who`, filed straight into the table. */
  let leaveCount = 0
  const pendingLeave = async (studio: Studio, who: Staff, type: 'annual' | 'medical' | 'study' = 'annual') => {
    const start = new Date(Date.now() + (30 + 3 * ++leaveCount) * DAY)
    const day = start.toISOString().slice(0, 10)
    const [row] = await harness.db
      .insert(schema.leaveRequests)
      .values({
        tenantId: studio.id,
        staffUserId: who.id,
        type,
        startDate: day,
        endDate: day,
        days: '1.0',
        leaveYear: start.getUTCFullYear(),
        reason: 'Family trip',
      })
      .returning({ id: schema.leaveRequests.id })
    return row!.id
  }

  const decide = (admin: Staff, id: string, action: 'approve' | 'reject' | 'revoke', reason?: string) =>
    send(`/portal/admin/leave/${id}/${action}`, admin.headers, 'POST', reason === undefined ? undefined : { reason })

  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const panel = async (who: Staff, query = '') => json(await send(`/portal/attention${query}`, who.headers), 200)
  const updatesOf = async (who: Staff) => (await panel(who)).updates.items as Array<Record<string, any>>

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    jobs = await import('../jobs')
  })

  after(async () => {
    harness?.clock.reset()
    await harness?.close()
  })

  test('ATN-140 approving an instructor’s leave gives them one unread update that links to their Leave page, and counts in the bubble', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const id = await pendingLeave(studio, ada)
    await json(await decide(admin, id, 'approve'), 200)

    const s = await summary(ada)
    assert.equal(s.unread_updates, 1)
    assert.equal(s.needs_action, 0)
    assert.equal(s.total, 1)

    const [u] = await updatesOf(ada)
    assert.equal(u!.kind, 'leave_decided')
    assert.match(u!.title, /^Your annual leave, \d+ \w+ \d{4}, was approved$/)
    assert.equal(u!.href, `/instructor/leave?request=${id}`)
    assert.equal(u!.read_at, null)
    assert.ok(u!.created_at)

    // The admin who decided it is told nothing.
    // (Ada joining did tell the admin, `staff_joined`; the leave is not it.)
    assert.deepEqual(
      (await updatesOf(admin)).map(x => x.kind),
      ['staff_joined'],
    )
    assert.equal((await summary(admin)).unread_updates, 1)
  })

  test('ATN-141 declining leave gives the applicant the reason and the admin’s name; an admin applicant is linked to My leave', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio, 'boss')
    const other = await adminAt(studio, 'second')
    const id = await pendingLeave(studio, other, 'medical')
    await json(await decide(admin, id, 'reject', 'Too many away that week'), 200)

    const [u] = await updatesOf(other)
    assert.match(u!.title, /^Your medical leave, \d+ \w+ \d{4}, was declined$/)
    assert.equal(u!.detail, '“Too many away that week” · boss')
    assert.equal(u!.href, `/admin/my-leave?request=${id}`)
  })

  test('ATN-142 revoking approved leave tells the applicant who cancelled it', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio, 'boss')
    const ada = await instructorAt(studio, admin, 'ada')
    const id = await pendingLeave(studio, ada, 'study')
    await json(await decide(admin, id, 'approve'), 200)
    await json(await decide(admin, id, 'revoke'), 200)

    const items = await updatesOf(ada)
    assert.equal(items.length, 2)
    // Newest first.
    assert.match(items[0]!.title, /^boss cancelled your approved study leave, \d+ \w+ \d{4}$/)
    assert.match(items[1]!.title, /was approved$/)
    assert.equal((await summary(ada)).unread_updates, 2)
  })

  test('ATN-143 an admin who decides their own leave gets no update', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const id = await pendingLeave(studio, admin)
    await json(await decide(admin, id, 'approve'), 200)
    assert.equal((await summary(admin)).unread_updates, 0)
    assert.deepEqual(await updatesOf(admin), [])
  })

  test('ATN-144 read marks one update read; read-all marks only the caller’s own; someone else’s update is a 404', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    for (const who of [ada, ada, ben]) await json(await decide(admin, await pendingLeave(studio, who), 'approve'), 200)

    const [first, second] = await updatesOf(ada)
    const [bens] = await updatesOf(ben)

    // Not theirs: 404, and Ben's update stays unread.
    await json(await send(`/portal/attention/updates/${bens!.id}/read`, ada.headers, 'POST'), 404)
    assert.equal((await summary(ben)).unread_updates, 1)
    await json(await send(`/portal/attention/updates/${crypto.randomUUID()}/read`, ada.headers, 'POST'), 404)

    await json(await send(`/portal/attention/updates/${first!.id}/read`, ada.headers, 'POST'), 204)
    assert.equal((await summary(ada)).unread_updates, 1)
    const after1 = await updatesOf(ada)
    assert.ok(after1.find(u => u.id === first!.id)!.read_at)
    assert.equal(after1.find(u => u.id === second!.id)!.read_at, null)
    // Reading it again is harmless and keeps the first time.
    await json(await send(`/portal/attention/updates/${first!.id}/read`, ada.headers, 'POST'), 204)

    await json(await send('/portal/attention/updates/read-all', ada.headers, 'POST'), 204)
    assert.equal((await summary(ada)).unread_updates, 0)
    assert.equal((await summary(ada)).total, 0)
    assert.equal((await summary(ben)).unread_updates, 1)
  })

  test('ATN-145 another studio’s staff cannot read an update, and see none of this studio’s', async () => {
    const studio = await freshStudio()
    const elsewhere = await freshStudio()
    const admin = await adminAt(studio)
    const stranger = await adminAt(elsewhere)
    const ada = await instructorAt(studio, admin, 'ada')
    await json(await decide(admin, await pendingLeave(studio, ada), 'approve'), 200)
    const [u] = await updatesOf(ada)

    assert.equal((await summary(stranger)).unread_updates, 0)
    await json(await send(`/portal/attention/updates/${u!.id}/read`, stranger.headers, 'POST'), 404)
    assert.equal((await summary(ada)).unread_updates, 1)
  })

  test('ATN-146 the Updates tab pages newest first with a cursor', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    for (let i = 0; i < 25; i++) await json(await decide(admin, await pendingLeave(studio, ada), 'approve'), 200)

    const page1 = (await panel(ada)).updates
    assert.equal(page1.items.length, 20)
    assert.ok(page1.next_cursor)
    const page2 = (await panel(ada, `?updates_before=${encodeURIComponent(page1.next_cursor)}`)).updates
    assert.equal(page2.items.length, 5)
    assert.equal(page2.next_cursor, null)
    const ids = [...page1.items, ...page2.items].map((u: any) => u.id)
    assert.equal(new Set(ids).size, 25, 'no update twice, none skipped')
    const times = [...page1.items, ...page2.items].map((u: any) => Date.parse(u.created_at))
    assert.deepEqual(times, [...times].sort((a, b) => b - a))
    await json(await send('/portal/attention?updates_before=nonsense', ada.headers), 400)
  })

  test('ATN-147 the retention job deletes updates older than 90 days, per studio, and keeps newer ones', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    await json(await decide(admin, await pendingLeave(studio, ada), 'approve'), 200)
    const t0 = harness.clock.now()

    // 89 days on: still there.
    harness.clock.set(new Date(t0.getTime() + 89 * DAY))
    await jobs.scheduledJobs.pruneStaffUpdates()
    assert.equal((await updatesOf(ada)).length, 1)

    // 91 days on: gone (the job is daily, so land inside a tenant's slot).
    for (let slot = 0; slot < 96; slot++) {
      harness.clock.set(new Date(t0.getTime() + 91 * DAY + slot * 900_000))
      await jobs.scheduledJobs.pruneStaffUpdates()
    }
    assert.equal((await updatesOf(ada)).length, 0)
    assert.equal((await summary(ada)).unread_updates, 0)
  })

  test('ATN-148 permanently deleting a member removes the updates that name them and leaves others', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const email = `mia@${studio.slug}.test`
    await harness.signInAs('client', email, studio)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [member] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name: 'Mia', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    await harness.db.insert(schema.staffUpdates).values([
      { tenantId: studio.id, recipientStaffId: ada.id, kind: 'leave_decided', payload: {}, subjectClientId: member!.id },
      { tenantId: studio.id, recipientStaffId: ada.id, kind: 'leave_decided', payload: {} },
    ])

    const res = await harness.app.request(`/api/v1/portal/admin/clients/${member!.id}/permanently`, {
      method: 'DELETE',
      headers: admin.headers,
    })
    assert.equal(res.status, 200, await res.clone().text())

    const left = await harness.db
      .select({ subject: schema.staffUpdates.subjectClientId })
      .from(schema.staffUpdates)
      // Not the admin's `staff_joined` for Ada, which names no member either.
      .where(and(eq(schema.staffUpdates.tenantId, studio.id), eq(schema.staffUpdates.recipientStaffId, ada.id)))
    assert.deepEqual(left, [{ subject: null }], 'only the update that named no one is left')
  })
})
