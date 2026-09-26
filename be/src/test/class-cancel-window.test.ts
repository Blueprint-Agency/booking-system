import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, like, sql } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { addDays, isoWeekday } from '../services/schedule/series-dates'

const run = Date.now().toString(36)
const DOMAIN = `${run}.cancel-window.test`
const TAG = `cwin-${run}`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `${TAG} class type`
const PACKAGE_NAME = `${TAG} pass`
const FLAG = 'waitlist_enabled'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** The studio's class window for the whole file, set in `before` and put back in `after`. */
const STUDIO_HOURS = 24

/**
 * The per-class Cancellation Window (#313, be/CONTEXT.md § Cancellation
 * Window): a class, or a weekly series for every class it makes, may carry its
 * own window; left blank it follows the studio's class window, live. Every rule
 * that turns on "the class window" reads the class's effective one — a member's
 * cancel, the waitlist closing, automatic seat-filling and the promotion
 * email's cancel-by time.
 *
 * Staff-facing fields go through the portal routes; the classes the member
 * rules run against are written directly, and every rule under test runs
 * behind a route.
 */
describe('per-class Cancellation Window', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Staff = { id: string; headers: Headers }
  type Member = { clientId: string; headers: Headers; email: string }

  let one!: { id: string; slug: string }
  let admin!: Staff
  let teacher!: Staff
  let locationId!: string
  let roomId!: string
  let classTypeId!: string
  let classPackageId!: string
  /** The studio's policy row as this file found it, put back in `after` — who saved it included. */
  let savedPolicy: { classWindowHours: number; updatedByStaffId: string | null } | undefined

  const emailFor = (name: string) => `${name}@${DOMAIN}`

  async function reply(res: Response): Promise<Reply> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const send = async (method: string, path: string, headers: Headers, body?: unknown) =>
    reply(
      await harness.app.request(`/api/v1${path}`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )

  async function staffAt(name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(name)
    const headers = await harness.signInAs('staff', email, one)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, one.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: one.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: row!.id })
    }
    return { id: row!.id, headers }
  }

  let memberSeq = 0
  /** A member of the studio, signed in, holding a 10-credit bundle. */
  async function member(): Promise<Member> {
    const email = emailFor(`member${++memberSeq}`)
    const headers = await harness.signInAs('client', email, one)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: one.id, email, name: `Member ${memberSeq}`, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    await purchaseSvc.grantPackage(one.id, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: classPackageId,
    })
    return { clientId: client!.id, headers, email }
  }

  /** A class starting `startsIn` from now, one credit a seat, with `ownHours` as its own window (null = studio's). */
  async function addClass(
    startsIn: number,
    ownHours: number | null,
    capacity: { online: number; waitlist: number } = { online: 10, waitlist: 0 },
  ): Promise<{ id: string; startsAt: Date }> {
    const startsAt = new Date(Date.now() + startsIn)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: one.id,
        classTypeId,
        mainInstructorId: teacher.id,
        locationId,
        roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: capacity.online,
        capacityWaitlist: capacity.waitlist,
        creditCost: 1,
        cancelWindowHours: ownHours,
        createdByStaffId: admin.id,
      })
      .returning({ id: schema.classes.id })
    return { id: row!.id, startsAt }
  }

  const setStudioHours = async (hours: number) => {
    const res = await send('PATCH', '/portal/admin/policy/global', admin.headers, { class_window_hours: hours })
    assert.equal(res.status, 200, JSON.stringify(res.body))
  }
  const setFlag = (enabled: boolean) =>
    send('PATCH', `/portal/admin/feature-flags/${FLAG}`, admin.headers, { enabled })

  async function booked(who: Member, classId: string): Promise<string> {
    const res = await send('POST', '/me/bookings/class', who.headers, { class_id: classId })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.booking_id as string
  }
  const cancel = (who: Member, bookingId: string) => send('DELETE', `/me/bookings/${bookingId}`, who.headers)

  /**
   * A member's cancel judged late under a `hours` window: refused naming that
   * window, or — once a late cancel goes through (#312) — let through without
   * the credit. Either way never a free cancel, and never some other failure.
   */
  function assertLate(res: Reply, hours: number) {
    if (res.status === 422) {
      assert.equal(res.body.error, 'cancellation_window_passed', JSON.stringify(res.body))
      assert.equal(res.body.window_hours, hours)
    } else {
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.notEqual(res.body.refund_outcome, 'credit_returned')
    }
  }

  async function creditsLeft(who: Member): Promise<number> {
    const rows = await harness.db
      .select({ left: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.clientId, who.clientId))
    return rows.reduce((sum, r) => sum + (r.left ?? 0), 0)
  }

  /** The member's upcoming booking on `classId`, as My Bookings reads it. */
  async function upcomingRow(who: Member, classId: string) {
    const res = await send('GET', '/me/bookings/upcoming', who.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const row = res.body.bookings.find((b: { class_id: string }) => b.class_id === classId)
    assert.ok(row, `class ${classId} missing from /me/bookings/upcoming`)
    return row
  }

  /** The member's view of a class in the catalogue. */
  async function memberCard(who: Member, classId: string) {
    const from = new Date(Date.now() - DAY).toISOString()
    const to = new Date(Date.now() + 10 * DAY).toISOString()
    const res = await send('GET', `/me/classes?from=${from}&to=${to}`, who.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const card = res.body.classes.find((c: { id: string }) => c.id === classId)
    assert.ok(card, `class ${classId} missing from /me/classes`)
    return card
  }

  /** A slot far enough out that nothing else in the run is in this room then. */
  let slotSeq = 0
  const slot = () => {
    const startsAt = new Date(Date.now() + (40 + ++slotSeq) * DAY)
    return { starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + HOUR).toISOString() }
  }
  const classBody = (extra: Record<string, unknown> = {}) => ({
    class_type_id: classTypeId,
    main_instructor_id: teacher.id,
    location_id: locationId,
    room_id: roomId,
    ...slot(),
    capacity_online: 10,
    credit_cost: 1,
    instructor_pay_sgd: 50,
    ...extra,
  })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    one = harness.tenants.one
    admin = await staffAt('admin', 'admin')
    teacher = await staffAt('teacher', 'instructor')
    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, one.id))
      .limit(1)
    assert.ok(location, 'the fixture studio has a seeded location')
    locationId = location.id
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: one.id, locationId, name: `${TAG} Room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    roomId = room!.id
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: one.id, name: CLASS_TYPE_NAME })
      .returning({ id: schema.classTypes.id })
    classTypeId = type!.id
    const pkg = await classPackagesSvc.createClassPackage(one.id, {
      name: PACKAGE_NAME,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    classPackageId = pkg.id

    const [policy] = await harness.db
      .select({
        classWindowHours: schema.globalPolicy.classWindowHours,
        updatedByStaffId: schema.globalPolicy.updatedByStaffId,
      })
      .from(schema.globalPolicy)
      .where(eq(schema.globalPolicy.tenantId, one.id))
    assert.ok(policy, 'the fixture studio has a policy row')
    savedPolicy = policy
    await setStudioHours(STUDIO_HOURS)
    assert.equal((await setFlag(true)).status, 200)
  })

  after(async () => {
    if (!harness) return
    if (admin) await setFlag(false)
    // Written directly: a save through the route would leave this file's admin
    // as the row's last editor, and that admin is deleted below.
    if (savedPolicy) {
      await harness.db.update(schema.globalPolicy).set(savedPolicy).where(eq(schema.globalPolicy.tenantId, one.id))
    }
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const ourClasses = sql`SELECT id FROM classes WHERE class_type_id = ${classTypeId}`
    await harness.db.execute(sql`DELETE FROM feature_flags WHERE key = ${FLAG} AND updated_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM clients WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM waitlist_entries WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM class_supporting_instructors WHERE class_id IN (${ourClasses})`)
    await harness.db.execute(sql`DELETE FROM classes WHERE class_type_id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM class_series WHERE class_type_id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE id = ${roomId}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, ours))
    await harness.close()
  })

  /* ── Staff set it ────────────────────────────────────────────────── */

  test('SCH-23 an admin schedules a class with its own window, or none; the portal row says both, and a negative one is refused', async () => {
    const own = await send('POST', '/portal/admin/schedule/classes', admin.headers, classBody({ cancel_window_hours: 12 }))
    assert.equal(own.status, 201, JSON.stringify(own.body))
    assert.equal(own.body.cancel_window_hours, 12)
    assert.equal(own.body.effective_cancel_window_hours, 12)

    const detail = await send('GET', `/portal/admin/schedule/classes/${own.body.id}`, admin.headers)
    assert.equal(detail.status, 200, JSON.stringify(detail.body))
    assert.equal(detail.body.cancel_window_hours, 12)
    assert.equal(detail.body.effective_cancel_window_hours, 12)

    const plain = await send('POST', '/portal/admin/schedule/classes', admin.headers, classBody())
    assert.equal(plain.status, 201, JSON.stringify(plain.body))
    assert.equal(plain.body.cancel_window_hours, null)
    assert.equal(plain.body.effective_cancel_window_hours, STUDIO_HOURS)

    const negative = await send('POST', '/portal/admin/schedule/classes', admin.headers, classBody({ cancel_window_hours: -1 }))
    assert.equal(negative.status, 400, JSON.stringify(negative.body))
    const fraction = await send('POST', '/portal/admin/schedule/classes', admin.headers, classBody({ cancel_window_hours: 1.5 }))
    assert.equal(fraction.status, 400, JSON.stringify(fraction.body))
  })

  test('SCH-24 an admin changes a class’s window, and an explicit null puts it back on the studio default', async () => {
    const created = await send('POST', '/portal/admin/schedule/classes', admin.headers, classBody())
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const id = created.body.id as string

    const set = await send('PATCH', `/portal/admin/schedule/classes/${id}`, admin.headers, { cancel_window_hours: 6 })
    assert.equal(set.status, 200, JSON.stringify(set.body))
    assert.equal(set.body.cancel_window_hours, 6)
    assert.equal(set.body.effective_cancel_window_hours, 6)

    // A patch that does not name the field leaves it alone.
    const untouched = await send('PATCH', `/portal/admin/schedule/classes/${id}`, admin.headers, { credit_cost: 2 })
    assert.equal(untouched.status, 200, JSON.stringify(untouched.body))
    assert.equal(untouched.body.cancel_window_hours, 6)

    const cleared = await send('PATCH', `/portal/admin/schedule/classes/${id}`, admin.headers, { cancel_window_hours: null })
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body))
    assert.equal(cleared.body.cancel_window_hours, null)
    assert.equal(cleared.body.effective_cancel_window_hours, STUDIO_HOURS)
  })

  test('SCH-25 an instructor schedules their own class with its own window', async () => {
    const res = await send('POST', '/portal/instructor/schedule/classes', teacher.headers, {
      class_type_id: classTypeId,
      location_id: locationId,
      room_id: roomId,
      ...slot(),
      capacity_online: 8,
      credit_cost: 1,
      cancel_window_hours: 36,
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.cancel_window_hours, 36)
    assert.equal(res.body.effective_cancel_window_hours, 36)
    const [row] = await harness.db
      .select({ hours: schema.classes.cancelWindowHours })
      .from(schema.classes)
      .where(eq(schema.classes.id, res.body.id))
    assert.equal(row!.hours, 36)
  })

  test('SCH-26 a series copies its window onto every class it creates, and onto every class an extend adds', async () => {
    // Mondays well past every other slot this file books in the room.
    const base = addDays(new Date().toISOString().slice(0, 10), 200)
    const monday = addDays(base, (1 - isoWeekday(base) + 7) % 7)
    const created = await send('POST', '/portal/admin/schedule/series', admin.headers, {
      class_type_id: classTypeId,
      main_instructor_id: teacher.id,
      instructor_pay_sgd: 40,
      location_id: locationId,
      room_id: roomId,
      weekday: 1,
      start_time: '07:00',
      end_time: '08:00',
      capacity_online: 12,
      credit_cost: 1,
      first_date: monday,
      last_date: addDays(monday, 14),
      cancel_window_hours: 48,
    })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.series.cancel_window_hours, 48)
    const seriesId = created.body.series.id as string

    const windowsOf = async () =>
      (
        await harness.db
          .select({ hours: schema.classes.cancelWindowHours })
          .from(schema.classes)
          .where(eq(schema.classes.seriesId, seriesId))
      ).map(r => r.hours)
    assert.deepEqual(await windowsOf(), [48, 48, 48])

    const extended = await send('POST', `/portal/admin/schedule/series/${seriesId}/extend`, admin.headers, {
      last_date: addDays(monday, 28),
    })
    assert.equal(extended.status, 200, JSON.stringify(extended.body))
    assert.equal(extended.body.class_ids.length, 2)
    assert.deepEqual(await windowsOf(), [48, 48, 48, 48, 48])

    // A series with none leaves its classes on the studio default.
    const plain = await send('POST', '/portal/admin/schedule/series', admin.headers, {
      class_type_id: classTypeId,
      main_instructor_id: teacher.id,
      instructor_pay_sgd: 40,
      location_id: locationId,
      room_id: roomId,
      weekday: 1,
      start_time: '09:00',
      end_time: '10:00',
      capacity_online: 12,
      credit_cost: 1,
      first_date: monday,
      last_date: monday,
    })
    assert.equal(plain.status, 201, JSON.stringify(plain.body))
    assert.equal(plain.body.series.cancel_window_hours, null)
    const [only] = await harness.db
      .select({ hours: schema.classes.cancelWindowHours })
      .from(schema.classes)
      .where(eq(schema.classes.seriesId, plain.body.series.id))
    assert.equal(only!.hours, null)
  })

  /* ── Members are held to it ──────────────────────────────────────── */

  test('CXL-36 a class’s own window beats the studio default for a member’s cancel, both ways, and members are shown it', async () => {
    // Shorter: 6h, class 12h out — inside the studio's 24h, outside its own.
    const short = await addClass(12 * HOUR, 6)
    const early = await member()
    const earlyBooking = await booked(early, short.id)
    assert.equal((await memberCard(early, short.id)).effective_cancel_window_hours, 6)
    assert.equal((await upcomingRow(early, short.id)).effective_cancel_window_hours, 6)
    assert.equal(await creditsLeft(early), 9)
    const freed = await cancel(early, earlyBooking)
    assert.equal(freed.status, 200, JSON.stringify(freed.body))
    assert.equal(freed.body.refund_outcome, 'credit_returned')
    assert.equal(await creditsLeft(early), 10, 'in time by the class’s own window: the credit comes back')

    // Longer: 48h, class 30h out — outside the studio's 24h, inside its own.
    const long = await addClass(30 * HOUR, 48)
    const late = await member()
    const lateBooking = await booked(late, long.id)
    assert.equal((await upcomingRow(late, long.id)).effective_cancel_window_hours, 48)
    assertLate(await cancel(late, lateBooking), 48)
    assert.equal(await creditsLeft(late), 9, 'inside the class’s own window: the credit is not returned')
  })

  test('CXL-37 a class with no window of its own follows the studio default live, even after it was booked', async () => {
    const cls = await addClass(12 * HOUR, null)
    const who = await member()
    const bookingId = await booked(who, cls.id)
    assert.equal((await upcomingRow(who, cls.id)).effective_cancel_window_hours, STUDIO_HOURS)

    await setStudioHours(6)
    try {
      assert.equal((await upcomingRow(who, cls.id)).effective_cancel_window_hours, 6)
      assert.equal((await memberCard(who, cls.id)).effective_cancel_window_hours, 6)
      const res = await cancel(who, bookingId)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.refund_outcome, 'credit_returned')
      assert.equal(await creditsLeft(who), 10)
    } finally {
      await setStudioHours(STUDIO_HOURS)
    }
  })

  test('CXL-38 clearing a class’s window puts an existing booking back on the studio default', async () => {
    const cls = await addClass(12 * HOUR, 6)
    const who = await member()
    const bookingId = await booked(who, cls.id)
    assert.equal((await upcomingRow(who, cls.id)).effective_cancel_window_hours, 6)

    const cleared = await send('PATCH', `/portal/admin/schedule/classes/${cls.id}`, admin.headers, { cancel_window_hours: null })
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body))
    assert.equal((await upcomingRow(who, cls.id)).effective_cancel_window_hours, STUDIO_HOURS)
    assertLate(await cancel(who, bookingId), STUDIO_HOURS)
    assert.equal(await creditsLeft(who), 9, '12h out is inside the studio’s 24h: the credit is not returned')
  })

  /* ── The waitlist follows it ─────────────────────────────────────── */

  test('WTL-27 a class’s own window decides when its waitlist closes, and the refusal names that class’s hours', async () => {
    // 48h, class 30h out: the studio's 24h would still be open; its own is closed.
    const closed = await addClass(30 * HOUR, 48, { online: 1, waitlist: 3 })
    await booked(await member(), closed.id)
    const refused = await member()
    assert.equal((await memberCard(refused, closed.id)).waitlist.open, false)
    const res = await send('POST', `/me/waitlist/classes/${closed.id}`, refused.headers)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'waitlist_closed')
    assert.equal(res.body.window_hours, 48)

    // A full class answers a booking with its line's state, by its own window.
    const full = await send('POST', '/me/bookings/class', refused.headers, { class_id: closed.id })
    assert.equal(full.status, 409, JSON.stringify(full.body))
    assert.equal(full.body.error, 'class_full')
    assert.equal(full.body.waitlist_open, false)

    // 6h, class 12h out: the studio's 24h would be closed; its own is open.
    const open = await addClass(12 * HOUR, 6, { online: 1, waitlist: 3 })
    await booked(await member(), open.id)
    const waiter = await member()
    assert.equal((await memberCard(waiter, open.id)).waitlist.open, true)
    const joined = await send('POST', `/me/waitlist/classes/${open.id}`, waiter.headers)
    assert.equal(joined.status, 201, JSON.stringify(joined.body))
  })

  test('WTL-28 a freed seat is filled automatically by the class’s own window, and the promotion email’s cancel-by uses it', async () => {
    // 6h, class 12h out: inside the studio's 24h nobody would be moved.
    const cls = await addClass(12 * HOUR, 6, { online: 1, waitlist: 3 })
    const seated = await member()
    const seatBooking = await booked(seated, cls.id)
    const waiter = await member()
    const joined = await send('POST', `/me/waitlist/classes/${cls.id}`, waiter.headers)
    assert.equal(joined.status, 201, JSON.stringify(joined.body))

    const res = await cancel(seated, seatBooking)
    assert.equal(res.status, 200, JSON.stringify(res.body))

    const promoted = await harness.db
      .select()
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.clientId, waiter.clientId),
          eq(schema.bookings.classId, cls.id),
          eq(schema.bookings.state, 'confirmed'),
        ),
      )
    assert.equal(promoted.length, 1, 'the waiting member now holds the seat')

    const [mail] = await harness.db
      .select({ body: schema.emailLog.bodyRendered })
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.recipientEmail, waiter.email), eq(schema.emailLog.templateSlug, 'class_waitlist_promoted')))
    assert.ok(mail, 'the promoted member is emailed')
    const [tenant] = await harness.db
      .select({ timezone: schema.tenants.timezone })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, one.id))
    const timeZone = tenant!.timezone
    const cancelBy = new Date(cls.startsAt.getTime() - 6 * HOUR)
    const date = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })
    const expected = `${date.format(cancelBy)}, ${time.format(cancelBy)}`
    assert.ok(mail.body.includes(expected), `expected the cancel-by "${expected}" in: ${mail.body}`)

    // 48h, class 30h out: the studio's 24h would still promote; its own window does not.
    const long = await addClass(30 * HOUR, 48, { online: 1, waitlist: 3 })
    const holder = await member()
    const holderBooking = await booked(holder, long.id)
    const next = await member()
    const inLine = await send('POST', `/me/waitlist/classes/${long.id}`, next.headers)
    // Joined before the class's own window closed it: written directly, as the
    // join itself is refused now (WTL-27).
    assert.equal(inLine.status, 409, JSON.stringify(inLine.body))
    const [entry] = await harness.db
      .insert(schema.waitlistEntries)
      .values({ tenantId: one.id, clientId: next.clientId, classId: long.id, status: 'waiting' })
      .returning({ id: schema.waitlistEntries.id })
    assertLate(await cancel(holder, holderBooking), 48)
    const [still] = await harness.db
      .select({ status: schema.waitlistEntries.status })
      .from(schema.waitlistEntries)
      .where(eq(schema.waitlistEntries.id, entry!.id))
    assert.equal(still!.status, 'waiting', 'inside the class’s own window nobody is moved automatically')
  })
})
