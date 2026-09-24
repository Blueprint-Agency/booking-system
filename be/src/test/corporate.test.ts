import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DOMAIN = `${run}.corporate.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const TAG = `corp-${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Corporate over real HTTP (admin-restructure §7c, §9b; be-portal §corporate-requests.ts, §3f).
 *
 * A member's corporate request arrives pending; an admin schedules it (which is
 * what creates the corporate session, named after the member), cancels it, or
 * marks it attended. Every route is admin-only and studio-scoped.
 */
describe('corporate packages, requests and sessions over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  type Place = { locationId: string; roomId: string; otherRoomId: string | null }
  type Staff = { staffId: string; headers: Record<string, string> }
  type Member = { clientId: string; name: string; headers: Record<string, string> }

  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }
  let hereAtOne!: Place
  let elsewhereAtOne!: Place
  let placeAtTwo!: Place
  let adminAtOne!: Staff
  let teacherA!: Staff
  let teacherB!: Staff
  let teacherC!: Staff
  let adminAtTwo!: Staff
  let teacherAtTwo!: Staff
  let memberAtOne!: Member
  let otherMemberAtOne!: Member
  let packageAtOne!: string

  const emailFor = (name: string, tenant: { slug: string }) =>
    `${name.toLowerCase().replace(/\s+/g, '-')}-${tenant.slug}@${DOMAIN}`

  // Far out and on a random quarter-hour, so no other fixture holds these rooms
  // or instructors. Each test takes its own slot, three hours apart.
  const base = (() => {
    const at = new Date(Date.now() + (1000 + Math.floor(Math.random() * 800)) * DAY)
    at.setUTCHours(0, Math.floor(Math.random() * 4) * 15, 0, 0)
    return at.getTime()
  })()
  let slots = 0
  const slot = () => {
    const startsAt = new Date(base + slots++ * 3 * HOUR)
    return { startsAt, endsAt: new Date(startsAt.getTime() + HOUR) }
  }

  const send = (
    path: string,
    headers: Record<string, string>,
    method = 'GET',
    body?: unknown,
  ): Promise<Response> =>
    Promise.resolve(
      harness.app.request(path, {
        method,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  const admin = (path: string, who: { headers: Record<string, string> }, method = 'GET', body?: unknown) =>
    send(`/api/v1/portal/admin${path}`, who.headers, method, body)

  async function json(res: Response): Promise<{ status: number; body: any }> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  /** A refusal: exactly this status, carrying exactly this error code. */
  async function refused(res: Response, status: number, error: string, what = '') {
    const { body } = await json(res)
    assert.equal(res.status, status, `${what} ${JSON.stringify(body)}`)
    assert.equal(body?.error, error, `${what} ${JSON.stringify(body)}`)
  }
  // A member's session is a row the staff pool has never seen: unauthenticated
  // there, not merely unprivileged. An instructor is signed in but not an admin.
  const asMember = (res: Response, what = '') => refused(res, 401, 'invalid_token', what)
  const asInstructor = (res: Response, what = '') => refused(res, 403, 'forbidden_role', what)

  async function places(tenant: { id: string; slug: string }): Promise<Place[]> {
    const rows = await harness.db
      .select({ locationId: schema.rooms.locationId, roomId: schema.rooms.id })
      .from(schema.rooms)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.rooms.locationId))
      .where(
        and(
          eq(schema.rooms.tenantId, tenant.id),
          sql`${schema.rooms.archivedAt} IS NULL`,
          sql`${schema.rooms.deletedAt} IS NULL`,
          sql`${schema.locations.deletedAt} IS NULL`,
        ),
      )
      .orderBy(asc(schema.locations.name), asc(schema.rooms.name))
    const byLocation = new Map<string, string[]>()
    for (const r of rows) byLocation.set(r.locationId, [...(byLocation.get(r.locationId) ?? []), r.roomId])
    return [...byLocation.entries()].map(([locationId, rooms]) => ({
      locationId,
      roomId: rooms[0]!,
      otherRoomId: rooms[1] ?? null,
    }))
  }

  async function staff(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(name, tenant)
    const headers = await harness.signInAs('staff', email, tenant)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { staffId: row!.id, headers }
  }

  async function member(tenant: { id: string; slug: string }, name: string): Promise<Member> {
    const email = emailFor(name, tenant)
    const headers = await harness.signInAs('client', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: tenant.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, name, headers }
  }

  async function createPackage(who: Staff, name: string): Promise<string> {
    const res = await json(await admin('/corporate-packages', who, 'POST', { name, price_sgd: '1500.00' }))
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.corporatePackage.id as string
  }

  /** A pending Corporate Request, made through the member's own route. */
  async function request(who: Member = memberAtOne, packageId = packageAtOne): Promise<string> {
    const res = await json(
      await send('/api/v1/me/corporate-requests', who.headers, 'POST', {
        package_id: packageId,
        preferred_location: `${TAG} office`,
        notes: 'team of twelve',
      }),
    )
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.corporate_request_id as string
  }

  type ScheduleBody = {
    main_instructor_id: string
    supporting_instructor_ids?: string[]
    location_id: string
    room_id?: string
    starts_at: string
    ends_at: string
  }
  const at = (place: Place, teacher: Staff, when: { startsAt: Date; endsAt: Date }, roomId = place.roomId): ScheduleBody => ({
    main_instructor_id: teacher.staffId,
    location_id: place.locationId,
    room_id: roomId,
    starts_at: when.startsAt.toISOString(),
    ends_at: when.endsAt.toISOString(),
  })

  const schedule = async (who: Staff, requestId: string, body: ScheduleBody) =>
    json(await admin(`/corporate-requests/${requestId}/schedule`, who, 'POST', body))

  async function requestRow(id: string) {
    const [row] = await harness.db.select().from(schema.corporateRequests).where(eq(schema.corporateRequests.id, id))
    assert.ok(row, `request ${id} exists`)
    return row
  }

  async function sessionRow(id: string) {
    const [row] = await harness.db.select().from(schema.corporateSessions).where(eq(schema.corporateSessions.id, id))
    assert.ok(row, `session ${id} exists`)
    return row
  }

  const sessionsFrom = (requestId: string) =>
    harness.db.select().from(schema.corporateSessions).where(eq(schema.corporateSessions.corporateRequestId, requestId))

  /** Schedules a fresh request and hands back both ids. */
  async function scheduled(teacher: Staff = teacherA, place: Place = hereAtOne) {
    const requestId = await request()
    const res = await schedule(adminAtOne, requestId, at(place, teacher, slot()))
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const { scheduledCorporateSessionId } = await requestRow(requestId)
    assert.ok(scheduledCorporateSessionId)
    return { requestId, sessionId: scheduledCorporateSessionId }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ one, two } = harness.tenants)

    const atOne = await places(one)
    assert.ok(atOne.length >= 2, 'the first fixture studio has two Locations with rooms')
    ;[hereAtOne, elsewhereAtOne] = atOne as [Place, Place]
    const atTwo = await places(two)
    assert.ok(atTwo.length >= 1, 'the second fixture studio has a room')
    placeAtTwo = atTwo[0]!

    adminAtOne = await staff(one, 'desk', 'admin')
    teacherA = await staff(one, 'teacher-a', 'instructor')
    teacherB = await staff(one, 'teacher-b', 'instructor')
    teacherC = await staff(one, 'teacher-c', 'instructor')
    adminAtTwo = await staff(two, 'desk', 'admin')
    teacherAtTwo = await staff(two, 'teacher', 'instructor')
    memberAtOne = await member(one, `Priya Corporate ${run}`)
    otherMemberAtOne = await member(one, `Omar Corporate ${run}`)
    packageAtOne = await createPackage(adminAtOne, `${TAG} Team Offsite`)
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const clientIds = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const requestIds = sql`SELECT id FROM corporate_requests WHERE client_id IN (${clientIds})`
    const sessionIds = sql`SELECT id FROM corporate_sessions WHERE created_by_staff_id IN (${staffIds})`
    const packageIds = sql`SELECT id FROM corporate_packages WHERE created_by_staff_id IN (${staffIds})`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE target_id IN (${requestIds}) OR target_id IN (${sessionIds}) OR target_id IN (${packageIds})`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    // The two tables point at each other; untie them before deleting either.
    await harness.db.execute(sql`UPDATE corporate_requests SET scheduled_corporate_session_id = NULL WHERE client_id IN (${clientIds})`)
    await harness.db.execute(sql`UPDATE corporate_sessions SET corporate_request_id = NULL WHERE created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM corporate_session_supporting_instructors WHERE corporate_session_id IN (${sessionIds})`)
    await harness.db.execute(sql`DELETE FROM corporate_sessions WHERE created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM corporate_requests WHERE client_id IN (${clientIds})`)
    await harness.db.execute(sql`DELETE FROM corporate_packages WHERE created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  // ---------------------------------------------------------------------------
  // Corporate packages
  // ---------------------------------------------------------------------------

  describe('corporate packages', () => {
    test('an admin creates, reads, edits and archives a corporate package', async () => {
      const id = await createPackage(adminAtOne, `${TAG} Lunch Flow Session`)

      const read = await json(await admin(`/corporate-packages/${id}`, adminAtOne))
      assert.equal(read.status, 200, JSON.stringify(read.body))
      assert.equal(read.body.corporatePackage.name, `${TAG} Lunch Flow Session`)
      assert.equal(read.body.corporatePackage.status, 'active')

      const edited = await json(await admin(`/corporate-packages/${id}`, adminAtOne, 'PATCH', { price_sgd: '1750.00' }))
      assert.equal(edited.status, 200, JSON.stringify(edited.body))
      assert.equal(Number(edited.body.corporatePackage.price_sgd), 1750)

      const archived = await json(await admin(`/corporate-packages/${id}`, adminAtOne, 'PATCH', { status: 'archived' }))
      assert.equal(archived.status, 200, JSON.stringify(archived.body))
      assert.equal(archived.body.corporatePackage.status, 'archived')

      const listed = await json(await admin('/corporate-packages', adminAtOne))
      assert.equal(listed.status, 200)
      assert.ok(listed.body.corporatePackages.some((p: { id: string }) => p.id === id))
    })

    test('a member and an instructor are refused the corporate package routes', async () => {
      await asMember(await admin('/corporate-packages', memberAtOne), 'member list')
      await asMember(
        await admin('/corporate-packages', memberAtOne, 'POST', { name: `${TAG} Member Made`, price_sgd: '1.00' }),
        'member create',
      )

      await asInstructor(await admin('/corporate-packages', teacherA), 'instructor list')
      await asInstructor(
        await admin('/corporate-packages', teacherA, 'POST', { name: `${TAG} Teacher Made`, price_sgd: '1.00' }),
        'instructor create',
      )
      await asInstructor(
        await admin(`/corporate-packages/${packageAtOne}`, teacherA, 'PATCH', { price_sgd: '1.00' }),
        'instructor edit',
      )

      const made = await harness.db
        .select()
        .from(schema.corporatePackages)
        .where(inArray(schema.corporatePackages.name, [`${TAG} Member Made`, `${TAG} Teacher Made`]))
      assert.equal(made.length, 0, 'nothing was created')
      const [pkg] = await harness.db.select().from(schema.corporatePackages).where(eq(schema.corporatePackages.id, packageAtOne))
      assert.equal(Number(pkg!.priceSgd), 1500, 'nothing was edited')
    })

    test("another studio's admin cannot read, edit or archive a corporate package", async () => {
      const read = await admin(`/corporate-packages/${packageAtOne}`, adminAtTwo)
      assert.equal(read.status, 404)
      const edit = await admin(`/corporate-packages/${packageAtOne}`, adminAtTwo, 'PATCH', { price_sgd: '1.00', status: 'archived' })
      assert.equal(edit.status, 404)
      const listed = await json(await admin('/corporate-packages', adminAtTwo))
      assert.equal(listed.status, 200)
      assert.ok(!listed.body.corporatePackages.some((p: { id: string }) => p.id === packageAtOne))

      const [pkg] = await harness.db.select().from(schema.corporatePackages).where(eq(schema.corporatePackages.id, packageAtOne))
      assert.equal(Number(pkg!.priceSgd), 1500)
      assert.equal(pkg!.status, 'active')
    })
  })

  // ---------------------------------------------------------------------------
  // Corporate requests
  // ---------------------------------------------------------------------------

  describe('corporate requests', () => {
    test('every pending Corporate Request is listed, whoever made it', async () => {
      const mine = await request(memberAtOne)
      const theirs = await request(otherMemberAtOne)
      const ids = (body: any) => new Set((body.corporate_requests as { id: string }[]).map(r => r.id))

      for (const query of ['', '?status=pending', '?status=all']) {
        const res = await json(await admin(`/corporate-requests${query}`, adminAtOne))
        assert.equal(res.status, 200, `${query}: ${JSON.stringify(res.body)}`)
        const listed = ids(res.body)
        assert.ok(listed.has(mine) && listed.has(theirs), `both requests are listed with ${query || 'no filter'}`)
      }

      const [row] = (await json(await admin('/corporate-requests', adminAtOne))).body.corporate_requests.filter(
        (r: { id: string }) => r.id === mine,
      )
      assert.equal(row.status, 'pending')
      assert.equal(row.client.id, memberAtOne.clientId)
      assert.equal(row.package.id, packageAtOne)
      assert.equal(row.session, null)

      const detail = await json(await admin(`/corporate-requests/${mine}`, adminAtOne))
      assert.equal(detail.status, 200)
      assert.equal(detail.body.corporate_request.id, mine)
    })

    test('CORP-07 scheduling a pending request creates a corporate session named after the member and marks the request scheduled', async () => {
      const requestId = await request(memberAtOne)
      const when = slot()
      const res = await schedule(adminAtOne, requestId, {
        ...at(hereAtOne, teacherA, when),
        supporting_instructor_ids: [teacherB.staffId],
      })
      assert.equal(res.status, 201, JSON.stringify(res.body))
      assert.equal(res.body.corporate_request.status, 'scheduled')
      assert.ok(res.body.corporate_request.session, 'the response carries the linked session')
      assert.equal(res.body.corporate_request.session.starts_at, when.startsAt.toISOString())

      const req = await requestRow(requestId)
      assert.equal(req.status, 'scheduled')
      assert.equal(req.resolvedByStaffId, adminAtOne.staffId)
      assert.ok(req.scheduledCorporateSessionId)

      const session = await sessionRow(req.scheduledCorporateSessionId)
      assert.equal(session.clientName, memberAtOne.name, 'the client name comes from the member record')
      assert.equal(session.corporateRequestId, requestId)
      assert.equal(session.corporatePackageId, packageAtOne)
      assert.equal(session.mainInstructorId, teacherA.staffId)
      assert.equal(session.locationId, hereAtOne.locationId)
      assert.equal(session.roomId, hereAtOne.roomId)
      assert.equal(session.startsAt.toISOString(), when.startsAt.toISOString())
      assert.equal(session.endsAt.toISOString(), when.endsAt.toISOString())
      assert.equal(session.lifecycle, 'active')

      const detail = await json(await admin(`/corporate-sessions/${session.id}`, adminAtOne))
      assert.equal(detail.status, 200, JSON.stringify(detail.body))
      assert.equal(detail.body.corporate_session.client_name, memberAtOne.name)
      assert.deepEqual(detail.body.corporate_session.supporting_instructor_ids, [teacherB.staffId])

      assert.equal((await sessionsFrom(requestId)).length, 1, 'exactly one session')
    })

    test('CORP-08 scheduling into a room already booked at that time is refused', async () => {
      const first = await scheduled(teacherA)
      const taken = await sessionRow(first.sessionId)
      const requestId = await request(otherMemberAtOne)

      // Same room, a different instructor, overlapping by half an hour.
      const res = await schedule(adminAtOne, requestId, {
        main_instructor_id: teacherC.staffId,
        location_id: hereAtOne.locationId,
        room_id: hereAtOne.roomId,
        starts_at: new Date(taken.startsAt.getTime() + 30 * MINUTE).toISOString(),
        ends_at: new Date(taken.endsAt.getTime() + 30 * MINUTE).toISOString(),
      })
      assert.equal(res.status, 409, JSON.stringify(res.body))
      assert.equal(res.body.error, 'schedule_conflict')

      assert.equal((await requestRow(requestId)).status, 'pending')
      assert.equal((await sessionsFrom(requestId)).length, 0, 'no session was created')
    })

    test('CORP-08 scheduling an instructor already booked at that time is refused', async () => {
      const first = await scheduled(teacherA)
      const taken = await sessionRow(first.sessionId)
      const requestId = await request(otherMemberAtOne)

      // Same instructor, another Location entirely, same hour.
      const res = await schedule(adminAtOne, requestId, {
        main_instructor_id: teacherA.staffId,
        location_id: elsewhereAtOne.locationId,
        room_id: elsewhereAtOne.roomId,
        starts_at: taken.startsAt.toISOString(),
        ends_at: taken.endsAt.toISOString(),
      })
      assert.equal(res.status, 409, JSON.stringify(res.body))
      assert.equal(res.body.error, 'schedule_conflict')

      // A busy supporting instructor is just as busy.
      const asSupport = await schedule(adminAtOne, requestId, {
        main_instructor_id: teacherC.staffId,
        supporting_instructor_ids: [teacherA.staffId],
        location_id: elsewhereAtOne.locationId,
        room_id: elsewhereAtOne.roomId,
        starts_at: taken.startsAt.toISOString(),
        ends_at: taken.endsAt.toISOString(),
      })
      assert.equal(asSupport.status, 409, JSON.stringify(asSupport.body))
      assert.equal(asSupport.body.error, 'schedule_conflict')

      assert.equal((await requestRow(requestId)).status, 'pending')
      assert.equal((await sessionsFrom(requestId)).length, 0)
    })

    test('CORP-08 scheduling into a room from another Location is refused', async () => {
      const requestId = await request(memberAtOne)
      const res = await schedule(adminAtOne, requestId, at(hereAtOne, teacherC, slot(), elsewhereAtOne.roomId))
      assert.equal(res.status, 400, JSON.stringify(res.body))
      assert.equal(res.body.error, 'room_location_mismatch')

      // Nor a room from another studio: from here it does not exist.
      const foreign = await schedule(adminAtOne, requestId, at(hereAtOne, teacherC, slot(), placeAtTwo.roomId))
      assert.equal(foreign.status, 404, JSON.stringify(foreign.body))
      assert.equal(foreign.body.error, 'room_not_found')

      assert.equal((await requestRow(requestId)).status, 'pending')
      assert.equal((await sessionsFrom(requestId)).length, 0)
    })

    test('scheduling with the end before the start is refused', async () => {
      const requestId = await request(memberAtOne)
      const when = slot()
      const res = await schedule(adminAtOne, requestId, {
        ...at(hereAtOne, teacherC, when),
        starts_at: when.endsAt.toISOString(),
        ends_at: when.startsAt.toISOString(),
      })
      assert.equal(res.status, 400, JSON.stringify(res.body))
      assert.equal((await requestRow(requestId)).status, 'pending')
    })

    test('scheduling a request whose package has been archived is refused as package_archived', async () => {
      const pkg = await createPackage(adminAtOne, `${TAG} Retired Offsite`)
      const requestId = await request(memberAtOne, pkg)
      const archive = await admin(`/corporate-packages/${pkg}`, adminAtOne, 'PATCH', { status: 'archived' })
      assert.equal(archive.status, 200)

      const res = await schedule(adminAtOne, requestId, at(hereAtOne, teacherC, slot()))
      assert.equal(res.status, 422, JSON.stringify(res.body))
      assert.equal(res.body.error, 'package_archived')
      assert.equal((await requestRow(requestId)).status, 'pending')
      assert.equal((await sessionsFrom(requestId)).length, 0)
    })

    test('scheduling a request that is no longer pending is refused as not_pending', async () => {
      const { requestId, sessionId } = await scheduled(teacherB)
      const again = await schedule(adminAtOne, requestId, at(elsewhereAtOne, teacherC, slot()))
      assert.equal(again.status, 409, JSON.stringify(again.body))
      assert.equal(again.body.error, 'not_pending')
      assert.equal((await requestRow(requestId)).scheduledCorporateSessionId, sessionId, 'still the first session')
      assert.equal((await sessionsFrom(requestId)).length, 1)

      const cancelledId = await request(memberAtOne)
      assert.equal((await admin(`/corporate-requests/${cancelledId}/cancel`, adminAtOne, 'POST')).status, 200)
      const afterCancel = await schedule(adminAtOne, cancelledId, at(elsewhereAtOne, teacherC, slot()))
      assert.equal(afterCancel.status, 409, JSON.stringify(afterCancel.body))
      assert.equal(afterCancel.body.error, 'not_pending')
      assert.equal((await requestRow(cancelledId)).status, 'cancelled')
    })

    test('CORP-09 marking a scheduled request attended makes it attended', async () => {
      const { requestId } = await scheduled(teacherC)
      const res = await json(await admin(`/corporate-requests/${requestId}/attended`, adminAtOne, 'POST'))
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.corporate_request.status, 'attended')
      const row = await requestRow(requestId)
      assert.equal(row.status, 'attended')
      assert.equal(row.resolvedByStaffId, adminAtOne.staffId)
    })

    test('CORP-09 a pending request cannot be marked attended', async () => {
      const requestId = await request(memberAtOne)
      await refused(
        await admin(`/corporate-requests/${requestId}/attended`, adminAtOne, 'POST'),
        400,
        'corporate_request_not_scheduled',
      )
      assert.equal((await requestRow(requestId)).status, 'pending')
    })

    test('CORP-10 cancelling a pending request makes it cancelled', async () => {
      const requestId = await request(memberAtOne)
      const res = await json(await admin(`/corporate-requests/${requestId}/cancel`, adminAtOne, 'POST'))
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.corporate_request.status, 'cancelled')
      const row = await requestRow(requestId)
      assert.equal(row.status, 'cancelled')
      assert.ok(row.resolvedAt)
      assert.equal(row.resolvedByStaffId, adminAtOne.staffId)
      assert.equal((await sessionsFrom(requestId)).length, 0)
    })

    test('CORP-11 cancelling a scheduled request cancels the request and its corporate session', async () => {
      const { requestId, sessionId } = await scheduled(teacherB, elsewhereAtOne)
      const res = await json(await admin(`/corporate-requests/${requestId}/cancel`, adminAtOne, 'POST'))
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.corporate_request.status, 'cancelled')

      assert.equal((await requestRow(requestId)).status, 'cancelled')
      const session = await sessionRow(sessionId)
      assert.equal(session.lifecycle, 'cancelled')
      assert.equal(session.cancelledByStaffId, adminAtOne.staffId)

      // The cancelled session no longer holds the room or the instructor.
      const next = await request(otherMemberAtOne)
      const retake = await schedule(adminAtOne, next, {
        main_instructor_id: teacherB.staffId,
        location_id: elsewhereAtOne.locationId,
        room_id: session.roomId!,
        starts_at: session.startsAt.toISOString(),
        ends_at: session.endsAt.toISOString(),
      })
      assert.equal(retake.status, 201, JSON.stringify(retake.body))
    })

    test('a member and an instructor are refused the corporate request routes', async () => {
      const requestId = await request(memberAtOne)
      for (const who of [memberAtOne, teacherA]) {
        const expect = who === teacherA ? asInstructor : asMember
        const calls: Array<[string, string, unknown?]> = [
          ['/corporate-requests', 'GET'],
          [`/corporate-requests/${requestId}`, 'GET'],
          [`/corporate-requests/${requestId}/schedule`, 'POST', at(hereAtOne, teacherC, slot())],
          [`/corporate-requests/${requestId}/cancel`, 'POST'],
          [`/corporate-requests/${requestId}/attended`, 'POST'],
        ]
        for (const [path, method, body] of calls) {
          await expect(await admin(path, who, method, body), `${method} ${path}`)
        }
      }
      assert.equal((await requestRow(requestId)).status, 'pending')
      assert.equal((await sessionsFrom(requestId)).length, 0)
    })

    test("another studio's admin cannot read, schedule, cancel or close a request", async () => {
      const requestId = await request(memberAtOne)
      const listed = await json(await admin('/corporate-requests?status=all', adminAtTwo))
      assert.equal(listed.status, 200)
      assert.ok(!listed.body.corporate_requests.some((r: { id: string }) => r.id === requestId))

      assert.equal((await admin(`/corporate-requests/${requestId}`, adminAtTwo)).status, 404)
      const sched = await schedule(adminAtTwo, requestId, at(placeAtTwo, teacherAtTwo, slot()))
      assert.equal(sched.status, 404, JSON.stringify(sched.body))
      assert.equal((await admin(`/corporate-requests/${requestId}/cancel`, adminAtTwo, 'POST')).status, 404)
      assert.equal((await admin(`/corporate-requests/${requestId}/attended`, adminAtTwo, 'POST')).status, 404)

      const row = await requestRow(requestId)
      assert.equal(row.status, 'pending')
      assert.equal(row.resolvedAt, null)
      assert.equal((await sessionsFrom(requestId)).length, 0)
    })
  })

  // ---------------------------------------------------------------------------
  // Corporate sessions
  // ---------------------------------------------------------------------------

  describe('corporate sessions', () => {
    test('an admin lists, reads and cancels a corporate session', async () => {
      const { sessionId } = await scheduled(teacherC, elsewhereAtOne)
      const session = await sessionRow(sessionId)

      const listed = await json(
        await admin(
          `/corporate-sessions?from=${new Date(session.startsAt.getTime() - HOUR).toISOString()}&to=${new Date(session.endsAt.getTime() + HOUR).toISOString()}`,
          adminAtOne,
        ),
      )
      assert.equal(listed.status, 200, JSON.stringify(listed.body))
      const entry = listed.body.corporate_sessions.find((s: { id: string }) => s.id === sessionId)
      assert.ok(entry, 'the session is listed')
      assert.equal(entry.client_name, memberAtOne.name)

      const read = await json(await admin(`/corporate-sessions/${sessionId}`, adminAtOne))
      assert.equal(read.status, 200)
      assert.equal(read.body.corporate_session.lifecycle, 'active')

      const cancelled = await json(await admin(`/corporate-sessions/${sessionId}/cancel`, adminAtOne, 'POST'))
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
      assert.equal(cancelled.body.corporate_session.lifecycle, 'cancelled')
      assert.equal((await sessionRow(sessionId)).lifecycle, 'cancelled')
    })

    test('a member and an instructor are refused the corporate session routes', async () => {
      const { sessionId } = await scheduled(teacherA, elsewhereAtOne)
      for (const who of [memberAtOne, teacherA]) {
        const expect = who === teacherA ? asInstructor : asMember
        for (const [path, method] of [
          ['/corporate-sessions', 'GET'],
          [`/corporate-sessions/${sessionId}`, 'GET'],
          [`/corporate-sessions/${sessionId}/cancel`, 'POST'],
        ] as const) {
          await expect(await admin(path, who, method), `${method} ${path}`)
        }
      }
      assert.equal((await sessionRow(sessionId)).lifecycle, 'active')
    })

    test("another studio's admin cannot read, move or cancel a corporate session", async () => {
      const { requestId, sessionId } = await scheduled(teacherB, hereAtOne)
      const before = await sessionRow(sessionId)

      const listed = await json(await admin('/corporate-sessions', adminAtTwo))
      assert.equal(listed.status, 200)
      assert.ok(!listed.body.corporate_sessions.some((s: { id: string }) => s.id === sessionId))
      assert.equal((await admin(`/corporate-sessions/${sessionId}`, adminAtTwo)).status, 404)
      const moved = await admin(`/corporate-sessions/${sessionId}`, adminAtTwo, 'PATCH', {
        starts_at: new Date(before.startsAt.getTime() + HOUR).toISOString(),
        ends_at: new Date(before.endsAt.getTime() + HOUR).toISOString(),
      })
      assert.equal(moved.status, 404)
      assert.equal((await admin(`/corporate-sessions/${sessionId}/cancel`, adminAtTwo, 'POST')).status, 404)

      const now = await sessionRow(sessionId)
      assert.equal(now.lifecycle, 'active')
      assert.equal(now.startsAt.toISOString(), before.startsAt.toISOString())
      assert.equal((await requestRow(requestId)).status, 'scheduled')
    })

    test('CORP-12 an admin cannot create a corporate session directly with a freeform client name (BUG: POST /corporate-sessions still exists)', async () => {
      const freeform = `${TAG} Freeform Client`
      const res = await admin('/corporate-sessions', adminAtOne, 'POST', {
        corporate_package_id: packageAtOne,
        client_name: freeform,
        main_instructor_id: teacherC.staffId,
        location_id: hereAtOne.locationId,
        room_id: hereAtOne.roomId,
        ...(() => {
          const when = slot()
          return { starts_at: when.startsAt.toISOString(), ends_at: when.endsAt.toISOString() }
        })(),
      })
      const text = await res.text()
      const made = await harness.db
        .select({ id: schema.corporateSessions.id })
        .from(schema.corporateSessions)
        .where(eq(schema.corporateSessions.clientName, freeform))
      assert.equal(made.length, 0, `a corporate session was created with a freeform client name (${res.status}): ${text}`)
      assert.equal(res.status, 404, `expected no such route, got ${res.status}: ${text}`)
    })
  })
})
