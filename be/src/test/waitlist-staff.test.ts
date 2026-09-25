import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.waitlist-staff.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Staff waitlist class type ${run}`
const PACKAGE_NAME = `Staff waitlist pass ${run}`
const FLAG = 'waitlist_enabled'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The staff side of the class waitlist over HTTP (#310, spec-waitlist.md §7,
 * §8, §10).
 *
 * The session page lists a class's line in order with whether each member's
 * package could pay; staff Add a waiting member to the class (regardless of the
 * Cancellation Window) or Remove them from the line; and a full class's
 * "Add member" can put the member in the line instead. `waitlist.test.ts` is the
 * member side and the automatic promotion.
 *
 * Fixtures are written directly; every rule under test runs behind a route.
 * The studio switch is turned on through the admin route and off again at the
 * end, as `waitlist.test.ts` does.
 */
describe('staff waitlist over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
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
    otherInstructor: Staff
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
      otherInstructor: await staffAt(tenant, 'other-instructor', 'instructor'),
    }
  }

  /** A class taught by the studio's instructor, starting three days from now, one credit a seat. */
  async function addClass(at: Studio, capacity: { online: number; buffer?: number; waitlist: number }): Promise<string> {
    const startsAt = new Date(Date.now() + 3 * DAY)
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

  const setFlag = (at: Studio, enabled: boolean) =>
    send('PATCH', `/portal/admin/feature-flags/${FLAG}`, at.admin.headers, { enabled })

  async function booked(who: Member, classId: string) {
    const res = await send('POST', '/me/bookings/class', who.headers, { class_id: classId })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.booking_id as string
  }

  async function joined(who: Member, classId: string) {
    const res = await send('POST', `/me/waitlist/classes/${classId}`, who.headers)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body as { entry_id: string; position: number }
  }

  const myLines = async (who: Member) => {
    const res = await send('GET', '/me/waitlist', who.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body.entries as Array<{ id: string; class_id: string; position: number }>
  }

  async function memberCard(who: Member, classId: string) {
    const from = new Date(Date.now() - DAY).toISOString()
    const to = new Date(Date.now() + 10 * DAY).toISOString()
    const res = await send('GET', `/me/classes?from=${from}&to=${to}`, who.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const card = res.body.classes.find((c: { id: string }) => c.id === classId)
    assert.ok(card, `class ${classId} missing from /me/classes`)
    return card
  }

  /** The admin session page's read of a class. */
  async function adminDetail(at: Studio, classId: string) {
    const res = await send('GET', `/portal/admin/schedule/classes/${classId}`, at.admin.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body
  }

  /** The instructor session page's read of a class they teach. */
  async function instructorDetail(at: Studio, classId: string) {
    const res = await send('GET', `/portal/instructor/sessions/class/${classId}/roster`, at.instructor.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body
  }

  const addToClass = (staff: Staff, role: 'admin' | 'instructor', classId: string, entryId: string, body: object = {}) =>
    send('POST', `/portal/${role}/schedule/classes/${classId}/waitlist/${entryId}/promote`, staff.headers, body)

  const removeFromLine = (staff: Staff, role: 'admin' | 'instructor', classId: string, entryId: string) =>
    send('DELETE', `/portal/${role}/schedule/classes/${classId}/waitlist/${entryId}`, staff.headers)

  const staffJoin = (staff: Staff, role: 'admin' | 'instructor', classId: string, clientId: string) =>
    send('POST', `/portal/${role}/schedule/classes/${classId}/waitlist`, staff.headers, { client_id: clientId })

  async function creditsLeft(who: Member): Promise<number> {
    const rows = await harness.db
      .select({ left: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.clientId, who.clientId))
    return rows.reduce((sum, r) => sum + (r.left ?? 0), 0)
  }

  async function entryRow(entryId: string) {
    const [row] = await harness.db.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, entryId))
    return row!
  }

  async function promotedMails(who: Member) {
    return harness.db
      .select()
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.recipientEmail, who.email), eq(schema.emailLog.templateSlug, 'class_waitlist_promoted')))
  }

  /** A class whose `online` seats are each taken by a fresh member. */
  async function fullClass(at: Studio, capacity: { online: number; buffer?: number; waitlist: number }) {
    const classId = await addClass(at, capacity)
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

  /* ── The panel ───────────────────────────────────────────────────── */

  test('WTL-17 the session page lists the line in (joined_at, id) order, with the positions members see and whether each can pay', async () => {
    const { classId } = await fullClass(one, { online: 1, waitlist: 5 })
    const first = await member(one)
    const third = await member(one)
    await joined(first, classId)
    // A member who could pay at join and spent it since: still in line, "can't pay".
    const brokeWallet = await member(one)
    await joined(brokeWallet, classId)
    await harness.db
      .update(schema.clientPackages)
      .set({ creditsOrSessionsRemaining: 0 })
      .where(eq(schema.clientPackages.clientId, brokeWallet.clientId))
    await joined(third, classId)

    const detail = await adminDetail(one, classId)
    assert.equal(detail.waiting, 3)
    assert.equal(detail.waitlist_enabled, true)
    assert.deepEqual(
      detail.waitlist.map((w: any) => ({ client: w.client.id, position: w.position })),
      [
        { client: first.clientId, position: 1 },
        { client: brokeWallet.clientId, position: 2 },
        { client: third.clientId, position: 3 },
      ],
    )
    const joinedAts = detail.waitlist.map((w: any) => Date.parse(w.joined_at))
    assert.deepEqual(joinedAts, [...joinedAts].sort((a, b) => a - b))
    assert.deepEqual(detail.waitlist[0].payment_status, { status: 'pending', package_name: PACKAGE_NAME })
    assert.deepEqual(detail.waitlist[1].payment_status, { status: 'cannot_pay', reason: 'insufficient_credits' })

    // The positions staff see are the ones each member sees.
    for (const [who, position] of [[first, 1], [brokeWallet, 2], [third, 3]] as const) {
      assert.deepEqual((await myLines(who)).map(e => e.position), [position])
    }

    // Reading the panel wrote nothing: the member who can't pay is still waiting, nothing debited.
    assert.equal(await creditsLeft(first), 10)
    assert.equal(detail.waitlist[1].entry_id, (await myLines(brokeWallet))[0]!.id)

    // The instructor teaching the class sees the same line.
    const theirs = await instructorDetail(one, classId)
    assert.deepEqual(theirs.waitlist, detail.waitlist)
  })

  /* ── Add to class ────────────────────────────────────────────────── */

  test('WTL-09 inside the window a cancel promotes nobody, and staff Add to class books the head of the line', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const head = await member(one)
    const behind = await member(one)
    const entry = await joined(head, classId)
    await joined(behind, classId)

    harness.clock.set(new Date(Date.now() + 3 * DAY - 20 * HOUR))
    try {
      const cancelled = await send('POST', `/portal/admin/bookings/${seated[0]!.bookingId}/cancel`, one.admin.headers)
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
      assert.equal((await entryRow(entry.entry_id)).status, 'waiting', 'nobody moves inside the window')

      const res = await addToClass(one.admin, 'admin', classId, entry.entry_id)
      assert.equal(res.status, 201, JSON.stringify(res.body))
      assert.equal(res.body.seat, 'online', 'the freed online seat')
    } finally {
      harness.clock.reset()
    }

    const row = await entryRow(entry.entry_id)
    assert.equal(row.status, 'promoted')
    assert.equal(row.resolvedBy, one.admin.id)
    assert.ok(row.bookingId)
    assert.equal(await creditsLeft(head), 9, 'paid for like any booking')
    assert.equal((await promotedMails(head)).length, 0, 'inside the window the email’s free cancel is not theirs')

    const detail = await adminDetail(one, classId)
    const onRoster = detail.attendees.find((a: any) => a.client.id === head.clientId)
    assert.ok(onRoster, 'the promoted member is on the roster')
    assert.equal(onRoster.booking_id, row.bookingId)
    assert.equal(onRoster.promoted_from_waitlist, true)
    const others = detail.attendees.filter((a: any) => a.client.id !== head.clientId)
    for (const a of others) assert.equal(a.promoted_from_waitlist, false)
    assert.deepEqual(
      detail.waitlist.map((w: any) => ({ client: w.client.id, position: w.position })),
      [{ client: behind.clientId, position: 1 }],
    )
  })

  test('WTL-18 Add to class for a member who cannot pay is refused with the selection reason, and they stay in line', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const broke = await member(one)
    const entry = await joined(broke, classId)
    await harness.db
      .update(schema.clientPackages)
      .set({ creditsOrSessionsRemaining: 0 })
      .where(eq(schema.clientPackages.clientId, broke.clientId))
    await send('POST', `/portal/admin/bookings/${seated[0]!.bookingId}/cancel`, one.admin.headers)

    const res = await addToClass(one.admin, 'admin', classId, entry.entry_id)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'insufficient_credits')
    assert.equal((await entryRow(entry.entry_id)).status, 'waiting')
    assert.deepEqual((await myLines(broke)).map(e => e.position), [1])
  })

  test('WTL-19 Add to class into a full class takes a buffer seat, then needs an admin overbook; an instructor cannot overbook', async () => {
    const { classId } = await fullClass(one, { online: 1, buffer: 1, waitlist: 5 })
    const first = await member(one)
    const a = await joined(first, classId)
    const b = await joined(await member(one), classId)
    const c = await joined(await member(one), classId)

    const intoBuffer = await addToClass(one.admin, 'admin', classId, a.entry_id)
    assert.equal(intoBuffer.status, 201, JSON.stringify(intoBuffer.body))
    assert.equal(intoBuffer.body.seat, 'buffer')
    assert.equal((await promotedMails(first)).length, 1, 'outside the window they are told, as on an automatic promotion')

    const full = await addToClass(one.admin, 'admin', classId, b.entry_id)
    assert.equal(full.status, 409, JSON.stringify(full.body))
    assert.equal(full.body.error, 'class_full')
    assert.equal((await entryRow(b.entry_id)).status, 'waiting')

    const overbooked = await addToClass(one.admin, 'admin', classId, b.entry_id, { overbook: true })
    assert.equal(overbooked.status, 201, JSON.stringify(overbooked.body))
    assert.equal(overbooked.body.seat, 'overbook')

    const instructorTried = await addToClass(one.instructor, 'instructor', classId, c.entry_id, { overbook: true })
    assert.equal(instructorTried.status, 409, JSON.stringify(instructorTried.body))
    assert.equal(instructorTried.body.error, 'class_full')
    assert.equal((await entryRow(c.entry_id)).status, 'waiting')
  })

  test('WTL-20 an instructor adds and removes on their own class only; another studio’s entry is not found', async () => {
    const { classId, seated } = await fullClass(one, { online: 1, waitlist: 3 })
    const waiter = await member(one)
    const entry = await joined(waiter, classId)

    const notTheirs = await addToClass(one.otherInstructor, 'instructor', classId, entry.entry_id)
    assert.equal(notTheirs.status, 403, JSON.stringify(notTheirs.body))
    assert.equal(notTheirs.body.error, 'not_your_session')
    const notTheirsRemove = await removeFromLine(one.otherInstructor, 'instructor', classId, entry.entry_id)
    assert.equal(notTheirsRemove.status, 403, JSON.stringify(notTheirsRemove.body))

    // Studio two's admin cannot reach studio one's line.
    const across = await addToClass(two.admin, 'admin', classId, entry.entry_id)
    assert.equal(across.status, 404, JSON.stringify(across.body))
    assert.equal((await entryRow(entry.entry_id)).status, 'waiting')

    await send('POST', `/portal/admin/bookings/${seated[0]!.bookingId}/cancel`, one.admin.headers)
    // The cancel was outside the window, so the line already filled the seat.
    assert.equal((await entryRow(entry.entry_id)).status, 'promoted')

    const again = await addToClass(one.instructor, 'instructor', classId, entry.entry_id)
    assert.equal(again.status, 404, JSON.stringify(again.body))
    assert.equal(again.body.error, 'waitlist_entry_not_found')
  })

  /* ── Remove ──────────────────────────────────────────────────────── */

  test('WTL-21 Remove takes a member out of the line: removed by that staff member, the rest move up, and the member sees the class again', async () => {
    const { classId } = await fullClass(one, { online: 1, waitlist: 2 })
    const gone = await member(one)
    const behind = await member(one)
    const entry = await joined(gone, classId)
    await joined(behind, classId)
    assert.equal((await memberCard(gone, classId)).waitlist.open, false, 'the line is full')

    const res = await removeFromLine(one.instructor, 'instructor', classId, entry.entry_id)
    assert.equal(res.status, 204, JSON.stringify(res.body))

    const row = await entryRow(entry.entry_id)
    assert.equal(row.status, 'removed')
    assert.equal(row.resolvedBy, one.instructor.id)
    assert.deepEqual((await myLines(behind)).map(e => e.position), [1])

    const card = await memberCard(gone, classId)
    assert.equal(card.waitlist.my_entry, null)
    assert.equal(card.waitlist.open, true, 'a place in line is free again, so they see Join waitlist')

    assert.equal((await removeFromLine(one.admin, 'admin', classId, entry.entry_id)).status, 404)
  })

  /* ── Add member's prompt ─────────────────────────────────────────── */

  test('WTL-22 a full class’s Add member can put the member in the line instead', async () => {
    const classId = await addClass(one, { online: 1, buffer: 0, waitlist: 3 })
    await booked(await member(one), classId)
    const walkIn = await member(one)

    const refused = await send('POST', `/portal/instructor/schedule/classes/${classId}/bookings`, one.instructor.headers, {
      client_id: walkIn.clientId,
    })
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.waitlist_open, true)

    const res = await staffJoin(one.instructor, 'instructor', classId, walkIn.clientId)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.position, 1)
    assert.equal(await creditsLeft(walkIn), 10, 'joining costs nothing')
    assert.deepEqual((await myLines(walkIn)).map(e => e.id), [res.body.entry_id])

    const byAdmin = await staffJoin(one.admin, 'admin', classId, (await member(one)).clientId)
    assert.equal(byAdmin.status, 201, JSON.stringify(byAdmin.body))
    assert.equal(byAdmin.body.position, 2)

    // The same rules as a member's own join.
    const twice = await staffJoin(one.admin, 'admin', classId, walkIn.clientId)
    assert.equal(twice.status, 409, JSON.stringify(twice.body))
    assert.equal(twice.body.error, 'already_waitlisted')

    const notTheirs = await staffJoin(one.otherInstructor, 'instructor', classId, (await member(one)).clientId)
    assert.equal(notTheirs.status, 403, JSON.stringify(notTheirs.body))

    const stranger = await member(two)
    const acrossStudios = await staffJoin(one.admin, 'admin', classId, stranger.clientId)
    assert.equal(acrossStudios.status, 404, JSON.stringify(acrossStudios.body))
    assert.equal(acrossStudios.body.error, 'client_not_found')
  })

  /* ── The studio switch, and the timetable ────────────────────────── */

  test('WTL-23 with the studio switch off, staff still see the line and can act on it', async () => {
    const { classId } = await fullClass(one, { online: 1, buffer: 1, waitlist: 3 })
    const first = await joined(await member(one), classId)
    const second = await joined(await member(one), classId)

    assert.equal((await setFlag(one, false)).status, 200)
    try {
      const detail = await adminDetail(one, classId)
      assert.equal(detail.waitlist_enabled, false)
      assert.equal(detail.waitlist.length, 2)
      // What the instructor's scheduling form reads to label the Waitlist field.
      const features = await send('GET', '/portal/instructor/catalog/features', one.instructor.headers)
      assert.deepEqual(features.body, { waitlist_enabled: false })

      const added = await addToClass(one.admin, 'admin', classId, first.entry_id)
      assert.equal(added.status, 201, JSON.stringify(added.body))
      const removed = await removeFromLine(one.admin, 'admin', classId, second.entry_id)
      assert.equal(removed.status, 204, JSON.stringify(removed.body))
      assert.equal((await adminDetail(one, classId)).waitlist.length, 0)
    } finally {
      await setFlag(one, true)
    }
  })

  test('WTL-24 the timetable says how many are waiting on each class', async () => {
    const { classId } = await fullClass(one, { online: 1, waitlist: 3 })
    await joined(await member(one), classId)
    await joined(await member(one), classId)
    const quiet = await addClass(one, { online: 1, waitlist: 3 })

    const from = new Date(Date.now()).toISOString()
    const to = new Date(Date.now() + 5 * DAY).toISOString()
    const admin = await send('GET', `/portal/admin/schedule?from=${from}&to=${to}&type=class`, one.admin.headers)
    assert.equal(admin.status, 200, JSON.stringify(admin.body))
    const find = (id: string) => (admin.body.entries as any[]).find(e => e.id === id)
    assert.equal(find(classId).waiting, 2)
    assert.equal(find(quiet).waiting, 0)

    const mine = await send('GET', `/portal/instructor/schedule?from=${from}&to=${to}&type=class`, one.instructor.headers)
    assert.equal(mine.status, 200, JSON.stringify(mine.body))
    assert.equal((mine.body.entries as any[]).find(e => e.id === classId).waiting, 2)
  })
})
