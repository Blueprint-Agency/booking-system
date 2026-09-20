import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm'
import {
  inTenantContext,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'
import { addDays, isoWeekday } from '../services/schedule/series-dates'

/**
 * Class Series (#175), over real HTTP as a studio admin: preview, create,
 * extend, end — and the classes it makes behaving like any class.
 *
 * Every row hangs off a room, a class type and an instructor made here, so no
 * other test's classes can clash with these and the dates are far enough out
 * that none of them is in the past.
 */
describe('class series', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let one!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `class-series-${run}.test`
  const TAG = `cser-${run}`
  const at = (name: string) => `${name}@${DOMAIN}`

  const send = (path: string, headers: Record<string, string>, method = 'GET', body?: unknown) =>
    harness.app.request(`/api/v1/portal/admin/schedule${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as Record<string, any>
  }

  const staffAt = async (email: string, role: 'admin' | 'instructor') => {
    const headers = await harness.signInAs('staff', email, one)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: one.id, email, name: email, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: row!.id })
    }
    return { headers, id: row!.id }
  }

  let admin!: Awaited<ReturnType<typeof staffAt>>
  let teacher!: Awaited<ReturnType<typeof staffAt>>
  let helper!: Awaited<ReturnType<typeof staffAt>>
  let locationId!: string
  let roomId!: string
  let classTypeId!: string

  /** Mondays, far enough out to be in the future whatever day this runs. */
  const firstMonday = (() => {
    const base = addDays(new Date().toISOString().slice(0, 10), 400)
    return addDays(base, (1 - isoWeekday(base) + 7) % 7)
  })()
  const monday = (week: number) => addDays(firstMonday, week * 7)

  const template = () => ({
    class_type_id: classTypeId,
    main_instructor_id: teacher.id,
    instructor_pay_sgd: 60,
    supporting_instructors: [{ instructor_id: helper.id, pay_sgd: 30 }],
    location_id: locationId,
    room_id: roomId,
    weekday: 1,
    start_time: '19:00',
    end_time: '20:00',
    capacity_online: 20,
    capacity_waitlist: 0,
    capacity_buffer: 0,
    credit_cost: 1,
    first_date: monday(0),
    last_date: addDays(monday(3), 2), // four Mondays, ending mid-week
    excluded_dates: [] as string[],
  })

  const seriesClasses = async (seriesId: string) =>
    harness.db
      .select()
      .from(schema.classes)
      .where(eq(schema.classes.seriesId, seriesId))
      .orderBy(schema.classes.startsAt)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    one = harness.tenants.one
    admin = await staffAt(at('admin'), 'admin')
    teacher = await staffAt(at('teacher'), 'instructor')
    helper = await staffAt(at('helper'), 'instructor')
    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(and(eq(schema.locations.tenantId, one.id), isNull(schema.locations.deletedAt), isNull(schema.locations.archivedAt)))
      .limit(1)
    assert.ok(location, 'the fixture studio has a seeded location')
    locationId = location.id
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: one.id, locationId, name: `${TAG} Room`, capacity: 20 })
      .returning()
    roomId = room!.id
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: one.id, name: `${TAG} Hatha` })
      .returning()
    classTypeId = type!.id
  })

  after(async () => {
    if (!harness) return
    const staff = await harness.db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const staffIds = staff.map(s => s.id)
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${`%@${DOMAIN}`}`
    const ourClasses = sql`SELECT id FROM classes WHERE class_type_id = ${classTypeId}`
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM credit_ledger WHERE client_id IN (${clients})`).catch(() => {})
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${TAG}%`}`)
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'classId' IN (SELECT id::text FROM classes WHERE class_type_id = ${classTypeId})`)
    await harness.db.execute(sql`DELETE FROM class_supporting_instructors WHERE class_id IN (${ourClasses})`)
    await harness.db.execute(sql`DELETE FROM classes WHERE class_type_id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM class_series WHERE class_type_id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE id = ${roomId}`)
    await harness.db.delete(schema.clients).where(like(schema.clients.email, `%@${DOMAIN}`))
    if (staffIds.length) {
      await harness.db.delete(schema.leaveRequests).where(inArray(schema.leaveRequests.instructorId, staffIds))
      await harness.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
      await harness.db.delete(schema.instructors).where(inArray(schema.instructors.staffUserId, staffIds))
      await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    }
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  test('an instructor cannot preview or create a series', async () => {
    const res = await send('/series/preview', teacher.headers, 'POST', template())
    assert.equal(res.status, 403)
  })

  test('preview lists every Monday at 19:00 studio time, minus excluded dates', async () => {
    const body = await json(
      await send('/series/preview', admin.headers, 'POST', { ...template(), excluded_dates: [monday(1)] }),
      200,
    )
    assert.deepEqual(
      body.dates.map((d: any) => d.date),
      [monday(0), monday(2), monday(3)],
    )
    // The fixture studio is Asia/Singapore: 19:00 there is 11:00 UTC.
    assert.equal(body.dates[0].starts_at, `${monday(0)}T11:00:00.000Z`)
    assert.equal(body.dates[0].ends_at, `${monday(0)}T12:00:00.000Z`)
    assert.equal(body.clash_count, 0)
    assert.ok(body.dates.every((d: any) => d.clashes.length === 0))
  })

  test('a series may cover at most a year per create', async () => {
    const res = await send('/series/preview', admin.headers, 'POST', {
      ...template(),
      last_date: addDays(monday(0), 400),
    })
    assert.equal((await json(res, 400)).error, 'series_range_too_long')
  })

  let seriesId!: string

  test('a clash on any date is listed, and a commit with it creates nothing', async () => {
    // Monday 1: the room is taken by a one-off class. Monday 2: the supporting
    // instructor is on leave.
    const roomTaken = await json(
      await send('/classes', admin.headers, 'POST', {
        class_type_id: classTypeId,
        main_instructor_id: teacher.id,
        location_id: locationId,
        room_id: roomId,
        starts_at: `${monday(1)}T11:30:00.000Z`,
        ends_at: `${monday(1)}T12:30:00.000Z`,
        capacity_online: 5,
        credit_cost: 1,
        instructor_pay_sgd: 10,
      }),
      201,
    )
    await harness.db.insert(schema.leaveRequests).values({
      tenantId: one.id,
      instructorId: helper.id,
      type: 'annual',
      startDate: monday(2),
      endDate: monday(2),
      days: '1',
      leaveYear: Number(monday(2).slice(0, 4)),
      status: 'approved',
      reason: `${TAG} leave`,
    })

    const preview = await json(await send('/series/preview', admin.headers, 'POST', template()), 200)
    assert.equal(preview.clash_count, 2)
    const byDate = Object.fromEntries(preview.dates.map((d: any) => [d.date, d.clashes]))
    // The room is taken by the one-off class; the teacher is also on it.
    assert.ok(byDate[monday(1)].some((c: any) => c.subject === 'room' && c.conflicts[0].id === roomTaken.id))
    assert.ok(
      byDate[monday(2)].some(
        (c: any) => c.subject === 'instructor' && c.subject_id === helper.id && c.conflicts[0].kind === 'leave',
      ),
    )
    assert.deepEqual(byDate[monday(0)], [])

    const refused = await json(await send('/series', admin.headers, 'POST', template()), 409)
    assert.equal(refused.error, 'series_conflict')
    assert.deepEqual(
      refused.dates.map((d: any) => d.date),
      [monday(1), monday(2)],
    )
    const series = await harness.db
      .select()
      .from(schema.classSeries)
      .where(eq(schema.classSeries.classTypeId, classTypeId))
    assert.equal(series.length, 0, 'no series row was left behind')
    const made = await harness.db
      .select()
      .from(schema.classes)
      .where(eq(schema.classes.classTypeId, classTypeId))
    assert.equal(made.length, 1, 'only the one-off class exists')
  })

  test('skipping the clashing dates creates every other class, linked to the series', async () => {
    const created = await json(
      await send('/series', admin.headers, 'POST', {
        ...template(),
        excluded_dates: [monday(1), monday(2)],
      }),
      201,
    )
    seriesId = created.series.id
    assert.equal(created.class_ids.length, 2)
    assert.deepEqual(created.series.excluded_dates, [monday(1), monday(2)])
    assert.equal(created.series.start_time, '19:00')

    const rows = await seriesClasses(seriesId)
    assert.deepEqual(
      rows.map(r => r.startsAt.toISOString()),
      [`${monday(0)}T11:00:00.000Z`, `${monday(3)}T11:00:00.000Z`],
    )
    assert.ok(rows.every(r => r.instructorPaySgd === '60.00' && r.capacityOnline === 20))
    const supporting = await harness.db
      .select()
      .from(schema.classSupportingInstructors)
      .where(inArray(schema.classSupportingInstructors.classId, rows.map(r => r.id)))
    assert.equal(supporting.length, 2)
    assert.ok(supporting.every(s => s.instructorId === helper.id && s.paySgd === '30.00'))

    // The schedule marks them, and only them.
    const schedule = await json(
      await send(`?from=${monday(0)}T00:00:00Z&to=${addDays(monday(3), 1)}T00:00:00Z`, admin.headers),
      200,
    )
    const ours = schedule.entries.filter((e: any) => e.class_type_id === classTypeId)
    assert.equal(ours.filter((e: any) => e.series_id === seriesId).length, 2)
    assert.equal(ours.filter((e: any) => e.series_id === null).length, 1)

    const detail = await json(await send(`/classes/${rows[0]!.id}`, admin.headers), 200)
    assert.equal(detail.series_id, seriesId)
  })

  test('extending twice over overlapping ranges never duplicates a date', async () => {
    const to = monday(6)
    const preview = await json(
      await send(`/series/${seriesId}/extend/preview`, admin.headers, 'POST', { last_date: to }),
      200,
    )
    assert.deepEqual(
      preview.dates.map((d: any) => d.date),
      [monday(4), monday(5), monday(6)],
    )
    const first = await json(await send(`/series/${seriesId}/extend`, admin.headers, 'POST', { last_date: to }), 200)
    assert.equal(first.class_ids.length, 3)
    assert.equal(first.series.last_date, to)

    // Same range again, then a range reaching back over it: only what is new.
    const again = await json(await send(`/series/${seriesId}/extend`, admin.headers, 'POST', { last_date: to }), 200)
    assert.equal(again.class_ids.length, 0)
    const further = await json(
      await send(`/series/${seriesId}/extend`, admin.headers, 'POST', {
        last_date: monday(8),
        excluded_dates: [monday(7)],
      }),
      200,
    )
    assert.equal(further.class_ids.length, 1)

    const dates = (await seriesClasses(seriesId)).map(r => r.startsAt.toISOString().slice(0, 10))
    assert.deepEqual(dates, [monday(0), monday(3), monday(4), monday(5), monday(6), monday(8)])
    assert.equal(new Set(dates).size, dates.length)
  })

  test('a class from a series books, edits and cancels like any class', async () => {
    const rows = await seriesClasses(seriesId)
    const [edited, cancelled, booked] = [rows[0]!, rows[1]!, rows[4]!]

    const patched = await json(
      await send(`/classes/${edited.id}`, admin.headers, 'PATCH', { capacity_online: 12 }),
      200,
    )
    assert.equal(patched.capacity_online, 12)
    assert.equal(patched.series_id, seriesId)
    const others = (await seriesClasses(seriesId)).filter(r => r.id !== edited.id)
    assert.ok(others.every(r => r.capacityOnline === 20), 'editing one class leaves the rest alone')

    await json(await send(`/classes/${cancelled.id}/cancel`, admin.headers, 'POST'), 200)

    // A member books the Monday-6 class with an ordinary credit bundle.
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: one.id, email: at('member'), name: 'Member', phone: '+6580000001', authUserId: `auth_${TAG}_member` })
      .returning()
    const classPackages = inTenantContext(await import('../services/packages/class-packages'))
    const purchase = inTenantContext(await import('../services/packages/purchase'))
    const book = inTenantContext(await import('../services/bookings/book'))
    const pkg = await classPackages.createClassPackage(one.id, {
      name: `${TAG} Ten`,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 900,
      priceSgd: '200.00',
    })
    await purchase.grantPackage(one.id, {
      clientId: client!.id,
      paymentIntentId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: pkg.id,
    })
    const booking = await book.bookClass(one.id, { clientId: client!.id, classId: booked.id })
    assert.ok(booking.bookingId)
  })

  test('ending a series cancels its unbooked future classes and returns the booked ones', async () => {
    const before = await seriesClasses(seriesId)
    const booked = before[4]!
    const ended = await json(
      await send(`/series/${seriesId}/end`, admin.headers, 'POST', { from_date: monday(4) }),
      200,
    )
    assert.equal(ended.ended_from, monday(4))
    assert.deepEqual(
      ended.booked_classes.map((b: any) => [b.class_id, b.booked_count]),
      [[booked.id, 1]],
    )
    // Mondays 4, 5 and 8 had nobody booked.
    assert.equal(ended.cancelled_class_ids.length, 3)

    const after = new Map((await seriesClasses(seriesId)).map(r => [r.id, r.lifecycle]))
    assert.equal(after.get(booked.id), 'active')
    assert.equal(after.get(before[0]!.id), 'active', 'classes before the end date are untouched')
    for (const id of ended.cancelled_class_ids) assert.equal(after.get(id), 'cancelled')

    // An ended series makes no more classes.
    const refused = await json(
      await send(`/series/${seriesId}/extend`, admin.headers, 'POST', { last_date: monday(12) }),
      409,
    )
    assert.equal(refused.error, 'series_ended')

    const read = await json(await send(`/series/${seriesId}`, admin.headers), 200)
    assert.equal(read.ended_from, monday(4))
  })
})
