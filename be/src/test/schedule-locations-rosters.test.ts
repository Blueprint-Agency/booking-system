import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.schedule-rules.test`
/** Every Location, room, Class Type, package and workshop this file makes is named with this. */
const TAG = `Sched ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * A Monday in 2031 or later, a random number of weeks out, so nothing another
 * file made (around today) shares a window with anything here, and two runs of
 * this file are unlikely to share one either. The app's clock is stood at day 0
 * for the whole file; a test that needs time to pass moves it and puts it back.
 */
const BASE = Date.UTC(2031, 0, 6) + Math.floor(Math.random() * 400) * 7 * DAY
const at = (days: number, hoursUtc = 0, minutes = 0) => new Date(BASE + days * DAY + hoursUtc * HOUR + minutes * MINUTE)
const plainDate = (d: Date) => d.toISOString().slice(0, 10)
const START = at(0)

/**
 * Schedule rules, Locations and rosters over HTTP (#267): what an admin can do
 * to the timetable and the studio's Locations without breaking what members
 * already hold.
 *
 * The in-process app against real Postgres, connected as the non-owning app
 * role, with both fixture Tenants and a real sign-in for every caller. Written
 * from the Scenario Inventory rows (`docs/md/test-scenarios.md` SCH, LOC, ROS)
 * and the specs they cite: admin-restructure §1, §2, §3b, §7, §10;
 * spec-finance §Required pay; spec-pre-launch-batch §1.
 *
 * Every row hangs off Locations, rooms, a Class Type and instructors made
 * here, so a clash or a listing is only ever the one a test set up.
 */
describe('schedule rules, Locations and rosters over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Tenant = { id: string; slug: string }
  type Staff = { id: string; headers: Headers }
  type Member = { clientId: string; headers: Headers }
  type Place = { locationId: string; roomId: string }

  let one!: Tenant
  let two!: Tenant
  let adminOne!: Staff
  let adminTwo!: Staff
  let teacher!: Staff
  let helper!: Staff
  let other!: Staff
  let coachTwo!: Staff
  /** Two Locations of studio one, with two rooms at the first. */
  let north!: Place
  let northAnnex!: Place
  let south!: Place
  let classTypeId!: string
  let classPackageId!: string
  let ptPackageId!: string

  const emailFor = (name: string, tenant: Tenant) => `${name}-${tenant.slug}@${DOMAIN}`

  async function reply(res: Response): Promise<Reply> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const request = async (method: string, path: string, headers: Headers, body?: unknown) =>
    reply(
      await harness.app.request(`/api/v1${path}`, {
        method,
        headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  const admin = (method: string, path: string, headers: Headers, body?: unknown) =>
    request(method, `/portal/admin${path}`, headers, body)
  const instructor = (method: string, path: string, headers: Headers, body?: unknown) =>
    request(method, `/portal/instructor${path}`, headers, body)

  const expect = (res: Reply, status: number) => {
    assert.equal(res.status, status, JSON.stringify(res.body))
    return res.body
  }
  const query = (params: Record<string, string>) => `?${new URLSearchParams(params)}`

  /* ── fixtures ─────────────────────────────────────────────────────── */

  async function staff(tenant: Tenant, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(name, tenant)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, tenant.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: `${name} ${run}`, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { id: row!.id, headers }
  }

  let members = 0
  async function member(tenant: Tenant = one): Promise<Member> {
    const name = `member${members++}`
    const email = emailFor(name, tenant)
    const headers = await harness.signInAs('client', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.tenantId, tenant.id), eq(schema.clientAuthUsers.email, email)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: tenant.id, email, name: `Member ${name}`, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  /** A Location made through the portal, with one room of its own. */
  async function location(name: string): Promise<Place> {
    const made = expect(await admin('POST', '/locations', adminOne.headers, { name: `${TAG} ${name}` }), 201)
    return { locationId: made.id, roomId: await room(made.id, name) }
  }

  async function room(locationId: string, name: string): Promise<string> {
    const [row] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: one.id, locationId, name: `${TAG} ${name} room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    return row!.id
  }

  /** A Credit Bundle the member holds, Dormant as a purchase leaves it. */
  async function credits(who: Member, count = 10): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: one.id,
        clientId: who.clientId,
        kind: 'credit_bundle',
        sourceClassPackageId: classPackageId,
        validityDays: 90,
        creditsOrSessionsRemaining: count,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /** An Unlimited Plan calling `locationId` home. Null expiry is Dormant. */
  async function unlimited(who: Member, locationId: string, expiresAt: Date | null = null): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: one.id,
        clientId: who.clientId,
        kind: 'unlimited',
        locationId,
        durationMonths: 1,
        expiresAt,
        active: true,
        amountPaidSgd: '300.00',
        listPriceSgd: '300.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /** Each class gets a day of its own, 10:00–11:00 studio time, so only the clashes a test sets up exist. */
  let slots = 0
  const slot = () => at(2 + slots++, 2)

  function classBody(over: Record<string, unknown> = {}) {
    const startsAt = (over.starts_at as string | undefined) ?? slot().toISOString()
    return {
      class_type_id: classTypeId,
      main_instructor_id: teacher.id,
      location_id: north.locationId,
      room_id: north.roomId,
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + HOUR).toISOString(),
      capacity_online: 10,
      capacity_waitlist: 0,
      capacity_buffer: 0,
      credit_cost: 1,
      instructor_pay_sgd: 50,
      ...over,
    }
  }

  async function createClass(over: Record<string, unknown> = {}): Promise<string> {
    return expect(await admin('POST', '/schedule/classes', adminOne.headers, classBody(over)), 201).id
  }

  async function classRow(id: string) {
    const [row] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, id))
    assert.ok(row, `no class ${id}`)
    return row
  }

  async function supportingOf(classId: string) {
    const rows = await harness.db
      .select({ instructorId: schema.classSupportingInstructors.instructorId, paySgd: schema.classSupportingInstructors.paySgd })
      .from(schema.classSupportingInstructors)
      .where(eq(schema.classSupportingInstructors.classId, classId))
    return Object.fromEntries(rows.map(r => [r.instructorId, r.paySgd === null ? null : Number(r.paySgd)]))
  }

  async function book(who: Member, classId: string): Promise<string> {
    const res = await request('POST', '/me/bookings/class', who.headers, { class_id: classId })
    return expect(res, 201).booking_id
  }

  async function bookingRow(id: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, id))
    assert.ok(row, `no booking ${id}`)
    return row
  }

  async function balance(clientPackageId: string) {
    const [row] = await harness.db
      .select({ left: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, clientPackageId))
    return row!.left
  }

  /** A workshop at `place` with one day. */
  async function workshop(place: Place, startsAt: Date, name = 'Workshop') {
    const made = expect(
      await admin('POST', '/workshops', adminOne.headers, {
        name: `${TAG} ${name} ${slots++}`,
        location_id: place.locationId,
        main_instructor_id: other.id,
        main_instructor_pay_sgd: 100,
      }),
      201,
    )
    const day = expect(
      await admin('POST', `/workshops/${made.id}/days`, adminOne.headers, workshopDay(place, startsAt)),
      201,
    )
    return { workshopId: made.id as string, dayId: day.id as string }
  }

  const workshopDay = (place: Place, startsAt: Date) => ({
    ord: 1,
    room_id: place.roomId,
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
    capacity_online: 10,
  })

  /** A pending PT request from a fresh member holding a PT package, at `place`. */
  async function ptRequest(place: Place, day: Date): Promise<string> {
    const who = await member()
    const [pkg] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: one.id,
        clientId: who.clientId,
        kind: 'pt',
        sourcePtPackageId: ptPackageId,
        validityDays: 90,
        creditsOrSessionsRemaining: 5,
        active: true,
        amountPaidSgd: '500.00',
        listPriceSgd: '500.00',
      })
      .returning({ id: schema.clientPackages.id })
    const res = await request('POST', '/me/pt-sessions/request', who.headers, {
      classTypeId,
      locationId: place.locationId,
      sessionType: '1on1',
      clientPackageId: pkg!.id,
      slots: [{ proposedDate: plainDate(day), startTime: '09:00', endTime: '10:00' }],
    })
    return expect(res, 201).pt_request_id
  }

  const ptSchedule = (place: Place, startsAt: Date, over: Record<string, unknown> = {}) => ({
    instructor_id: helper.id,
    location_id: place.locationId,
    room_id: place.roomId,
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
    instructor_pay_sgd: 60,
    ...over,
  })

  /** A confirmed PT session at `place`, scheduled by the admin. Returns the session id. */
  async function ptSession(place: Place, startsAt: Date): Promise<{ requestId: string; sessionId: string }> {
    const requestId = await ptRequest(place, startsAt)
    const res = expect(await admin('POST', `/pt-sessions/${requestId}/schedule`, adminOne.headers, ptSchedule(place, startsAt)), 201)
    return { requestId, sessionId: res.pt_request.session.id }
  }

  async function locationRow(id: string) {
    const [row] = await harness.db.select().from(schema.locations).where(eq(schema.locations.id, id))
    assert.ok(row, `no location ${id}`)
    return row
  }

  async function classTypeRow(id: string) {
    const [row] = await harness.db.select().from(schema.classTypes).where(eq(schema.classTypes.id, id))
    assert.ok(row, `no class type ${id}`)
    return row
  }

  async function newClassType(name: string, parentId: string | null = null): Promise<string> {
    const made = expect(
      await admin('POST', '/class-types', adminOne.headers, { name: `${TAG} ${name}`, parent_id: parentId }),
      201,
    )
    return made.id
  }

  /** Time moves inside `fn` only. */
  async function atTime<T>(instant: Date, fn: () => Promise<T>): Promise<T> {
    harness.clock.set(instant)
    try {
      return await fn()
    } finally {
      harness.clock.set(START)
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    one = harness.tenants.one
    two = harness.tenants.two
    harness.clock.set(START)

    adminOne = await staff(one, 'admin', 'admin')
    adminTwo = await staff(two, 'admin', 'admin')
    teacher = await staff(one, 'teacher', 'instructor')
    helper = await staff(one, 'helper', 'instructor')
    other = await staff(one, 'other', 'instructor')
    coachTwo = await staff(two, 'coach', 'instructor')

    north = await location('North')
    northAnnex = { locationId: north.locationId, roomId: await room(north.locationId, 'North annex') }
    south = await location('South')

    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: one.id, name: `${TAG} Hatha` })
      .returning({ id: schema.classTypes.id })
    classTypeId = type!.id
    const [bundle] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: one.id, name: `${TAG} bundle`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '100.00' })
      .returning({ id: schema.classPackages.id })
    classPackageId = bundle!.id
    const [pt] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: one.id, name: `${TAG} PT`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '500.00' })
      .returning({ id: schema.ptPackages.id })
    ptPackageId = pt!.id
  })

  after(async () => {
    if (!harness) return
    try {
      await cleanup()
    } finally {
      await harness.close()
    }
  })

  async function cleanup() {
    const db = harness.db
    const clientIds = sql`SELECT id FROM clients WHERE email LIKE ${`%@${DOMAIN}`}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${`%@${DOMAIN}`}`
    const locationIds = sql`SELECT id FROM locations WHERE name LIKE ${`${TAG}%`}`
    const classIds = sql`SELECT id FROM classes WHERE main_instructor_id IN (${staffIds}) OR location_id IN (${locationIds})`
    const workshopIds = sql`SELECT id FROM workshops WHERE name LIKE ${`${TAG}%`}`
    const ptSessionIds = sql`SELECT id FROM pt_sessions WHERE instructor_id IN (${staffIds})`
    const ptRequestIds = sql`SELECT id FROM pt_requests WHERE client_id IN (${clientIds})`
    const statements = [
      sql`DELETE FROM inbox_items WHERE payload->>'classId' IN (SELECT id::text FROM classes WHERE id IN (${classIds}))`,
      sql`DELETE FROM cancellations WHERE client_id IN (${clientIds})`,
      sql`DELETE FROM bookings WHERE client_id IN (${clientIds})`,
      sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${ptSessionIds})`,
      sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (${ptSessionIds})`,
      sql`DELETE FROM pt_sessions WHERE id IN (${ptSessionIds})`,
      sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${ptRequestIds})`,
      sql`DELETE FROM pt_requests WHERE id IN (${ptRequestIds})`,
      sql`DELETE FROM manual_adjustments WHERE client_package_id IN (SELECT id FROM client_packages WHERE client_id IN (${clientIds}))`,
      sql`DELETE FROM client_packages WHERE client_id IN (${clientIds})`,
      sql`DELETE FROM workshop_tier_days WHERE workshop_day_id IN (SELECT id FROM workshop_days WHERE workshop_id IN (${workshopIds}))`,
      sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshopIds})`,
      sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshopIds})`,
      sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshopIds})`,
      sql`DELETE FROM workshops WHERE id IN (${workshopIds})`,
      sql`DELETE FROM class_supporting_instructors WHERE class_id IN (${classIds})`,
      sql`DELETE FROM classes WHERE id IN (${classIds})`,
      sql`DELETE FROM class_series WHERE main_instructor_id IN (${staffIds})`,
      sql`DELETE FROM leave_requests WHERE instructor_id IN (${staffIds})`,
      sql`DELETE FROM class_types WHERE name LIKE ${`${TAG}%`} AND parent_id IS NOT NULL`,
      sql`DELETE FROM class_types WHERE name LIKE ${`${TAG}%`}`,
      sql`DELETE FROM class_packages WHERE name LIKE ${`${TAG}%`}`,
      sql`DELETE FROM pt_packages WHERE name LIKE ${`${TAG}%`}`,
      sql`DELETE FROM rooms WHERE location_id IN (${locationIds})`,
      sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`,
      sql`DELETE FROM locations WHERE id IN (${locationIds})`,
      sql`DELETE FROM clients WHERE id IN (${clientIds})`,
      sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`,
      sql`DELETE FROM staff_users WHERE id IN (${staffIds})`,
    ]
    for (const statement of statements) await db.execute(statement)
    await db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
  }

  /* ── SCH: the timetable ───────────────────────────────────────────── */

  test('SCH-01 the timetable for a Location lists only its classes, workshop days and confirmed PT sessions', async () => {
    const day = slot()
    const northClass = await createClass({ starts_at: day.toISOString() })
    const southClass = await createClass({ location_id: south.locationId, room_id: south.roomId, main_instructor_id: helper.id, starts_at: day.toISOString() })
    const later = (hours: number) => new Date(day.getTime() + hours * HOUR)
    const northWorkshop = await workshop(north, later(3))
    const southWorkshop = await workshop(south, later(5))
    const northPt = await ptSession(north, later(7))
    const southPt = await ptSession(south, later(9))
    const cancelledPt = await ptSession(northAnnex, later(11))
    expect(await admin('POST', `/pt-sessions/${cancelledPt.requestId}/cancel`, adminOne.headers), 200)

    const onDay = { from: later(-1).toISOString(), to: later(20).toISOString() }
    const listed = async (place: Place) =>
      expect(await admin('GET', `/schedule${query({ ...onDay, location_id: place.locationId })}`, adminOne.headers), 200)
        .entries.map((e: any) => `${e.kind}:${e.id}`)
        .sort()

    assert.deepEqual(await listed(north), [`class:${northClass}`, `workshop:${northWorkshop.dayId}`, `pt:${northPt.sessionId}`].sort())
    assert.deepEqual(await listed(south), [`class:${southClass}`, `workshop:${southWorkshop.dayId}`, `pt:${southPt.sessionId}`].sort())
  })

  test('SCH-02 an Instructor lists only the classes they teach', async () => {
    const day = slot()
    const mine = await createClass({ starts_at: day.toISOString() })
    const theirs = await createClass({ starts_at: day.toISOString(), main_instructor_id: helper.id, room_id: northAnnex.roomId })
    const window = query({ from: day.toISOString(), to: new Date(day.getTime() + HOUR).toISOString() })

    const teacherSees = expect(await instructor('GET', `/schedule${window}`, teacher.headers), 200).entries
    assert.deepEqual(teacherSees.map((e: any) => e.id), [mine])
    const helperSees = expect(await instructor('GET', `/schedule${window}`, helper.headers), 200).entries
    assert.deepEqual(helperSees.map((e: any) => e.id), [theirs])
    // Another studio's instructor sees neither.
    assert.deepEqual(expect(await instructor('GET', `/schedule${window}`, coachTwo.headers), 200).entries, [])
  })

  test('SCH-03 a class that costs 2 credits debits 2, and repricing it later leaves existing bookings as they were', async () => {
    const classId = await createClass({ credit_cost: 2 })
    const first = await member()
    const firstPackage = await credits(first, 10)
    const firstBooking = await book(first, classId)
    assert.equal((await bookingRow(firstBooking)).creditsOrSessionsUsed, 2)
    assert.equal(await balance(firstPackage), 8)

    const repriced = expect(await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, { credit_cost: 3 }), 200)
    assert.equal(repriced.credit_cost, 3)
    assert.equal((await classRow(classId)).creditCost, 3)
    // The member who already booked paid 2 and still holds 8.
    const kept = await bookingRow(firstBooking)
    assert.equal(kept.state, 'confirmed')
    assert.equal(kept.creditsOrSessionsUsed, 2)
    assert.equal(await balance(firstPackage), 8)

    const second = await member()
    const secondPackage = await credits(second, 10)
    const secondBooking = await book(second, classId)
    assert.equal((await bookingRow(secondBooking)).creditsOrSessionsUsed, 3)
    assert.equal(await balance(secondPackage), 7)
  })

  test('SCH-04 capacity of waitlist 5, online 10 and buffer 2 reads as a max capacity of 17', async () => {
    const day = slot()
    const classId = await createClass({ starts_at: day.toISOString(), capacity_waitlist: 5, capacity_online: 10, capacity_buffer: 2 })
    const row = await classRow(classId)
    assert.deepEqual([row.capacityWaitlist, row.capacityOnline, row.capacityBuffer], [5, 10, 2])

    const window = query({ from: day.toISOString(), to: new Date(day.getTime() + HOUR).toISOString(), location_id: north.locationId })
    const [entry] = expect(await admin('GET', `/schedule${window}`, adminOne.headers), 200).entries
    assert.equal(entry.id, classId)
    assert.equal(entry.capacity, 17)
    const detail = expect(await admin('GET', `/schedule/classes/${classId}`, adminOne.headers), 200)
    assert.deepEqual([detail.capacity_waitlist, detail.capacity_online, detail.capacity_buffer], [5, 10, 2])

    // A class nobody can sit in is not a class.
    const empty = await admin('POST', '/schedule/classes', adminOne.headers, classBody({ capacity_online: 0, capacity_waitlist: 0, capacity_buffer: 0 }))
    expect(empty, 400)
  })

  test('SCH-06 an admin scheduling a class, a PT session or a workshop without Instructor Pay is refused, and nothing is made', async () => {
    const day = slot()
    const { instructor_pay_sgd: _pay, ...unpriced } = classBody({ starts_at: day.toISOString() })
    expect(await admin('POST', '/schedule/classes', adminOne.headers, unpriced), 400)
    const madeThen = await harness.db.select().from(schema.classes).where(and(eq(schema.classes.roomId, north.roomId), eq(schema.classes.startsAt, day)))
    assert.deepEqual(madeThen, [])

    // A supporting instructor arriving with no pay is the same refusal.
    const res = await admin('POST', '/schedule/classes', adminOne.headers, classBody({ starts_at: day.toISOString(), supporting_instructors: [{ instructor_id: helper.id }] }))
    assert.equal(expect(res, 400).error, 'instructor_pay_required')
    assert.deepEqual(
      await harness.db.select().from(schema.classes).where(and(eq(schema.classes.roomId, north.roomId), eq(schema.classes.startsAt, day))),
      [],
    )

    const requestId = await ptRequest(north, day)
    const { instructor_pay_sgd: _ptPay, ...unpricedPt } = ptSchedule(north, day)
    expect(await admin('POST', `/pt-sessions/${requestId}/schedule`, adminOne.headers, unpricedPt), 400)
    const [ptRequest_] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, requestId))
    assert.equal(ptRequest_!.status, 'pending')
    assert.deepEqual(await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.ptRequestId, requestId)), [])

    const name = `${TAG} Unpriced workshop`
    expect(await admin('POST', '/workshops', adminOne.headers, { name, location_id: north.locationId, main_instructor_id: other.id }), 400)
    assert.deepEqual(await harness.db.select().from(schema.workshops).where(eq(schema.workshops.name, name)), [])
  })

  test('SCH-07 an Instructor scheduling their own class or PT session makes it theirs and Unpriced, whatever the body says, and it shows under Needs pay', async () => {
    const day = slot()
    const made = expect(
      await instructor('POST', '/schedule/classes', teacher.headers, {
        ...classBody({ starts_at: day.toISOString() }),
        main_instructor_id: helper.id,
        instructor_pay_sgd: 99,
        supporting_instructor_ids: [helper.id],
      }),
      201,
    )
    assert.equal(made.main_instructor_id, teacher.id)
    assert.equal(made.instructor_pay_sgd, null)
    const row = await classRow(made.id)
    assert.equal(row.mainInstructorId, teacher.id)
    assert.equal(row.instructorPaySgd, null)
    assert.deepEqual(await supportingOf(made.id), {})

    const ptDay = new Date(day.getTime() + 3 * HOUR)
    const requestId = await ptRequest(north, ptDay)
    const scheduled = await instructor('POST', `/pt-requests/${requestId}/schedule`, teacher.headers, {
      ...ptSchedule(northAnnex, ptDay),
      instructor_id: helper.id,
      instructor_pay_sgd: 99,
    })
    const sessionId = expect(scheduled, 201).pt_request.session.id
    const [session] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.id, sessionId))
    assert.equal(session!.instructorId, teacher.id)
    assert.equal(session!.instructorPaySgd, null)

    // Once held, both wait under Needs pay for an admin to price them.
    const needsPay = await atTime(new Date(day.getTime() + DAY), async () =>
      expect(
        await admin('GET', `/finance${query({ needs_pay: 'true', instructor_id: teacher.id, from: day.toISOString(), to: new Date(day.getTime() + DAY).toISOString() })}`, adminOne.headers),
        200,
      ),
    )
    const ids = needsPay.rows.map((r: any) => r.id)
    assert.ok(ids.includes(made.id), `the class is under Needs pay: ${JSON.stringify(ids)}`)
    assert.ok(ids.includes(sessionId), `the PT session is under Needs pay: ${JSON.stringify(ids)}`)
  })

  test('SCH-09 a class in a room of another Location is refused, made or moved', async () => {
    const day = slot()
    const mismatched = await admin('POST', '/schedule/classes', adminOne.headers, classBody({ starts_at: day.toISOString(), room_id: south.roomId }))
    assert.equal(expect(mismatched, 400).error, 'room_location_mismatch')
    assert.deepEqual(await harness.db.select().from(schema.classes).where(and(eq(schema.classes.roomId, south.roomId), eq(schema.classes.startsAt, day))), [])

    const classId = await createClass({ starts_at: day.toISOString() })
    const moved = await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, { room_id: south.roomId })
    assert.equal(expect(moved, 400).error, 'room_location_mismatch')
    const row = await classRow(classId)
    assert.equal(row.roomId, north.roomId)
    assert.equal(row.locationId, north.locationId)
  })

  test('SCH-10 a class, workshop day or PT session overlapping an active class in its room is refused, naming that class', async () => {
    const day = slot()
    const taken = await createClass({ starts_at: day.toISOString() })
    const overlapping = new Date(day.getTime() + 30 * MINUTE)
    const namesTaken = (res: Reply) => {
      const body = expect(res, 409)
      assert.equal(body.error, 'schedule_conflict')
      assert.equal(body.subject, 'room')
      assert.equal(body.subject_id, north.roomId)
      assert.deepEqual(body.conflicts.map((c: any) => [c.kind, c.id]), [['class', taken]])
      assert.equal(typeof body.message, 'string')
    }

    namesTaken(await admin('POST', '/schedule/classes', adminOne.headers, classBody({ starts_at: overlapping.toISOString(), main_instructor_id: helper.id })))
    assert.equal(
      (await harness.db.select().from(schema.classes).where(and(eq(schema.classes.roomId, north.roomId), eq(schema.classes.startsAt, overlapping)))).length,
      0,
    )

    const ws = expect(
      await admin('POST', '/workshops', adminOne.headers, { name: `${TAG} Clashing workshop`, location_id: north.locationId, main_instructor_id: other.id, main_instructor_pay_sgd: 100 }),
      201,
    )
    namesTaken(await admin('POST', `/workshops/${ws.id}/days`, adminOne.headers, workshopDay(north, overlapping)))
    assert.deepEqual(await harness.db.select().from(schema.workshopDays).where(eq(schema.workshopDays.workshopId, ws.id)), [])

    const requestId = await ptRequest(north, overlapping)
    namesTaken(await admin('POST', `/pt-sessions/${requestId}/schedule`, adminOne.headers, ptSchedule(north, overlapping)))
    const [stillPending] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, requestId))
    assert.equal(stillPending!.status, 'pending')

    // Rescheduling another class into the slot is the same refusal, and the class stays where it was.
    const elsewhere = new Date(day.getTime() + 4 * HOUR)
    const movable = await createClass({ starts_at: elsewhere.toISOString(), main_instructor_id: helper.id })
    namesTaken(
      await admin('PATCH', `/schedule/classes/${movable}`, adminOne.headers, {
        starts_at: overlapping.toISOString(),
        ends_at: new Date(overlapping.getTime() + HOUR).toISOString(),
      }),
    )
    assert.equal((await classRow(movable)).startsAt.getTime(), elsewhere.getTime())

    const into = { starts_at: overlapping.toISOString(), ends_at: new Date(overlapping.getTime() + HOUR).toISOString() }
    const movableDay = await workshop(north, new Date(day.getTime() + 6 * HOUR))
    namesTaken(await admin('PATCH', `/workshops/${movableDay.workshopId}/days/${movableDay.dayId}`, adminOne.headers, into))
    const [dayRow] = await harness.db.select().from(schema.workshopDays).where(eq(schema.workshopDays.id, movableDay.dayId))
    assert.equal(dayRow!.startsAt.getTime(), day.getTime() + 6 * HOUR)

    const movablePt = await ptSession(north, new Date(day.getTime() + 8 * HOUR))
    namesTaken(await admin('PATCH', `/pt-sessions/sessions/${movablePt.sessionId}`, adminOne.headers, into))
    const [ptRow] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.id, movablePt.sessionId))
    assert.equal(ptRow!.startsAt.getTime(), day.getTime() + 8 * HOUR)

    // Back to back is not a clash; a cancelled class holds the room no longer.
    await createClass({ starts_at: new Date(day.getTime() + HOUR).toISOString(), main_instructor_id: helper.id })
    expect(await admin('POST', `/schedule/classes/${taken}/cancel`, adminOne.headers), 200)
    await createClass({ starts_at: day.toISOString(), main_instructor_id: other.id })
  })

  /* ── SCH: Class Series ────────────────────────────────────────────── */

  /** Mondays from day 210 on, 19:00–20:00 studio time (11:00–12:00 UTC). */
  const monday = (week: number) => plainDate(at(210 + week * 7))
  const seriesBody = (over: Record<string, unknown> = {}) => ({
    class_type_id: classTypeId,
    main_instructor_id: teacher.id,
    instructor_pay_sgd: 60,
    location_id: south.locationId,
    room_id: south.roomId,
    weekday: 1,
    start_time: '19:00',
    end_time: '20:00',
    capacity_online: 10,
    credit_cost: 1,
    first_date: monday(0),
    last_date: monday(3),
    ...over,
  })

  test('SCH-12 a Class Series preview lists each date’s clash against it: the room, the instructor teaching, the instructor on leave', async () => {
    const roomTaken = await createClass({ starts_at: at(210 + 7, 11, 30).toISOString(), main_instructor_id: helper.id, location_id: south.locationId, room_id: south.roomId })
    const teaching = await createClass({ starts_at: at(210 + 14, 11, 30).toISOString(), location_id: north.locationId, room_id: north.roomId })
    const [leave] = await harness.db
      .insert(schema.leaveRequests)
      .values({
        tenantId: one.id,
        instructorId: teacher.id,
        type: 'annual',
        startDate: monday(3),
        endDate: monday(3),
        days: '1',
        leaveYear: at(210 + 21).getUTCFullYear(),
        status: 'approved',
        reason: 'Away',
      })
      .returning({ id: schema.leaveRequests.id })

    const preview = expect(await admin('POST', '/schedule/series/preview', adminOne.headers, seriesBody()), 200)
    assert.equal(preview.clash_count, 3)
    const clashes = Object.fromEntries(preview.dates.map((d: any) => [d.date, d.clashes]))
    assert.deepEqual(clashes[monday(0)], [])

    const summary = (list: any[]) => list.map(c => [c.subject, c.subject_id, c.conflicts.map((x: any) => [x.kind, x.id])])
    assert.deepEqual(summary(clashes[monday(1)]), [['room', south.roomId, [['class', roomTaken]]]])
    assert.deepEqual(summary(clashes[monday(2)]), [['instructor', teacher.id, [['class', teaching]]]])
    assert.deepEqual(summary(clashes[monday(3)]), [['instructor', teacher.id, [['leave', leave!.id]]]])

    // A preview writes nothing.
    assert.deepEqual(await harness.db.select().from(schema.classSeries).where(eq(schema.classSeries.mainInstructorId, teacher.id)), [])
  })

  test('SCH-14 a Class Series running past a year is refused and makes nothing', async () => {
    const lastDate = plainDate(at(210 + 366))
    const res = await admin('POST', '/schedule/series', adminOne.headers, seriesBody({ main_instructor_id: other.id, first_date: monday(0), last_date: lastDate }))
    assert.equal(expect(res, 400).error, 'series_range_too_long')
    expect(await admin('POST', '/schedule/series/preview', adminOne.headers, seriesBody({ main_instructor_id: other.id, last_date: lastDate })), 400)
    assert.deepEqual(await harness.db.select().from(schema.classSeries).where(eq(schema.classSeries.mainInstructorId, other.id)), [])
    assert.deepEqual(
      await harness.db.select({ id: schema.classes.id }).from(schema.classes).where(and(eq(schema.classes.mainInstructorId, other.id), eq(schema.classes.roomId, south.roomId))),
      [],
    )

    // A year to the day is still a year.
    expect(await admin('POST', '/schedule/series/preview', adminOne.headers, seriesBody({ main_instructor_id: other.id, last_date: plainDate(at(210 + 365)) })), 200)
  })

  /* ── SCH: Class Types ─────────────────────────────────────────────── */

  test('SCH-17 a Class Type cannot take a parent that already has a parent', async () => {
    const root = await newClassType('Root A')
    const child = await newClassType('Child A', root)
    const loner = await newClassType('Loner')

    const res = await admin('PATCH', `/class-types/${loner}`, adminOne.headers, { parent_id: child })
    assert.equal(expect(res, 400).error, 'parent_must_be_root')
    assert.equal((await classTypeRow(loner)).parentId, null)

    const name = `${TAG} Grandchild`
    expect(await admin('POST', '/class-types', adminOne.headers, { name, parent_id: child }), 400)
    assert.deepEqual(await harness.db.select().from(schema.classTypes).where(eq(schema.classTypes.name, name)), [])
  })

  test('SCH-18 a Class Type with children cannot become a child', async () => {
    const parent = await newClassType('Parent B')
    const child = await newClassType('Child B', parent)
    const elsewhere = await newClassType('Root B')

    const res = await admin('PATCH', `/class-types/${parent}`, adminOne.headers, { parent_id: elsewhere })
    const body = expect(res, 409)
    assert.equal(body.error, 'class_type_has_children')
    assert.deepEqual(body.child_ids, [child])
    assert.equal((await classTypeRow(parent)).parentId, null)
  })

  test('SCH-19 a Class Type used by an upcoming or ongoing class cannot be archived, nor can its parent', async () => {
    const parent = await newClassType('Parent C')
    const used = await newClassType('Used C', parent)
    const day = slot()
    const classId = await createClass({ class_type_id: used, starts_at: day.toISOString() })

    for (const id of [used, parent]) {
      const res = await admin('POST', `/class-types/${id}/archive`, adminOne.headers)
      const body = expect(res, 409)
      assert.equal(body.error, 'class_type_in_use')
      assert.deepEqual(body.class_ids, [classId])
      assert.equal((await classTypeRow(id)).archivedAt, null)
    }

    // Ongoing is still in use.
    await atTime(new Date(day.getTime() + 30 * MINUTE), async () => {
      expect(await admin('POST', `/class-types/${used}/archive`, adminOne.headers), 409)
    })
    assert.equal((await classTypeRow(used)).archivedAt, null)

    // Once the class is over, the type archives.
    await atTime(new Date(day.getTime() + 2 * HOUR), async () => {
      expect(await admin('POST', `/class-types/${used}/archive`, adminOne.headers), 200)
    })
    assert.notEqual((await classTypeRow(used)).archivedAt, null)
  })

  /* ── editing and cancelling a class ───────────────────────────────── */

  test('rescheduling a booked class moves it and leaves its bookings and credits as they were', async () => {
    const day = slot()
    const classId = await createClass({ starts_at: day.toISOString(), credit_cost: 1 })
    const who = await member()
    const pkg = await credits(who, 5)
    const bookingId = await book(who, classId)
    assert.equal(await balance(pkg), 4)

    const later = new Date(day.getTime() + 2 * HOUR)
    const moved = expect(
      await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, {
        starts_at: later.toISOString(),
        ends_at: new Date(later.getTime() + HOUR).toISOString(),
      }),
      200,
    )
    assert.equal(moved.starts_at, later.toISOString())
    assert.equal((await classRow(classId)).startsAt.getTime(), later.getTime())
    const kept = await bookingRow(bookingId)
    assert.equal(kept.state, 'confirmed')
    assert.equal(kept.classId, classId)
    assert.equal(await balance(pkg), 4)
  })

  test('online capacity cannot drop below the members already booked, and a class that has started cannot be edited', async () => {
    const day = slot()
    const classId = await createClass({ starts_at: day.toISOString(), capacity_online: 3 })
    const held: { bookingId: string; packageId: string }[] = []
    for (const who of [await member(), await member()]) {
      const packageId = await credits(who, 5)
      held.push({ bookingId: await book(who, classId), packageId })
    }

    const shrink = await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, { capacity_online: 1 })
    const body = expect(shrink, 409)
    assert.equal(body.error, 'capacity_below_bookings')
    assert.equal(body.confirmed, 2)
    assert.equal((await classRow(classId)).capacityOnline, 3)
    expect(await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, { capacity_online: 2 }), 200)
    assert.equal((await classRow(classId)).capacityOnline, 2)

    for (const [offset, state] of [[30 * MINUTE, 'ongoing'], [2 * HOUR, 'completed']] as const) {
      await atTime(new Date(day.getTime() + offset), async () => {
        const res = await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, { capacity_online: 9 })
        assert.equal(expect(res, 409).error, `class_${state}`)
      })
    }
    assert.equal((await classRow(classId)).capacityOnline, 2)
    for (const { bookingId, packageId } of held) {
      assert.equal((await bookingRow(bookingId)).state, 'confirmed')
      assert.equal(await balance(packageId), 4)
    }
  })

  test('cancelling a booked class cancels its bookings and gives every member their credits back', async () => {
    const classId = await createClass({ credit_cost: 2 })
    const who = await member()
    const pkg = await credits(who, 6)
    const bookingId = await book(who, classId)
    assert.equal(await balance(pkg), 4)

    const res = expect(await admin('POST', `/schedule/classes/${classId}/cancel`, adminOne.headers), 200)
    assert.deepEqual(res, { total_bookings: 1, refunded_count: 1 })
    assert.equal((await classRow(classId)).lifecycle, 'cancelled')
    assert.equal((await bookingRow(bookingId)).state, 'cancelled')
    assert.equal(await balance(pkg), 6)
  })

  /* ── LOC ──────────────────────────────────────────────────────────── */

  test('LOC-01 an Admin lists every active Location of the studio and no archived one', async () => {
    const gone = await location('Gone')
    expect(await admin('POST', `/locations/${gone.locationId}/archive`, adminOne.headers), 200)

    const listed = expect(await admin('GET', '/locations', adminOne.headers), 200).locations.map((l: any) => l.id)
    assert.ok(listed.includes(north.locationId))
    assert.ok(listed.includes(south.locationId))
    assert.ok(!listed.includes(gone.locationId))
    const active = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(and(eq(schema.locations.tenantId, one.id), sql`${schema.locations.archivedAt} IS NULL`, sql`${schema.locations.deletedAt} IS NULL`))
    assert.deepEqual([...listed].sort(), active.map(l => l.id).sort())

    const withArchived = expect(await admin('GET', '/locations?include_archived=true', adminOne.headers), 200).locations
    assert.ok(withArchived.some((l: any) => l.id === gone.locationId && l.archived_at !== null))

    const theirs = expect(await admin('GET', '/locations?include_archived=true', adminTwo.headers), 200).locations.map((l: any) => l.id)
    for (const id of [north.locationId, south.locationId, gone.locationId]) assert.ok(!theirs.includes(id))
  })

  test('LOC-05 a Location with only past sessions archives, sits with the archived ones, and restores', async () => {
    const place = await location('Past only')
    const day = slot()
    await createClass({ location_id: place.locationId, room_id: place.roomId, starts_at: day.toISOString() })
    await workshop(place, new Date(day.getTime() + 2 * HOUR), 'Past workshop')
    await ptSession(place, new Date(day.getTime() + 4 * HOUR))

    await atTime(new Date(day.getTime() + DAY), async () => {
      const archived = expect(await admin('POST', `/locations/${place.locationId}/archive`, adminOne.headers), 200)
      assert.notEqual(archived.archived_at, null)
    })
    assert.notEqual((await locationRow(place.locationId)).archivedAt, null)
    const active = expect(await admin('GET', '/locations', adminOne.headers), 200).locations
    assert.ok(!active.some((l: any) => l.id === place.locationId))
    const all = expect(await admin('GET', '/locations?include_archived=true', adminOne.headers), 200).locations
    assert.ok(all.some((l: any) => l.id === place.locationId && l.archived_at !== null))

    const restored = expect(await admin('POST', `/locations/${place.locationId}/unarchive`, adminOne.headers), 200)
    assert.equal(restored.archived_at, null)
    assert.equal((await locationRow(place.locationId)).archivedAt, null)
    const again = expect(await admin('GET', '/locations', adminOne.headers), 200).locations
    assert.ok(again.some((l: any) => l.id === place.locationId))
  })

  test('LOC-06 archiving a Location live Unlimited Plans call home reports how many it strands, and still archives', async () => {
    const place = await location('Home')
    const dormant = await unlimited(await member(), place.locationId)
    const running = await unlimited(await member(), place.locationId, at(20))
    await unlimited(await member(), place.locationId, at(-1)) // expired: strands nobody
    await unlimited(await member(), north.locationId) // another Location's

    const count = expect(await admin('GET', `/locations/${place.locationId}/live-unlimited-count`, adminOne.headers), 200)
    assert.deepEqual(count, { count: 2 })
    // After the running plan expires, only the Dormant one is live.
    await atTime(at(21), async () => {
      assert.deepEqual(expect(await admin('GET', `/locations/${place.locationId}/live-unlimited-count`, adminOne.headers), 200), { count: 1 })
    })

    expect(await admin('POST', `/locations/${place.locationId}/archive`, adminOne.headers), 200)
    assert.notEqual((await locationRow(place.locationId)).archivedAt, null)
    const plans = await harness.db
      .select({ locationId: schema.clientPackages.locationId })
      .from(schema.clientPackages)
      .where(inArray(schema.clientPackages.id, [dormant, running]))
    assert.deepEqual(plans.map(p => p.locationId), [place.locationId, place.locationId])
  })

  test('LOC-07 a Location with an upcoming or ongoing class, workshop or PT session is not archived, and the sessions are listed', async () => {
    const refused = async (place: Place, key: 'class_ids' | 'workshop_ids' | 'pt_session_ids', id: string) => {
      const body = expect(await admin('POST', `/locations/${place.locationId}/archive`, adminOne.headers), 409)
      assert.equal(body.error, 'location_in_use')
      assert.deepEqual(body[key], [id])
      assert.equal((await locationRow(place.locationId)).archivedAt, null)
    }

    const withClass = await location('Upcoming class')
    const day = slot()
    const classId = await createClass({ location_id: withClass.locationId, room_id: withClass.roomId, starts_at: day.toISOString() })
    await refused(withClass, 'class_ids', classId)
    await atTime(new Date(day.getTime() + 30 * MINUTE), () => refused(withClass, 'class_ids', classId))

    const withWorkshop = await location('Upcoming workshop')
    const ws = await workshop(withWorkshop, at(1, 3))
    await refused(withWorkshop, 'workshop_ids', ws.workshopId)
    await atTime(at(1, 3, 30), () => refused(withWorkshop, 'workshop_ids', ws.workshopId))

    const withPt = await location('Upcoming PT')
    const pt = await ptSession(withPt, at(1, 6))
    await refused(withPt, 'pt_session_ids', pt.sessionId)
    await atTime(at(1, 6, 30), () => refused(withPt, 'pt_session_ids', pt.sessionId))
  })

  test('LOC-08 the Home Location of an Unlimited Plan cannot be deleted, and the plan keeps it', async () => {
    const place = await location('Home to delete')
    const plan = await unlimited(await member(), place.locationId, at(-1))
    expect(await admin('POST', `/locations/${place.locationId}/archive`, adminOne.headers), 200)

    const res = await admin('DELETE', `/locations/${place.locationId}`, adminOne.headers)
    const body = expect(res, 409)
    assert.equal(body.error, 'location_in_use')
    assert.deepEqual(body.client_package_ids, [plan])
    assert.equal((await locationRow(place.locationId)).deletedAt, null)
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, plan))
    assert.equal(row!.locationId, place.locationId)

    // Nor can the row go from under the plan at the database.
    await assert.rejects(harness.db.delete(schema.locations).where(eq(schema.locations.id, place.locationId)), (err: any) => {
      assert.equal((err.cause ?? err).code, '23503')
      return true
    })
    await locationRow(place.locationId)
  })

  test('LOC-14, LOC-15 the database refuses a plan that breaks the Unlimited Plan shape', async () => {
    const who = await member()
    const row = (over: Omit<Partial<typeof schema.clientPackages.$inferInsert>, 'kind'> & { kind: 'unlimited' | 'credit_bundle' }) => ({
      tenantId: one.id,
      clientId: who.clientId,
      active: true,
      amountPaidSgd: '100.00',
      listPriceSgd: '100.00',
      ...over,
    })
    const unlimitedRow = { kind: 'unlimited' as const, locationId: north.locationId, durationMonths: 1 }
    const bundleRow = { kind: 'credit_bundle' as const, validityDays: 90, creditsOrSessionsRemaining: 5 }
    const refusedRows = [
      // LOC-14: an Unlimited Plan with no Home Location, or no frozen Duration.
      { ...unlimitedRow, locationId: null },
      { ...unlimitedRow, durationMonths: null },
      // LOC-15: anything else carrying either.
      { ...bundleRow, locationId: north.locationId },
      { ...bundleRow, durationMonths: 1 },
    ]
    for (const values of refusedRows) {
      await assert.rejects(harness.db.insert(schema.clientPackages).values(row(values)), (err: any) => {
        const cause = err.cause ?? err
        assert.equal(cause.code, '23514', JSON.stringify(values))
        assert.equal(cause.constraint_name, 'client_packages_kind_fields')
        return true
      })
    }
    assert.deepEqual(await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, who.clientId)), [])

    // The shapes themselves are fine.
    await harness.db.insert(schema.clientPackages).values(row(unlimitedRow))
    await harness.db.insert(schema.clientPackages).values(row(bundleRow))
  })

  /* ── ROS ──────────────────────────────────────────────────────────── */

  test('ROS-01 the class detail lists the confirmed attendees in booking order, and the booked count', async () => {
    const classId = await createClass({ credit_cost: 2 })
    const [first, second, leaver] = [await member(), await member(), await member()]
    for (const who of [first, second, leaver]) await credits(who, 10)
    const firstBooking = await book(first, classId)
    const secondBooking = await book(second, classId)
    const leaverBooking = await book(leaver, classId)
    expect(await request('DELETE', `/me/bookings/${leaverBooking}`, leaver.headers), 200)

    const detail = expect(await admin('GET', `/schedule/classes/${classId}`, adminOne.headers), 200)
    assert.equal(detail.booked_count, 2)
    const expected = async (bookingId: string, who: Member) => {
      const [client] = await harness.db.select({ name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, who.clientId))
      return {
        booking_id: bookingId,
        client: { id: who.clientId, name: client!.name },
        package_kind: 'credit_bundle',
        credits_used: 2,
        check_in_state: 'pending',
        code: (await bookingRow(bookingId)).code,
      }
    }
    assert.deepEqual(detail.attendees, [await expected(firstBooking, first), await expected(secondBooking, second)])
  })

  test('ROS-02 a session reads scheduled, then ongoing, then completed as its times pass', async () => {
    const day = slot()
    const classId = await createClass({ starts_at: day.toISOString() })
    const stateAt = (instant: Date) =>
      atTime(instant, async () => {
        const window = query({ from: day.toISOString(), to: new Date(day.getTime() + HOUR).toISOString(), location_id: north.locationId })
        const [entry] = expect(await admin('GET', `/schedule${window}`, adminOne.headers), 200).entries
        assert.equal(entry.id, classId)
        const [own] = expect(await instructor('GET', `/schedule${window}`, teacher.headers), 200).entries
        assert.equal(own.event_state, entry.event_state, 'the instructor reads the same state')
        return entry.event_state
      })

    assert.equal(await stateAt(new Date(day.getTime() - MINUTE)), 'scheduled')
    assert.equal(await stateAt(new Date(day.getTime() + 30 * MINUTE)), 'ongoing')
    assert.equal(await stateAt(new Date(day.getTime() + HOUR + MINUTE)), 'completed')
  })

  test('ROS-03 adding a supporting instructor to an existing session without pay is refused, and the roster is unchanged', async () => {
    const classId = await createClass()
    for (const body of [{ supporting_instructors: [{ instructor_id: helper.id }] }, { supporting_instructor_ids: [helper.id] }]) {
      const res = await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, body)
      assert.equal(expect(res, 400).error, 'instructor_pay_required')
      assert.deepEqual(await supportingOf(classId), {})
    }
    expect(await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, { supporting_instructors: [{ instructor_id: helper.id, pay_sgd: 25 }] }), 200)
    assert.deepEqual(await supportingOf(classId), { [helper.id]: 25 })
  })

  test('ROS-04 editing a roster keeps the pay already entered for everyone who stays on it', async () => {
    const classId = await createClass({ instructor_pay_sgd: 60, supporting_instructors: [{ instructor_id: helper.id, pay_sgd: 30 }] })
    // Pay changed from Finance after scheduling.
    expect(await admin('PATCH', `/finance/pay/class/${classId}`, adminOne.headers, { instructor_pay_sgd: 65 }), 200)

    expect(
      await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, {
        supporting_instructors: [{ instructor_id: helper.id }, { instructor_id: other.id, pay_sgd: 20 }],
      }),
      200,
    )
    assert.equal(Number((await classRow(classId)).instructorPaySgd), 65)
    assert.deepEqual(await supportingOf(classId), { [helper.id]: 30, [other.id]: 20 })

    // The bare id list means "these instructors, pay as it is".
    expect(await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, { supporting_instructor_ids: [other.id, helper.id] }), 200)
    assert.deepEqual(await supportingOf(classId), { [helper.id]: 30, [other.id]: 20 })

    // An edit that is not about the roster leaves pay alone too.
    expect(await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, { capacity_online: 12 }), 200)
    const detail = expect(await admin('GET', `/schedule/classes/${classId}`, adminOne.headers), 200)
    assert.equal(detail.instructor_pay_sgd, 65)
    assert.deepEqual(
      Object.fromEntries(detail.supporting_instructors.map((s: any) => [s.id, s.pay_sgd])),
      { [helper.id]: 30, [other.id]: 20 },
    )
  })

  test('ROS-05 an Unpriced session from before the required-pay rule is read and edited without inventing a pay figure', async () => {
    const startsAt = slot()
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: one.id,
        classTypeId,
        mainInstructorId: teacher.id,
        locationId: north.locationId,
        roomId: north.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        instructorPaySgd: null,
        createdByStaffId: adminOne.id,
      })
      .returning({ id: schema.classes.id })
    const classId = row!.id
    await harness.db.insert(schema.classSupportingInstructors).values({ tenantId: one.id, classId, instructorId: helper.id, paySgd: null })

    const read = expect(await admin('GET', `/schedule/classes/${classId}`, adminOne.headers), 200)
    assert.equal(read.instructor_pay_sgd, null)
    assert.deepEqual(read.supporting_instructors.map((s: any) => [s.id, s.pay_sgd]), [[helper.id, null]])

    expect(await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, { capacity_online: 8 }), 200)
    expect(await admin('PATCH', `/schedule/classes/${classId}`, adminOne.headers, { supporting_instructor_ids: [helper.id] }), 200)
    assert.equal((await classRow(classId)).instructorPaySgd, null)
    assert.deepEqual(await supportingOf(classId), { [helper.id]: null })
  })

  /* ── refusals ─────────────────────────────────────────────────────── */

  test('an instructor and a member are refused every admin schedule, Class Type and Location route, and nothing changes', async () => {
    const classId = await createClass()
    const typeId = await newClassType('Guarded')
    const place = await location('Guarded')
    const who = await member()
    const requestId = await ptRequest(north, slot())
    const ws = await workshop(north, slot())
    const routes: [string, string, unknown?][] = [
      ['POST', '/workshops', { name: `${TAG} Not made`, location_id: north.locationId, main_instructor_id: other.id, main_instructor_pay_sgd: 1 }],
      ['POST', `/workshops/${ws.workshopId}/days`, workshopDay(north, slot())],
      ['POST', `/pt-sessions/${requestId}/schedule`, ptSchedule(north, slot())],
      ['POST', `/pt-sessions/${requestId}/cancel`],
      ['GET', '/finance'],
      ['PATCH', `/finance/pay/class/${classId}`, { instructor_pay_sgd: 1 }],
      ['GET', `/schedule${query({ location_id: north.locationId })}`],
      ['GET', `/schedule/classes/${classId}`],
      ['POST', '/schedule/classes', classBody()],
      ['PATCH', `/schedule/classes/${classId}`, { capacity_online: 2 }],
      ['POST', `/schedule/classes/${classId}/cancel`],
      ['POST', '/schedule/series/preview', seriesBody()],
      ['POST', '/schedule/series', seriesBody()],
      ['POST', '/class-types', { name: `${TAG} Not made` }],
      ['PATCH', `/class-types/${typeId}`, { name: 'Renamed' }],
      ['POST', `/class-types/${typeId}/archive`],
      ['GET', '/locations'],
      ['POST', '/locations', { name: `${TAG} Not made` }],
      ['GET', `/locations/${place.locationId}/live-unlimited-count`],
      ['POST', `/locations/${place.locationId}/archive`],
      ['POST', `/locations/${place.locationId}/unarchive`],
      ['DELETE', `/locations/${place.locationId}`],
    ]
    for (const [method, path, body] of routes) {
      assert.equal((await admin(method, path, teacher.headers, body)).status, 403, `instructor ${method} ${path}`)
      const asMember = await admin(method, path, who.headers, body)
      assert.ok([401, 403].includes(asMember.status), `member ${method} ${path}: ${asMember.status}`)
    }
    for (const [method, path] of [['GET', '/schedule'], ['POST', '/schedule/classes']] as const) {
      const res = await instructor(method, path, who.headers, method === 'POST' ? classBody() : undefined)
      assert.ok([401, 403].includes(res.status), `member ${method} instructor${path}: ${res.status}`)
    }

    const cls = await classRow(classId)
    assert.equal(cls.capacityOnline, 10)
    assert.equal(cls.lifecycle, 'active')
    assert.equal(Number(cls.instructorPaySgd), 50)
    const [request_] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, requestId))
    assert.equal(request_!.status, 'pending')
    assert.equal((await harness.db.select().from(schema.workshopDays).where(eq(schema.workshopDays.workshopId, ws.workshopId))).length, 1)
    assert.deepEqual(await harness.db.select().from(schema.workshops).where(eq(schema.workshops.name, `${TAG} Not made`)), [])
    const type = await classTypeRow(typeId)
    assert.equal(type.name, `${TAG} Guarded`)
    assert.equal(type.archivedAt, null)
    const loc = await locationRow(place.locationId)
    assert.equal(loc.archivedAt, null)
    assert.equal(loc.deletedAt, null)
    assert.deepEqual(await harness.db.select().from(schema.locations).where(eq(schema.locations.name, `${TAG} Not made`)), [])
    assert.deepEqual(await harness.db.select().from(schema.classTypes).where(eq(schema.classTypes.name, `${TAG} Not made`)), [])
  })

  test('another studio’s staff find none of this studio’s classes, rooms, Class Types or Locations, and change nothing', async () => {
    const day = slot()
    const classId = await createClass({ starts_at: day.toISOString() })
    const typeId = await newClassType('Theirs not')
    const place = await location('Theirs not')
    const archivedPlace = await location('Theirs not archived')
    expect(await admin('POST', `/locations/${archivedPlace.locationId}/archive`, adminOne.headers), 200)
    const requestId = await ptRequest(north, day)
    const ws = expect(
      await admin('POST', '/workshops', adminOne.headers, { name: `${TAG} Not theirs`, location_id: north.locationId, main_instructor_id: other.id, main_instructor_pay_sgd: 100 }),
      201,
    )

    const notFound: [string, string, unknown?][] = [
      ['GET', `/schedule/classes/${classId}`],
      ['PATCH', `/schedule/classes/${classId}`, { capacity_online: 2 }],
      ['POST', `/schedule/classes/${classId}/cancel`],
      ['PATCH', `/class-types/${typeId}`, { name: 'Renamed' }],
      ['POST', `/class-types/${typeId}/archive`],
      ['POST', `/locations/${place.locationId}/archive`],
      ['POST', `/locations/${archivedPlace.locationId}/unarchive`],
      ['DELETE', `/locations/${archivedPlace.locationId}`],
      ['POST', `/workshops/${ws.id}/days`, workshopDay(north, at(1, 20))],
    ]
    for (const [method, path, body] of notFound) {
      assert.equal((await admin(method, path, adminTwo.headers, body)).status, 404, `${method} ${path}`)
    }
    // A class, series or PT session in this studio's room is not theirs to book the room with.
    const theirOwnLocation = expect(await admin('GET', '/locations', adminTwo.headers), 200).locations[0].id
    const borrowed = { location_id: theirOwnLocation, room_id: north.roomId, main_instructor_id: coachTwo.id, class_type_id: classTypeId }
    assert.equal((await admin('POST', '/schedule/classes', adminTwo.headers, classBody(borrowed))).status, 404)
    assert.equal((await admin('POST', '/schedule/series/preview', adminTwo.headers, seriesBody(borrowed))).status, 404)
    assert.equal((await admin('POST', '/schedule/series', adminTwo.headers, seriesBody(borrowed))).status, 404)
    assert.equal((await admin('PATCH', `/finance/pay/class/${classId}`, adminTwo.headers, { instructor_pay_sgd: 1 })).status, 404)
    assert.equal((await instructor('POST', '/schedule/classes', coachTwo.headers, classBody(borrowed))).status, 404)
    assert.equal(
      (await admin('POST', `/pt-sessions/${requestId}/schedule`, adminTwo.headers, ptSchedule(north, day, { instructor_id: coachTwo.id }))).status,
      404,
    )
    // Their live-unlimited count for this studio's Location is nothing they can read.
    assert.equal((await admin('GET', `/locations/${place.locationId}/live-unlimited-count`, adminTwo.headers)).status, 404)
    // And the timetable filtered to this studio's Location shows them nothing.
    const window = query({ from: day.toISOString(), to: new Date(day.getTime() + HOUR).toISOString(), location_id: north.locationId })
    assert.deepEqual(expect(await admin('GET', `/schedule${window}`, adminTwo.headers), 200).entries, [])

    const cls = await classRow(classId)
    assert.equal(cls.capacityOnline, 10)
    assert.equal(cls.lifecycle, 'active')
    assert.equal(Number(cls.instructorPaySgd), 50)
    assert.deepEqual(await harness.db.select().from(schema.classSeries).where(eq(schema.classSeries.tenantId, two.id)).then(r => r.filter(x => x.roomId === north.roomId)), [])
    assert.equal((await classTypeRow(typeId)).archivedAt, null)
    assert.equal((await locationRow(place.locationId)).archivedAt, null)
    const stillArchived = await locationRow(archivedPlace.locationId)
    assert.notEqual(stillArchived.archivedAt, null)
    assert.equal(stillArchived.deletedAt, null)
    assert.deepEqual(await harness.db.select().from(schema.workshopDays).where(eq(schema.workshopDays.workshopId, ws.id)), [])
    const [pending] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, requestId))
    assert.equal(pending!.status, 'pending')
    assert.deepEqual(
      await harness.db.select().from(schema.classes).where(and(eq(schema.classes.roomId, north.roomId), eq(schema.classes.tenantId, two.id))),
      [],
    )
  })
})
