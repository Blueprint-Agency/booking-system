import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.waitlist.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Waitlist class type ${run}`
const PACKAGE_NAME = `Waitlist pass ${run}`
const FLAG = 'waitlist_enabled'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The class waitlist over HTTP (#308, spec-waitlist.md §3–§6, §8, §9, §11).
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
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM clients WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'cancelledByStaffId' IN (SELECT id::text FROM staff_users WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM waitlist_entries WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
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
    assert.equal(before.spots_left, 0)
    assert.deepEqual(before.waitlist, { enabled: true, capacity: 3, waiting: 0, open: true, my_entry: null })

    const entry = await joined(waiter, classId)
    assert.equal(entry.position, 1)
    assert.equal(await creditsLeft(waiter), 10, 'joining the line costs nothing')

    const after = await memberCard(waiter, classId)
    assert.deepEqual(after.waitlist, {
      enabled: true,
      capacity: 3,
      waiting: 1,
      open: true,
      my_entry: { id: entry.entry_id, position: 1 },
    })
    // The public catalogue counts the line and names nobody in it.
    assert.deepEqual((await publicDetail(one, classId)).waitlist, {
      enabled: true,
      capacity: 3,
      waiting: 1,
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
    assert.equal(card.spots_left, 0)
    assert.equal(card.waitlist.my_entry, null)
    assert.equal(card.waitlist.waiting, 1)
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
      const res = await send('POST', `/portal/admin/bookings/${seated[0]!.bookingId}/cancel`, one.admin.headers)
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
    assert.equal((await memberCard(waiter, classId)).spots_left, 1, 'the second freed seat stays free')
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
      const res = await send('POST', `/portal/admin/bookings/${id}/cancel`, one.admin.headers)
      assert.equal(res.status, 200, JSON.stringify(res.body))
    }
    assert.equal((await confirmedOn(waiter, classId)).length, 0)
    assert.equal((await entryStatus(entry.entry_id)).status, 'waiting')
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
    const inbox = await harness.db.execute(sql`SELECT id FROM inbox_items WHERE payload->>'clientId' = ${waiter.clientId}`)
    assert.equal(inbox.length, 0)

    // Twice, or someone else's, is not found.
    assert.equal((await leaveLine(waiter, entry.entry_id)).status, 404)
    const theirs = await joined(await member(one), classId)
    const notMine = await leaveLine(behind, theirs.entry_id)
    assert.equal(notMine.status, 404)
    assert.equal(notMine.body.error, 'waitlist_entry_not_found')
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
    assert.equal((await memberCard(waiter, classId)).waitlist.waiting, 0)
    // The stray row does not fill the one place in this class's line.
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
