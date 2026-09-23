import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.checkin.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Check-in class type ${run}`
const PACKAGE_NAME = `Check-in pass ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Front-desk check-in over real HTTP (#192): a member's QR or typed code,
 * scanned by staff, ticks them `attended` on the roster.
 *
 * Every rule the ticket names has a test here — the scan by token and by code,
 * the idempotent second scan, the Check-in Window either side, the refusals
 * (unknown, cancelled booking, cancelled class, wrong day, another studio's
 * code, an instructor on somebody else's class), and today's roster.
 */
describe('check-in over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
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
  type Member = { clientId: string; name: string; headers: Record<string, string> }

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
    await purchaseSvc.grantPackage(at.id, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: at.classPackageId,
    })
    return { clientId: client!.id, name, headers }
  }

  /** A class `startsIn` from now, taught by `teacher`. */
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

  /** Books through the member's own route, and hands back what their app would show. */
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

  /** Moves a class, keeping it an hour long. */
  const moveClass = (classId: string, startsIn: number) => {
    const startsAt = new Date(Date.now() + startsIn)
    return harness.db
      .update(schema.classes)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + HOUR) })
      .where(eq(schema.classes.id, classId))
  }

  async function scan(
    who: Staff,
    body: { qr_token?: string; code?: string },
    audience: 'admin' | 'instructor' = 'admin',
  ): Promise<{ status: number; body: any }> {
    const res = await harness.app.request(`/api/v1/portal/${audience}/check-in/scan`, {
      method: 'POST',
      headers: { ...who.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }

  async function tick(
    who: Staff,
    bookingId: string,
    attended: boolean,
    audience: 'admin' | 'instructor' = 'admin',
  ): Promise<{ status: number; body: any }> {
    const res = await harness.app.request(`/api/v1/portal/${audience}/check-in/manual`, {
      method: 'POST',
      headers: { ...who.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, attended }),
    })
    return { status: res.status, body: await res.json() }
  }

  async function today(who: Staff, audience: 'admin' | 'instructor' = 'admin') {
    const res = await harness.app.request(`/api/v1/portal/${audience}/check-in`, { headers: who.headers })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    return JSON.parse(text) as {
      date: string
      sessions: {
        kind: string
        id: string
        name: string
        check_in_opens_at: string
        roster: { booking_id: string; name: string; code: string; check_in_state: string; method: string | null }[]
      }[]
    }
  }

  const checkInsOf = (bookingId: string) =>
    harness.db.select().from(schema.checkIns).where(eq(schema.checkIns.bookingId, bookingId))

  async function bookingRow(bookingId: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.ok(row)
    return row
  }

  async function windowOf(at: Studio): Promise<number> {
    const [policy] = await harness.db
      .select({ minutes: schema.globalPolicy.checkInOpensMinutesBefore })
      .from(schema.globalPolicy)
      .where(eq(schema.globalPolicy.tenantId, at.id))
    assert.ok(policy)
    return policy.minutes
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    adminAtOne = await staff(one, 'front-desk', 'admin')
    teacherAtOne = await staff(one, 'teacher', 'instructor')
    otherTeacherAtOne = await staff(one, 'other-teacher', 'instructor')
    adminAtTwo = await staff(two, 'front-desk', 'admin')
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
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('scanning a QR checks the member in: roster shows attended, and so does their own booking', async () => {
    const ana = await member(one, 'Ana Scan')
    const classId = await addClass(one, 10 * MINUTE, teacherAtOne)
    const { bookingId, qrToken } = await book(ana, classId)

    const res = await scan(adminAtOne, { qr_token: qrToken })

    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.outcome, 'checked_in')
    assert.equal(res.body.booking_id, bookingId)
    assert.equal(res.body.member.name, 'Ana Scan')
    assert.equal(res.body.session.id, classId)
    assert.equal((await bookingRow(bookingId)).checkInState, 'attended')
    const [row] = await checkInsOf(bookingId)
    assert.equal(row?.method, 'qr')
    assert.equal(row?.checkedInByStaffId, adminAtOne.staffId)

    const session = (await today(adminAtOne)).sessions.find(s => s.id === classId)
    assert.ok(session, "today's list carries the class")
    const entry = session.roster.find(r => r.booking_id === bookingId)
    assert.equal(entry?.check_in_state, 'attended')
    assert.equal(entry?.method, 'qr')

    const mine = await harness.app.request(`/api/v1/me/bookings/${bookingId}`, { headers: ana.headers })
    assert.equal(((await mine.json()) as { check_in_state: string }).check_in_state, 'attended')
  })

  test('a typed code does the same, in any case, and records that it was typed', async () => {
    const ben = await member(one, 'Ben Code')
    const { bookingId, code } = await book(ben, await addClass(one, 5 * MINUTE, teacherAtOne))

    const res = await scan(adminAtOne, { code: ` ${code.toLowerCase()} ` })

    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.outcome, 'checked_in')
    assert.equal((await bookingRow(bookingId)).checkInState, 'attended')
    assert.equal((await checkInsOf(bookingId))[0]?.method, 'code')
  })

  test('a second scan of the same code is a friendly no-op, never a second row', async () => {
    const cal = await member(one, 'Cal Twice')
    const { bookingId, qrToken, code } = await book(cal, await addClass(one, 5 * MINUTE, teacherAtOne))
    assert.equal((await scan(adminAtOne, { qr_token: qrToken })).status, 200)

    const again = await scan(adminAtOne, { code })

    assert.equal(again.status, 200, JSON.stringify(again.body))
    assert.equal(again.body.outcome, 'already_checked_in')
    assert.match(again.body.message, /already checked in/i)
    const rows = await checkInsOf(bookingId)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.method, 'qr', 'the first scan is the one on record')
  })

  test('check-in opens the studio’s window before the start, and not a minute earlier', async () => {
    const minutes = await windowOf(one)
    assert.ok(minutes > 1, 'the seeded window is wide enough to test inside')
    const dee = await member(one, 'Dee Early')
    const classId = await addClass(one, (minutes + 5) * MINUTE, teacherAtOne)
    const { bookingId, code } = await book(dee, classId)

    const early = await scan(adminAtOne, { code })
    assert.equal(early.status, 422, JSON.stringify(early.body))
    assert.equal(early.body.error, 'check_in_not_open')
    assert.ok(early.body.message, 'the refusal says when it opens')
    assert.ok(early.body.opens_at)
    // The tick is held to the same window.
    assert.equal((await tick(adminAtOne, bookingId, true)).body.error, 'check_in_not_open')
    assert.equal((await bookingRow(bookingId)).checkInState, 'pending')

    // Time passes: the class is now inside the window, still not started.
    await moveClass(classId, (minutes - 1) * MINUTE)
    const inside = await scan(adminAtOne, { code })
    assert.equal(inside.status, 200, JSON.stringify(inside.body))
    assert.equal((await bookingRow(bookingId)).checkInState, 'attended')

    // Undo is available inside the window too.
    assert.equal((await tick(adminAtOne, bookingId, false)).status, 200)
    assert.equal((await bookingRow(bookingId)).checkInState, 'pending')
  })

  test('a manual tick works early inside the window, but a no-show still waits for the start', async () => {
    const eve = await member(one, 'Eve Tick')
    const { bookingId } = await book(eve, await addClass(one, 5 * MINUTE, teacherAtOne))

    const noShow = await harness.app.request(`/api/v1/portal/admin/bookings/${bookingId}/no-show`, {
      method: 'POST',
      headers: adminAtOne.headers,
    })
    assert.equal(noShow.status, 422)
    assert.equal(((await noShow.json()) as { error: string }).error, 'session_not_started')

    const res = await tick(adminAtOne, bookingId, true)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal((await bookingRow(bookingId)).checkInState, 'attended')
    assert.equal((await checkInsOf(bookingId))[0]?.method, 'manual')
  })

  test("a scan is refused for a class on another day, even one that has finished", async () => {
    const fay = await member(one, 'Fay Yesterday')
    const classId = await addClass(one, 3 * DAY, teacherAtOne)
    const { code } = await book(fay, classId)

    const future = await scan(adminAtOne, { code })
    assert.equal(future.status, 422)
    assert.equal(future.body.error, 'check_in_not_open')

    await moveClass(classId, -2 * DAY)
    const past = await scan(adminAtOne, { code })
    assert.equal(past.status, 422, JSON.stringify(past.body))
    assert.equal(past.body.error, 'check_in_closed')
    assert.ok(past.body.message)
  })

  test("a manual tick still works on a past day's roster, where a scan is closed", async () => {
    const gil = await member(one, 'Gil Cleanup')
    const classId = await addClass(one, 5 * MINUTE, teacherAtOne)
    const { bookingId, code } = await book(gil, classId)
    await moveClass(classId, -2 * DAY)

    assert.equal((await scan(adminAtOne, { code })).body.error, 'check_in_closed')
    const res = await tick(adminAtOne, bookingId, true)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal((await bookingRow(bookingId)).checkInState, 'attended')
  })

  test('a PT session is checked in the same way, and listed with the day', async () => {
    const pia = await member(one, 'Pia Personal')
    const startsAt = new Date(Date.now() + 5 * MINUTE)
    const [session] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: one.id,
        instructorId: teacherAtOne.staffId,
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
    const code = `RT-P${run.slice(-5).toUpperCase()}`
    const [booking] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: one.id,
        clientId: pia.clientId,
        kind: 'pt',
        ptSessionId: session!.id,
        creditsOrSessionsUsed: 1,
        qrToken: `pt-token-${run}`,
        code,
      })
      .returning({ id: schema.bookings.id })

    const listed = (await today(teacherAtOne, 'instructor')).sessions.find(s => s.id === session!.id)
    assert.equal(listed?.kind, 'pt')
    assert.ok(listed.roster.some(r => r.booking_id === booking!.id))

    const res = await scan(teacherAtOne, { code }, 'instructor')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.session.kind, 'pt')
    assert.equal(res.body.session.location.id, one.locationId)
    assert.equal((await bookingRow(booking!.id)).checkInState, 'attended')
  })

  test("the desk can narrow today's list to the Location it stands at", async () => {
    const classId = await addClass(one, 5 * MINUTE, teacherAtOne)
    const at = async (locationId: string) => {
      const res = await harness.app.request(`/api/v1/portal/admin/check-in?location_id=${locationId}`, {
        headers: adminAtOne.headers,
      })
      assert.equal(res.status, 200)
      return ((await res.json()) as { sessions: { id: string }[] }).sessions.map(s => s.id)
    }
    assert.ok((await at(one.locationId)).includes(classId))
    assert.ok(!(await at(two.locationId)).includes(classId))
  })

  test('unknown codes, cancelled bookings and cancelled classes are refused by name', async () => {
    const unknown = await scan(adminAtOne, { code: 'RT-ZZZZZZ' })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.body.error, 'booking_not_found')
    assert.equal((await scan(adminAtOne, {})).status, 400)

    const gus = await member(one, 'Gus Cancelled')
    const classId = await addClass(one, 3 * DAY, teacherAtOne)
    const { bookingId, code } = await book(gus, classId)
    const cancel = await harness.app.request(`/api/v1/me/bookings/${bookingId}`, {
      method: 'DELETE',
      headers: gus.headers,
    })
    assert.equal(cancel.status, 200)
    await moveClass(classId, 5 * MINUTE)
    const cancelled = await scan(adminAtOne, { code })
    assert.equal(cancelled.status, 409)
    assert.equal(cancelled.body.error, 'booking_cancelled')

    const hal = await member(one, 'Hal Class Off')
    const offClass = await addClass(one, 5 * MINUTE, teacherAtOne)
    const booked = await book(hal, offClass)
    await harness.db.update(schema.classes).set({ lifecycle: 'cancelled' }).where(eq(schema.classes.id, offClass))
    const off = await scan(adminAtOne, { code: booked.code })
    assert.equal(off.status, 409)
    assert.equal(off.body.error, 'session_cancelled')
  })

  test("another studio's code resolves to nothing, and touches nothing", async () => {
    const ivy = await member(one, 'Ivy Elsewhere')
    const { bookingId, qrToken, code } = await book(ivy, await addClass(one, 5 * MINUTE, teacherAtOne))

    for (const body of [{ code }, { qr_token: qrToken }]) {
      const res = await scan(adminAtTwo, body)
      assert.equal(res.status, 404, JSON.stringify(res.body))
      assert.equal(res.body.error, 'booking_not_found')
      assert.deepEqual(Object.keys(res.body).sort(), ['error', 'message'], 'nothing about the booking leaks')
    }
    assert.equal((await bookingRow(bookingId)).checkInState, 'pending')
    assert.equal((await checkInsOf(bookingId)).length, 0)
  })

  test('an instructor checks in their own class and is refused anyone else’s', async () => {
    const jay = await member(one, 'Jay Mine')
    const kim = await member(one, 'Kim Theirs')
    const mine = await addClass(one, 5 * MINUTE, teacherAtOne)
    const theirs = await addClass(one, 5 * MINUTE, otherTeacherAtOne)
    const jayBooking = await book(jay, mine)
    const kimBooking = await book(kim, theirs)

    const ok = await scan(teacherAtOne, { code: jayBooking.code }, 'instructor')
    assert.equal(ok.status, 200, JSON.stringify(ok.body))

    const refused = await scan(teacherAtOne, { code: kimBooking.code }, 'instructor')
    assert.equal(refused.status, 403)
    assert.equal(refused.body.error, 'not_your_session')
    assert.equal((await bookingRow(kimBooking.bookingId)).checkInState, 'pending')

    const list = await today(teacherAtOne, 'instructor')
    assert.ok(list.sessions.some(s => s.id === mine))
    assert.ok(!list.sessions.some(s => s.id === theirs), 'an instructor sees their own sessions only')
    // An admin sees both.
    const all = await today(adminAtOne)
    assert.ok(all.sessions.some(s => s.id === mine) && all.sessions.some(s => s.id === theirs))
  })

  test("today's list leaves out other days, cancelled bookings and other studios", async () => {
    const lou = await member(one, 'Lou Roster')
    const tomorrow = await addClass(one, 2 * DAY, teacherAtOne)
    await book(lou, tomorrow)
    const list = await today(adminAtOne)
    assert.ok(!list.sessions.some(s => s.id === tomorrow))
    assert.match(list.date, /^\d{4}-\d{2}-\d{2}$/)

    const other = await today(adminAtTwo)
    const ourIds = new Set(list.sessions.map(s => s.id))
    assert.ok(!other.sessions.some(s => ourIds.has(s.id)))

    for (const session of list.sessions) {
      for (const entry of session.roster) {
        const row = await bookingRow(entry.booking_id)
        assert.notEqual(row.state, 'cancelled')
      }
    }
  })

  test('the window is the studio’s to set', async () => {
    const was = await windowOf(one)
    const [prior] = await harness.db
      .select({ updatedByStaffId: schema.globalPolicy.updatedByStaffId })
      .from(schema.globalPolicy)
      .where(eq(schema.globalPolicy.tenantId, one.id))
    assert.ok(prior)
    const patch = (minutes: number) =>
      harness.app.request('/api/v1/portal/admin/policy/global', {
        method: 'PATCH',
        headers: { ...adminAtOne.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ check_in_opens_minutes_before: minutes }),
      })
    try {
      const res = await patch(45)
      assert.equal(res.status, 200, await res.clone().text())
      assert.equal(((await res.json()) as any).check_in_opens_minutes_before, 45)
      assert.equal(await windowOf(one), 45)
      assert.equal((await patch(-1)).status, 400)
      assert.equal(await windowOf(two), was, "one studio's window is not another's")
    } finally {
      await harness.db
        .update(schema.globalPolicy)
        // The PATCH stamped our admin as the editor; put back who it was, or
        // the cleanup cannot delete them.
        .set({ checkInOpensMinutesBefore: was, updatedByStaffId: prior.updatedByStaffId })
        .where(eq(schema.globalPolicy.tenantId, one.id))
    }
  })
})
