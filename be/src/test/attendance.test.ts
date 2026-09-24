import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.attendance.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Attendance class type ${run}`
const PACKAGE_NAME = `Attendance pass ${run}`
const WORKSHOP_NAME = `Attendance workshop ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Attendance over real HTTP (#216): who may mark a booking attended or a
 * no-show, on which sessions, what that does to the member's credit, and when a
 * session's check-in counts as finished.
 *
 * Every scenario reads back the rows the request left: the booking's state and
 * check-in state, the check-in row, the member's package balance and its credit
 * ledger (`manual_adjustments`), and the cancellation record. The front-desk
 * scan's own rules (window, idempotency, today's list) are `check-in.test.ts`.
 */
describe('attendance over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    classPackageId: string
  }
  type Staff = { staffId: string; headers: Record<string, string> }
  type Member = { clientId: string; clientPackageId: string; headers: Record<string, string> }
  type Reply = { status: number; body: any }

  let one!: Studio
  let two!: Studio
  let adminAtOne!: Staff
  let teacherAtOne!: Staff
  let otherTeacherAtOne!: Staff
  let adminAtTwo!: Staff

  const emailFor = (name: string) => `${name.toLowerCase().replace(/\s+/g, '-')}@${DOMAIN}`

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenant.id))
      .limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location.id)).limit(1)
    assert.ok(room, `expected a seeded room for ${tenant.slug}`)
    const classType = await classTypesSvc.createClassType(tenant.id, { name: CLASS_TYPE_NAME })
    const classPackage = await classPackagesSvc.createClassPackage(tenant.id, {
      name: PACKAGE_NAME,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      classTypeId: classType.id,
      classPackageId: classPackage.id,
    }
  }

  async function staff(at: Studio, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${name}-${at.slug}`)
    const headers = await harness.signInAs('staff', email, at)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    }
    return { staffId: row!.id, headers }
  }

  /** A member signed in on `at`'s hostname, holding a 10-credit bundle. */
  async function member(at: Studio, name: string): Promise<Member> {
    const email = emailFor(`${name}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    const { clientPackageId } = await purchaseSvc.grantPackage(at.id, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: at.classPackageId,
    })
    return { clientId: client!.id, clientPackageId, headers }
  }

  /** A class `startsIn` from now (negative: already started), taught by `teacher`. */
  async function addClass(at: Studio, startsIn: number, teacher: Staff): Promise<string> {
    const startsAt = new Date(Date.now() + startsIn)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: teacher.staffId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: teacher.staffId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /** Moves a class, keeping it an hour long. Booking closes at the start, so a
   *  class is booked ahead and then moved into the past: time passing. */
  const moveClass = (classId: string, startsIn: number) => {
    const startsAt = new Date(Date.now() + startsIn)
    return harness.db
      .update(schema.classes)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + HOUR) })
      .where(eq(schema.classes.id, classId))
  }

  /** Books through the member's own route, and hands back what their app shows. */
  async function book(who: Member, classId: string): Promise<{ bookingId: string; qrToken: string; code: string }> {
    const res = await harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...who.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_id: classId }),
    })
    const text = await res.text()
    assert.equal(res.status, 201, text)
    const body = JSON.parse(text) as { booking_id: string; qr_token: string; code: string }
    return { bookingId: body.booking_id, qrToken: body.qr_token, code: body.code }
  }

  /** A booking on a class that has already started an hour ago. */
  async function bookStarted(who: Member, teacher: Staff, at: Studio = one) {
    const classId = await addClass(at, 3 * DAY, teacher)
    const booked = await book(who, classId)
    await moveClass(classId, -HOUR)
    return { classId, ...booked }
  }

  async function reply(res: Response): Promise<Reply> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const post = async (path: string, headers: Record<string, string>, body?: unknown) =>
    reply(
      await harness.app.request(path, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )

  const tick = (who: { headers: Record<string, string> }, bookingId: string, attended: boolean, audience: 'admin' | 'instructor' = 'admin') =>
    post(`/api/v1/portal/${audience}/check-in/manual`, who.headers, { booking_id: bookingId, attended })

  const scan = (who: { headers: Record<string, string> }, body: { qr_token?: string; code?: string }, audience: 'admin' | 'instructor' = 'admin') =>
    post(`/api/v1/portal/${audience}/check-in/scan`, who.headers, body)

  const noShow = (who: { headers: Record<string, string> }, bookingId: string, audience: 'admin' | 'instructor' = 'admin') =>
    post(`/api/v1/portal/${audience}/bookings/${bookingId}/no-show`, who.headers)

  async function classDetail(who: Staff, classId: string) {
    const res = await reply(await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: who.headers }))
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body as {
      check_in_state: string
      attendees: { booking_id: string; check_in_state: string }[]
    }
  }

  async function bookingRow(bookingId: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.ok(row, `no booking row ${bookingId}`)
    return row
  }

  const checkInsOf = (bookingId: string) =>
    harness.db.select().from(schema.checkIns).where(eq(schema.checkIns.bookingId, bookingId))

  const cancellationsOf = (bookingId: string) =>
    harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))

  async function creditsLeft(who: Member): Promise<number> {
    const [row] = await harness.db
      .select({ left: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, who.clientPackageId))
    assert.ok(row)
    return row.left!
  }

  /**
   * The member's credit ledger on their bundle: every recorded movement, in
   * order. A class booking's own debit is carried on the booking
   * (`credits_or_sessions_used`) and writes no row here (book.ts), so for these
   * members an empty ledger means nothing was ever handed back.
   */
  async function ledger(who: Member): Promise<number[]> {
    const rows = await harness.db
      .select({ delta: schema.manualAdjustments.delta })
      .from(schema.manualAdjustments)
      .where(eq(schema.manualAdjustments.clientPackageId, who.clientPackageId))
      .orderBy(schema.manualAdjustments.createdAt)
    return rows.map(r => r.delta)
  }

  /** What a booking and its money look like, for "nothing changed" assertions. */
  async function snapshot(who: Member, bookingId: string) {
    return {
      booking: await bookingRow(bookingId),
      checkIns: (await checkInsOf(bookingId)).length,
      cancellations: (await cancellationsOf(bookingId)).length,
      credits: await creditsLeft(who),
      ledger: await ledger(who),
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    adminAtOne = await staff(one, 'desk', 'admin')
    teacherAtOne = await staff(one, 'teacher', 'instructor')
    otherTeacherAtOne = await staff(one, 'other-teacher', 'instructor')
    adminAtTwo = await staff(two, 'desk', 'admin')
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM check_ins WHERE booking_id IN (SELECT id FROM bookings WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM pt_sessions WHERE scheduled_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name = ${WORKSHOP_NAME}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('CHK-01 every booking carries its own QR token and code, even two of the same member', async () => {
    const ana = await member(one, 'Ana Codes')
    const bo = await member(one, 'Bo Codes')
    const classId = await addClass(one, 3 * DAY, teacherAtOne)
    const first = await book(ana, classId)
    const second = await book(ana, await addClass(one, 4 * DAY, teacherAtOne))
    const third = await book(bo, classId)

    const all = [first, second, third]
    assert.equal(new Set(all.map(b => b.qrToken)).size, 3, 'three bookings, three QR tokens')
    assert.equal(new Set(all.map(b => b.code)).size, 3, 'three bookings, three codes')
    for (const b of all) {
      const row = await bookingRow(b.bookingId)
      assert.equal(row.qrToken, b.qrToken)
      assert.equal(row.code, b.code)
      assert.match(b.code, /^RT-[0-9A-HJKMNP-TV-Z]{6}$/)
    }
  })

  test('CHK-02 a scanned QR checks in that booking on its own session, and no other', async () => {
    const cy = await member(one, 'Cy Scanned')
    const now = await addClass(one, 3 * DAY, teacherAtOne)
    const later = await addClass(one, 4 * DAY, teacherAtOne)
    const today = await book(cy, now)
    const tomorrow = await book(cy, later)
    await moveClass(now, 5 * MINUTE)

    const res = await scan(adminAtOne, { qr_token: today.qrToken })

    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.booking_id, today.bookingId)
    assert.equal(res.body.session.id, now, 'the session comes from the booking, not from the desk')
    assert.equal(res.body.member.id, cy.clientId)
    assert.equal((await bookingRow(today.bookingId)).checkInState, 'attended')
    assert.equal((await checkInsOf(today.bookingId))[0]?.method, 'qr')
    // The member's other booking is untouched.
    assert.equal((await bookingRow(tomorrow.bookingId)).checkInState, 'pending')
    assert.equal((await checkInsOf(tomorrow.bookingId)).length, 0)
    // Checking in spends nothing further.
    assert.equal(await creditsLeft(cy), 8)
    assert.deepEqual(await ledger(cy), [])
  })

  test('CHK-03 a code typed in lower case resolves to the same booking as the upper-case code', async () => {
    const di = await member(one, 'Di Lower')
    const classId = await addClass(one, 3 * DAY, teacherAtOne)
    const { bookingId, code } = await book(di, classId)
    await moveClass(classId, 5 * MINUTE)

    const lower = await scan(adminAtOne, { code: code.toLowerCase() })
    assert.equal(lower.status, 200, JSON.stringify(lower.body))
    assert.equal(lower.body.booking_id, bookingId)
    assert.equal(lower.body.outcome, 'checked_in')

    const upper = await scan(adminAtOne, { code })
    assert.equal(upper.body.booking_id, bookingId)
    assert.equal(upper.body.outcome, 'already_checked_in')
    assert.equal((await checkInsOf(bookingId)).length, 1)
  })

  test("CHK-04 the main instructor marks their started class's booking attended and undoes it; they have no no-show action", async () => {
    const ed = await member(one, 'Ed Taught')
    const { bookingId } = await bookStarted(ed, teacherAtOne)

    const marked = await tick(teacherAtOne, bookingId, true, 'instructor')
    assert.equal(marked.status, 200, JSON.stringify(marked.body))
    assert.equal(marked.body.check_in_state, 'attended')
    let row = await bookingRow(bookingId)
    assert.equal(row.checkInState, 'attended')
    assert.equal(row.state, 'confirmed')
    const [checkIn] = await checkInsOf(bookingId)
    assert.equal(checkIn?.checkedInByStaffId, teacherAtOne.staffId)
    assert.equal(checkIn?.method, 'manual')

    const undone = await tick(teacherAtOne, bookingId, false, 'instructor')
    assert.equal(undone.status, 200, JSON.stringify(undone.body))
    assert.equal(undone.body.check_in_state, 'pending')
    row = await bookingRow(bookingId)
    assert.equal(row.checkInState, 'pending')
    assert.equal((await checkInsOf(bookingId)).length, 0)

    // No no-show under the instructor portal, and the admin one is not theirs.
    assert.equal((await noShow(teacherAtOne, bookingId, 'instructor')).status, 404)
    assert.equal((await noShow(teacherAtOne, bookingId)).status, 403)
    row = await bookingRow(bookingId)
    assert.equal(row.state, 'confirmed')
    assert.equal(row.checkInState, 'pending')
    assert.equal(await creditsLeft(ed), 9)
    assert.deepEqual(await ledger(ed), [])
  })

  test('CHK-05 an admin marks attended on a started class whoever teaches it', async () => {
    const fi = await member(one, 'Fi Admin')
    const { bookingId } = await bookStarted(fi, otherTeacherAtOne)

    const res = await tick(adminAtOne, bookingId, true)

    assert.equal(res.status, 200, JSON.stringify(res.body))
    const row = await bookingRow(bookingId)
    assert.equal(row.checkInState, 'attended')
    assert.equal(row.state, 'confirmed')
    assert.equal((await checkInsOf(bookingId))[0]?.checkedInByStaffId, adminAtOne.staffId)
    assert.equal(await creditsLeft(fi), 9)
    assert.deepEqual(await ledger(fi), [])
    assert.equal((await cancellationsOf(bookingId)).length, 0)
  })

  test('CHK-06 a no-show on a started class keeps the credit spent and writes no cancellation', async () => {
    const gi = await member(one, 'Gi Absent')
    const classId = await addClass(one, 3 * DAY, teacherAtOne)
    const { bookingId } = await book(gi, classId)

    // Not before the class has started: nothing moves.
    const early = await noShow(adminAtOne, bookingId)
    assert.equal(early.status, 422)
    assert.equal(early.body.error, 'session_not_started')
    assert.equal((await bookingRow(bookingId)).state, 'confirmed')

    await moveClass(classId, -HOUR)
    const res = await noShow(adminAtOne, bookingId)

    assert.equal(res.status, 200, JSON.stringify(res.body))
    const row = await bookingRow(bookingId)
    assert.equal(row.state, 'no_show')
    assert.equal(row.checkInState, 'no_show')
    assert.equal(row.refundOutcome, 'forfeited')
    assert.equal(await creditsLeft(gi), 9)
    assert.equal(row.creditsOrSessionsUsed, 1, 'the booking debit stands')
    assert.deepEqual(await ledger(gi), [], 'and nothing is credited back')
    assert.equal((await cancellationsOf(bookingId)).length, 0)
    // No money moves either: no Purchase is opened, refunded or touched.
    assert.deepEqual(
      await harness.db.select().from(schema.purchases).where(eq(schema.purchases.clientId, gi.clientId)),
      [],
    )
    // A no-show twice is refused, and still returns nothing.
    assert.equal((await noShow(adminAtOne, bookingId)).status, 409)
    assert.equal(await creditsLeft(gi), 9)
  })

  test("CHK-07 a session's check-in completes once every roster row is attended or no-show", async () => {
    const hu = await member(one, 'Hu Roster')
    const ida = await member(one, 'Ida Roster')
    const classId = await addClass(one, 3 * DAY, teacherAtOne)
    const hus = await book(hu, classId)
    const idas = await book(ida, classId)
    await moveClass(classId, -HOUR)

    assert.equal((await classDetail(adminAtOne, classId)).check_in_state, 'pending')

    assert.equal((await tick(adminAtOne, hus.bookingId, true)).status, 200)
    assert.equal((await classDetail(adminAtOne, classId)).check_in_state, 'pending', 'one row still undecided')

    assert.equal((await noShow(adminAtOne, idas.bookingId)).status, 200)
    const detail = await classDetail(adminAtOne, classId)
    assert.equal(detail.check_in_state, 'completed')
    // The no-show is still on the roster: it is a decision, not a disappearance.
    assert.deepEqual(
      detail.attendees.map(a => [a.booking_id, a.check_in_state]).sort(),
      [
        [hus.bookingId, 'attended'],
        [idas.bookingId, 'no_show'],
      ].sort(),
    )

    // Undoing one reopens it.
    assert.equal((await tick(adminAtOne, hus.bookingId, false)).status, 200)
    assert.equal((await classDetail(adminAtOne, classId)).check_in_state, 'pending')
  })

  test('CHK-08 a cancelled booking cannot be checked in, and stays cancelled', async () => {
    const jo = await member(one, 'Jo Cancelled')
    const classId = await addClass(one, 3 * DAY, teacherAtOne)
    const { bookingId, code, qrToken } = await book(jo, classId)
    const cancelled = await reply(
      await harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers: jo.headers }),
    )
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
    await moveClass(classId, -HOUR)
    const untouched = await snapshot(jo, bookingId)
    assert.equal(untouched.booking.state, 'cancelled')
    assert.equal(untouched.credits, 10)

    for (const attempt of [
      () => tick(adminAtOne, bookingId, true),
      () => tick(teacherAtOne, bookingId, true, 'instructor'),
      () => scan(adminAtOne, { code }),
      () => scan(adminAtOne, { qr_token: qrToken }),
    ]) {
      const res = await attempt()
      assert.equal(res.status, 409, JSON.stringify(res.body))
      assert.equal(res.body.error, 'booking_cancelled')
    }
    assert.equal((await noShow(adminAtOne, bookingId)).status, 409)

    assert.deepEqual(await snapshot(jo, bookingId), untouched)
  })

  test('CHK-09 a workshop booking is not check-in tracked: every way in refuses it', async () => {
    const ky = await member(one, 'Ky Workshop')
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: one.id, name: WORKSHOP_NAME, locationId: one.locationId, createdByStaffId: adminAtOne.staffId })
      .returning({ id: schema.workshops.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: one.id, workshopId: workshop!.id, name: 'Full', regularPriceSgd: '80.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    const [booking] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: one.id,
        clientId: ky.clientId,
        kind: 'workshop',
        workshopId: workshop!.id,
        workshopTierId: tier!.id,
        creditsOrSessionsUsed: 0,
        listPriceSgd: '80.00',
        amountPaidSgd: '80.00',
        qrToken: `workshop-token-${run}`,
        code: `RT-W${run.slice(-5).toUpperCase()}`,
      })
      .returning()
    const untouched = await bookingRow(booking!.id)

    for (const [res, error] of [
      [await tick(adminAtOne, booking!.id, true), 'workshop_check_in_unsupported'],
      [await scan(adminAtOne, { code: booking!.code }), 'workshop_check_in_unsupported'],
      [await scan(adminAtOne, { qr_token: booking!.qrToken }), 'workshop_check_in_unsupported'],
      [await noShow(adminAtOne, booking!.id), 'workshop_no_show_unsupported'],
    ] as const) {
      assert.equal(res.status, 400, JSON.stringify(res.body))
      assert.equal(res.body.error, error)
    }
    assert.deepEqual(await bookingRow(booking!.id), untouched)
    assert.equal((await checkInsOf(booking!.id)).length, 0)
  })

  test("CHK-10 an instructor is refused check-in on another instructor's class or PT session", async () => {
    const lu = await member(one, 'Lu Theirs')
    const { bookingId, code } = await bookStarted(lu, otherTeacherAtOne)
    const untouched = await snapshot(lu, bookingId)

    for (const res of [
      await tick(teacherAtOne, bookingId, true, 'instructor'),
      await tick(teacherAtOne, bookingId, false, 'instructor'),
      await scan(teacherAtOne, { code }, 'instructor'),
    ]) {
      assert.equal(res.status, 403, JSON.stringify(res.body))
      assert.equal(res.body.error, 'not_your_session')
    }
    assert.deepEqual(await snapshot(lu, bookingId), untouched)

    // The same for a PT session.
    const startsAt = new Date(Date.now() - HOUR)
    const [session] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: one.id,
        instructorId: otherTeacherAtOne.staffId,
        locationId: one.locationId,
        roomId: one.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        sessionType: '1on1',
        capacityOnline: 1,
        scheduledAt: new Date(),
        scheduledByStaffId: adminAtOne.staffId,
      })
      .returning({ id: schema.ptSessions.id })
    const [pt] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: one.id,
        clientId: lu.clientId,
        kind: 'pt',
        ptSessionId: session!.id,
        creditsOrSessionsUsed: 1,
        qrToken: `pt-attendance-${run}`,
        code: `RT-Q${run.slice(-5).toUpperCase()}`,
      })
      .returning()
    const ptRefused = await tick(teacherAtOne, pt!.id, true, 'instructor')
    assert.equal(ptRefused.status, 403, JSON.stringify(ptRefused.body))
    assert.equal(ptRefused.body.error, 'not_your_session')
    assert.equal((await scan(teacherAtOne, { code: pt!.code }, 'instructor')).status, 403)
    assert.equal((await bookingRow(pt!.id)).checkInState, 'pending')
    assert.equal((await checkInsOf(pt!.id)).length, 0)

    // Its own instructor may.
    assert.equal((await tick(otherTeacherAtOne, pt!.id, true, 'instructor')).status, 200)
    assert.equal((await bookingRow(pt!.id)).checkInState, 'attended')
  })

  test('CHK-11 a finished session left unmarked is never flipped to no-show by the scheduled jobs', async () => {
    const mo = await member(one, 'Mo Unmarked')
    const classId = await addClass(one, 3 * DAY, teacherAtOne)
    const { bookingId } = await book(mo, classId)
    // Long over: it ended two days ago and nobody decided the row.
    await moveClass(classId, -2 * DAY)
    const untouched = await snapshot(mo, bookingId)
    assert.equal(untouched.booking.checkInState, 'pending')

    // Every scheduled job, run for this studio as the scheduler would.
    const { withTenant } = await import('../db')
    const { expireStaleSessions, completeEndedPtSessions } = await import('../services/pt-sessions/cancel')
    const { expirePackages, sendLapsingAlerts, sendExpiredNotifications } = await import('../services/packages/expire')
    const { flagExpiredWaivers } = await import('../services/waiver')
    for (const job of [
      expireStaleSessions,
      completeEndedPtSessions,
      expirePackages,
      sendLapsingAlerts,
      sendExpiredNotifications,
      flagExpiredWaivers,
    ]) {
      await withTenant(one.id, async () => {
        await job()
      })
    }

    const now = await snapshot(mo, bookingId)
    assert.equal(now.booking.state, 'confirmed')
    assert.equal(now.booking.checkInState, 'pending')
    assert.equal(now.booking.refundOutcome, untouched.booking.refundOutcome)
    assert.equal(now.credits, 9)
    assert.deepEqual(now.ledger, [])
    assert.equal(now.cancellations, 0)
    assert.equal((await classDetail(adminAtOne, classId)).check_in_state, 'pending')
  })

  test("another studio's staff cannot mark, undo or no-show a booking, and nothing moves", async () => {
    const ned = await member(one, 'Ned Elsewhere')
    const { bookingId, classId, code, qrToken } = await bookStarted(ned, teacherAtOne)
    const untouched = await snapshot(ned, bookingId)

    for (const res of [
      await tick(adminAtTwo, bookingId, true),
      await tick(adminAtTwo, bookingId, false),
      await noShow(adminAtTwo, bookingId),
      await scan(adminAtTwo, { code }),
      await scan(adminAtTwo, { qr_token: qrToken }),
    ]) {
      assert.equal(res.status, 404, JSON.stringify(res.body))
      assert.equal(res.body.error, 'booking_not_found')
    }
    const detail = await reply(
      await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: adminAtTwo.headers }),
    )
    assert.equal(detail.status, 404)

    // Studio two's session carried to studio one's hostname is refused outright.
    const crossed = { headers: { ...adminAtTwo.headers, 'X-Tenant-Slug': one.slug } }
    assert.ok([401, 403].includes((await tick(crossed, bookingId, true)).status))
    assert.ok([401, 403].includes((await scan(crossed, { code })).status))
    assert.ok([401, 403].includes((await noShow(crossed, bookingId)).status))

    assert.deepEqual(await snapshot(ned, bookingId), untouched)
  })

  test('a member cannot mark attendance or a no-show, not even on their own booking', async () => {
    const oz = await member(one, 'Oz Self')
    const { bookingId, code } = await bookStarted(oz, teacherAtOne)
    const untouched = await snapshot(oz, bookingId)

    for (const res of [
      await scan(oz, { code }),
      await scan(oz, { code }, 'instructor'),
      await tick(oz, bookingId, true),
      await tick(oz, bookingId, true, 'instructor'),
      await noShow(oz, bookingId),
    ]) {
      assert.equal(res.status, 401, JSON.stringify(res.body))
    }
    assert.deepEqual(await snapshot(oz, bookingId), untouched)
  })
})
