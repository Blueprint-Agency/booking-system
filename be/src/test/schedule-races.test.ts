import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, like, sql, type SQL } from 'drizzle-orm'
import {
  inTenantContext,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * Two scheduling writes that need the same instructor, room or class seats,
 * made at once, over real HTTP with real sign-in: one of them is decided after
 * the other has committed, and so sees it.
 *
 * Each race is made to happen every run, not by luck of timing. The test holds
 * a row lock that every write in the race reaches before it commits, fires the
 * first write and waits until Postgres shows it queued behind that lock, then
 * fires the second and waits the same way, and only then lets go. Both writes
 * are in flight together, so a check that reads without the lock its rival
 * takes passes for both of them.
 *
 * Every room, class type, instructor and member here is this run's own, on a
 * random far-future day, so no other file's rows can clash with these.
 */
describe('scheduling writes made at once', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const DOMAIN = `schedule-races-${run}.test`
  const TAG = `schrace-${run}`
  const at = (name: string) => `${name}@${DOMAIN}`
  const HOUR = 3_600_000
  const DAY = 24 * HOUR

  type Staff = { headers: Record<string, string>; id: string; name: string }
  type Member = { clientId: string; headers: Record<string, string> }

  let tenantId!: string
  let locationId!: string
  let roomA!: string
  let roomB!: string
  let classTypeId!: string
  let classPackageId!: string
  let admin!: Staff
  let teacher!: Staff
  let colleague!: Staff

  const staffIds: string[] = []
  const roomIds: string[] = []

  const addDays = (from: string, n: number) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
  const BASE = addDays(new Date().toISOString().slice(0, 10), 600 + Math.floor(Math.random() * 3000))
  const day = (n: number) => addDays(BASE, n)
  const sg = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString()

  type Res = { status: number; body: Record<string, any> }
  const send = async (path: string, headers: Record<string, string>, method: string, body: unknown): Promise<Res> => {
    const res = await harness.app.request(`/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : {} }
  }

  const staffAt = async (name: string, role: 'admin' | 'instructor'): Promise<Staff> => {
    const tenant = harness.tenants.one
    const email = at(`${name}-${tenant.slug}`)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const display = `${name} ${run}`
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: display, role, status: 'active', authUserId: user!.id })
      .returning()
    staffIds.push(row!.id)
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { headers, id: row!.id, name: display }
  }

  const member = async (name: string): Promise<Member> => {
    const email = at(name)
    const headers = await harness.signInAs('client', email, harness.tenants.one)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    await purchaseSvc.grantPackage(tenantId, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: classPackageId,
    })
    return { clientId: client!.id, headers }
  }

  const ptRequest = async (who: Member) => {
    const [row] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId,
        clientId: who.clientId,
        classTypeId,
        locationId,
        sessionType: '1on1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 30 * DAY),
        message: TAG,
      })
      .returning()
    return row!.id
  }

  const schedulePt = (requestId: string, who: Staff, room: string, date: string) => () =>
    send(`/portal/admin/pt-sessions/${requestId}/schedule`, admin.headers, 'POST', {
      instructor_id: who.id,
      location_id: locationId,
      room_id: room,
      starts_at: sg(date, '10:00'),
      ends_at: sg(date, '11:00'),
      instructor_pay_sgd: 40,
    })

  const classBody = (who: Staff, room: string, startsAt: string, endsAt: string, capacityOnline = 10) => ({
    class_type_id: classTypeId,
    main_instructor_id: who.id,
    location_id: locationId,
    room_id: room,
    starts_at: startsAt,
    ends_at: endsAt,
    capacity_online: capacityOnline,
    credit_cost: 1,
    instructor_pay_sgd: 50,
  })

  const createClass = (body: Record<string, unknown>) => () =>
    send('/portal/admin/schedule/classes', admin.headers, 'POST', body)

  const book = (who: Member, classId: string) => () =>
    send('/me/bookings/class', who.headers, 'POST', { class_id: classId })

  const teachingOn = async (instructorId: string, date: string) => {
    const from = sg(date, '00:00')
    const to = sg(addDays(date, 1), '00:00')
    const [row] = await harness.db.execute<{ n: number }>(sql`
      SELECT (
        (SELECT count(*) FROM pt_sessions WHERE instructor_id = ${instructorId} AND lifecycle = 'active'
           AND starts_at >= ${from}::timestamptz AND starts_at < ${to}::timestamptz)
        + (SELECT count(*) FROM classes WHERE main_instructor_id = ${instructorId} AND lifecycle = 'active'
           AND starts_at >= ${from}::timestamptz AND starts_at < ${to}::timestamptz)
      )::int AS n`)
    return row!.n
  }

  const sessionsInRoom = async (roomId: string, date: string) => {
    const [row] = await harness.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM pt_sessions WHERE room_id = ${roomId} AND lifecycle = 'active'
        AND starts_at >= ${sg(date, '00:00')}::timestamptz AND starts_at < ${sg(addDays(date, 1), '00:00')}::timestamptz`)
    return row!.n
  }

  async function inFlightTogether(lock: SQL, calls: (() => Promise<Res>)[]): Promise<Res[]> {
    const pending = await harness.db.transaction(async tx => {
      const held = await tx.execute(sql`${lock} FOR UPDATE`)
      assert.equal(held.length, 1, 'the row to hold exists')
      const [holder] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      assert.ok(holder)
      const started: Promise<Res>[] = []
      for (const call of calls) {
        let answered: Res | null = null
        const response = call().then(res => (answered = res))
        started.push(response)
        const deadline = Date.now() + 10_000
        for (;;) {
          const [queue] = await tx.execute<{ n: number }>(sql`
            WITH RECURSIVE queue(pid) AS (
              SELECT pid FROM pg_locks WHERE NOT granted AND ${holder.pid}::int = ANY(pg_blocking_pids(pid))
              UNION
              SELECT l.pid FROM pg_locks l, queue q WHERE NOT l.granted AND q.pid = ANY(pg_blocking_pids(l.pid))
            )
            SELECT count(DISTINCT pid)::int AS n FROM queue`)
          if (queue!.n >= started.length) break
          assert.equal(answered, null, `call ${started.length} answered before it queued: ${JSON.stringify(answered)}`)
          assert.ok(Date.now() < deadline, `call ${started.length} never queued behind the held row`)
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }
      return started
    })
    return Promise.all(pending)
  }

  const instructorRow = (id: string) => sql`SELECT staff_user_id FROM instructors WHERE staff_user_id = ${id}`
  const roomRow = (id: string) => sql`SELECT id FROM rooms WHERE id = ${id}`
  const classRow = (id: string) => sql`SELECT id FROM classes WHERE id = ${id}`
  const ptSessionRow = (id: string) => sql`SELECT id FROM pt_sessions WHERE id = ${id}`

  const workshopIds: string[] = []
  const workshop = async (name: string) => {
    const res = await send('/portal/admin/workshops', admin.headers, 'POST', {
      name: `${TAG} ${name}`,
      location_id: locationId,
      main_instructor_id: teacher.id,
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    workshopIds.push(res.body.id)
    return res.body.id as string
  }
  const workshopDay = (ref: string, room: string, date: string, from: string, to: string) => ({
    ref,
    room_id: room,
    starts_at: sg(date, from),
    ends_at: sg(date, to),
    capacity_online: 10,
  })
  const saveSchedule = (workshopId: string, days: ReturnType<typeof workshopDay>[]) => () =>
    send(`/portal/admin/workshops/${workshopId}/schedule`, admin.headers, 'PUT', { days, tiers: [] })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    tenantId = harness.tenants.one.id
    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenantId))
      .limit(1)
    assert.ok(location, 'the fixture studio has a seeded location')
    locationId = location.id
    const [a, b] = await harness.db
      .insert(schema.rooms)
      .values([
        { tenantId, locationId, name: `${TAG} Room A`, capacity: 20 },
        { tenantId, locationId, name: `${TAG} Room B`, capacity: 20 },
      ])
      .returning()
    roomA = a!.id
    roomB = b!.id
    roomIds.push(roomA, roomB)
    const [type] = await harness.db.insert(schema.classTypes).values({ tenantId, name: `${TAG} Hatha` }).returning()
    classTypeId = type!.id

    admin = await staffAt('admin', 'admin')
    teacher = await staffAt('teacher', 'instructor')
    colleague = await staffAt('colleague', 'instructor')

    const pkg = await classPackagesSvc.createClassPackage(tenantId, {
      name: `${TAG} bundle`,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    classPackageId = pkg.id
  })

  after(async () => {
    if (!harness) return
    const db = harness.db
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${`%@${DOMAIN}`}`
    const ourClasses = sql`SELECT id FROM classes WHERE class_type_id = ${classTypeId ?? null}`
    const ourPtRequests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
    const ourPtSessions = sql`SELECT id FROM pt_sessions WHERE pt_request_id IN (${ourPtRequests})`
    const failures: unknown[] = []
    const attempt = async (step: () => Promise<unknown>) => {
      try {
        await step()
      } catch (err) {
        failures.push(err)
      }
    }
    const cleanup = (q: SQL) => attempt(() => db.execute(q))
    await cleanup(
      sql`DELETE FROM email_log WHERE recipient_email LIKE ${`%@${DOMAIN}`}
            OR (template_slug LIKE 'leave_%' AND body_rendered LIKE ${`%${run}%`})`,
    )
    await cleanup(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
    await cleanup(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await cleanup(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${ourPtRequests})`)
    await cleanup(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await cleanup(sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${ourPtSessions})`)
    await cleanup(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (${ourPtSessions})`)
    await cleanup(sql`DELETE FROM pt_sessions WHERE id IN (${ourPtSessions})`)
    await cleanup(sql`DELETE FROM pt_requests WHERE id IN (${ourPtRequests})`)
    await cleanup(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    if (classPackageId) await cleanup(sql`DELETE FROM class_packages WHERE id = ${classPackageId}`)
    if (workshopIds.length) {
      await attempt(() => db.delete(schema.workshopTiers).where(inArray(schema.workshopTiers.workshopId, workshopIds)))
      await attempt(() => db.delete(schema.workshopDays).where(inArray(schema.workshopDays.workshopId, workshopIds)))
      await attempt(() => db.delete(schema.workshopImages).where(inArray(schema.workshopImages.workshopId, workshopIds)))
      await attempt(() =>
        db.delete(schema.workshopInstructors).where(inArray(schema.workshopInstructors.workshopId, workshopIds)),
      )
      await attempt(() => db.delete(schema.workshops).where(inArray(schema.workshops.id, workshopIds)))
    }
    if (classTypeId) {
      await cleanup(sql`DELETE FROM class_supporting_instructors WHERE class_id IN (${ourClasses})`)
      await cleanup(sql`DELETE FROM classes WHERE id IN (${ourClasses})`)
      await cleanup(sql`DELETE FROM class_types WHERE id = ${classTypeId}`)
    }
    if (roomIds.length) await attempt(() => db.delete(schema.rooms).where(inArray(schema.rooms.id, roomIds)))
    await cleanup(sql`DELETE FROM clients WHERE email LIKE ${`%@${DOMAIN}`}`)
    if (staffIds.length) {
      await attempt(() => db.delete(schema.leaveRequests).where(inArray(schema.leaveRequests.staffUserId, staffIds)))
      await attempt(() => db.delete(schema.leavePools).where(inArray(schema.leavePools.staffUserId, staffIds)))
      await attempt(() => db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds)))
      await attempt(() => db.delete(schema.instructors).where(inArray(schema.instructors.staffUserId, staffIds)))
      await attempt(() => db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds)))
    }
    await attempt(() => db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`)))
    await attempt(() => db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`)))
    await harness.close()
    if (failures.length > 0) throw new AggregateError(failures, `schedule-races cleanup: ${failures.length} step(s) failed`)
  })

  test('PT-131 two PT requests scheduled at once onto one instructor at the same time: one is scheduled, the other is refused schedule_conflict and stays pending', async () => {
    const date = day(0)
    const first = await ptRequest(await member('pt-one'))
    const second = await ptRequest(await member('pt-two'))
    const [won, lost] = await inFlightTogether(instructorRow(teacher.id), [
      schedulePt(first, teacher, roomA, date),
      schedulePt(second, teacher, roomB, date),
    ])
    assert.equal(won!.status, 201, JSON.stringify(won!.body))
    assert.equal(lost!.status, 409, JSON.stringify(lost!.body))
    assert.equal(lost!.body.error, 'schedule_conflict')
    assert.equal(lost!.body.subject, 'instructor')
    assert.equal(lost!.body.subject_id, teacher.id)
    assert.equal(await teachingOn(teacher.id, date), 1, 'the instructor teaches one session then')
    const [stillPending] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, second))
    assert.equal(stillPending!.status, 'pending')
  })

  test('PT-131 two PT requests scheduled at once into one room at the same time, with different instructors: one is scheduled, the other is refused schedule_conflict and stays pending', async () => {
    const date = day(1)
    const first = await ptRequest(await member('pt-three'))
    const second = await ptRequest(await member('pt-four'))
    const [won, lost] = await inFlightTogether(roomRow(roomA), [
      schedulePt(first, teacher, roomA, date),
      schedulePt(second, colleague, roomA, date),
    ])
    assert.equal(won!.status, 201, JSON.stringify(won!.body))
    assert.equal(lost!.status, 409, JSON.stringify(lost!.body))
    assert.equal(lost!.body.error, 'schedule_conflict')
    assert.equal(lost!.body.subject, 'room')
    assert.equal(lost!.body.subject_id, roomA)
    assert.equal(await sessionsInRoom(roomA, date), 1, 'the room holds one session then')
    const [stillPending] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, second))
    assert.equal(stillPending!.status, 'pending')
  })

  test('SCH-31 a PT session and a class saved at once for one instructor at the same time: one is saved, the other is refused schedule_conflict', async () => {
    const date = day(3)
    const request = await ptRequest(await member('pt-five'))
    const [pt, cls] = await inFlightTogether(instructorRow(teacher.id), [
      schedulePt(request, teacher, roomA, date),
      createClass(classBody(teacher, roomB, sg(date, '10:30'), sg(date, '11:30'))),
    ])
    assert.equal(pt!.status, 201, JSON.stringify(pt!.body))
    assert.equal(cls!.status, 409, JSON.stringify(cls!.body))
    assert.equal(cls!.body.error, 'schedule_conflict')
    assert.equal(cls!.body.subject, 'instructor')
    assert.equal(cls!.body.subject_id, teacher.id)
    assert.equal(await teachingOn(teacher.id, date), 1, 'the instructor teaches one session then')
  })

  test('SEAT-06 a member books the last online seat while an Admin cuts online capacity below it: the booking stands and the cut is refused capacity_below_bookings', async () => {
    const startsAt = new Date(Date.now() + 2 * DAY)
    const created = await createClass(
      classBody(teacher, roomB, startsAt.toISOString(), new Date(startsAt.getTime() + HOUR).toISOString(), 2),
    )()
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const classId = created.body.id as string
    const seated = await book(await member('seat-one'), classId)()
    assert.equal(seated.status, 201, JSON.stringify(seated.body))

    const [booking, cut] = await inFlightTogether(classRow(classId), [
      book(await member('seat-two'), classId),
      () => send(`/portal/admin/schedule/classes/${classId}`, admin.headers, 'PATCH', { capacity_online: 1 }),
    ])
    assert.equal(booking!.status, 201, JSON.stringify(booking!.body))
    assert.equal(cut!.status, 409, JSON.stringify(cut!.body))
    assert.equal(cut!.body.error, 'capacity_below_bookings')
    assert.equal(cut!.body.confirmed, 2)

    const [row] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, classId))
    assert.equal(row!.capacityOnline, 2, 'online capacity is left as it was')
    const online = await harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.classId, classId), eq(schema.bookings.state, 'confirmed'), eq(schema.bookings.seat, 'online')))
    assert.equal(online.length, 2)
  })

  test('LEV-137 an instructor files leave for a day while an Admin saves him a class that day: the leave is filed and the class is refused, as he is on leave', async () => {
    const date = day(5)
    const [filed, cls] = await inFlightTogether(instructorRow(teacher.id), [
      () => send('/portal/leave', teacher.headers, 'POST', { type: 'annual', start_date: date, end_date: date, reason: `${TAG} leave` }),
      createClass(classBody(teacher, roomB, sg(date, '10:00'), sg(date, '11:00'))),
    ])
    assert.equal(filed!.status, 201, JSON.stringify(filed!.body))
    assert.equal(cls!.status, 409, JSON.stringify(cls!.body))
    assert.equal(cls!.body.error, 'schedule_conflict')
    assert.equal(cls!.body.subject_id, teacher.id)
    assert.equal(cls!.body.conflicts[0].kind, 'leave')
    assert.equal(await teachingOn(teacher.id, date), 0, 'no class was saved on his leave')
  })

  test('SCH-32 two classes saved at once into one room, the second naming the room id in upper case: one is saved, the other is refused schedule_conflict', async () => {
    const date = day(7)
    const [first, second] = await inFlightTogether(roomRow(roomA), [
      createClass(classBody(teacher, roomA, sg(date, '10:00'), sg(date, '11:00'))),
      createClass(classBody(colleague, roomA.toUpperCase(), sg(date, '10:30'), sg(date, '11:30'))),
    ])
    assert.equal(first!.status, 201, JSON.stringify(first!.body))
    assert.equal(second!.status, 409, JSON.stringify(second!.body))
    assert.equal(second!.body.error, 'schedule_conflict')
    assert.equal(second!.body.subject, 'room')
    assert.equal(second!.body.subject_id, roomA)
    assert.equal(await teachingOn(colleague.id, date), 0, 'the refused class was never saved')
  })

  test('SCH-33 a class whose instructor id is sent in upper case is refused schedule_conflict while that instructor already teaches then', async () => {
    const date = day(8)
    const first = await createClass(classBody(teacher, roomA, sg(date, '10:00'), sg(date, '11:00')))()
    assert.equal(first.status, 201, JSON.stringify(first.body))
    const second = await createClass({
      ...classBody(teacher, roomB, sg(date, '10:30'), sg(date, '11:30')),
      main_instructor_id: teacher.id.toUpperCase(),
    })()
    assert.equal(second.status, 409, JSON.stringify(second.body))
    assert.equal(second.body.error, 'schedule_conflict')
    assert.equal(second.body.subject, 'instructor')
    assert.equal(second.body.subject_id, teacher.id)
    assert.equal(await teachingOn(teacher.id, date), 1, 'the instructor teaches one class then')
  })

  test('WSP-22 two workshop schedules naming the same two rooms in opposite order, saved at once: both are saved', async () => {
    const one = await workshop('one')
    const two = await workshop('two')
    const [first, second] = [day(10), day(11)]
    const [savedOne, savedTwo] = await inFlightTogether(roomRow(roomA), [
      saveSchedule(one, [
        workshopDay('first', roomA, first, '09:00', '10:00'),
        workshopDay('second', roomB, second, '09:00', '10:00'),
      ]),
      saveSchedule(two, [
        workshopDay('first', roomB, first, '12:00', '13:00'),
        workshopDay('second', roomA, second, '12:00', '13:00'),
      ]),
    ])
    assert.equal(savedOne!.status, 200, JSON.stringify(savedOne!.body))
    assert.equal(savedTwo!.status, 200, JSON.stringify(savedTwo!.body))
    assert.equal(savedOne!.body.days.length, 2)
    assert.equal(savedTwo!.body.days.length, 2)
  })

  test('PT-135 two edits of one PT session at once, one moving its room and one its time, never leave it in a room taken at its new time: the second is refused schedule_conflict', async () => {
    const date = day(13)
    const scheduled = await schedulePt(await ptRequest(await member('pt-six')), teacher, roomA, date)()
    assert.equal(scheduled.status, 201, JSON.stringify(scheduled.body))
    const sessionId = scheduled.body.pt_request.session.id as string
    const taken = await createClass(classBody(colleague, roomB, sg(date, '14:00'), sg(date, '15:00')))()
    assert.equal(taken.status, 201, JSON.stringify(taken.body))

    const edit = (body: Record<string, unknown>) => () =>
      send(`/portal/admin/pt-sessions/sessions/${sessionId}`, admin.headers, 'PATCH', body)
    const [moved, retimed] = await inFlightTogether(ptSessionRow(sessionId), [
      edit({ room_id: roomB }),
      edit({ starts_at: sg(date, '14:00'), ends_at: sg(date, '15:00') }),
    ])
    assert.equal(moved!.status, 200, JSON.stringify(moved!.body))
    assert.equal(retimed!.status, 409, JSON.stringify(retimed!.body))
    assert.equal(retimed!.body.error, 'schedule_conflict')
    assert.equal(retimed!.body.subject, 'room')
    assert.equal(retimed!.body.subject_id, roomB)
    const [row] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.id, sessionId))
    assert.equal(row!.roomId, roomB)
    assert.equal(row!.startsAt.toISOString(), sg(date, '10:00'))
  })
})
