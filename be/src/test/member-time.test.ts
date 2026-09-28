import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.member-time.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Clash class type ${run}`
const PACKAGE_NAME = `Clash pass ${run}`
const WORKSHOP_NAME = `Clash workshop ${run}`
const FLAG = 'waitlist_enabled'
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * One body, one session at a time (services/bookings/member-time.ts), over HTTP.
 *
 * A member may not hold two bookings whose times overlap — a class, a private
 * session, or a day of a workshop tier. The member is refused `time_clash`
 * naming what they already hold; staff are refused the same, and may book
 * anyway once told (`allow_clash`), which the audit record keeps. A waitlist
 * promotion skips a member who now clashes. Back-to-back is not a clash.
 *
 * Fixtures are written directly; every rule under test runs behind a route.
 * Each test takes its own hours (`slot`), so a clash is only ever one it set up.
 */
describe('a member in one place at a time', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
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

  // Each test's own hours, days out and a morning apart from every other test's.
  let slots = 0
  const slot = () => new Date(Date.now() + 3 * DAY + slots++ * 12 * HOUR)

  /** A one-hour class (or `minutes` long) starting at `startsAt`, one credit a seat. */
  async function addClass(
    at: Studio,
    startsAt: Date,
    opts: { online?: number; buffer?: number; waitlist?: number; minutes?: number } = {},
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.instructor.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + (opts.minutes ?? 60) * MINUTE),
        capacityOnline: opts.online ?? 10,
        // Staff book into buffer seats.
        capacityBuffer: opts.buffer ?? 2,
        capacityWaitlist: opts.waitlist ?? 0,
        creditCost: 1,
        createdByStaffId: at.admin.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MINUTE)

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
    return { clientId: client!.id, headers, email }
  }

  const book = (who: Member, classId: string) => send('POST', '/me/bookings/class', who.headers, { class_id: classId })
  const cancel = (who: Member, bookingId: string) => send('DELETE', `/me/bookings/${bookingId}`, who.headers)
  const staffBooks = (by: Staff, role: 'admin' | 'instructor', classId: string, who: Member, allowClash?: boolean) =>
    send('POST', `/portal/${role}/schedule/classes/${classId}/bookings`, by.headers, {
      client_id: who.clientId,
      ...(allowClash === undefined ? {} : { allow_clash: allowClash }),
    })

  async function booked(who: Member, classId: string) {
    const res = await book(who, classId)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.booking_id as string
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

  async function memberCard(who: Member, classId: string) {
    const from = new Date(Date.now() - DAY).toISOString()
    const to = new Date(Date.now() + 60 * DAY).toISOString()
    const res = await send('GET', `/me/classes?from=${from}&to=${to}`, who.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const card = res.body.classes.find((c: { id: string }) => c.id === classId)
    assert.ok(card, `class ${classId} missing from /me/classes`)
    return card
  }

  /** A free workshop at `at` whose one tier covers days at these times. */
  async function freeWorkshop(at: Studio, days: { startsAt: Date; minutes: number }[]) {
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: at.id, name: WORKSHOP_NAME, locationId: at.locationId, createdByStaffId: at.admin.id })
      .returning({ id: schema.workshops.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: at.id, workshopId: workshop!.id, name: 'Full', regularPriceSgd: '0.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    for (const [i, d] of days.entries()) {
      const [day] = await harness.db
        .insert(schema.workshopDays)
        .values({
          tenantId: at.id,
          workshopId: workshop!.id,
          ord: i + 1,
          roomId: at.roomId,
          startsAt: d.startsAt,
          endsAt: new Date(d.startsAt.getTime() + d.minutes * MINUTE),
          basePriceSgd: '0.00',
          capacityOnline: 10,
        })
        .returning({ id: schema.workshopDays.id })
      await harness.db.insert(schema.workshopTierDays).values({ tenantId: at.id, workshopTierId: tier!.id, workshopDayId: day!.id })
    }
    return { workshopId: workshop!.id, tierId: tier!.id }
  }

  const registerWorkshop = (who: Member, w: { workshopId: string; tierId: string }) =>
    send('POST', '/me/checkout/workshop', who.headers, { workshop_id: w.workshopId, workshop_tier_id: w.tierId })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    assert.equal((await send('PATCH', `/portal/admin/feature-flags/${FLAG}`, one.admin.headers, { enabled: true })).status, 200)
  })

  after(async () => {
    if (!harness) return
    if (one) await send('PATCH', `/portal/admin/feature-flags/${FLAG}`, one.admin.headers, { enabled: false })
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM feature_flags WHERE key = ${FLAG} AND updated_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM clients WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM waitlist_entries WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name = ${WORKSHOP_NAME}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── The member ──────────────────────────────────────────────────── */

  test('BKG-37 a member booked 4:00–5:00 is refused a class at 4:15, told which class, and nothing is spent', async () => {
    const four = slot()
    const first = await addClass(one, four)
    const second = await addClass(one, at(four, 15))
    const ana = await member(one)
    const held = await booked(ana, first)

    const res = await book(ana, second)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'time_clash')
    assert.equal(res.body.clash.booking_id, held)
    assert.equal(res.body.clash.kind, 'class')
    assert.equal(res.body.clash.title, CLASS_TYPE_NAME)
    assert.equal(res.body.clash.starts_at, four.toISOString())
    assert.equal((await confirmedOn(ana, second)).length, 0)
    assert.equal(await creditsLeft(ana), 9, 'only the first class was paid for')
  })

  test('BKG-38 back-to-back classes are both booked: one ending at 5, the next starting at 5', async () => {
    const four = slot()
    const ben = await member(one)
    await booked(ben, await addClass(one, four))
    await booked(ben, await addClass(one, at(four, 60)))
    await booked(ben, await addClass(one, at(four, -60)))
    assert.equal(await creditsLeft(ben), 7)
  })

  test('BKG-39 a cancelled booking, or a booking on a cancelled class, does not hold the member’s time', async () => {
    const four = slot()
    const cal = await member(one)
    const dropped = await addClass(one, four)
    await cancel(cal, await booked(cal, dropped)).then(r => assert.equal(r.status, 200, JSON.stringify(r.body)))
    const called = await addClass(one, at(four, 5))
    await booked(cal, called)
    await harness.db.update(schema.classes).set({ lifecycle: 'cancelled' }).where(eq(schema.classes.id, called))

    await booked(cal, await addClass(one, at(four, 10)))
  })

  test('BKG-40 two overlapping classes booked at the same moment: exactly one is confirmed, one credit spent', async () => {
    const four = slot()
    const a = await addClass(one, four)
    const b = await addClass(one, at(four, 30))
    const dee = await member(one)

    const results = await Promise.all([book(dee, a), book(dee, b)])
    const statuses = results.map(r => r.status).sort()
    assert.deepEqual(statuses, [201, 409], JSON.stringify(results.map(r => r.body)))
    assert.equal(results.find(r => r.status === 409)!.body.error, 'time_clash')
    assert.equal((await confirmedOn(dee, a)).length + (await confirmedOn(dee, b)).length, 1)
    assert.equal(await creditsLeft(dee), 9)
  })

  test('BKG-41 a workshop day the member registered for clashes with a class at that hour; a day at another hour does not', async () => {
    const four = slot()
    const eve = await member(one)
    const w = await freeWorkshop(one, [
      { startsAt: four, minutes: 120 },
      { startsAt: at(four, 24 * 60), minutes: 120 },
    ])
    assert.equal((await registerWorkshop(eve, w)).status, 201)

    const during = await book(eve, await addClass(one, at(four, 60)))
    assert.equal(during.status, 409, JSON.stringify(during.body))
    assert.equal(during.body.clash.kind, 'workshop')
    assert.equal(during.body.clash.title, WORKSHOP_NAME)

    await booked(eve, await addClass(one, at(four, 180)))
  })

  test('BKG-42 the schedule marks a class that overlaps the member’s booking, and only that one', async () => {
    const four = slot()
    const held = await addClass(one, four)
    const overlapping = await addClass(one, at(four, 15))
    const after = await addClass(one, at(four, 60))
    const fay = await member(one)
    const bookingId = await booked(fay, held)

    const card = await memberCard(fay, overlapping)
    assert.deepEqual(card.clash, {
      booking_id: bookingId,
      kind: 'class',
      title: CLASS_TYPE_NAME,
      starts_at: four.toISOString(),
      ends_at: at(four, 60).toISOString(),
      location_name: card.location.name,
    })
    assert.equal((await memberCard(fay, after)).clash, null, 'back-to-back')
    assert.equal((await memberCard(fay, held)).clash, null, 'a class never clashes with itself')

    // The class detail says the same.
    const detail = await send('GET', `/me/classes/${overlapping}`, fay.headers)
    assert.equal(detail.body.clash.booking_id, bookingId)
  })

  test('BKG-42 a member cannot book past a clash: the member route takes no `allow_clash`', async () => {
    const four = slot()
    const gus = await member(one)
    await booked(gus, await addClass(one, four))
    const later = await addClass(one, at(four, 30))
    const res = await send('POST', '/me/bookings/class', gus.headers, { class_id: later, allow_clash: true })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal((await confirmedOn(gus, later)).length, 0)
  })

  /* ── Staff ───────────────────────────────────────────────────────── */

  test('BKG-43 staff booking a member into an overlapping class are told whose booking it clashes with, and may book anyway', async () => {
    const four = slot()
    const hal = await member(one)
    const held = await booked(hal, await addClass(one, four))

    for (const [by, role] of [
      [one.admin, 'admin'],
      [one.instructor, 'instructor'],
    ] as const) {
      const classId = await addClass(one, at(four, 30))
      const refused = await staffBooks(by, role, classId, hal)
      assert.equal(refused.status, 409, JSON.stringify(refused.body))
      assert.equal(refused.body.error, 'time_clash')
      assert.equal(refused.body.client_id, hal.clientId)
      assert.equal(refused.body.client_name, hal.email.split('-')[0])
      assert.equal(refused.body.clash.booking_id, held)

      const anyway = await staffBooks(by, role, classId, hal, true)
      assert.equal(anyway.status, 201, JSON.stringify(anyway.body))
      const [audit] = await harness.db
        .select({ payload: schema.auditLog.payload })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.targetTable, 'bookings'), eq(schema.auditLog.targetId, anyway.body.booking_id)))
      assert.deepEqual((audit!.payload as { detail?: unknown }).detail, { allow_clash: true }, `${role}'s override is audited`)
    }
  })

  test('BKG-44 another studio’s booking at the same hour never holds this studio’s member', async () => {
    const four = slot()
    const ida = await member(one)
    // A row carrying studio two's tenant but naming studio one's member —
    // written as the owner, past RLS. Only the clash query's own tenant filter
    // keeps it out of this member's time.
    const theirs = await addClass(two, four)
    await harness.db.insert(schema.bookings).values({
      tenantId: two.id,
      clientId: ida.clientId,
      kind: 'class',
      classId: theirs,
      state: 'confirmed',
      seat: 'online',
      qrToken: `clash-stray-${run}`,
      code: `CLS${run}`.slice(0, 12),
    })
    await booked(ida, await addClass(one, four))
  })

  /* ── The waitlist ────────────────────────────────────────────────── */

  test('WTL-31 a freed seat skips a waiting member who has since booked an overlapping class, and books the next', async () => {
    const four = slot()
    const full = await addClass(one, four, { online: 1, waitlist: 3 })
    const seated = await member(one)
    const seatBooking = await booked(seated, full)

    const first = await member(one)
    const second = await member(one)
    for (const who of [first, second]) {
      const res = await send('POST', `/me/waitlist/classes/${full}`, who.headers)
      assert.equal(res.status, 201, JSON.stringify(res.body))
    }
    // Waiting, the first member books something else at 4:30.
    await booked(first, await addClass(one, at(four, 30)))

    assert.equal((await cancel(seated, seatBooking)).status, 200)
    assert.equal((await confirmedOn(first, full)).length, 0, 'the clashing member is skipped')
    assert.equal((await confirmedOn(second, full)).length, 1, 'the next in line is booked')
    const [entry] = await harness.db
      .select({ status: schema.waitlistEntries.status })
      .from(schema.waitlistEntries)
      .where(and(eq(schema.waitlistEntries.clientId, first.clientId), eq(schema.waitlistEntries.classId, full)))
    assert.equal(entry!.status, 'waiting', 'and keeps their place for the next seat')
  })

  test('WTL-32 a member may not join the line of a class that overlaps their booking; staff may put them in it anyway', async () => {
    const four = slot()
    const full = await addClass(one, four, { online: 1, waitlist: 3 })
    await booked(await member(one), full)
    const jo = await member(one)
    await booked(jo, await addClass(one, at(four, 45)))

    const joined = await send('POST', `/me/waitlist/classes/${full}`, jo.headers)
    assert.equal(joined.status, 409, JSON.stringify(joined.body))
    assert.equal(joined.body.error, 'time_clash')

    const byStaff = await send('POST', `/portal/admin/schedule/classes/${full}/waitlist`, one.admin.headers, {
      client_id: jo.clientId,
    })
    assert.equal(byStaff.status, 409, JSON.stringify(byStaff.body))
    assert.equal(byStaff.body.error, 'time_clash')
    const anyway = await send('POST', `/portal/admin/schedule/classes/${full}/waitlist`, one.admin.headers, {
      client_id: jo.clientId,
      allow_clash: true,
    })
    assert.equal(anyway.status, 201, JSON.stringify(anyway.body))
  })

  /* ── Workshops ───────────────────────────────────────────────────── */

  test('WSP-17 a member booked into a class on one of a tier’s days is refused that tier at checkout, before any payment', async () => {
    const four = slot()
    const kim = await member(one)
    const held = await booked(kim, await addClass(one, at(four, 30)))
    const w = await freeWorkshop(one, [{ startsAt: four, minutes: 120 }])

    const res = await registerWorkshop(kim, w)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'time_clash')
    assert.equal(res.body.clash.booking_id, held)
    const places = await harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.clientId, kim.clientId), eq(schema.bookings.workshopId, w.workshopId)))
    assert.equal(places.length, 0)
  })
})
