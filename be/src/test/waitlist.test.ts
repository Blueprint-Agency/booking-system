import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import postgres from 'postgres'
import {
  inTenantContext,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  TEST_DATABASE_URL,
  type TestApp,
} from './harness'
import { isoWeekday, localDateOf } from '../services/schedule/series-dates'
import { abortOnce } from './abort-once'

const run = Date.now().toString(36)
const DOMAIN = `${run}.waitlist.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Waitlist class type ${run}`
const PACKAGE_NAME = `Waitlist pass ${run}`
const FLAG = 'waitlist_enabled'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The class waitlist over HTTP (spec-waitlist.md §3–§6, §8, §9, §11).
 *
 * A member joins the line of a class whose online seats are full; joining costs
 * nothing. When a confirmed online booking is cancelled outside the
 * Cancellation Window, the first member in line whose package can pay is
 * booked in the same transaction, debited, and emailed. Inside the window
 * nobody is moved; a buffer or overbook seat never promotes.
 *
 * Fixtures — classes, packages, staff — are written directly; every rule under
 * test runs behind a route. The studio switch is turned on through the admin
 * route and off again at the end: the flag cache is the process's, and the
 * other suites in this run expect the waitlist off.
 */
describe('class waitlist over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let jobs!: typeof import('../jobs')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')
  let ptPackagesSvc!: typeof import('../services/packages/pt-packages')

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Staff = { id: string; headers: Headers }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    classPackageId: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; headers: Headers; email: string }

  let one!: Studio
  let two!: Studio

  const emailFor = (name: string, at: { slug: string }) => `${name}-${at.slug}@${DOMAIN}`

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

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(name, tenant)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, tenant.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { id: row!.id, headers }
  }

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
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
    }
  }

  /** A class starting `startsIn` from now (three days by default), one credit a seat. */
  async function addClass(
    at: Studio,
    capacity: { online: number; buffer?: number; waitlist: number },
    startsIn = 3 * DAY,
  ): Promise<string> {
    const startsAt = new Date(Date.now() + startsIn)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.instructor.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: capacity.online,
        capacityBuffer: capacity.buffer ?? 0,
        capacityWaitlist: capacity.waitlist,
        creditCost: 1,
        createdByStaffId: at.admin.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  let memberSeq = 0
  /** A member of `at`, signed in there, holding a 10-credit bundle unless `withBundle` is false. */
  async function member(at: Studio, withBundle = true): Promise<Member> {
    const name = `member${++memberSeq}`
    const email = emailFor(name, at)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    if (withBundle) {
      await purchaseSvc.grantPackage(at.id, {
        clientId: client!.id,
        purchaseId: null,
        amountSgd: '200.00',
        packageKind: 'class',
        packageId: at.classPackageId,
      })
    }
    return { clientId: client!.id, headers, email }
  }

  const book = (who: Member, classId: string) => send('POST', '/me/bookings/class', who.headers, { class_id: classId })
  const cancel = (who: Member, bookingId: string) => send('DELETE', `/me/bookings/${bookingId}`, who.headers)
  const joinLine = (who: Member, classId: string) => send('POST', `/me/waitlist/classes/${classId}`, who.headers)
  const leaveLine = (who: Member, entryId: string) => send('DELETE', `/me/waitlist/${entryId}`, who.headers)
  const myLines = async (who: Member) => {
    const res = await send('GET', '/me/waitlist', who.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body.entries as Array<{ id: string; class_id: string; position: number }>
  }
  const setFlag = (at: Studio, enabled: boolean) =>
    send('PATCH', `/portal/admin/feature-flags/${FLAG}`, at.admin.headers, { enabled })

  async function booked(who: Member, classId: string) {
    const res = await book(who, classId)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.booking_id as string
  }

  async function joined(who: Member, classId: string) {
    const res = await joinLine(who, classId)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body as { entry_id: string; position: number }
  }

  /** The member's own view of a class, as `/me/classes` shows it. */
  async function memberCard(who: Member, classId: string) {
    const from = new Date(Date.now() - DAY).toISOString()
    const to = new Date(Date.now() + 10 * DAY).toISOString()
    const res = await send('GET', `/me/classes?from=${from}&to=${to}`, who.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const card = res.body.classes.find((c: { id: string }) => c.id === classId)
    assert.ok(card, `class ${classId} missing from /me/classes`)
    return card
  }

  async function publicDetail(at: Studio, classId: string) {
    const res = await reply(
      await harness.app.request(`/api/v1/public/classes/${classId}`, { headers: { 'X-Tenant-Slug': at.slug } }),
    )
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body
  }

  async function creditsLeft(who: Member): Promise<number> {
    const rows = await harness.db
      .select({ left: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.clientId, who.clientId))
    return rows.reduce((sum, r) => sum + (r.left ?? 0), 0)
  }

  async function confirmedOn(who: Member, classId: string) {
    return harness.db
      .select()
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.clientId, who.clientId),
          eq(schema.bookings.classId, classId),
          eq(schema.bookings.state, 'confirmed'),
        ),
      )
  }

  async function entryStatus(entryId: string) {
    const [row] = await harness.db.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, entryId))
    return row!
  }

  async function promotedMails(who: Member) {
    return harness.db
      .select()
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.recipientEmail, who.email), eq(schema.emailLog.templateSlug, 'class_waitlist_promoted')))
  }

  /** A full class of `online` seats, each taken by a fresh member. Returns them with their bookings. */
  async function fullClass(at: Studio, capacity: { online: number; buffer?: number; waitlist: number }, startsIn?: number) {
    const classId = await addClass(at, capacity, startsIn)
    const seated: Array<{ who: Member; bookingId: string }> = []
    for (let i = 0; i < capacity.online; i++) {
      const who = await member(at)
      seated.push({ who, bookingId: await booked(who, classId) })
    }
    return { classId, seated }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    jobs = await import('../jobs')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    assert.equal((await setFlag(one, true)).status, 200)
    assert.equal((await setFlag(two, true)).status, 200)
  })

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    // Off again in this process's cache, then gone from the table.
    if (one) await setFlag(one, false)
    if (two) await setFlag(two, false)
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM feature_flags WHERE key = ${FLAG} AND updated_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM waitlist_entries WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
    const sessions = sql`SELECT id FROM pt_sessions WHERE pt_request_id IN (${requests})`
    await harness.db.execute(sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${sessions})`)
    await harness.db.execute(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (${sessions})`)
    await harness.db.execute(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${requests})`)
    await harness.db.execute(sql`DELETE FROM pt_sessions WHERE id IN (${sessions})`)
    await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_series WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name IN (${PACKAGE_NAME}, ${`Waitlist refused ${run}`})`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name = ${`Waitlist PT ${run}`}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE name IN (${`Waitlist series room ${run}`}, ${`Waitlist PT room ${run}`})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── Joining ─────────────────────────────────────────────────────── */

  test('WTL-01 a member joins a full class’s waitlist at position 1, and nothing is spent', async () => {
    const { classId } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)

    const before = await memberCard(waiter, classId)
    assert.equal(before.has_seats, false)
    assert.deepEqual(before.waitlist, { enabled: true, open: true, my_entry: null })

    const entry = await joined(waiter, classId)
    assert.equal(entry.position, 1)
    assert.equal(await creditsLeft(waiter), 10, 'joining the line costs nothing')

    const after = await memberCard(waiter, classId)
    assert.deepEqual(after.waitlist, {
      enabled: true,
      open: true,
      my_entry: { id: entry.entry_id, position: 1 },
    })
    // The public catalogue says the line is open, and neither counts it nor
    // names anybody in it.
    assert.deepEqual((await publicDetail(one, classId)).waitlist, {
      enabled: true,
      open: true,
      my_entry: null,
    })

    const second = await joined(await member(one), classId)
    assert.equal(second.position, 2)

    const listed = await myLines(waiter)
    assert.deepEqual(
      listed.map(e => ({ id: e.id, class_id: e.class_id, position: e.position })),
      [{ id: entry.entry_id, class_id: classId, position: 1 }],
    )
  })

  test('WTL-02 a full line refuses the next member with waitlist_full, and the class reads not open', async () => {
    const { classId } = await fullClass(one, { online: 1, waitlist: 1 })
    await joined(await member(one), classId)

    const late = await member(one)
    const res = await joinLine(late, classId)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'waitlist_full')
    assert.equal((await memberCard(late, classId)).waitlist.open, false)
  })

  test('WTL-03 inside the Cancellation Window the line is closed: waitlist_closed with the window', async () => {
    // The seeded policy's class window is 24 hours.
    const { classId } = await fullClass(one, { online: 1, waitlist: 3 }, 20 * HOUR)
    const late = await member(one)
    const res = await joinLine(late, classId)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'waitlist_closed')
    assert.equal(res.body.window_hours, 24)
    assert.equal((await memberCard(late, classId)).waitlist.open, false)
  })

  test('WTL-04 a class with a free online seat refuses the line with class_not_full', async () => {
    const classId = await addClass(one, { online: 2, waitlist: 3 })
    await booked(await member(one), classId)
    const res = await joinLine(await member(one), classId)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'class_not_full')
  })

  test('WTL-05 a member already booked, or already waiting, is refused', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const onIt = await joinLine(seated[0]!.who, classId)
    assert.equal(onIt.status, 409, JSON.stringify(onIt.body))
    assert.equal(onIt.body.error, 'already_booked')

    const waiter = await member(one)
    await joined(waiter, classId)
    const again = await joinLine(waiter, classId)
    assert.equal(again.status, 409, JSON.stringify(again.body))
    assert.equal(again.body.error, 'already_waitlisted')
  })

  test('WTL-06 a member no package can pay for is refused with the booking’s own reason', async () => {
    const { classId } = await fullClass(one, { online: 1, waitlist: 3 })
    const res = await joinLine(await member(one, false), classId)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'insufficient_credits')
  })

  /* ── Promotion ───────────────────────────────────────────────────── */

  test('WTL-07 a cancel outside the window books #1: confirmed, debited, entry promoted, one email', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const first = await member(one)
    const second = await member(one)
    const entry = await joined(first, classId)
    await joined(second, classId)

    const res = await cancel(seated[0]!.who, seated[0]!.bookingId)
    assert.equal(res.status, 200, JSON.stringify(res.body))

    const [promoted] = await confirmedOn(first, classId)
    assert.ok(promoted, '#1 now holds the seat')
    assert.equal(promoted.seat, 'online')
    assert.ok(promoted.qrToken && promoted.code, 'a promoted booking is a booking like any other')
    assert.equal(await creditsLeft(first), 9)

    const row = await entryStatus(entry.entry_id)
    assert.equal(row.status, 'promoted')
    assert.equal(row.bookingId, promoted.id)

    assert.equal((await promotedMails(first)).length, 1)
    assert.equal((await promotedMails(second)).length, 0)

    // #2 moves up, and the class is full again with them still in line.
    assert.deepEqual((await myLines(second)).map(e => e.position), [1])
    const card = await memberCard(first, classId)
    assert.equal(card.is_booked, true)
    assert.equal(card.has_seats, false)
    assert.equal(card.waitlist.my_entry, null)
  })

  test('WTL-08 when #1 cannot pay, #2 is booked and #1 stays in line', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const broke = await member(one)
    const next = await member(one)
    const brokeEntry = await joined(broke, classId)
    await joined(next, classId)
    // #1 spends their package elsewhere after joining.
    await harness.db
      .update(schema.clientPackages)
      .set({ creditsOrSessionsRemaining: 0 })
      .where(eq(schema.clientPackages.clientId, broke.clientId))

    await cancel(seated[0]!.who, seated[0]!.bookingId)

    assert.equal((await confirmedOn(broke, classId)).length, 0)
    assert.equal((await confirmedOn(next, classId)).length, 1)
    assert.equal(await creditsLeft(next), 9)
    assert.equal((await entryStatus(brokeEntry.entry_id)).status, 'waiting')
    assert.deepEqual((await myLines(broke)).map(e => e.position), [1])
  })

  test('WTL-09 a cancel inside the window promotes nobody', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)
    const entry = await joined(waiter, classId)

    // The class is now 20 hours away: inside the 24-hour window. Staff cancel,
    // since a member can no longer.
    harness.clock.set(new Date(Date.now() + 3 * DAY - 20 * HOUR))
    try {
      const res = await send('POST', `/portal/admin/bookings/${seated[0]!.bookingId}/cancel`, one.admin.headers, { credit: 'return' })
      assert.equal(res.status, 200, JSON.stringify(res.body))
    } finally {
      harness.clock.reset()
    }

    assert.equal((await confirmedOn(waiter, classId)).length, 0)
    assert.equal((await entryStatus(entry.entry_id)).status, 'waiting')
    assert.equal(await creditsLeft(waiter), 10)
  })

  test('WTL-10 two cancels at once with one member waiting book them exactly once', async () => {
    const { classId, seated } = await fullClass(one, { online: 2, waitlist: 3 })
    const waiter = await member(one)
    await joined(waiter, classId)

    const results = await Promise.all(seated.map(s => cancel(s.who, s.bookingId)))
    for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body))

    assert.equal((await confirmedOn(waiter, classId)).length, 1)
    assert.equal(await creditsLeft(waiter), 9, 'debited once')
    assert.equal((await promotedMails(waiter)).length, 1)
    assert.equal((await memberCard(waiter, classId)).has_seats, true, 'the second freed seat stays free')
  })

  test('WTL-16 a promoted member cancels under the normal policy and gets the credit back', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)
    await joined(waiter, classId)
    await cancel(seated[0]!.who, seated[0]!.bookingId)
    const [promoted] = await confirmedOn(waiter, classId)
    assert.ok(promoted)
    assert.equal(await creditsLeft(waiter), 9)

    const res = await cancel(waiter, promoted.id)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.refund_outcome, 'credit_returned')
    assert.equal(await creditsLeft(waiter), 10)
  })

  test('SEAT-03 a cancelled buffer or overbook booking promotes nobody', async () => {
    const classId = await addClass(one, { online: 1, buffer: 1, waitlist: 3 })
    await booked(await member(one), classId)
    const walkIn = await member(one)
    const staffBooked = await send('POST', `/portal/admin/schedule/classes/${classId}/bookings`, one.admin.headers, {
      client_id: walkIn.clientId,
    })
    assert.equal(staffBooked.status, 201, JSON.stringify(staffBooked.body))
    assert.equal(staffBooked.body.seat, 'buffer')
    const extra = await member(one)
    const overbooked = await send('POST', `/portal/admin/schedule/classes/${classId}/bookings`, one.admin.headers, {
      client_id: extra.clientId,
      overbook: true,
    })
    assert.equal(overbooked.body.seat, 'overbook')

    const waiter = await member(one)
    const entry = await joined(waiter, classId)

    for (const id of [staffBooked.body.booking_id, overbooked.body.booking_id]) {
      const res = await send('POST', `/portal/admin/bookings/${id}/cancel`, one.admin.headers, { credit: 'return' })
      assert.equal(res.status, 200, JSON.stringify(res.body))
    }
    assert.equal((await confirmedOn(waiter, classId)).length, 0)
    assert.equal((await entryStatus(entry.entry_id)).status, 'waiting')
  })

  test('SEAT-01 staff Add member takes a free online seat while members are waiting', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, buffer: 1, waitlist: 3 })
    const waiter = await member(one)
    const entry = await joined(waiter, classId)
    const walkIn = await member(one)

    // Inside the window a freed online seat is not promoted, so the class has
    // one free with a member in line. Staff may still take it.
    harness.clock.set(new Date(Date.now() + 3 * DAY - 20 * HOUR))
    try {
      const freed = await send('POST', `/portal/admin/bookings/${seated[0]!.bookingId}/cancel`, one.admin.headers, {
        credit: 'return',
      })
      assert.equal(freed.status, 200, JSON.stringify(freed.body))
      assert.equal((await entryStatus(entry.entry_id)).status, 'waiting')

      const res = await send('POST', `/portal/admin/schedule/classes/${classId}/bookings`, one.admin.headers, {
        client_id: walkIn.clientId,
      })
      assert.equal(res.status, 201, JSON.stringify(res.body))
      assert.equal(res.body.seat, 'online')
    } finally {
      harness.clock.reset()
    }
    assert.equal((await confirmedOn(walkIn, classId)).length, 1)
    assert.equal((await entryStatus(entry.entry_id)).status, 'waiting', 'the line keeps its place')
  })

  test('SEAT-01 cancelling a staff booking that holds an online seat promotes the head of the line', async () => {
    const classId = await addClass(one, { online: 1, buffer: 1, waitlist: 3 })
    const walkIn = await member(one)
    const staffBooked = await send('POST', `/portal/admin/schedule/classes/${classId}/bookings`, one.admin.headers, {
      client_id: walkIn.clientId,
    })
    assert.equal(staffBooked.status, 201, JSON.stringify(staffBooked.body))
    assert.equal(staffBooked.body.seat, 'online')

    const waiter = await member(one)
    const entry = await joined(waiter, classId)

    const res = await send('POST', `/portal/admin/bookings/${staffBooked.body.booking_id}/cancel`, one.admin.headers, {
      credit: 'return',
    })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal((await confirmedOn(waiter, classId)).length, 1)
    assert.equal((await entryStatus(entry.entry_id)).status, 'promoted')
    assert.equal(await creditsLeft(waiter), 9)
  })

  test('staff booking a full class is told whether the line is open and how long it is', async () => {
    const classId = await addClass(one, { online: 1, buffer: 0, waitlist: 4 })
    await booked(await member(one), classId)
    await joined(await member(one), classId)

    const res = await send('POST', `/portal/admin/schedule/classes/${classId}/bookings`, one.admin.headers, {
      client_id: (await member(one)).clientId,
    })
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.deepEqual(res.body, { error: 'class_full', waitlist_open: true, waiting: 1, capacity_waitlist: 4 })
  })

  test('CAT-10 a member booking a full class is told only whether the line is open, not how long it is', async () => {
    const classId = await addClass(one, { online: 1, buffer: 0, waitlist: 4 })
    await booked(await member(one), classId)
    await joined(await member(one), classId)

    const res = await book(await member(one), classId)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.deepEqual(res.body, { error: 'class_full', waitlist_open: true })
  })

  test('a member who books a freed seat by hand leaves the line', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const broke = await member(one)
    const entry = await joined(broke, classId)
    await harness.db
      .update(schema.clientPackages)
      .set({ creditsOrSessionsRemaining: 0 })
      .where(eq(schema.clientPackages.clientId, broke.clientId))
    // Nobody in line can pay, so the freed seat stays free…
    await cancel(seated[0]!.who, seated[0]!.bookingId)
    assert.equal((await entryStatus(entry.entry_id)).status, 'waiting')

    // …until the member tops up and books it themselves.
    await harness.db
      .update(schema.clientPackages)
      .set({ creditsOrSessionsRemaining: 5 })
      .where(eq(schema.clientPackages.clientId, broke.clientId))
    await booked(broke, classId)
    assert.equal((await entryStatus(entry.entry_id)).status, 'withdrawn')
    assert.deepEqual(await myLines(broke), [])
  })

  /* ── Leaving, expiry, class cancel ───────────────────────────────── */

  test('WTL-11 leaving the line is not a cancellation: withdrawn, nothing recorded against the member', async () => {
    const { classId } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)
    const behind = await member(one)
    const entry = await joined(waiter, classId)
    await joined(behind, classId)

    const res = await leaveLine(waiter, entry.entry_id)
    assert.equal(res.status, 204, JSON.stringify(res.body))
    assert.equal((await entryStatus(entry.entry_id)).status, 'withdrawn')
    assert.deepEqual(await myLines(waiter), [])
    assert.deepEqual((await myLines(behind)).map(e => e.position), [1])

    const cancellations = await harness.db
      .select()
      .from(schema.cancellations)
      .where(eq(schema.cancellations.clientId, waiter.clientId))
    assert.equal(cancellations.length, 0)

    // Twice, or someone else's, is not found.
    assert.equal((await leaveLine(waiter, entry.entry_id)).status, 404)
    const theirs = await joined(await member(one), classId)
    const notMine = await leaveLine(behind, theirs.entry_id)
    assert.equal(notMine.status, 404)
    assert.equal(notMine.body.error, 'waitlist_entry_not_found')
  })

  /**
   * Wait until `n` requests are queued on a lock (or `stop()` says the call has answered). Fails
   * after `deadlineMs`, saying how many queued against how many were expected, so a lock order
   * that is not reached fails the test instead of hanging the run.
   */
  async function untilRowLockWaiters(
    n: number,
    stop: () => boolean,
    events = 'transactionid,tuple',
    deadlineMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + deadlineMs
    let seen = 0
    while (!stop()) {
      const [row] = (await harness.db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = ANY(string_to_array(${events}, ','))`)) as unknown as { n: number }[]
      seen = Number(row?.n ?? 0)
      if (seen >= n) return
      assert.ok(
        Date.now() < deadline,
        `only ${seen} of ${n} requests queued on a ${events} lock within ${deadlineMs} ms: a request never queued behind the held lock`,
      )
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }

  const holdPackagesOf = (...members: Member[]) =>
    holdRows(tx => tx`SELECT id FROM client_packages WHERE client_id IN ${tx(members.map(m => m.clientId))} FOR UPDATE`)

  async function holdRows(lock: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<{ release: () => Promise<void> }> {
    const holder = postgres(TEST_DATABASE_URL!, { max: 1 })
    let letGo!: () => void
    const released = new Promise<void>(resolve => (letGo = resolve))
    let locked!: () => void
    const held = new Promise<void>(resolve => (locked = resolve))
    const holding = holder.begin(async tx => {
      await lock(tx)
      locked()
      await released
    })
    const release = async () => {
      letGo()
      await holding.finally(() => holder.end({ timeout: 5 }))
    }
    await Promise.race([held, holding]).catch(async err => {
      await release()
      throw err
    })
    return { release }
  }

  async function leaveWhilePaying(waiter: Member, entryId: string, promote: () => Promise<Reply>) {
    const promotionWaits = 1
    const leaveWaitsToo = 2
    const packages = await holdPackagesOf(waiter)
    try {
      let promoted = false
      const promoting = promote().finally(() => (promoted = true))
      await untilRowLockWaiters(promotionWaits, () => promoted)
      let left = false
      const leaving = leaveLine(waiter, entryId).finally(() => (left = true))
      await untilRowLockWaiters(leaveWaitsToo, () => left)

      await packages.release()
      return { promote: await promoting, leave: await leaving }
    } finally {
      await packages.release()
    }
  }

  async function heldBy(waiter: Member, classId: string, entryId: string) {
    return {
      entry: (await entryStatus(entryId)).status,
      booked: (await confirmedOn(waiter, classId)).length,
      credits: await creditsLeft(waiter),
      emails: (await promotedMails(waiter)).length,
    }
  }

  test('WTL-33 a member who leaves the line while a cancel books them into the freed seat is left or booked, never told they left and then charged', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)
    const entry = await joined(waiter, classId)

    const answers = await leaveWhilePaying(waiter, entry.entry_id, () => cancel(seated[0]!.who, seated[0]!.bookingId))
    assert.equal(answers.promote.status, 200, JSON.stringify(answers.promote.body))

    const seen = { leave: answers.leave.status, error: answers.leave.body?.error ?? null, ...(await heldBy(waiter, classId, entry.entry_id)) }
    const leftFirst = { leave: 204, error: null, entry: 'withdrawn', booked: 0, credits: 10, emails: 0 }
    const bookedFirst = { leave: 404, error: 'waitlist_entry_not_found', entry: 'promoted', booked: 1, credits: 9, emails: 1 }
    assert.deepEqual(seen, seen.leave === 204 ? leftFirst : bookedFirst, 'the leave and the promotion took turns')
  })

  test('WTL-34 a member who leaves the line while staff Add them to the class is left or booked, never told they left and then charged', async () => {
    const { classId } = await fullClass(one, { online: 1, buffer: 1, waitlist: 3 })
    const waiter = await member(one)
    const entry = await joined(waiter, classId)

    const answers = await leaveWhilePaying(waiter, entry.entry_id, () =>
      send('POST', `/portal/admin/schedule/classes/${classId}/waitlist/${entry.entry_id}/promote`, one.admin.headers, {}),
    )

    const seen = { add: answers.promote.status, leave: answers.leave.status, ...(await heldBy(waiter, classId, entry.entry_id)) }
    const leftFirst = { add: 404, leave: 204, entry: 'withdrawn', booked: 0, credits: 10, emails: 0 }
    const addedFirst = { add: 201, leave: 404, entry: 'promoted', booked: 1, credits: 9, emails: 1 }
    assert.deepEqual(seen, seen.leave === 204 ? leftFirst : addedFirst, 'the leave and the Add to class took turns')
  })

  test('WTL-35 two members who each wait on the class the other is cancelling cancel at the same moment: both cancels stand, and each is booked into the seat the other freed', async () => {
    const early = await addClass(one, { online: 1, waitlist: 3 })
    const later = await addClass(one, { online: 1, waitlist: 3 }, 3 * DAY + 2 * HOUR)
    const ann = await member(one)
    const ben = await member(one)
    const annSeat = await booked(ann, early)
    const benSeat = await booked(ben, later)
    const annEntry = await joined(ann, later)
    const benEntry = await joined(ben, early)

    const packages = await holdPackagesOf(ann, ben)
    let answers: Reply[]
    try {
      let settled = false
      const annCancel = cancel(ann, annSeat).finally(() => (settled = true))
      await untilRowLockWaiters(1, () => settled)
      const benCancel = cancel(ben, benSeat).finally(() => (settled = true))
      await untilRowLockWaiters(2, () => settled)
      await packages.release()
      answers = await Promise.all([annCancel, benCancel])
    } finally {
      await packages.release()
    }

    for (const answer of answers) {
      assert.equal(answer.status, 200, JSON.stringify(answer.body))
      assert.equal(answer.body.refund_outcome, 'credit_returned')
    }
    assert.equal((await confirmedOn(ben, early)).length, 1)
    assert.equal((await confirmedOn(ann, later)).length, 1)
    assert.equal((await entryStatus(benEntry.entry_id)).status, 'promoted')
    assert.equal((await entryStatus(annEntry.entry_id)).status, 'promoted')
    assert.equal(await creditsLeft(ann), 9)
    assert.equal(await creditsLeft(ben), 9)
    assert.equal((await promotedMails(ann)).length, 1)
    assert.equal((await promotedMails(ben)).length, 1)
  })

  test('WTL-37 the expiry sweep ends a waiting entry while a cancel that would promote it waits on the member’s packages: the expiry stands, and nothing is booked, debited or emailed', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)
    const entry = await joined(waiter, classId)

    const packages = await holdPackagesOf(waiter)
    let answer: Reply
    try {
      let settled = false
      const cancelling = cancel(seated[0]!.who, seated[0]!.bookingId).finally(() => (settled = true))
      await untilRowLockWaiters(1, () => settled)
      harness.clock.set(new Date(Date.now() + 3 * DAY + 5 * 60 * 1000))
      try {
        await jobs.scheduledJobs.expireWaitlists()
      } finally {
        harness.clock.reset()
      }
      await packages.release()
      answer = await cancelling
    } finally {
      await packages.release()
    }

    assert.equal(answer.status, 200, JSON.stringify(answer.body))
    assert.equal((await entryStatus(entry.entry_id)).status, 'expired')
    assert.equal((await confirmedOn(waiter, classId)).length, 0)
    assert.equal(await creditsLeft(waiter), 10)
    assert.equal((await promotedMails(waiter)).length, 0)
  })

  const grantOf =
    (packageKind: 'class' | 'pt', packageId: string, opts: { complimentary?: boolean } = {}) =>
    async (who: Member) =>
      (
        await purchaseSvc.grantPackage(one.id, {
          clientId: who.clientId,
          purchaseId: null,
          amountSgd: opts.complimentary ? '0.00' : '200.00',
          packageKind,
          packageId,
          ...opts,
        })
      ).clientPackageId

  async function byPackageOrder(grant: (who: Member) => Promise<string>): Promise<{ lower: Member; higher: Member; pkg: Map<Member, string> }> {
    const pair = [await member(one, false), await member(one, false)]
    const pkg = new Map([[pair[0]!, await grant(pair[0]!)], [pair[1]!, await grant(pair[1]!)]])
    const [lower, higher] = pair.sort((a, b) => (pkg.get(a)! < pkg.get(b)! ? -1 : 1)) as [Member, Member]
    return { lower, higher, pkg }
  }

  async function inTurn(hold: () => Promise<{ release: () => Promise<void> }>, calls: Array<() => Promise<Reply>>): Promise<Reply[]> {
    const held = await hold()
    try {
      let settled = false
      const started: Promise<Reply>[] = []
      for (const call of calls) {
        started.push(call().finally(() => (settled = true)))
        await untilRowLockWaiters(started.length, () => settled)
      }
      await held.release()
      return await Promise.all(started)
    } finally {
      await held.release()
    }
  }

  test('WTL-38 a member frees a seat whose line waits on another class while an Admin cancels that class whole: both go through in either order, and the head of the line is booked', async () => {
    for (const first of ['member', 'admin'] as const) {
      for (const bookedFirst of ['higher', 'lower'] as const) {
        const round = `${first} first, the ${bookedFirst} package booked first on the cancelled class`
        const full = await addClass(one, { online: 1, waitlist: 3 })
        const other = await addClass(one, { online: 2, waitlist: 0 }, 5 * DAY)
        const seated = await member(one)
        const seat = await booked(seated, full)
        const { lower, higher } = await byPackageOrder(grantOf('class', one.classPackageId))
        for (const w of bookedFirst === 'higher' ? [higher, lower] : [lower, higher]) await booked(w, other)
        const head = await joined(lower, full)
        await joined(higher, full)

        const memberCancel = () => cancel(seated, seat)
        const classCancel = () => send('POST', `/portal/admin/schedule/classes/${other}/cancel`, one.admin.headers)
        const answers = await inTurn(
          () => holdPackagesOf(first === 'member' ? lower : higher),
          first === 'member' ? [memberCancel, classCancel] : [classCancel, memberCancel],
        )
        const [byMember, byAdmin] = (first === 'member' ? answers : [...answers].reverse()) as [Reply, Reply]

        assert.equal(byMember.status, 200, `${round}: ${JSON.stringify(byMember.body)}`)
        assert.equal(byMember.body.refund_outcome, 'credit_returned', round)
        assert.equal(byAdmin.status, 200, `${round}: ${JSON.stringify(byAdmin.body)}`)
        assert.equal((await confirmedOn(lower, full)).length, 1, `${round}: the head of the line holds the freed seat`)
        assert.equal((await entryStatus(head.entry_id)).status, 'promoted', round)
        assert.equal((await confirmedOn(lower, other)).length + (await confirmedOn(higher, other)).length, 0, round)
        assert.deepEqual([await creditsLeft(seated), await creditsLeft(lower), await creditsLeft(higher)], [10, 9, 10], round)
        assert.equal((await promotedMails(lower)).length, 1, round)
      }
    }
  })

  test('WTL-39 a cancel reaches the head of the line while the expiry sweep is ending their entry: the promotion passes them by without waiting, and the expiry stands', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)
    const entry = await joined(waiter, classId)

    const sweep = await holdRows(async tx => {
      const ended = await tx`UPDATE waitlist_entries SET status = 'expired', resolved_at = now(), resolved_by = 'system' WHERE id = ${entry.entry_id} AND status = 'waiting'`
      assert.equal(ended.count, 1, 'the sweep is ending the entry')
    })
    let answer: Reply
    let answeredMidSweep: boolean
    try {
      let settled = false
      const cancelling = cancel(seated[0]!.who, seated[0]!.bookingId).finally(() => (settled = true))
      await untilRowLockWaiters(1, () => settled)
      answeredMidSweep = settled
      await sweep.release()
      answer = await cancelling
    } finally {
      await sweep.release()
    }

    assert.equal(answer.status, 200, JSON.stringify(answer.body))
    assert.equal(answer.body.refund_outcome, 'credit_returned')
    assert.equal((await entryStatus(entry.entry_id)).status, 'expired')
    assert.equal((await confirmedOn(waiter, classId)).length, 0)
    assert.equal(await creditsLeft(waiter), 10)
    assert.equal((await promotedMails(waiter)).length, 0)
    assert.ok(answeredMidSweep, 'the promotion did not wait for the sweep')
  })

  const holdPackage = (id: string) => holdRows(tx => tx`SELECT id FROM client_packages WHERE id = ${id} FOR UPDATE`)

  const seatFirstInCancelOrder = (ptSessionId: string, who: Member) =>
    harness.db
      .update(schema.bookings)
      .set({ bookedAt: sql`${schema.bookings.bookedAt} - interval '1 minute'` })
      .where(and(eq(schema.bookings.ptSessionId, ptSessionId), eq(schema.bookings.clientId, who.clientId)))

  test('WTL-40 a member frees a seat whose line holds both members of a two-to-one private session while an Admin cancels that session: both go through in either order', async () => {
    const pt = await ptPackagesSvc.createPtPackage(one.id, { name: `Waitlist PT ${run}`, sessionType: '2on1', numSessions: 10, validityDays: 90, priceSgd: '900.00' })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: one.id, locationId: one.locationId, name: `Waitlist PT room ${run}`, capacity: 2 })
      .returning({ id: schema.rooms.id })
    const instructor = await staffAt(one, 'pt-instructor', 'instructor')
    for (const [i, first] of (['member', 'admin'] as const).entries()) {
      const { lower, higher, pkg } = await byPackageOrder(grantOf('pt', pt.id))
      for (const w of [lower, higher]) await grantOf('class', one.classPackageId)(w)
      const startsAt = new Date(Date.now() + 20 * DAY + i * 3 * HOUR)
      const created = await send('POST', '/portal/admin/pt-sessions/manual', one.admin.headers, {
        location_id: one.locationId,
        room_id: room!.id,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        session_type: '2on1',
        instructor_pay_sgd: 60,
        instructor_id: instructor.id,
        members: [lower, higher].map(w => ({ client_id: w.clientId, client_package_id: pkg.get(w) })),
      })
      assert.equal(created.status, 201, JSON.stringify(created.body))
      const sessionId = created.body.pt_request.session.id as string
      await seatFirstInCancelOrder(sessionId, higher)

      const full = await addClass(one, { online: 1, waitlist: 3 })
      const seated = await member(one)
      const seat = await booked(seated, full)
      const head = await joined(lower, full)
      await joined(higher, full)

      const memberCancel = () => cancel(seated, seat)
      const sessionCancel = () => send('POST', `/portal/admin/pt-sessions/${created.body.pt_request.id}/cancel`, one.admin.headers)
      const answers = await inTurn(
        () => holdPackage(pkg.get(first === 'member' ? lower : higher)!),
        first === 'member' ? [memberCancel, sessionCancel] : [sessionCancel, memberCancel],
      )
      const [byMember, byAdmin] = (first === 'member' ? answers : [...answers].reverse()) as [Reply, Reply]

      assert.equal(byMember.status, 200, `${first} first: ${JSON.stringify(byMember.body)}`)
      assert.equal(byAdmin.status, 200, `${first} first: ${JSON.stringify(byAdmin.body)}`)
      assert.equal((await confirmedOn(lower, full)).length, 1, `${first} first: the head of the line holds the freed seat`)
      assert.equal((await entryStatus(head.entry_id)).status, 'promoted', first)
      const seats = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.ptSessionId, sessionId))
      assert.deepEqual(seats.map(s => s.state), ['cancelled', 'cancelled'], first)
    }
  })

  test('WTL-41 a member frees a seat whose line holds two members while an Admin’s Package rule change cancels both their bookings on another class: both go through in either order', async () => {
    const refused = await classPackagesSvc.createClassPackage(one.id, { name: `Waitlist refused ${run}`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '100.00' })
    for (const first of ['member', 'admin'] as const) {
      for (const bookedFirst of ['higher', 'lower'] as const) {
        const round = `${first} first, the ${bookedFirst} package booked first on the changed class`
        const changed = await addClass(one, { online: 2, waitlist: 0 }, 5 * DAY)
        const { lower, higher, pkg } = await byPackageOrder(grantOf('class', refused.id))
        for (const w of bookedFirst === 'higher' ? [higher, lower] : [lower, higher]) await booked(w, changed)
        const full = await addClass(one, { online: 1, waitlist: 3 })
        const seated = await member(one)
        const seat = await booked(seated, full)
        const head = await joined(lower, full)
        await joined(higher, full)

        const memberCancel = () => cancel(seated, seat)
        const ruleChange = () =>
          send('PATCH', `/portal/admin/schedule/classes/${changed}`, one.admin.headers, {
            package_rule: { mode: 'only', package_ids: [one.classPackageId] },
          })
        const answers = await inTurn(
          () => holdPackage(pkg.get(first === 'member' ? lower : higher)!),
          first === 'member' ? [memberCancel, ruleChange] : [ruleChange, memberCancel],
        )
        const [byMember, byAdmin] = (first === 'member' ? answers : [...answers].reverse()) as [Reply, Reply]

        assert.equal(byMember.status, 200, `${round}: ${JSON.stringify(byMember.body)}`)
        assert.equal(byAdmin.status, 200, `${round}: ${JSON.stringify(byAdmin.body)}`)
        assert.equal((await confirmedOn(lower, full)).length, 1, `${round}: the head of the line holds the freed seat`)
        assert.equal((await entryStatus(head.entry_id)).status, 'promoted', round)
        assert.equal((await confirmedOn(lower, changed)).length + (await confirmedOn(higher, changed)).length, 0, round)
        assert.deepEqual([await creditsLeft(seated), await creditsLeft(lower), await creditsLeft(higher)], [10, 9, 10], round)
      }
    }
  })

  test('WTL-42 a member frees a seat on a class while an Admin removes a Complimentary Package booked there and on an earlier class, whose lines share a member who is not the head of this one: both go through', async () => {
    const earlier = await addClass(one, { online: 1, waitlist: 3 }, 3 * DAY)
    const later = await addClass(one, { online: 2, waitlist: 3 }, 4 * DAY)
    const given = await member(one, false)
    const comp = await grantOf('class', one.classPackageId, { complimentary: true })(given)
    await booked(given, earlier)
    await booked(given, later)
    const seated = await member(one)
    const seat = await booked(seated, later)
    const shared = await member(one)
    const head = await member(one)
    await joined(shared, earlier)
    await joined(head, later)
    await joined(shared, later)

    const [byMember, removal] = (await inTurn(
      () => holdRows(tx => tx`SELECT id FROM classes WHERE id = ${later} FOR UPDATE`),
      [
        () => cancel(seated, seat),
        () => send('POST', `/portal/admin/clients/${given.clientId}/packages/${comp}/remove`, one.admin.headers, { reason: 'Given to the wrong member' }),
      ],
    )) as [Reply, Reply]

    assert.equal(byMember.status, 200, JSON.stringify(byMember.body))
    assert.equal(byMember.body.refund_outcome, 'credit_returned')
    assert.equal(removal.status, 200, JSON.stringify(removal.body))
    assert.deepEqual(await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, comp)), [], 'the package is removed')
    assert.equal((await confirmedOn(head, later)).length, 1, 'the head of the later line holds the seat the member freed')
    assert.equal((await confirmedOn(shared, earlier)).length, 1, 'the shared member holds the earlier seat the Remove freed')
    assert.equal((await confirmedOn(shared, later)).length, 1, 'and the later seat it freed')
  })

  const holdTimeOf = (who: Member) =>
    holdRows(tx => tx`SELECT pg_advisory_xact_lock(hashtext(${`member-time:${one.id}:${who.clientId}`}))`)

  const lockedElsewhere = async (packageId: string) =>
    ((await harness.db.execute(sql`SELECT id FROM client_packages WHERE id = ${packageId} FOR UPDATE SKIP LOCKED`)) as unknown as unknown[])
      .length === 0

  const packageOf = async (who: Member) =>
    (await harness.db.select({ id: schema.clientPackages.id }).from(schema.clientPackages).where(eq(schema.clientPackages.clientId, who.clientId)))[0]!.id

  /**
   * `first` queues on the head's member time, then `second` queues there too while holding
   * `heldPackage`. Released, `first` takes the time and waits on the package `second` holds,
   * while `second` waits on the time: Postgres aborts one of them. `cycle` says the interleaving
   * was reached.
   */
  async function bothQueuedOnTimeOf(head: Member, heldPackage: string, first: () => Promise<Reply>, second: () => Promise<Reply>) {
    const time = await holdTimeOf(head)
    try {
      let settled = false
      const firstCall = first().finally(() => (settled = true))
      await untilRowLockWaiters(1, () => settled, 'advisory')
      const secondCall = second().finally(() => (settled = true))
      await untilRowLockWaiters(2, () => settled, 'advisory')
      const cycle = !settled && (await lockedElsewhere(heldPackage))
      await time.release()
      return { answers: await Promise.all([firstCall, secondCall]), cycle }
    } finally {
      await time.release()
    }
  }

  test('WTL-43 an Admin cancels a member’s booking on one class and its promotion passes by a member who cannot pay to the head of the line the member frees a seat on: both go through, the head is booked into that seat once, and each credit comes back once', async () => {
    const later = await addClass(one, { online: 1, waitlist: 3 }, 5 * DAY)
    const full = await addClass(one, { online: 1, waitlist: 3 })
    const canceller = await member(one)
    const seat = await booked(canceller, full)
    const laterSeat = await booked(canceller, later)
    const unpaid = await member(one)
    const head = await member(one)
    await joined(unpaid, later)
    await joined(head, later)
    await harness.db.update(schema.clientPackages).set({ creditsOrSessionsRemaining: 0 }).where(eq(schema.clientPackages.clientId, unpaid.clientId))
    const headEntry = await joined(head, full)
    await joined(await member(one), full)

    const { answers, cycle } = await bothQueuedOnTimeOf(
      head,
      await packageOf(canceller),
      () => cancel(canceller, seat),
      () => send('POST', `/portal/admin/bookings/${laterSeat}/cancel`, one.admin.headers, { credit: 'return' }),
    )
    const [byMember, byAdmin] = answers as [Reply, Reply]

    assert.ok(cycle, 'the Admin cancel held the member’s package while both waited on the head’s time')
    assert.equal(byMember.status, 200, JSON.stringify(byMember.body))
    assert.equal(byMember.body.refund_outcome, 'credit_returned')
    assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body))
    assert.equal(byAdmin.body.refund_outcome, 'credit_returned')
    assert.equal((await confirmedOn(head, full)).length, 1, 'the head of the line holds the seat the member freed')
    assert.equal((await entryStatus(headEntry.entry_id)).status, 'promoted')
    assert.equal((await confirmedOn(head, later)).length, 1, 'and the seat the Admin freed, the member who cannot pay passed by')
    assert.equal((await confirmedOn(unpaid, later)).length, 0)
    assert.deepEqual([await creditsLeft(canceller), await creditsLeft(head)], [10, 8], 'each credit moved once')
    assert.equal((await promotedMails(head)).length, 2)
  })

  test('WTL-44 an Admin’s Package rule change cancels a member’s booking and then another, promoting further down a line to the head of the line the member frees a seat on: both go through, the head is booked into that seat once, and each credit comes back once', async () => {
    const refused = await classPackagesSvc.createClassPackage(one.id, { name: `Waitlist refused ${run}`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '100.00' })
    let cycled = false
    for (let round = 1; round <= 6 && !cycled; round++) {
      const changed = await addClass(one, { online: 2, waitlist: 3 }, 5 * DAY)
      const full = await addClass(one, { online: 2, waitlist: 3 })
      const pair = [await member(one, false), await member(one, false)]
      const seats = new Map<Member, string>()
      const onChanged = new Map<Member, string>()
      for (const w of pair) {
        await grantOf('class', refused.id)(w)
        onChanged.set(w, await booked(w, changed))
        seats.set(w, await booked(w, full))
      }
      // The rule change cancels the refused bookings in booking id order.
      const [canceller, other] = [...pair].sort((a, b) => (onChanged.get(a)! < onChanged.get(b)! ? -1 : 1)) as [Member, Member]
      const seat = seats.get(canceller)!
      const promotedFirst = await member(one)
      const head = await member(one)
      await joined(promotedFirst, changed)
      await joined(head, changed)
      const headEntry = await joined(head, full)
      await joined(await member(one), full)

      const { answers, cycle } = await bothQueuedOnTimeOf(
        head,
        await packageOf(canceller),
        () => cancel(canceller, seat),
        () => send('PATCH', `/portal/admin/schedule/classes/${changed}`, one.admin.headers, { package_rule: { mode: 'only', package_ids: [one.classPackageId] } }),
      )
      const [byMember, byAdmin] = answers as [Reply, Reply]
      cycled = cycle

      assert.equal(byMember.status, 200, `round ${round}: ${JSON.stringify(byMember.body)}`)
      assert.equal(byMember.body.refund_outcome, 'credit_returned')
      assert.equal(byAdmin.status, 200, `round ${round}: ${JSON.stringify(byAdmin.body)}`)
      assert.equal((await confirmedOn(head, full)).length, 1, `round ${round}: the head of the line holds the seat the member freed`)
      assert.equal((await entryStatus(headEntry.entry_id)).status, 'promoted')
      assert.equal((await confirmedOn(canceller, changed)).length + (await confirmedOn(other, changed)).length, 0)
      assert.equal((await confirmedOn(promotedFirst, changed)).length, 1)
      assert.equal((await confirmedOn(head, changed)).length, 1)
      assert.deepEqual(
        [await creditsLeft(canceller), await creditsLeft(other), await creditsLeft(promotedFirst), await creditsLeft(head)],
        [10, 9, 9, 8],
        `round ${round}: each credit moved once`,
      )
    }
    assert.ok(cycled, 'in some round the rule change held the member’s package while both waited on the head’s time')
  })

  test('WTL-46 a member frees a seat whose head of the line cannot pay while an Admin cancels whole a class the member and the next in line are booked on: both go through, the next in line is booked once, and each credit moves once', async () => {
    const full = await addClass(one, { online: 1, waitlist: 3 })
    const other = await addClass(one, { online: 2, waitlist: 0 }, 5 * DAY)
    const { lower: next, higher: canceller, pkg } = await byPackageOrder(grantOf('class', one.classPackageId))
    const seat = await booked(canceller, full)
    await booked(next, other)
    await booked(canceller, other)
    const unpaid = await member(one)
    await joined(unpaid, full)
    const nextEntry = await joined(next, full)
    await harness.db.update(schema.clientPackages).set({ creditsOrSessionsRemaining: 0 }).where(eq(schema.clientPackages.clientId, unpaid.clientId))

    const [byMember, byAdmin] = (await inTurn(
      () => holdPackage(pkg.get(canceller)!),
      [() => cancel(canceller, seat), () => send('POST', `/portal/admin/schedule/classes/${other}/cancel`, one.admin.headers)],
    )) as [Reply, Reply]

    assert.equal(byMember.status, 200, JSON.stringify(byMember.body))
    assert.equal(byMember.body.refund_outcome, 'credit_returned')
    assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body))
    assert.equal((await confirmedOn(next, full)).length, 1, 'the next in line holds the freed seat, the member who cannot pay passed by')
    assert.equal((await entryStatus(nextEntry.entry_id)).status, 'promoted')
    assert.equal((await confirmedOn(unpaid, full)).length, 0)
    assert.equal((await confirmedOn(next, other)).length + (await confirmedOn(canceller, other)).length, 0)
    assert.deepEqual([await creditsLeft(canceller), await creditsLeft(next)], [10, 9], 'each credit moved once')
    assert.equal((await promotedMails(next)).length, 1)
  })

  test('WTL-45 a Complimentary Remove that Postgres aborts after it has promoted a member, to break a deadlock with that member’s own cancel, runs again: the member is booked and emailed once, and both go through', async () => {
    let cycled = false
    for (let round = 1; round <= 6 && !cycled; round++) {
      const pair = [await addClass(one, { online: 1, waitlist: 3 }, 3 * DAY), await addClass(one, { online: 1, waitlist: 3 }, 4 * DAY)]
      const elsewhere = await addClass(one, { online: 1, waitlist: 3 }, 5 * DAY)
      const given = await member(one, false)
      const comp = await grantOf('class', one.classPackageId, { complimentary: true })(given)
      const heldOn = new Map<string, string>()
      for (const c of pair) heldOn.set(c, await booked(given, c))
      // The Remove cancels the package's bookings in booking id order.
      const [first, second] = [...pair].sort((a, b) => (heldOn.get(a)! < heldOn.get(b)! ? -1 : 1)) as [string, string]
      const promoted = await member(one)
      const head = await member(one)
      const seat = await booked(promoted, elsewhere)
      const promotedEntry = await joined(promoted, first)
      await joined(head, second)
      await joined(head, elsewhere)

      const { answers, cycle } = await bothQueuedOnTimeOf(
        head,
        await packageOf(promoted),
        () => cancel(promoted, seat),
        () => send('POST', `/portal/admin/clients/${given.clientId}/packages/${comp}/remove`, one.admin.headers, { reason: 'Given to the wrong member' }),
      )
      const [byMember, removal] = answers as [Reply, Reply]
      cycled = cycle

      assert.equal(byMember.status, 200, `round ${round}: ${JSON.stringify(byMember.body)}`)
      assert.equal(byMember.body.refund_outcome, 'credit_returned')
      assert.equal(removal.status, 200, `round ${round}: ${JSON.stringify(removal.body)}`)
      assert.deepEqual(await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, comp)), [], 'the package is removed')
      assert.equal((await confirmedOn(promoted, first)).length, 1, `round ${round}: the member holds the seat the Remove freed`)
      assert.equal((await entryStatus(promotedEntry.entry_id)).status, 'promoted')
      assert.equal(await creditsLeft(promoted), 9, `round ${round}: the cancel returned one credit and the promotion took one`)
      assert.equal((await promotedMails(promoted)).length, 1, `round ${round}: one promotion email`)
      assert.equal((await confirmedOn(head, elsewhere)).length + (await confirmedOn(head, second)).length, 2)
    }
    assert.ok(cycled, 'in some round the Remove held the member’s package while both waited on the head’s time')
  })

  test('WTL-47 a Complimentary Remove that Postgres aborts at its delete of the package, after both its cancels have promoted the members waiting, runs again: each is booked into the freed seat, debited and emailed once, and the removal is audited once', async () => {
    const pair = [await addClass(one, { online: 1, waitlist: 3 }, 3 * DAY), await addClass(one, { online: 1, waitlist: 3 }, 4 * DAY)]
    const given = await member(one, false)
    const comp = await grantOf('class', one.classPackageId, { complimentary: true })(given)
    for (const c of pair) await booked(given, c)
    const waiting = [await member(one), await member(one)]
    const entries = [await joined(waiting[0]!, pair[0]!), await joined(waiting[1]!, pair[1]!)]
    harness.logs.clear()

    // The abort lands on the one write that comes after every cancel and every
    // promotion, so the first attempt's promotions (and their emails) are the
    // ones the second attempt must not leave standing twice.
    const { result: removal, reached } = await abortOnce(
      harness.db,
      { table: 'client_packages', event: 'DELETE', rowWhen: `OLD.id = '${comp}'` },
      () => send('POST', `/portal/admin/clients/${given.clientId}/packages/${comp}/remove`, one.admin.headers, { reason: 'Given to the wrong member' }),
    )

    assert.equal(removal.status, 200, JSON.stringify(removal.body))
    assert.equal(reached, 2, 'the first delete of the package was aborted, and the second went through')
    const retried = harness.logs.lines().filter(l => l.msg === 'transaction aborted by Postgres; retrying')
    assert.equal(retried.length, 1, 'the Remove ran exactly one extra attempt')
    assert.equal(retried[0]!.operation, 'Complimentary Remove')
    assert.deepEqual(await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, comp)), [], 'the package is removed')
    for (const [i, who] of waiting.entries()) {
      assert.equal((await confirmedOn(who, pair[i]!)).length, 1, `waiting member ${i + 1} holds the seat the Remove freed, once`)
      assert.equal((await entryStatus(entries[i]!.entry_id)).status, 'promoted')
      assert.equal(await creditsLeft(who), 9, `waiting member ${i + 1} was debited once`)
      assert.equal((await promotedMails(who)).length, 1, `waiting member ${i + 1} was emailed once`)
    }
    const audited = await harness.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.targetId, comp), eq(schema.auditLog.action, 'complimentary_package_removed')))
    assert.equal(audited.length, 1, 'one audit row for one Remove')
  })

  test('WTL-12 once the class starts the line is over: reads show nothing, and the sweep marks it expired', async () => {
    const { classId } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)
    const entry = await joined(waiter, classId)

    harness.clock.set(new Date(Date.now() + 3 * DAY + 5 * 60 * 1000))
    try {
      assert.deepEqual(await myLines(waiter), [], 'a started class shows no live position')
      await jobs.scheduledJobs.expireWaitlists()
    } finally {
      harness.clock.reset()
    }
    const row = await entryStatus(entry.entry_id)
    assert.equal(row.status, 'expired')
    assert.equal(row.resolvedBy, 'system')
  })

  test('WTL-13 cancelling the whole class removes everyone in its line', async () => {
    const { classId } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)
    const entry = await joined(waiter, classId)

    const res = await send('POST', `/portal/admin/schedule/classes/${classId}/cancel`, one.admin.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const row = await entryStatus(entry.entry_id)
    assert.equal(row.status, 'removed')
    assert.equal(row.resolvedBy, one.admin.id)
    assert.deepEqual(await myLines(waiter), [])
  })

  test('WTL-36 ending a series removes the line of each class it cancels, as cancelling the class does', async () => {
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: one.id, locationId: one.locationId, name: `Waitlist series room ${run}`, capacity: 5 })
      .returning({ id: schema.rooms.id })
    const teacher = await staffAt(one, 'series-teacher', 'instructor')
    const outsideTheWindow = 5 * DAY
    const date = localDateOf(new Date(Date.now() + outsideTheWindow), 'Asia/Singapore')
    const created = await send('POST', '/portal/admin/schedule/series', one.admin.headers, {
      class_type_id: one.classTypeId,
      main_instructor_id: teacher.id,
      instructor_pay_sgd: 50,
      supporting_instructors: [],
      location_id: one.locationId,
      room_id: room!.id,
      weekday: isoWeekday(date),
      start_time: '07:00',
      end_time: '08:00',
      capacity_online: 1,
      capacity_waitlist: 3,
      capacity_buffer: 0,
      credit_cost: 1,
      first_date: date,
      last_date: date,
      excluded_dates: [],
    })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const seriesId = created.body.series.id as string
    const [classId] = created.body.class_ids as string[]

    const seated = await member(one)
    const bookingId = await booked(seated, classId!)
    const waiter = await member(one)
    const entry = await joined(waiter, classId!)
    await harness.db
      .update(schema.clientPackages)
      .set({ creditsOrSessionsRemaining: 0 })
      .where(eq(schema.clientPackages.clientId, waiter.clientId))
    assert.equal((await cancel(seated, bookingId)).status, 200)
    assert.equal((await entryStatus(entry.entry_id)).status, 'waiting')

    const ended = await send('POST', `/portal/admin/schedule/series/${seriesId}/end`, one.admin.headers, { from_date: date })
    assert.equal(ended.status, 200, JSON.stringify(ended.body))
    assert.deepEqual(ended.body.cancelled_class_ids, [classId])
    assert.deepEqual(ended.body.booked_classes, [])

    const row = await entryStatus(entry.entry_id)
    assert.equal(row.status, 'removed')
    assert.equal(row.resolvedBy, one.admin.id)
    assert.deepEqual(await myLines(waiter), [])
  })

  test('WTL-14 a cancel that voids the package (the Refund’s own arm) promotes like a member cancel', async () => {
    // Removing a Complimentary Package cancels its bookings through the same
    // `packageVoided` cancel a Refund's unwind uses.
    const classId = await addClass(one, { online: 1, waitlist: 3 })
    const gifted = await member(one, false)
    const issued = await send('POST', `/portal/admin/clients/${gifted.clientId}/packages/issue`, one.admin.headers, {
      package_kind: 'class',
      package_id: one.classPackageId,
      reason: 'Goodwill after a cancelled class',
    })
    assert.equal(issued.status, 201, JSON.stringify(issued.body))
    await booked(gifted, classId)

    const waiter = await member(one)
    await joined(waiter, classId)

    const removed = await send(
      'POST',
      `/portal/admin/clients/${gifted.clientId}/packages/${issued.body.client_package_id}/remove`,
      one.admin.headers,
      { reason: 'Given by mistake' },
    )
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    assert.equal(removed.body.cancelled_bookings, 1)

    assert.equal((await confirmedOn(waiter, classId)).length, 1)
    assert.equal(await creditsLeft(waiter), 9)
    assert.equal((await promotedMails(waiter)).length, 1)
  })

  /* ── The studio switch ───────────────────────────────────────────── */

  test('WTL-15 with the studio switch off, joining is refused and an existing line still promotes', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)
    await joined(waiter, classId)

    assert.equal((await setFlag(one, false)).status, 200)
    try {
      const refused = await joinLine(await member(one), classId)
      assert.equal(refused.status, 409, JSON.stringify(refused.body))
      assert.equal(refused.body.error, 'waitlist_disabled')
      const card = await memberCard(waiter, classId)
      assert.equal(card.waitlist.enabled, false)
      assert.equal(card.waitlist.open, false)

      await cancel(seated[0]!.who, seated[0]!.bookingId)
      assert.equal((await confirmedOn(waiter, classId)).length, 1, 'the line already there still fills the seat')
    } finally {
      await setFlag(one, true)
    }
  })

  /* ── Isolation ───────────────────────────────────────────────────── */

  test('SEAT-05 another studio’s waiting rows never count toward, or get promoted into, this studio’s class', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 1 })

    // A row carrying studio two's tenant but pointing at studio one's class —
    // written as the owner, past RLS. Only the waitlist's own tenant filter
    // keeps it out of studio one's line.
    const stray = await member(two)
    const [strayRow] = await harness.db
      .insert(schema.waitlistEntries)
      .values({ tenantId: two.id, clientId: stray.clientId, classId, status: 'waiting' })
      .returning({ id: schema.waitlistEntries.id })

    const waiter = await member(one)
    // The stray row does not fill the one place in this class's line: the line
    // still reads open, and the join takes that place.
    assert.equal((await memberCard(waiter, classId)).waitlist.open, true)
    const entry = await joined(waiter, classId)
    assert.equal(entry.position, 1)

    await cancel(seated[0]!.who, seated[0]!.bookingId)
    assert.equal((await confirmedOn(waiter, classId)).length, 1)
    assert.equal((await entryStatus(strayRow!.id)).status, 'waiting', 'never promoted into this studio')
    assert.equal(await creditsLeft(stray), 10)

    // And a member cannot join, or leave, a line at another studio.
    const theirClass = await addClass(two, { online: 1, waitlist: 3 })
    const across = await joinLine(waiter, theirClass)
    assert.equal(across.status, 404, JSON.stringify(across.body))
    assert.equal(across.body.error, 'class_not_found')
    const theirs = await harness.db
      .select({ id: schema.waitlistEntries.id })
      .from(schema.waitlistEntries)
      .where(inArray(schema.waitlistEntries.id, [strayRow!.id]))
    assert.equal((await leaveLine(waiter, theirs[0]!.id)).status, 404)
  })
})
