import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.seats.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Seats class type ${run}`
const PACKAGE_NAME = `Seats pass ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * Seats over HTTP (#307, spec-waitlist.md §2, §7, §10).
 *
 * A class has online seats members book and buffer seats staff fill;
 * attendance capacity is their sum and the waitlist is not a seat. Staff book a
 * member through the same booking as the member route — package, debit, QR —
 * into a buffer seat, and an admin may overbook past a full buffer. Every
 * surface that shows a class's numbers (the member catalogue, the portal
 * timetable, the session detail) reads them from one count, so they agree.
 *
 * Fixtures — studios' classes, a bundle held by a member, staff rows — are
 * written directly; every rule under test runs behind a route.
 */
describe('class seats over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
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
    /** Teaches the classes `addClass` makes. */
    instructor: Staff
    /** Teaches nothing here. */
    otherInstructor: Staff
  }
  type Member = { clientId: string; headers: Headers }

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

  /** A class three days out, taught by `at.instructor`, one credit a seat. */
  async function addClass(at: Studio, capacity: { online: number; buffer: number; waitlist?: number }): Promise<string> {
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
        capacityBuffer: capacity.buffer,
        capacityWaitlist: capacity.waitlist ?? 0,
        creditCost: 1,
        createdByStaffId: at.admin.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  let memberSeq = 0
  /** A member of `at`, signed in there, holding a 10-credit bundle. */
  async function member(at: Studio): Promise<Member> {
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
    await purchaseSvc.grantPackage(at.id, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: at.classPackageId,
    })
    return { clientId: client!.id, headers }
  }

  const memberBooks = (who: Member, classId: string) =>
    send('POST', '/me/bookings/class', who.headers, { class_id: classId })

  const adminBooks = (at: Studio, classId: string, who: Member, overbook?: boolean) =>
    send('POST', `/portal/admin/schedule/classes/${classId}/bookings`, at.admin.headers, {
      client_id: who.clientId,
      ...(overbook === undefined ? {} : { overbook }),
    })

  const instructorBooks = (as: Staff, classId: string, who: Member, overbook?: boolean) =>
    send('POST', `/portal/instructor/schedule/classes/${classId}/bookings`, as.headers, {
      client_id: who.clientId,
      ...(overbook === undefined ? {} : { overbook }),
    })

  const detail = async (at: Studio, classId: string) => {
    const res = await send('GET', `/portal/admin/schedule/classes/${classId}`, at.admin.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body
  }

  const catalogue = async (at: Studio, classId: string) => {
    const res = await reply(
      await harness.app.request(`/api/v1/public/classes/${classId}`, { headers: { 'X-Tenant-Slug': at.slug } }),
    )
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body
  }

  const timetableEntry = async (at: Studio, classId: string) => {
    const from = new Date(Date.now() + 2 * DAY).toISOString()
    const to = new Date(Date.now() + 4 * DAY).toISOString()
    const res = await send('GET', `/portal/admin/schedule?type=class&from=${from}&to=${to}`, at.admin.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const entry = res.body.entries.find((e: { id: string }) => e.id === classId)
    assert.ok(entry, `class ${classId} missing from the timetable`)
    return entry
  }

  async function creditsLeft(who: Member): Promise<number> {
    const [row] = await harness.db
      .select({ left: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.clientId, who.clientId))
    return row!.left!
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
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

  test('SEAT-01 an admin books a member into a buffer seat: paid like any booking, spots left unchanged', async () => {
    const classId = await addClass(one, { online: 2, buffer: 1 })
    const walkIn = await member(one)
    const before = await catalogue(one, classId)

    const res = await adminBooks(one, classId, walkIn)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.seat, 'buffer')
    assert.ok(res.body.code, 'a staff booking gets a booking code like a member booking')

    // The same booking as the member route: a credit spent, a QR token issued.
    assert.equal(await creditsLeft(walkIn), 9)
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, res.body.booking_id))
    assert.equal(row!.seat, 'buffer')
    assert.equal(row!.state, 'confirmed')
    assert.ok(row!.qrToken)

    const after = await catalogue(one, classId)
    assert.equal(after.spots_left, before.spots_left)
    assert.equal(after.spots_left, 2)

    // Booking the same member twice is refused, as for a member.
    const again = await adminBooks(one, classId, walkIn)
    assert.equal(again.status, 409)
    assert.equal(again.body.error, 'already_booked')
  })

  test('SEAT-01 an instructor books a member onto their own class into a buffer seat', async () => {
    const classId = await addClass(one, { online: 2, buffer: 1 })
    const walkIn = await member(one)

    const res = await instructorBooks(one.instructor, classId, walkIn)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.seat, 'buffer')
    assert.equal((await catalogue(one, classId)).spots_left, 2)
  })

  test('SEAT-02 a full buffer refuses staff with class_full; an admin who overbooks gets in, an instructor never does', async () => {
    const classId = await addClass(one, { online: 1, buffer: 1, waitlist: 5 })
    await adminBooks(one, classId, await member(one))

    const late = await member(one)
    const refused = await adminBooks(one, classId, late)
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.deepEqual(refused.body, {
      error: 'class_full',
      waitlist_open: false,
      waiting: 0,
      capacity_waitlist: 5,
    })

    const instructorTried = await instructorBooks(one.instructor, classId, late, true)
    assert.equal(instructorTried.status, 409, JSON.stringify(instructorTried.body))
    assert.equal(instructorTried.body.error, 'class_full')
    assert.equal(await creditsLeft(late), 10, 'a refused booking spends nothing')

    const overbooked = await adminBooks(one, classId, late, true)
    assert.equal(overbooked.status, 201, JSON.stringify(overbooked.body))
    assert.equal(overbooked.body.seat, 'overbook')

    const d = await detail(one, classId)
    const row = d.attendees.find((a: { client: { id: string } }) => a.client.id === late.clientId)
    assert.equal(row.seat, 'overbook')
    assert.equal(d.overbook_used, 1)
    // The online seat is still the members'.
    assert.equal((await catalogue(one, classId)).spots_left, 1)
  })

  test('a member never takes a buffer seat: online full is full to them', async () => {
    const classId = await addClass(one, { online: 1, buffer: 3 })
    const first = await member(one)
    assert.equal((await memberBooks(first, classId)).status, 201)

    const second = await memberBooks(await member(one), classId)
    assert.equal(second.status, 409, JSON.stringify(second.body))
    assert.equal(second.body.error, 'class_full')
  })

  test('SEAT-04 the session detail, the timetable and the member catalogue agree on one class', async () => {
    const classId = await addClass(one, { online: 3, buffer: 1, waitlist: 5 })
    await memberBooks(await member(one), classId)
    await memberBooks(await member(one), classId)
    await adminBooks(one, classId, await member(one))
    await adminBooks(one, classId, await member(one), true)

    const d = await detail(one, classId)
    assert.equal(d.attendance_capacity, 4, 'online plus buffer; the waitlist is not a seat')
    assert.equal(d.online_used, 2)
    assert.equal(d.buffer_used, 1)
    assert.equal(d.overbook_used, 1)
    assert.equal(d.attending, 4)
    assert.equal(d.booked_count, 4)
    assert.deepEqual(
      d.attendees.map((a: { seat: string }) => a.seat).sort(),
      ['buffer', 'online', 'online', 'overbook'],
    )

    const t = await timetableEntry(one, classId)
    assert.equal(t.capacity, d.attendance_capacity)
    assert.equal(t.attendance_capacity, d.attendance_capacity)
    assert.equal(t.booked_count, d.attending)
    assert.equal(t.attending, d.attending)
    assert.equal(t.online_used, d.online_used)
    assert.equal(t.buffer_used, d.buffer_used)
    assert.equal(t.overbook_used, d.overbook_used)

    const c = await catalogue(one, classId)
    assert.equal(c.capacity_online, d.capacity_online)
    assert.equal(c.booked_count, d.online_used)
    assert.equal(c.spots_left, d.capacity_online - d.online_used)
  })

  test('SEAT-05 another studio’s bookings never count toward this studio’s seats, and staff cannot cross', async () => {
    const mine = await addClass(one, { online: 2, buffer: 1 })
    const theirs = await addClass(two, { online: 2, buffer: 1 })
    await memberBooks(await member(two), theirs)
    await adminBooks(two, theirs, await member(two))

    // A row carrying studio two's tenant but pointing at studio one's class —
    // written as the owner, past RLS. Only the count's own tenant filter keeps
    // it out of studio one's seats.
    const stray = await member(two)
    await harness.db.insert(schema.bookings).values({
      tenantId: two.id,
      clientId: stray.clientId,
      kind: 'class',
      classId: mine,
      state: 'confirmed',
      seat: 'online',
      qrToken: `stray-${run}`,
      code: `STRAY${run}`.slice(0, 12),
    })

    const d = await detail(one, mine)
    assert.equal(d.attending, 0)
    assert.equal(d.online_used, 0)
    assert.equal((await catalogue(one, mine)).spots_left, 2)
    assert.equal((await timetableEntry(one, mine)).attending, 0)

    // An admin cannot book onto the other studio's class, nor book the other
    // studio's member onto their own.
    const outsider = await member(two)
    const onTheirs = await adminBooks(one, theirs, await member(one))
    assert.equal(onTheirs.status, 404, JSON.stringify(onTheirs.body))
    assert.equal(onTheirs.body.error, 'class_not_found')
    const theirMember = await adminBooks(one, mine, outsider)
    assert.equal(theirMember.status, 404, JSON.stringify(theirMember.body))
    assert.equal(theirMember.body.error, 'client_not_found')
    assert.equal(await creditsLeft(outsider), 10)
  })

  test('an instructor books and reads the roster of their own classes only', async () => {
    const classId = await addClass(one, { online: 2, buffer: 1 })
    const walkIn = await member(one)

    const notTheirs = await instructorBooks(one.otherInstructor, classId, walkIn)
    assert.equal(notTheirs.status, 403, JSON.stringify(notTheirs.body))
    assert.equal(notTheirs.body.error, 'not_your_session')
    assert.equal(await creditsLeft(walkIn), 10)

    await instructorBooks(one.instructor, classId, walkIn)
    const roster = await send('GET', `/portal/instructor/sessions/class/${classId}/roster`, one.instructor.headers)
    assert.equal(roster.status, 200, JSON.stringify(roster.body))
    assert.equal(roster.body.attendance_capacity, 3)
    assert.equal(roster.body.buffer_used, 1)
    assert.equal(roster.body.attendees.length, 1)
    assert.equal(roster.body.attendees[0].seat, 'buffer')
    assert.equal('instructor_pay_sgd' in roster.body, false, 'an instructor never sees pay')

    const other = await send('GET', `/portal/instructor/sessions/class/${classId}/roster`, one.otherInstructor.headers)
    assert.equal(other.status, 403)
    assert.equal(other.body.error, 'not_your_session')
  })

  test('an instructor finds a member of their own studio to add, and nobody from another', async () => {
    const mine = await member(one)
    const theirs = await member(two)
    const [row] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, mine.clientId))
    const [their] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, theirs.clientId))

    const found = await send('GET', `/portal/instructor/clients?q=${encodeURIComponent(row!.email)}`, one.instructor.headers)
    assert.equal(found.status, 200, JSON.stringify(found.body))
    assert.deepEqual(found.body.clients, [{ id: row!.id, name: row!.name, email: row!.email }])

    const missed = await send('GET', `/portal/instructor/clients?q=${encodeURIComponent(their!.email)}`, one.instructor.headers)
    assert.deepEqual(missed.body.clients, [])
  })

  test('lowering online capacity is measured against online seats, not buffer or overbook ones', async () => {
    const classId = await addClass(one, { online: 2, buffer: 1 })
    await memberBooks(await member(one), classId)
    await adminBooks(one, classId, await member(one))
    await adminBooks(one, classId, await member(one), true)

    const toOne = await send('PATCH', `/portal/admin/schedule/classes/${classId}`, one.admin.headers, {
      capacity_online: 1,
    })
    assert.equal(toOne.status, 200, JSON.stringify(toOne.body))

    const toZero = await send('PATCH', `/portal/admin/schedule/classes/${classId}`, one.admin.headers, {
      capacity_online: 0,
    })
    assert.equal(toZero.status, 409, JSON.stringify(toZero.body))
    assert.equal(toZero.body.error, 'capacity_below_bookings')
  })
})
