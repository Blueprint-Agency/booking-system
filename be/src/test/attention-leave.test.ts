import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { sgToday } from '../lib/time'

/**
 * Staff attention, leave requests (#476, #479): `leave_request_pending`, read
 * over HTTP as a signed-in admin. Every test makes a studio of its own, so a
 * count says only what that test filed.
 */
describe('Staff attention: leave requests', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const DAY = 24 * 60 * 60 * 1000

  type Studio = { id: string; slug: string }
  type Staff = { headers: Record<string, string>; id: string; name: string }

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

  const freshStudio = async (): Promise<Studio> => {
    const slug = `attl-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Attention Leave Studio', adminEmail: `owner@${slug}.test` })
    return { id: tenant.id, slug }
  }

  const staffAt = async (studio: Studio, name: string, role: 'admin' | 'instructor' = 'admin'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: row!.id })
    return { headers, id: row!.id, name }
  }

  /** The studio's owner is an active admin too; archive it so a test controls who the admins are. */
  const archiveOwner = async (studio: Studio) => {
    await harness.db
      .update(schema.staffUsers)
      .set({ status: 'archived' })
      .where(eq(schema.staffUsers.email, `owner@${studio.slug}.test`))
  }

  /** A calendar date n days from today in Singapore, the studio's own day. */
  const dayOffset = (n: number) => sgToday(new Date(Date.now() + n * DAY))

  /** A pending request, written straight to the table so a test can choose dates the API would refuse. */
  const requestLeave = async (
    studio: Studio,
    who: Staff,
    over: { type?: 'annual' | 'medical' | 'study'; start?: string; end?: string; days?: string; halfDay?: 'none' | 'morning' | 'afternoon' } = {},
  ) => {
    const start = over.start ?? dayOffset(10)
    const [row] = await harness.db
      .insert(schema.leaveRequests)
      .values({
        tenantId: studio.id,
        staffUserId: who.id,
        type: over.type ?? 'annual',
        startDate: start,
        endDate: over.end ?? start,
        halfDay: over.halfDay ?? 'none',
        days: over.days ?? '1.0',
        leaveYear: Number(start.slice(0, 4)),
        status: 'pending',
        reason: 'attention test',
      })
      .returning({ id: schema.leaveRequests.id })
    return row!.id
  }

  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const leaveItems = async (who: Staff) =>
    ((await panel(who)).needs_action.groups as Array<{ items: Array<Record<string, any>> }>)
      .flatMap(g => g.items)
      .filter(i => i.kind === 'leave_request_pending')

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
  })

  after(async () => {
    await harness?.close()
  })

  test('ATN-30 every active admin except the applicant sees a pending leave request, titled and linked to admin Leave, and the Leave badge counts it', async () => {
    const studio = await freshStudio()
    await archiveOwner(studio)
    const anna = await staffAt(studio, 'anna')
    const bruno = await staffAt(studio, 'bruno')
    const cara = await staffAt(studio, 'cara')
    const start = dayOffset(10)
    const id = await requestLeave(studio, anna, { start, end: dayOffset(12), days: '3.0' })

    for (const admin of [bruno, cara]) {
      const counts = await summary(admin)
      assert.equal(counts.needs_action, 1)
      assert.equal(counts.by_group.leave, 1)
      const body = await panel(admin)
      const [group] = body.needs_action.groups
      assert.equal(group.key, 'requests')
      assert.equal(group.see_all_href, '/admin/leave')
      const [item] = group.items
      assert.equal(item.id, `leave_request_pending:${id}`)
      assert.equal(item.kind, 'leave_request_pending')
      assert.match(item.title, /^anna asked for annual leave, \d{1,2} \w{3}( \d{4})? to \d{1,2} \w{3}( \d{4})?$/)
      assert.equal(item.href, `/admin/leave?request=${id}`)
      assert.equal(item.location, null)
      assert.equal(item.dismissable, false)
    }

    const own = await summary(anna)
    assert.equal(own.needs_action, 0, 'the applicant is not asked to decide their own leave')
    assert.equal(own.by_group.leave ?? 0, 0)
    assert.deepEqual(await leaveItems(anna), [])
  })

  test('ATN-31 the only active admin sees their own request, and loses the exemption once a second admin exists', async () => {
    const studio = await freshStudio()
    await archiveOwner(studio)
    const anna = await staffAt(studio, 'anna')
    await requestLeave(studio, anna)

    assert.equal((await summary(anna)).by_group.leave, 1)
    assert.equal((await leaveItems(anna)).length, 1)

    await staffAt(studio, 'bruno')
    assert.equal((await summary(anna)).needs_action, 0)

    const [bruno] = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.email, `bruno@${studio.slug}.test`))
    await harness.db.update(schema.staffUsers).set({ status: 'archived' }).where(eq(schema.staffUsers.id, bruno!.id))
    assert.equal((await summary(anna)).needs_action, 1, 'an archived admin does not count as someone else who can decide')
  })

  test('ATN-32 the detail says how many days and when it starts, or that it started n days ago', async () => {
    const studio = await freshStudio()
    await archiveOwner(studio)
    const anna = await staffAt(studio, 'anna')
    const bruno = await staffAt(studio, 'bruno')
    const soon = await requestLeave(studio, anna, { start: dayOffset(3), end: dayOffset(4), days: '2.0' })
    const started = await requestLeave(studio, anna, { type: 'medical', start: dayOffset(-2), end: dayOffset(-1), days: '2.0' })
    const half = await requestLeave(studio, anna, { start: dayOffset(1), days: '0.5', halfDay: 'morning' })
    const today = await requestLeave(studio, anna, { start: sgToday(new Date()), days: '1.0' })

    const byId = new Map((await leaveItems(bruno)).map(i => [i.id, i]))
    assert.equal(byId.get(`leave_request_pending:${soon}`)!.detail, '2 days · starts in 3 days')
    assert.equal(byId.get(`leave_request_pending:${started}`)!.detail, '2 days · started 2 days ago')
    assert.equal(byId.get(`leave_request_pending:${half}`)!.detail, '0.5 days · starts in 1 day')
    assert.equal(byId.get(`leave_request_pending:${today}`)!.detail, '1 day · starts today')
    assert.match(byId.get(`leave_request_pending:${half}`)!.title, /annual leave, \d{1,2} \w{3}( \d{4})? \(morning\)$/)
  })

  test('ATN-33 an instructor on study leave over the cap, or in a Leave Conflict, is flagged on the item', async () => {
    const studio = await freshStudio()
    await archiveOwner(studio)
    const admin = await staffAt(studio, 'admin')
    const tara = await staffAt(studio, 'tara', 'instructor')
    const kim = await staffAt(studio, 'kim', 'instructor')
    const lee = await staffAt(studio, 'lee', 'instructor')
    await harness.db.update(schema.globalPolicy).set({ studyLeaveCap: 1 }).where(eq(schema.globalPolicy.tenantId, studio.id))

    const date = dayOffset(20)
    await requestLeave(studio, kim, { type: 'study', start: date })
    const overCap = await requestLeave(studio, tara, { type: 'study', start: date })
    const clean = await requestLeave(studio, lee, { type: 'annual', start: dayOffset(40) })

    const byId = () => leaveItems(admin).then(items => new Map(items.map(i => [i.id, i])))
    assert.equal((await byId()).get(`leave_request_pending:${overCap}`)!.detail, '1 day · starts in 20 days · over the study cap')
    assert.equal((await byId()).get(`leave_request_pending:${clean}`)!.detail, '1 day · starts in 40 days')

    const [a, b] = [tara.id, lee.id].sort()
    await harness.db.insert(schema.leaveConflicts).values({ tenantId: studio.id, instructorAId: a!, instructorBId: b! })
    const overlap = await requestLeave(studio, lee, { type: 'medical', start: date })
    assert.equal((await byId()).get(`leave_request_pending:${overlap}`)!.detail, "1 day · starts in 20 days · clashes with tara's leave")
  })

  test('ATN-34 the item disappears when the request is approved, rejected or withdrawn, and the badge follows', async () => {
    const studio = await freshStudio()
    await archiveOwner(studio)
    const admin = await staffAt(studio, 'admin')
    const tara = await staffAt(studio, 'tara', 'instructor')
    const kim = await staffAt(studio, 'kim', 'instructor')
    const lee = await staffAt(studio, 'lee', 'instructor')
    const toApprove = await requestLeave(studio, tara, { start: dayOffset(10) })
    const toReject = await requestLeave(studio, kim, { start: dayOffset(12) })
    const toWithdraw = await requestLeave(studio, lee, { start: dayOffset(14) })
    assert.equal((await summary(admin)).by_group.leave, 3)

    await json(await send(`/portal/admin/leave/${toApprove}/approve`, admin.headers, 'POST', {}), 200)
    assert.equal((await summary(admin)).by_group.leave, 2)

    await json(await send(`/portal/admin/leave/${toReject}/reject`, admin.headers, 'POST', { reason: 'Short staffed' }), 200)
    assert.equal((await summary(admin)).by_group.leave, 1)

    await json(await send(`/portal/leave/${toWithdraw}/withdraw`, lee.headers, 'POST', {}), 200)
    const final = await summary(admin)
    assert.equal(final.needs_action, 0)
    assert.equal(final.by_group.leave ?? 0, 0)
    assert.deepEqual(await leaveItems(admin), [])
  })

  test('ATN-35 instructors and other studios see nothing of a studio’s leave requests, and a request filed over HTTP shows at once', async () => {
    const one = await freshStudio()
    const two = await freshStudio()
    await archiveOwner(one)
    const admin = await staffAt(one, 'admin')
    const tara = await staffAt(one, 'tara', 'instructor')
    const otherAdmin = await staffAt(two, 'admin')

    const res = await json(
      await send('/portal/leave', tara.headers, 'POST', {
        type: 'annual',
        start_date: dayOffset(30),
        end_date: dayOffset(30),
        reason: 'holiday',
      }),
      201,
    )

    assert.equal((await summary(admin)).by_group.leave, 1)
    assert.equal((await leaveItems(admin))[0]!.id, `leave_request_pending:${res.id}`)
    assert.equal((await summary(tara)).by_group.leave ?? 0, 0, 'the applicant is an instructor, and instructors are never owed this kind')
    assert.equal((await summary(otherAdmin)).by_group.leave ?? 0, 0)
  })
})
