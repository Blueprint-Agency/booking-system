import assert from 'node:assert/strict'
import { after, afterEach, before, describe, test } from 'node:test'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { addDays, isoWeekday } from '../services/schedule/series-dates'

/**
 * Instructor Pay is optional when an admin schedules (#314, reversing the
 * required-pay rule of be/docs/adr/0002 — see adr/0008). A blank pay field
 * leaves the assignment Unpriced — stored null, never S$0 — and every Unpriced
 * assignment shows under Finance's Needs pay filter once the session is held,
 * so it can be priced from one place. An explicit 0 is a price.
 *
 * Every session is scheduled over real HTTP as a studio admin, well in the
 * future, in a room and with instructors made here, so nothing clashes with
 * another file's rows. Each test then moves the app clock past its session to
 * read Needs pay, and puts it back afterwards.
 */
describe('optional instructor pay', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let one!: { id: string; slug: string }

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const DOMAIN = `optional-pay-${run}.test`
  const TAG = `opay-${run}`
  const WORKSHOP_NAME = `${TAG} Retreat`
  const MINUTE = 60 * 1000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  /** A UTC midnight well out in the future, so every session is schedulable. */
  const BASE = (() => {
    const d = new Date(Date.now() + (500 + Math.floor(Math.random() * 200)) * DAY)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  })()
  const at = (days: number, hours = 10) => new Date(BASE + days * DAY + hours * HOUR)
  /** The Finance window every test reads, and a "now" after all of it has been held. */
  const WINDOW = { from: at(0, 0).toISOString(), to: at(40, 0).toISOString() }
  const HELD = at(45, 0)

  const api = (path: string, headers: Record<string, string>, method = 'GET', body?: unknown) =>
    harness.app.request(`/api/v1/portal/admin${path}`, {
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
    const body = await json(await api(`/finance?${qs}`, admin.headers), 200)
    return body.rows as PayRow[]
  }

  /** The (instructor, pay, unpriced) triples Needs pay lists for one session. */
  const listedFor = (rows: PayRow[], id: string) =>
    rows
      .filter(r => r.id === id)
      .map(r => [r.instructor_id, r.pay_sgd, r.unpriced] as const)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))

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

  /** Sorted, so a pair of instructors reads the same whichever way it was listed. */
  const both = () => [tara.id, omar.id].sort()

  /** An admin class body at `startsAt`, with the caller's pay fields laid over it. */
  const classBody = (startsAt: Date, pay: Record<string, unknown>) => ({
    class_type_id: classTypeId,
    main_instructor_id: tara.id,
    location_id: locationId,
    room_id: roomId,
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
    capacity_online: 10,
    credit_cost: 1,
    ...pay,
  })

  const classPay = async (id: string) =>
    (await harness.db.select({ pay: schema.classes.instructorPaySgd }).from(schema.classes).where(eq(schema.classes.id, id)))[0]
      ?.pay

  const classSupportingPay = async (classIds: string[]) =>
    harness.db
      .select({ classId: schema.classSupportingInstructors.classId, pay: schema.classSupportingInstructors.paySgd })
      .from(schema.classSupportingInstructors)
      .where(inArray(schema.classSupportingInstructors.classId, classIds))

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
        authUserId: `optional-pay-${run}`,
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
    const workshopIds = sql`SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME}`
    const ourClasses = sql`SELECT id FROM classes WHERE class_type_id = ${classTypeId}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshopIds})`)
    await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshopIds})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name = ${WORKSHOP_NAME}`)
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

  test('SCH-06 an admin schedules a class with no Instructor Pay: it is stored Unpriced, not S$0, and shows under Needs pay', async () => {
    const created = await json(await api('/schedule/classes', admin.headers, 'POST', classBody(at(1), {})), 201)

    assert.equal(await classPay(created.id), null)
    assert.deepEqual(listedFor(await needsPay(), created.id), [[tara.id, null, true]])
  })

  test('SCH-06 a weekly series with no pay for its main or a supporting instructor makes every class, and each supporting row, Unpriced, extend included', async () => {
    // Two Mondays, the first at least a week past BASE.
    const start = at(7).toISOString().slice(0, 10)
    const firstMonday = addDays(start, (1 - isoWeekday(start) + 7) % 7)
    const created = await json(
      await api('/schedule/series', admin.headers, 'POST', {
        class_type_id: classTypeId,
        main_instructor_id: tara.id,
        supporting_instructors: [{ instructor_id: omar.id, pay_sgd: null }],
        location_id: locationId,
        room_id: roomId,
        weekday: 1,
        start_time: '19:00',
        end_time: '20:00',
        capacity_online: 10,
        credit_cost: 1,
        first_date: firstMonday,
        last_date: addDays(firstMonday, 7),
      }),
      201,
    )
    const classIds = created.class_ids as string[]
    assert.equal(classIds.length, 2)
    assert.equal(created.series.instructor_pay_sgd, null)
    assert.deepEqual(created.series.supporting_instructors, [{ instructor_id: omar.id, pay_sgd: null }])

    const [template] = await harness.db
      .select({ pay: schema.classSeriesSupportingInstructors.paySgd })
      .from(schema.classSeriesSupportingInstructors)
      .where(eq(schema.classSeriesSupportingInstructors.seriesId, created.series.id))
    assert.equal(template?.pay, null)
    for (const id of classIds) assert.equal(await classPay(id), null)
    const supporting = await classSupportingPay(classIds)
    assert.equal(supporting.length, 2)
    assert.ok(supporting.every(s => s.pay === null), JSON.stringify(supporting))

    // Extending the series makes its next class the same way: the Unpriced
    // supporting instructor is copied on as null, not read back as S$0.
    const extended = await json(
      await api(`/schedule/series/${created.series.id}/extend`, admin.headers, 'POST', {
        last_date: addDays(firstMonday, 14),
      }),
      200,
    )
    const added = extended.class_ids as string[]
    assert.equal(added.length, 1)
    assert.equal(await classPay(added[0]!), null)
    assert.deepEqual((await classSupportingPay(added)).map(s => s.pay), [null])

    const rows = await needsPay()
    for (const id of [...classIds, ...added]) {
      assert.deepEqual(listedFor(rows, id), both().map(i => [i, null, true]))
    }
  })

  test('SCH-06 a PT session scheduled from a request with pay sent as null is Unpriced and shows under Needs pay', async () => {
    const [request] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: one.id,
        clientId,
        classTypeId,
        locationId,
        sessionType: '1on1',
        status: 'pending',
        expiresAt: at(2, 0),
      })
      .returning({ id: schema.ptRequests.id })
    const startsAt = at(2)
    await json(
      await api(`/pt-sessions/${request!.id}/schedule`, admin.headers, 'POST', {
        instructor_id: tara.id,
        location_id: locationId,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        instructor_pay_sgd: null,
      }),
      201,
    )
    const [session] = await harness.db
      .select({ id: schema.ptSessions.id, pay: schema.ptSessions.instructorPaySgd })
      .from(schema.ptSessions)
      .where(eq(schema.ptSessions.ptRequestId, request!.id))
    assert.ok(session)
    assert.equal(session.pay, null)
    assert.deepEqual(listedFor(await needsPay(), session.id), [[tara.id, null, true]])
  })

  test('SCH-06 a workshop created with no pay for its main or a supporting instructor is Unpriced and shows under Needs pay', async () => {
    const created = await json(
      await api('/workshops', admin.headers, 'POST', {
        name: WORKSHOP_NAME,
        location_id: locationId,
        main_instructor_id: tara.id,
        main_instructor_pay_sgd: null,
        supporting_instructors: [{ instructor_id: omar.id }],
      }),
      201,
    )
    const startsAt = at(3)
    await json(
      await api(`/workshops/${created.id}/days`, admin.headers, 'POST', {
        ord: 1,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 2 * HOUR).toISOString(),
        capacity_online: 10,
      }),
      201,
    )

    const roster = await harness.db
      .select({ role: schema.workshopInstructors.role, pay: schema.workshopInstructors.paySgd })
      .from(schema.workshopInstructors)
      .where(eq(schema.workshopInstructors.workshopId, created.id))
    assert.deepEqual(roster.map(r => [r.role, r.pay]).sort(), [['main', null], ['supporting', null]])
    assert.deepEqual(listedFor(await needsPay(), created.id), both().map(i => [i, null, true]))
  })

  test('ROS-03 an admin adds a supporting instructor to an existing class without pay: the edit saves and they show under Needs pay', async () => {
    const created = await json(
      await api('/schedule/classes', admin.headers, 'POST', classBody(at(4), { instructor_pay_sgd: 50 })),
      201,
    )
    await json(
      await api(`/schedule/classes/${created.id}`, admin.headers, 'PATCH', {
        supporting_instructors: [{ instructor_id: omar.id }],
      }),
      200,
    )

    assert.equal(await classPay(created.id), '50.00', 'the main keeps the pay they were given')
    assert.deepEqual((await classSupportingPay([created.id])).map(s => s.pay), [null])
    assert.deepEqual(listedFor(await needsPay(), created.id), [[omar.id, null, true]])
  })

  test('SCH-06 an explicit 0 is a price: the class is priced at zero and does not show under Needs pay', async () => {
    const created = await json(
      await api('/schedule/classes', admin.headers, 'POST', classBody(at(5), { instructor_pay_sgd: 0 })),
      201,
    )

    assert.equal(await classPay(created.id), '0.00')
    assert.deepEqual(listedFor(await needsPay(), created.id), [])
  })
})
