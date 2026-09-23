import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import {
  inTenantContext,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * Leave occupying the schedule, and an instructor cancelling his own class
 * (#204), over real HTTP with real sign-in.
 *
 * spec-instructor-leave.md §The clash rule: pending and approved leave Occupy
 * the instructor on every scheduling write path — class create/edit (admin and
 * the instructor's own), private session schedule/edit, corporate session
 * create/edit — and never occupy a room. §Days and half days: a half day is the
 * Singapore-time morning (to 13:00) or afternoon (from 13:00).
 * §Instructor-initiated class cancellation: main instructor only, a reason, no
 * notice window, the admin cancellation's refunds.
 *
 * Every room, class type, instructor and member here is this run's own, and the
 * leave dates sit on a random far-future day, so no other file's fixtures can
 * clash with these or be clashed with. Leave rows are written directly: which
 * leave an instructor has is the fixture, the scheduling refusal is the rule.
 */
describe('leave on the schedule', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let mailer!: typeof import('../lib/mailer')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const DOMAIN = `leave-scheduling-${run}.test`
  const TAG = `lvsch-${run}`
  const at = (name: string) => `${name}@${DOMAIN}`
  const HOUR = 3_600_000
  const DAY = 24 * HOUR

  type Tenant = { id: string; slug: string }
  type Staff = { headers: Record<string, string>; id: string; name: string }
  type Studio = Tenant & { locationId: string; roomId: string; otherRoomId: string; classTypeId: string }

  let one!: Studio
  let two!: Studio
  let admin!: Staff
  let teacher!: Staff // the instructor on leave, in most tests
  let colleague!: Staff // a free instructor
  let bystander!: Staff // an instructor assigned to nothing
  let adminTwo!: Staff
  let teacherTwo!: Staff
  let classPackageId!: string
  let corporatePackageId!: string

  const staffIds: string[] = []
  const classTypeIds: string[] = []
  const roomIds: string[] = []

  /* ── dates ─────────────────────────────────────────────────────────── */

  /** A plain date `n` days after `from` (YYYY-MM-DD). */
  const addDays = (from: string, n: number) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
  /** A random far-future day for this run; every leave date is an offset from it. */
  const BASE = addDays(new Date().toISOString().slice(0, 10), 600 + Math.floor(Math.random() * 3000))
  const day = (n: number) => addDays(BASE, n)
  /** `hh:mm` on `date`, Singapore studio time, as an ISO instant. */
  const sg = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString()
  /** How the refusal names a date: "12 Aug", in studio time. */
  const sgDay = (date: string) =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' }).format(
      new Date(`${date}T12:00:00+08:00`),
    )

  /* ── requests ──────────────────────────────────────────────────────── */

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

  /** The body of a leave refusal: a schedule_conflict naming the instructor, phrased as leave. */
  const assertOnLeave = (body: Record<string, any>, who: Staff, date: string) => {
    assert.equal(body.error, 'schedule_conflict')
    assert.equal(body.subject, 'instructor')
    assert.equal(body.subject_id, who.id)
    assert.equal(body.conflicts[0].kind, 'leave')
    assert.equal(body.message, `${who.name} is on leave on ${sgDay(date)}.`)
    assert.doesNotMatch(body.message, /already booked/)
  }

  /* ── fixtures ──────────────────────────────────────────────────────── */

  const staffAt = async (tenant: Tenant, name: string, role: 'admin' | 'instructor'): Promise<Staff> => {
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

  const studio = async (tenant: Tenant): Promise<Studio> => {
    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenant.id))
      .limit(1)
    assert.ok(location, `the fixture studio ${tenant.slug} has a seeded location`)
    const [room, otherRoom] = await harness.db
      .insert(schema.rooms)
      .values([
        { tenantId: tenant.id, locationId: location.id, name: `${TAG} Room A`, capacity: 20 },
        { tenantId: tenant.id, locationId: location.id, name: `${TAG} Room B`, capacity: 20 },
      ])
      .returning()
    roomIds.push(room!.id, otherRoom!.id)
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: `${TAG} Hatha` })
      .returning()
    classTypeIds.push(type!.id)
    return { ...tenant, locationId: location.id, roomId: room!.id, otherRoomId: otherRoom!.id, classTypeId: type!.id }
  }

  const leave = async (
    who: Staff,
    date: string,
    status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled' | 'revoked',
    halfDay: 'none' | 'morning' | 'afternoon' = 'none',
    tenant: Tenant = one,
  ) => {
    const [row] = await harness.db
      .insert(schema.leaveRequests)
      .values({
        tenantId: tenant.id,
        instructorId: who.id,
        type: 'annual',
        startDate: date,
        endDate: date,
        halfDay,
        days: halfDay === 'none' ? '1' : '0.5',
        leaveYear: Number(date.slice(0, 4)),
        status,
        reason: `${TAG} leave`,
      })
      .returning()
    return row!
  }

  /** The admin's class-create body: `who` teaching `from`–`to` studio time on `date`. */
  const classBody = (s: Studio, who: Staff, date: string, from = '10:00', to = '11:00', room = s.roomId) => ({
    class_type_id: s.classTypeId,
    main_instructor_id: who.id,
    location_id: s.locationId,
    room_id: room,
    starts_at: sg(date, from),
    ends_at: sg(date, to),
    capacity_online: 10,
    credit_cost: 1,
    instructor_pay_sgd: 50,
  })

  const createClass = (headers: Record<string, string>, body: Record<string, unknown>) =>
    send('/portal/admin/schedule/classes', headers, 'POST', body)

  const classRow = async (id: string) => {
    const [row] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, id))
    assert.ok(row, `no class ${id}`)
    return row
  }

  const classesOn = (s: Studio, date: string) =>
    harness.db
      .select()
      .from(schema.classes)
      .where(
        and(
          eq(schema.classes.classTypeId, s.classTypeId),
          sql`${schema.classes.startsAt} >= ${sg(date, '00:00')}::timestamptz`,
          sql`${schema.classes.startsAt} < ${sg(addDays(date, 1), '00:00')}::timestamptz`,
        ),
      )

  /** A member of studio one with a 10-credit bundle, signed in on its hostname. */
  const member = async (name: string) => {
    const email = at(name)
    const headers = await harness.signInAs('client', email, one)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: one.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    const { clientPackageId } = await purchaseSvc.grantPackage(one.id, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: classPackageId,
    })
    return { clientId: client!.id, clientPackageId, headers }
  }
  type Member = Awaited<ReturnType<typeof member>>

  const creditsLeft = async (m: Member) => {
    const [row] = await harness.db
      .select({ left: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, m.clientPackageId))
    return row!.left
  }

  const book = async (m: Member, classId: string) => {
    const body = await json(
      await harness.app.request('/api/v1/me/bookings/class', {
        method: 'POST',
        headers: { ...m.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: classId }),
      }),
      201,
    )
    return body.booking_id as string
  }

  /** A class that starts `startsIn` from now (real time — cancellation reads the wall clock). */
  const soonClass = async (who: Staff, startsIn: number, supporting: Staff[] = []) => {
    const startsAt = new Date(Date.now() + startsIn)
    return json(
      await createClass(admin.headers, {
        ...classBody(one, who, BASE),
        // Its own room: nothing else of this run is near the present.
        room_id: one.otherRoomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        supporting_instructors: supporting.map(s => ({ instructor_id: s.id, pay_sgd: 20 })),
      }),
      201,
    )
  }

  const instructorCancel = (who: { headers: Record<string, string> }, classId: string, body: unknown) =>
    send(`/portal/instructor/schedule/classes/${classId}/cancel`, who.headers, 'POST', body)

  /** A pending private-session request from a member of studio one. */
  const ptRequest = async (clientId: string) => {
    const [row] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: one.id,
        clientId,
        classTypeId: one.classTypeId,
        locationId: one.locationId,
        sessionType: '1on1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 30 * DAY),
        message: TAG,
      })
      .returning()
    return row!.id
  }

  const ptBody = (who: Staff, date: string, from = '10:00', to = '11:00') => ({
    instructor_id: who.id,
    location_id: one.locationId,
    room_id: one.roomId,
    starts_at: sg(date, from),
    ends_at: sg(date, to),
    instructor_pay_sgd: 40,
  })

  /**
   * A corporate session comes only from scheduling a member's Corporate Request
   * (CORP-12), so the fixture is the request, made on the member's own route.
   */
  const corporateRequest = async () => {
    const body = await json(
      await send('/me/corporate-requests', corporateMember.headers, 'POST', {
        package_id: corporatePackageId,
        preferred_location: `${TAG} office`,
        notes: TAG,
      }),
      201,
    )
    return body.corporate_request_id as string
  }

  const scheduleBody = (who: Staff, date: string, from = '10:00', to = '11:00') => ({
    main_instructor_id: who.id,
    location_id: one.locationId,
    room_id: one.roomId,
    starts_at: sg(date, from),
    ends_at: sg(date, to),
  })

  const scheduleCorporate = (requestId: string, body: Record<string, unknown>) =>
    send(`/portal/admin/corporate-requests/${requestId}/schedule`, admin.headers, 'POST', body)

  const corporateRequestRow = async (id: string) => {
    const [row] = await harness.db.select().from(schema.corporateRequests).where(eq(schema.corporateRequests.id, id))
    assert.ok(row, `no corporate request ${id}`)
    return row
  }

  let ptClientId!: string
  let corporateMember!: Member

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    mailer = await import('../lib/mailer')
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    admin = await staffAt(one, 'admin', 'admin')
    teacher = await staffAt(one, 'teacher', 'instructor')
    colleague = await staffAt(one, 'colleague', 'instructor')
    bystander = await staffAt(one, 'bystander', 'instructor')
    adminTwo = await staffAt(two, 'admin', 'admin')
    teacherTwo = await staffAt(two, 'teacher', 'instructor')

    const pkg = await classPackagesSvc.createClassPackage(one.id, {
      name: `${TAG} bundle`,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    classPackageId = pkg.id
    const [corp] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: one.id, name: `${TAG} corporate`, priceSgd: '500.00', createdByStaffId: admin.id })
      .returning()
    corporatePackageId = corp!.id

    ptClientId = (await member('pt-member')).clientId
    corporateMember = await member('corporate-member')
  })

  after(async () => {
    if (!harness) return
    const db = harness.db
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${`%@${DOMAIN}`}`
    const ourClasses = sql`SELECT id FROM classes WHERE class_type_id IN (${sql.join(classTypeIds.map(id => sql`${id}::uuid`), sql`, `)})`
    const ourPtRequests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
    const ourPtSessions = sql`SELECT id FROM pt_sessions WHERE pt_request_id IN (${ourPtRequests})`
    const ourCorporate = sql`SELECT id FROM corporate_sessions WHERE corporate_package_id = ${corporatePackageId ?? null}`
    // Every step is attempted, so one failure does not strand the rest of this
    // run's rows; but any failure fails the file, below, rather than passing
    // quietly and leaving rows behind for the next file to trip over.
    const failures: unknown[] = []
    const attempt = async (step: () => Promise<unknown>) => {
      try {
        await step()
      } catch (err) {
        failures.push(err)
      }
    }
    const cleanup = (q: ReturnType<typeof sql>) => attempt(() => db.execute(q))
    if (classTypeIds.length) {
      await cleanup(sql`DELETE FROM inbox_items WHERE payload->>'classId' IN (SELECT id::text FROM (${ourClasses}) c)`)
      await cleanup(sql`DELETE FROM email_log WHERE template_slug = 'instructor_cancel_class' AND body_rendered LIKE ${`%${TAG}%`}`)
    }
    await cleanup(sql`DELETE FROM email_log WHERE recipient_email LIKE ${`%@${DOMAIN}`}`)
    await cleanup(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await cleanup(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await cleanup(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${ourPtRequests})`)
    await cleanup(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await cleanup(sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${ourPtSessions})`)
    await cleanup(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (${ourPtSessions})`)
    await cleanup(sql`DELETE FROM pt_sessions WHERE id IN (${ourPtSessions})`)
    await cleanup(sql`DELETE FROM pt_requests WHERE id IN (${ourPtRequests})`)
    if (corporatePackageId) {
      const ourCorporateRequests = sql`SELECT id FROM corporate_requests WHERE corporate_package_id = ${corporatePackageId}`
      await cleanup(sql`DELETE FROM audit_log WHERE target_id IN (${ourCorporateRequests}) OR target_id IN (${ourCorporate})`)
      // The two tables point at each other; untie them before deleting either.
      await cleanup(sql`UPDATE corporate_requests SET scheduled_corporate_session_id = NULL WHERE id IN (${ourCorporateRequests})`)
      await cleanup(sql`UPDATE corporate_sessions SET corporate_request_id = NULL WHERE id IN (${ourCorporate})`)
      await cleanup(sql`DELETE FROM corporate_session_supporting_instructors WHERE corporate_session_id IN (${ourCorporate})`)
      await cleanup(sql`DELETE FROM corporate_sessions WHERE id IN (${ourCorporate})`)
      await cleanup(sql`DELETE FROM corporate_requests WHERE corporate_package_id = ${corporatePackageId}`)
      await cleanup(sql`DELETE FROM corporate_packages WHERE id = ${corporatePackageId}`)
    }
    await cleanup(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    if (classPackageId) await cleanup(sql`DELETE FROM class_packages WHERE id = ${classPackageId}`)
    if (classTypeIds.length) {
      await cleanup(sql`DELETE FROM class_supporting_instructors WHERE class_id IN (${ourClasses})`)
      await cleanup(sql`DELETE FROM classes WHERE id IN (${ourClasses})`)
      await attempt(() => db.delete(schema.classTypes).where(inArray(schema.classTypes.id, classTypeIds)))
    }
    if (roomIds.length) await attempt(() => db.delete(schema.rooms).where(inArray(schema.rooms.id, roomIds)))
    await cleanup(sql`DELETE FROM clients WHERE email LIKE ${`%@${DOMAIN}`}`)
    if (staffIds.length) {
      await attempt(() => db.delete(schema.leaveRequests).where(inArray(schema.leaveRequests.instructorId, staffIds)))
      await attempt(() => db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds)))
      await attempt(() => db.delete(schema.instructors).where(inArray(schema.instructors.staffUserId, staffIds)))
      await attempt(() => db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds)))
    }
    await attempt(() => db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`)))
    await attempt(() => db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`)))
    await harness.close()
    if (failures.length > 0) throw new AggregateError(failures, `leave-scheduling cleanup: ${failures.length} step(s) failed`)
  })

  /* ── leave occupies the instructor ─────────────────────────────────── */

  test('LEV-93 an admin cannot create a class on a day the instructor has approved leave, and is told he is on leave', async () => {
    const date = day(0)
    await leave(teacher, date, 'approved')

    const body = await json(await createClass(admin.headers, classBody(one, teacher, date, '09:00', '10:00')), 409)
    assertOnLeave(body, teacher, date)
    assert.equal((await classesOn(one, date)).length, 0, 'no class was saved')
  })

  test('LEV-94 pending leave occupies him too: rostered as main or as supporting, the save is refused', async () => {
    const pendingDate = day(1)
    await leave(teacher, pendingDate, 'pending')
    assertOnLeave(await json(await createClass(admin.headers, classBody(one, teacher, pendingDate)), 409), teacher, pendingDate)
    const asSupporting = await json(
      await createClass(admin.headers, {
        ...classBody(one, colleague, pendingDate),
        supporting_instructors: [{ instructor_id: teacher.id, pay_sgd: 20 }],
      }),
      409,
    )
    assertOnLeave(asSupporting, teacher, pendingDate)

    // And approved leave, rostered as a supporting instructor.
    const approvedDate = day(2)
    await leave(teacher, approvedDate, 'approved')
    assertOnLeave(
      await json(
        await createClass(admin.headers, {
          ...classBody(one, colleague, approvedDate),
          supporting_instructors: [{ instructor_id: teacher.id, pay_sgd: 20 }],
        }),
        409,
      ),
      teacher,
      approvedDate,
    )
    assert.equal((await classesOn(one, pendingDate)).length, 0)
    assert.equal((await classesOn(one, approvedDate)).length, 0)
  })

  test('LEV-95 rejected, withdrawn, cancelled and revoked leave does not occupy him: the class is saved', async () => {
    const statuses = ['rejected', 'withdrawn', 'cancelled', 'revoked'] as const
    for (const [i, status] of statuses.entries()) {
      const date = day(10 + i)
      await leave(teacher, date, status)
      const created = await json(await createClass(admin.headers, classBody(one, teacher, date)), 201)
      assert.equal(created.main_instructor_id, teacher.id, `${status} leave left him assignable`)
    }
    // As a supporting instructor too.
    const date = day(14)
    await leave(teacher, date, 'revoked')
    const created = await json(
      await createClass(admin.headers, {
        ...classBody(one, colleague, date),
        supporting_instructors: [{ instructor_id: teacher.id, pay_sgd: 20 }],
      }),
      201,
    )
    assert.deepEqual(created.supporting_instructor_ids, [teacher.id])
  })

  test('LEV-96 editing a class so that it lands on his leave is refused, and the class is left as it was', async () => {
    const leaveDate = day(20)
    await leave(teacher, leaveDate, 'approved')

    // Moving his class onto the leave day.
    const his = await json(await createClass(admin.headers, classBody(one, teacher, day(21))), 201)
    assertOnLeave(
      await json(
        await send(`/portal/admin/schedule/classes/${his.id}`, admin.headers, 'PATCH', {
          starts_at: sg(leaveDate, '10:00'),
          ends_at: sg(leaveDate, '11:00'),
        }),
        409,
      ),
      teacher,
      leaveDate,
    )
    assert.equal((await classRow(his.id)).startsAt.toISOString(), sg(day(21), '10:00'))

    // Handing a class on the leave day to him.
    const theirs = await json(await createClass(admin.headers, classBody(one, colleague, leaveDate, '15:00', '16:00')), 201)
    assertOnLeave(
      await json(
        await send(`/portal/admin/schedule/classes/${theirs.id}`, admin.headers, 'PATCH', {
          main_instructor_id: teacher.id,
        }),
        409,
      ),
      teacher,
      leaveDate,
    )
    assert.equal((await classRow(theirs.id)).mainInstructorId, colleague.id)

    // Adding him as a supporting instructor on it.
    assertOnLeave(
      await json(
        await send(`/portal/admin/schedule/classes/${theirs.id}`, admin.headers, 'PATCH', {
          supporting_instructors: [{ instructor_id: teacher.id, pay_sgd: 20 }],
        }),
        409,
      ),
      teacher,
      leaveDate,
    )
    const supporting = await harness.db
      .select()
      .from(schema.classSupportingInstructors)
      .where(eq(schema.classSupportingInstructors.classId, theirs.id))
    assert.equal(supporting.length, 0)
  })

  test('LEV-97 a private session scheduled or edited onto his pending or approved leave is refused', async () => {
    for (const [i, status] of (['pending', 'approved'] as const).entries()) {
      const leaveDate = day(30 + i * 3)
      await leave(teacher, leaveDate, status)

      // Scheduling a request onto the leave day.
      const requestId = await ptRequest(ptClientId)
      assertOnLeave(
        await json(await send(`/portal/admin/pt-sessions/${requestId}/schedule`, admin.headers, 'POST', ptBody(teacher, leaveDate)), 409),
        teacher,
        leaveDate,
      )
      const [still] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, requestId))
      assert.equal(still!.status, 'pending', `${status}: the request is still waiting to be scheduled`)

      // Scheduled on a free day, then moved onto the leave day.
      const freeDay = day(30 + i * 3 + 1)
      await json(await send(`/portal/admin/pt-sessions/${requestId}/schedule`, admin.headers, 'POST', ptBody(teacher, freeDay)), 201)
      const [session] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.ptRequestId, requestId))
      assert.ok(session)
      assertOnLeave(
        await json(
          await send(`/portal/admin/pt-sessions/sessions/${session.id}`, admin.headers, 'PATCH', {
            starts_at: sg(leaveDate, '10:00'),
            ends_at: sg(leaveDate, '11:00'),
          }),
          409,
        ),
        teacher,
        leaveDate,
      )

      // A colleague's session on the leave day, handed to him.
      const otherId = await ptRequest(ptClientId)
      await json(
        await send(`/portal/admin/pt-sessions/${otherId}/schedule`, admin.headers, 'POST', ptBody(colleague, leaveDate, '15:00', '16:00')),
        201,
      )
      const [other] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.ptRequestId, otherId))
      assertOnLeave(
        await json(await send(`/portal/admin/pt-sessions/sessions/${other!.id}`, admin.headers, 'PATCH', { instructor_id: teacher.id }), 409),
        teacher,
        leaveDate,
      )
      const [after] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.id, other!.id))
      assert.equal(after!.instructorId, colleague.id)
      const [moved] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.id, session.id))
      assert.equal(moved!.startsAt.toISOString(), sg(freeDay, '10:00'))
    }
  })

  test('LEV-98 a corporate session created or edited onto his pending or approved leave is refused', async () => {
    for (const [i, status] of (['pending', 'approved'] as const).entries()) {
      const leaveDate = day(40 + i * 3)
      await leave(teacher, leaveDate, status)

      // Creating: scheduling a request onto his leave day.
      const requestId = await corporateRequest()
      assertOnLeave(await json(await scheduleCorporate(requestId, scheduleBody(teacher, leaveDate)), 409), teacher, leaveDate)
      const unscheduled = await corporateRequestRow(requestId)
      assert.equal(unscheduled.status, 'pending', `${status}: the request is still waiting to be scheduled`)
      assert.equal(unscheduled.scheduledCorporateSessionId, null)
      const fromRequest = await harness.db
        .select()
        .from(schema.corporateSessions)
        .where(eq(schema.corporateSessions.corporateRequestId, requestId))
      assert.equal(fromRequest.length, 0, 'no session was saved on his leave day')

      // Editing: the same request scheduled on a free day, then moved onto the leave day.
      const freeDay = day(40 + i * 3 + 1)
      await json(await scheduleCorporate(requestId, scheduleBody(teacher, freeDay)), 201)
      const hisId = (await corporateRequestRow(requestId)).scheduledCorporateSessionId
      assert.ok(hisId, 'scheduling made his session')
      assertOnLeave(
        await json(
          await send(`/portal/admin/corporate-sessions/${hisId}`, admin.headers, 'PATCH', {
            starts_at: sg(leaveDate, '10:00'),
            ends_at: sg(leaveDate, '11:00'),
          }),
          409,
        ),
        teacher,
        leaveDate,
      )

      // Editing: a colleague's session on the leave day, handed to him.
      const otherRequestId = await corporateRequest()
      await json(await scheduleCorporate(otherRequestId, scheduleBody(colleague, leaveDate, '15:00', '16:00')), 201)
      const theirsId = (await corporateRequestRow(otherRequestId)).scheduledCorporateSessionId
      assert.ok(theirsId, "scheduling made the colleague's session")
      assertOnLeave(
        await json(
          await send(`/portal/admin/corporate-sessions/${theirsId}`, admin.headers, 'PATCH', {
            main_instructor_id: teacher.id,
          }),
          409,
        ),
        teacher,
        leaveDate,
      )
      const [kept] = await harness.db
        .select()
        .from(schema.corporateSessions)
        .where(eq(schema.corporateSessions.id, theirsId))
      assert.equal(kept!.mainInstructorId, colleague.id)
      const [unmoved] = await harness.db
        .select()
        .from(schema.corporateSessions)
        .where(eq(schema.corporateSessions.id, hisId))
      assert.equal(unmoved!.startsAt.toISOString(), sg(freeDay, '10:00'))
    }
  })

  test('LEV-99 an instructor cannot create a class for himself on a day he has leave', async () => {
    const date = day(50)
    await leave(teacher, date, 'pending')
    const res = await send('/portal/instructor/schedule/classes', teacher.headers, 'POST', {
      class_type_id: one.classTypeId,
      location_id: one.locationId,
      room_id: one.roomId,
      starts_at: sg(date, '18:00'),
      ends_at: sg(date, '19:00'),
      capacity_online: 10,
      credit_cost: 1,
    })
    assertOnLeave(await json(res, 409), teacher, date)
    assert.equal((await classesOn(one, date)).length, 0)

    // The day after is free, and his own class there is saved.
    const free = await json(
      await send('/portal/instructor/schedule/classes', teacher.headers, 'POST', {
        class_type_id: one.classTypeId,
        location_id: one.locationId,
        room_id: one.roomId,
        starts_at: sg(day(51), '18:00'),
        ends_at: sg(day(51), '19:00'),
        capacity_online: 10,
        credit_cost: 1,
      }),
      201,
    )
    assert.equal(free.main_instructor_id, teacher.id)
  })

  test('LEV-100 morning half-day leave: a 10:00 class that day is refused, a 15:00 class is saved', async () => {
    const date = day(60)
    await leave(teacher, date, 'approved', 'morning')

    const refused = await json(await createClass(admin.headers, classBody(one, teacher, date, '10:00', '11:00')), 409)
    assert.equal(refused.error, 'schedule_conflict')
    assert.equal(refused.subject_id, teacher.id)
    assert.equal(refused.conflicts[0].kind, 'leave')
    // The morning, in Singapore time: midnight to 13:00.
    assert.equal(refused.conflicts[0].starts_at, sg(date, '00:00'))
    assert.equal(refused.conflicts[0].ends_at, sg(date, '13:00'))
    assert.match(refused.message, /is on leave/)

    const accepted = await json(await createClass(admin.headers, classBody(one, teacher, date, '15:00', '16:00')), 201)
    assert.equal(accepted.starts_at, sg(date, '15:00'))
    // Starting exactly at the 13:00 boundary is the afternoon, which he is not away for.
    await json(await createClass(admin.headers, classBody(one, teacher, date, '13:00', '14:00')), 201)
  })

  test('LEV-101 afternoon leave: a class starting before 13:00 that runs past it is refused', async () => {
    const date = day(70)
    await leave(teacher, date, 'approved', 'afternoon')

    const refused = await json(await createClass(admin.headers, classBody(one, teacher, date, '12:00', '13:30')), 409)
    assert.equal(refused.error, 'schedule_conflict')
    assert.equal(refused.conflicts[0].kind, 'leave')
    assert.equal(refused.conflicts[0].starts_at, sg(date, '13:00'))
    // Starting exactly at the boundary is the afternoon.
    await json(await createClass(admin.headers, classBody(one, teacher, date, '13:00', '14:00')), 409)
    // A morning class that ends before the boundary is his to teach.
    await json(await createClass(admin.headers, classBody(one, teacher, date, '09:00', '10:00')), 201)
  })

  test('LEV-102 leave never occupies a room: another instructor is booked into it, and the room shows no clash', async () => {
    const date = day(80)
    await leave(teacher, date, 'approved')

    // The room the instructor on leave would normally use, the whole day.
    const preview = await json(
      await send('/portal/admin/schedule/series/preview', admin.headers, 'POST', {
        class_type_id: one.classTypeId,
        main_instructor_id: colleague.id,
        instructor_pay_sgd: 50,
        location_id: one.locationId,
        room_id: one.roomId,
        weekday: new Date(`${date}T00:00:00Z`).getUTCDay() || 7,
        start_time: '10:00',
        end_time: '11:00',
        capacity_online: 10,
        credit_cost: 1,
        first_date: date,
        last_date: date,
      }),
      200,
    )
    assert.equal(preview.dates.length, 1)
    assert.deepEqual(preview.dates[0].clashes, [], 'the room is free on his leave day')

    // Other instructors are booked into either room, at the same hour, that day.
    const first = await json(await createClass(admin.headers, classBody(one, colleague, date, '10:00', '11:00', one.roomId)), 201)
    const second = await json(
      await createClass(admin.headers, classBody(one, bystander, date, '10:00', '11:00', one.otherRoomId)),
      201,
    )
    assert.equal(first.room_id, one.roomId)
    assert.equal(second.room_id, one.otherRoomId)
  })

  test('LEV-93 cross-tenant: another studio\'s instructor on leave that day blocks nothing here, and his own studio still refuses him', async () => {
    const date = day(90)
    await leave(teacherTwo, date, 'approved', 'none', two)

    // Studio one, the same day: its own instructor is free.
    await json(await createClass(admin.headers, classBody(one, teacher, date)), 201)
    // A studio-one admin naming the other studio's instructor gets nothing of his leave back.
    // He is not an instructor of this studio at all, so the refusal is that, not his leave.
    const foreign = await json(await createClass(admin.headers, classBody(one, teacherTwo, date, '15:00', '16:00')), 400)
    assert.equal(foreign.error, 'invalid_instructor_id')
    assert.doesNotMatch(JSON.stringify(foreign), /on leave/)

    // In studio two the leave does occupy him.
    assertOnLeave(await json(await createClass(adminTwo.headers, classBody(two, teacherTwo, date)), 409), teacherTwo, date)
  })

  /* ── the instructor cancels his own class ──────────────────────────── */

  test('LEV-112 the main instructor cancels his class with a reason: every booking cancelled and refunded exactly as an admin cancel', async () => {
    const byInstructor = await soonClass(teacher, 3 * DAY)
    const byAdmin = await soonClass(teacher, 3 * DAY + 2 * HOUR)
    const ana = await member('ana')
    const ben = await member('ben')
    const bookings = {
      instructor: [await book(ana, byInstructor.id), await book(ben, byInstructor.id)],
      admin: [await book(ana, byAdmin.id), await book(ben, byAdmin.id)],
    }
    assert.equal(await creditsLeft(ana), 8)
    assert.equal(await creditsLeft(ben), 8)

    const reason = `${TAG} back injury`
    const mine = await json(await instructorCancel(teacher, byInstructor.id, { reason }), 200)
    const theirs = await json(await send(`/portal/admin/schedule/classes/${byAdmin.id}/cancel`, admin.headers, 'POST'), 200)
    assert.deepEqual(mine, { total_bookings: 2, refunded_count: 2 })
    assert.deepEqual(mine, theirs, 'the same outcome as an admin cancellation')

    assert.equal((await classRow(byInstructor.id)).lifecycle, 'cancelled')
    assert.equal((await classRow(byAdmin.id)).lifecycle, 'cancelled')
    assert.equal((await classRow(byInstructor.id)).cancelledByStaffId, teacher.id)
    // Every credit is back.
    assert.equal(await creditsLeft(ana), 10)
    assert.equal(await creditsLeft(ben), 10)

    const outcome = async (bookingId: string) => {
      const [b] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
      const [c] = await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))
      assert.ok(b && c)
      return {
        booking: { state: b.state, refundOutcome: b.refundOutcome, checkInState: b.checkInState },
        cancellation: { kind: c.kind, wasWithinWindow: c.wasWithinWindow, wasWithinCap: c.wasWithinCap, refundFired: c.refundFired },
        source: c.source,
      }
    }
    for (const [i, id] of bookings.instructor.entries()) {
      const a = await outcome(id)
      const b = await outcome(bookings.admin[i]!)
      assert.deepEqual(a.booking, { state: 'cancelled', refundOutcome: 'credit_returned', checkInState: 'n_a' })
      assert.deepEqual(a.booking, b.booking)
      assert.deepEqual(a.cancellation, b.cancellation)
      assert.equal(a.cancellation.refundFired, true)
      // Only who acted differs.
      assert.equal(a.source, 'instructor')
      assert.equal(b.source, 'admin')
    }

    // The refund is recorded against the instructor, and the reason is kept.
    const refunds = await harness.db
      .select()
      .from(schema.manualAdjustments)
      .where(and(eq(schema.manualAdjustments.clientId, ana.clientId), eq(schema.manualAdjustments.actedByStaffId, teacher.id)))
    assert.deepEqual(
      refunds.map(r => [r.delta, r.reason]),
      [[1, 'instructor_class_cancellation_refund']],
    )
    const [inbox] = await harness.db
      .select()
      .from(schema.inboxItems)
      .where(sql`${schema.inboxItems.payload}->>'classId' = ${byInstructor.id}`)
    assert.ok(inbox)
    assert.equal(inbox.type, 'instructor_cancel_class')
    assert.equal((inbox.payload as Record<string, unknown>).reason, reason)
  })

  test('LEV-114 there is no notice window: he cancels his class ten minutes before it starts', async () => {
    const cls = await soonClass(teacher, 10 * 60_000)
    const cara = await member('cara')
    await book(cara, cls.id)
    assert.equal(await creditsLeft(cara), 9)

    assert.deepEqual(await json(await instructorCancel(teacher, cls.id, { reason: 'fever' }), 200), {
      total_bookings: 1,
      refunded_count: 1,
    })
    assert.equal((await classRow(cls.id)).lifecycle, 'cancelled')
    assert.equal(await creditsLeft(cara), 10)
  })

  test('LEV-115 a cancel without a reason is refused and the class stands', async () => {
    const cls = await soonClass(teacher, 4 * DAY)
    const dan = await member('dan')
    const bookingId = await book(dan, cls.id)

    for (const body of [{}, { reason: '' }, { reason: '   ' }]) {
      await json(await instructorCancel(teacher, cls.id, body), 400)
    }
    assert.equal((await classRow(cls.id)).lifecycle, 'active')
    const [b] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.equal(b!.state, 'confirmed')
    assert.equal(await creditsLeft(dan), 9)
  })

  test('LEV-116 a supporting instructor, an unassigned instructor and a member cannot cancel the class', async () => {
    const cls = await soonClass(teacher, 5 * DAY, [colleague])
    const eve = await member('eve')
    const bookingId = await book(eve, cls.id)

    for (const who of [colleague, bystander]) {
      const refused = await json(await instructorCancel(who, cls.id, { reason: 'not mine to cancel' }), 403)
      assert.equal(refused.error, 'not_main_instructor')
    }
    // A member is not staff at all.
    // A member's session is a row the staff pool has never seen.
    const asMember = await json(await instructorCancel(eve, cls.id, { reason: 'please' }), 401)
    assert.equal(asMember.error, 'invalid_token')

    assert.equal((await classRow(cls.id)).lifecycle, 'active')
    const [b] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.equal(b!.state, 'confirmed')
    assert.equal(await creditsLeft(eve), 9)
    const cancellations = await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))
    assert.equal(cancellations.length, 0)
  })

  test('LEV-116 cross-tenant: another studio\'s instructor cannot cancel this studio\'s class — it does not exist for him', async () => {
    const cls = await soonClass(teacher, 6 * DAY)
    const refused = await instructorCancel(teacherTwo, cls.id, { reason: 'not my studio' })
    assert.equal(refused.status, 404, await refused.text())
    assert.equal((await classRow(cls.id)).lifecycle, 'active')
  })

  test('LEV-119 the admin notification failing does not undo the cancel, and the failure is logged with the error object', async () => {
    const cls = await soonClass(teacher, 7 * DAY)
    const fay = await member('fay')
    await book(fay, cls.id)

    const restore = mailer.useTransport({
      name: 'null',
      async send() {
        throw new Error(`${TAG} mail transport down`)
      },
    })
    harness.logs.clear()
    try {
      assert.deepEqual(await json(await instructorCancel(teacher, cls.id, { reason: 'sick' }), 200), {
        total_bookings: 1,
        refunded_count: 1,
      })
    } finally {
      restore()
    }

    assert.equal((await classRow(cls.id)).lifecycle, 'cancelled')
    assert.equal(await creditsLeft(fay), 10)

    const failures = harness.logs
      .lines()
      .filter(l => l.level === 'error' && (l.err as { message?: string } | undefined)?.message?.includes(`${TAG} mail transport down`))
    assert.ok(failures.length >= 1, 'the send failure was logged')
    const err = failures[0]!.err as { type?: string; message?: string; stack?: string }
    assert.equal(err.type, 'Error', 'the error object itself, not a flattened string')
    assert.match(err.stack ?? '', /mail transport down/)
    assert.equal(failures[0]!.template, 'instructor_cancel_class')

    // This cancel's mail to the admin is on record as failed (earlier cancels' mail went out).
    const logged = await harness.db
      .select()
      .from(schema.emailLog)
      .where(
        and(
          eq(schema.emailLog.recipientEmail, at(`admin-${one.slug}`)),
          eq(schema.emailLog.templateSlug, 'instructor_cancel_class'),
          like(schema.emailLog.error, `%${TAG} mail transport down%`),
        ),
      )
    assert.deepEqual(
      logged.map(l => l.status),
      ['failed'],
    )
  })
})
