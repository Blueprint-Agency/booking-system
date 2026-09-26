import assert from 'node:assert/strict'
import { after, afterEach, before, describe, test } from 'node:test'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { addDays, isoWeekday } from '../services/schedule/series-dates'

/**
 * An instructor schedules for themselves (#319): a single class, a weekly
 * repeat (Class Series) and a PT session from a request. Whatever the body
 * names, the caller is the main instructor, nobody else is rostered, and pay is
 * left Unpriced for an admin to set from Finance's Needs pay filter. Extending
 * or ending a series stays admin only.
 *
 * Everything runs over real HTTP, well in the future, in a room and with a
 * class type made here, so nothing clashes with another file's rows. Reading
 * Needs pay moves the app clock past the sessions; each test puts it back.
 */
describe('instructor scheduling for themselves', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let one!: { id: string; slug: string }

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const DOMAIN = `instructor-series-${run}.test`
  const TAG = `iser-${run}`
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  /** A UTC midnight well out in the future, so every session is schedulable. */
  const BASE = (() => {
    const d = new Date(Date.now() + (500 + Math.floor(Math.random() * 200)) * DAY)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  })()
  const at = (days: number, hours = 10) => new Date(BASE + days * DAY + hours * HOUR)
  const WINDOW = { from: at(0, 0).toISOString(), to: at(60, 0).toISOString() }
  const HELD = at(65, 0)

  /** The Monday on or after `days` past BASE. */
  const mondayFrom = (days: number) => {
    const start = at(days).toISOString().slice(0, 10)
    return addDays(start, (1 - isoWeekday(start) + 7) % 7)
  }

  const call = (path: string, headers: Record<string, string>, method = 'GET', body?: unknown) =>
    harness.app.request(`/api/v1/portal${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as Record<string, any>
  }

  type PayRow = { id: string; instructor_id: string | null; pay_sgd: number | null; unpriced: boolean }

  /** Finance's Needs pay list for the window, read once the sessions have been held. */
  async function needsPay(): Promise<PayRow[]> {
    harness.clock.set(HELD)
    const qs = new URLSearchParams({ ...WINDOW, needs_pay: 'true' }).toString()
    const body = await json(await call(`/admin/finance?${qs}`, admin.headers), 200)
    return body.rows as PayRow[]
  }

  /** The (instructor, pay, unpriced) triples Needs pay lists for one session. */
  const listedFor = (rows: PayRow[], id: string) =>
    rows.filter(r => r.id === id).map(r => [r.instructor_id, r.pay_sgd, r.unpriced] as const)

  const staffAt = async (handle: string, role: 'admin' | 'instructor') => {
    const email = `${handle}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, one)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: one.id, email, name: `${handle} ${run}`, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: row!.id })
    }
    return { headers, id: row!.id }
  }

  let admin!: Awaited<ReturnType<typeof staffAt>>
  let tara!: Awaited<ReturnType<typeof staffAt>>
  let omar!: Awaited<ReturnType<typeof staffAt>>
  let clientId!: string
  let locationId!: string
  let roomId!: string
  let classTypeId!: string

  /**
   * An instructor's weekly repeat, carrying everything an admin's would — another
   * instructor as main, a pay, a supporting instructor — which the instructor
   * route must ignore.
   */
  const seriesBody = (firstDate: string, weeks: number) => ({
    class_type_id: classTypeId,
    main_instructor_id: omar.id,
    instructor_pay_sgd: 80,
    supporting_instructors: [{ instructor_id: omar.id, pay_sgd: 30 }],
    location_id: locationId,
    room_id: roomId,
    weekday: 1,
    start_time: '19:00',
    end_time: '20:00',
    capacity_online: 10,
    credit_cost: 1,
    cancel_window_hours: 24,
    first_date: firstDate,
    last_date: addDays(firstDate, (weeks - 1) * 7),
    excluded_dates: [] as string[],
  })

  const classesOf = (seriesId: string) =>
    harness.db
      .select()
      .from(schema.classes)
      .where(eq(schema.classes.seriesId, seriesId))
      .orderBy(schema.classes.startsAt)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    one = harness.tenants.one
    admin = await staffAt('admin', 'admin')
    tara = await staffAt('tara', 'instructor')
    omar = await staffAt('omar', 'instructor')
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
    const [client] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId: one.id,
        authUserId: `instructor-series-${run}`,
        email: `member@${DOMAIN}`,
        name: `Member ${run}`,
        phone: '+6580000000',
      })
      .returning({ id: schema.clients.id })
    clientId = client!.id
  })

  afterEach(() => harness?.clock.reset())

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const ourClasses = sql`SELECT id FROM classes WHERE class_type_id = ${classTypeId}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_session_clients WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_sessions WHERE scheduled_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM class_supporting_instructors WHERE class_id IN (${ourClasses})`)
    await harness.db.execute(sql`DELETE FROM classes WHERE class_type_id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM class_series WHERE class_type_id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE id = ${roomId}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('SCH-07, SCH-27 an instructor previews and commits a weekly repeat: every class is theirs, Unpriced, alone on the roster, and shows under Needs pay', async () => {
    const first = mondayFrom(7)
    const body = seriesBody(first, 3)

    const preview = await json(await call('/instructor/schedule/series/preview', tara.headers, 'POST', body), 200)
    assert.deepEqual(
      preview.dates.map((d: any) => d.date),
      [first, addDays(first, 7), addDays(first, 14)],
    )
    assert.equal(preview.clash_count, 0)

    const created = await json(await call('/instructor/schedule/series', tara.headers, 'POST', body), 201)
    const classIds = created.class_ids as string[]
    assert.equal(classIds.length, 3)
    assert.equal(created.series.main_instructor_id, tara.id)
    assert.equal(created.series.instructor_pay_sgd, null)
    assert.deepEqual(created.series.supporting_instructors, [])
    assert.equal(created.series.cancel_window_hours, 24, 'the rest of the form is taken as sent')

    const rows = await classesOf(created.series.id)
    assert.deepEqual(rows.map(r => r.id).sort(), [...classIds].sort())
    for (const r of rows) {
      assert.equal(r.mainInstructorId, tara.id)
      assert.equal(r.instructorPaySgd, null)
      assert.equal(r.locationId, locationId)
      assert.equal(r.roomId, roomId)
      assert.equal(r.createdByStaffId, tara.id)
    }
    const supporting = await harness.db
      .select()
      .from(schema.classSupportingInstructors)
      .where(inArray(schema.classSupportingInstructors.classId, classIds))
    assert.equal(supporting.length, 0)

    const listed = await needsPay()
    for (const id of classIds) assert.deepEqual(listedFor(listed, id), [[tara.id, null, true]])
  })

  test('SCH-07 an instructor schedules a single class naming another instructor and a pay: it is theirs, Unpriced, and shows under Needs pay', async () => {
    const startsAt = at(3)
    const created = await json(
      await call('/instructor/schedule/classes', tara.headers, 'POST', {
        class_type_id: classTypeId,
        main_instructor_id: omar.id,
        instructor_pay_sgd: 80,
        supporting_instructors: [{ instructor_id: omar.id, pay_sgd: 30 }],
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        capacity_online: 10,
        credit_cost: 1,
      }),
      201,
    )
    assert.equal(created.main_instructor_id, tara.id)
    assert.equal(created.instructor_pay_sgd, null)
    const [row] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, created.id))
    assert.equal(row?.mainInstructorId, tara.id)
    assert.equal(row?.instructorPaySgd, null)
    assert.deepEqual(listedFor(await needsPay(), created.id), [[tara.id, null, true]])
  })

  test('SCH-07 an instructor schedules a PT session from a request naming another instructor: it is theirs, Unpriced, and shows under Needs pay', async () => {
    const [request] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: one.id,
        clientId,
        classTypeId,
        locationId,
        sessionType: '1on1',
        status: 'pending',
        expiresAt: at(4, 0),
      })
      .returning({ id: schema.ptRequests.id })
    const startsAt = at(4)
    await json(
      await call(`/instructor/pt-requests/${request!.id}/schedule`, tara.headers, 'POST', {
        instructor_id: omar.id,
        instructor_pay_sgd: 80,
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
      }),
      201,
    )
    const [session] = await harness.db
      .select({
        id: schema.ptSessions.id,
        instructorId: schema.ptSessions.instructorId,
        pay: schema.ptSessions.instructorPaySgd,
      })
      .from(schema.ptSessions)
      .where(eq(schema.ptSessions.ptRequestId, request!.id))
    assert.ok(session)
    assert.equal(session.instructorId, tara.id)
    assert.equal(session.pay, null)
    assert.deepEqual(listedFor(await needsPay(), session.id), [[tara.id, null, true]])
  })

  test('SCH-28 an instructor cannot extend or end a series, even one they created', async () => {
    const first = mondayFrom(35)
    const created = await json(
      await call('/instructor/schedule/series', tara.headers, 'POST', seriesBody(first, 2)),
      201,
    )
    const id = created.series.id as string
    const later = { last_date: addDays(first, 21) }
    const from = { from_date: first }

    // The admin routes refuse an instructor outright…
    assert.equal((await call(`/admin/schedule/series/${id}/extend/preview`, tara.headers, 'POST', later)).status, 403)
    assert.equal((await call(`/admin/schedule/series/${id}/extend`, tara.headers, 'POST', later)).status, 403)
    assert.equal((await call(`/admin/schedule/series/${id}/end`, tara.headers, 'POST', from)).status, 403)
    // …and the instructor's own schedule has no such routes.
    assert.equal((await call(`/instructor/schedule/series/${id}/extend`, tara.headers, 'POST', later)).status, 404)
    assert.equal((await call(`/instructor/schedule/series/${id}/end`, tara.headers, 'POST', from)).status, 404)

    const [series] = await harness.db.select().from(schema.classSeries).where(eq(schema.classSeries.id, id))
    assert.equal(series?.lastDate, addDays(first, 7))
    assert.equal(series?.endedFrom, null)
    const rows = await classesOf(id)
    assert.equal(rows.length, 2)
    assert.ok(rows.every(r => r.lifecycle === 'active'))
  })
})
