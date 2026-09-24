import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.package-validity.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `Validity ${run}`
const CLASS_TYPE_NAME = `Validity class type ${run}`
const SECOND_LOCATION_NAME = `Validity second premises ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** Where the app's clock stands for every test here: a mid-month instant, so month arithmetic has no edge to fall off. */
const T = new Date('2031-03-10T04:00:00Z')

/**
 * When a package starts and ends, over real HTTP (#215): Activation on the
 * first booking it pays for, which package pays when a member holds several,
 * and what an Admin's hand on a package's expiry or Home Location does.
 *
 * Written from the PKG rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`). The app's clock stands at `T` throughout
 * (`lib/clock`), so every expiry is asserted to the millisecond from the
 * booking moment rather than to within a tolerance of the wall clock. Every
 * test acts through a route and reads back the rows it left: the booking, the
 * package, the cancellation and the ledger.
 */
describe('package activation and expiry over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    secondLocationId: string
    secondRoomId: string
    classTypeId: string
    admin: Staff
    instructor: Staff
    bundleId: string
    unlimitedId: string
    trialId: string
    ptId: string
  }
  type Member = { clientId: string; headers: Record<string, string> }
  type Kind = 'credit_bundle' | 'unlimited' | 'trial' | 'pt'

  let one!: Studio
  let two!: Studio

  const json = { 'Content-Type': 'application/json' }
  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const days = (n: number) => new Date(T.getTime() + n * DAY)
  const addUtcMonths = (from: Date, months: number) => {
    const d = new Date(from)
    d.setUTCMonth(d.getUTCMonth() + months)
    return d
  }

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${name}-${tenant.slug}`)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select({ id: schema.staffAuthUsers.id }).from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    return { id: row!.id, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location.id)).limit(1)
    assert.ok(room, `expected a seeded room for ${tenant.slug}`)
    const [second] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: SECOND_LOCATION_NAME })
      .returning({ id: schema.locations.id })
    const [secondRoom] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: second!.id, name: `Room ${run}`, capacity: 20 })
      .returning({ id: schema.rooms.id })

    const classType = await classTypesSvc.createClassType(tenant.id, { name: CLASS_TYPE_NAME })
    const admin = await staffAt(tenant, 'admin', 'admin')
    const instructor = await staffAt(tenant, 'instructor', 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: instructor.id })

    const catalogue = async (values: Partial<typeof schema.classPackages.$inferInsert> & { kind: 'credit_bundle' | 'unlimited' | 'trial' }) => {
      const [row] = await harness.db
        .insert(schema.classPackages)
        .values({ tenantId: tenant.id, name: `${NAME} ${values.kind}`, priceSgd: '150.00', status: 'active', ...values })
        .returning({ id: schema.classPackages.id })
      return row!.id
    }
    const [pt] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: `${NAME} pt`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00' })
      .returning({ id: schema.ptPackages.id })

    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      secondLocationId: second!.id,
      secondRoomId: secondRoom!.id,
      classTypeId: classType.id,
      admin,
      instructor,
      bundleId: await catalogue({ kind: 'credit_bundle', credits: 10, validityDays: 30 }),
      unlimitedId: await catalogue({ kind: 'unlimited', durationMonths: 1 }),
      trialId: await catalogue({ kind: 'trial', credits: 1, validityDays: 14, priceSgd: '0.00' }),
      ptId: pt!.id,
    }
  }

  let members = 0
  async function member(at: Studio): Promise<Member> {
    const email = emailFor(`member-${members++}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  /**
   * A package the member holds, as a purchase would have left it: Dormant
   * (null expiry) unless `expiresAt` says it is already running. Purchases are
   * a second apart in the order made, so "the one that waited longest" is the
   * one made first.
   */
  let purchases = 0
  async function holds(
    at: Studio,
    who: Member,
    kind: Kind,
    options: { credits?: number; expiresAt?: Date | null; locationId?: string } = {},
  ): Promise<string> {
    const unlimited = kind === 'unlimited'
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind,
        sourceClassPackageId: kind === 'pt' ? null : { credit_bundle: at.bundleId, unlimited: at.unlimitedId, trial: at.trialId }[kind],
        sourcePtPackageId: kind === 'pt' ? at.ptId : null,
        locationId: unlimited ? (options.locationId ?? at.locationId) : null,
        durationMonths: unlimited ? 1 : null,
        validityDays: unlimited ? null : 30,
        creditsOrSessionsRemaining: unlimited ? null : (options.credits ?? 5),
        expiresAt: options.expiresAt ?? null,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
        purchasedAt: new Date(T.getTime() - 30 * DAY + purchases++ * 1000),
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /** A class `startsIn` after the clock's now (three days by default). */
  async function addClass(at: Studio, options: { startsIn?: number; atSecond?: boolean } = {}): Promise<string> {
    const startsAt = new Date(harness.clock.now().getTime() + (options.startsIn ?? 3 * DAY))
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.instructor.id,
        locationId: options.atSecond ? at.secondLocationId : at.locationId,
        roomId: options.atSecond ? at.secondRoomId : at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: at.instructor.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  const post = (headers: Record<string, string>, path: string, body?: unknown) =>
    harness.app.request(path, {
      method: 'POST',
      headers: { ...headers, ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const book = (who: Member, classId: string, extra: Record<string, unknown> = {}) =>
    post(who.headers, '/api/v1/me/bookings/class', { class_id: classId, ...extra })

  async function bookOk(who: Member, classId: string, extra: Record<string, unknown> = {}): Promise<string> {
    return (await expectStatus(await book(who, classId, extra), 201)).booking_id as string
  }

  const adminOn = (as: Staff | Record<string, string>, who: Member, packageId: string, action: string, body: unknown) =>
    post('headers' in as ? (as.headers as Record<string, string>) : as, `/api/v1/portal/admin/clients/${who.clientId}/packages/${packageId}/${action}`, body)

  const setExpiry = (as: Staff, who: Member, packageId: string, expiresAt: Date | null, reason = 'test: expiry') =>
    adminOn(as, who, packageId, 'expiry', { expires_at: expiresAt?.toISOString() ?? null, reason })

  const moveHome = (as: Staff, who: Member, packageId: string, locationId: string, reason = 'test: wrong Location at checkout') =>
    adminOn(as, who, packageId, 'location', { location_id: locationId, reason })

  /* ── state ──────────────────────────────────────────────────────────── */

  async function pkg(id: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, id))
    assert.ok(row, `no package ${id}`)
    return row
  }

  async function bookingRow(id: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, id))
    assert.ok(row, `no booking ${id}`)
    return row
  }

  const ledgerOf = (packageId: string) =>
    harness.db
      .select()
      .from(schema.manualAdjustments)
      .where(eq(schema.manualAdjustments.clientPackageId, packageId))
      .orderBy(schema.manualAdjustments.createdAt)

  const bookingsOf = (who: Member) => harness.db.select().from(schema.bookings).where(eq(schema.bookings.clientId, who.clientId))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    harness.clock.set(T)
  })

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const workshops = sql`SELECT id FROM workshops WHERE name LIKE ${`${NAME}%`}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (SELECT id FROM pt_requests WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name LIKE ${`${NAME}%`}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (SELECT id FROM locations WHERE name = ${SECOND_LOCATION_NAME})`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name = ${SECOND_LOCATION_NAME}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── Activation ─────────────────────────────────────────────────────── */

  test('PKG-12 a Dormant plan booked weeks ahead Activates from the booking moment plus its Duration, not from the class date', async () => {
    const ada = await member(one)
    const plan = await holds(one, ada, 'unlimited')
    const classId = await addClass(one, { startsIn: 3 * 7 * DAY })

    const bookingId = await bookOk(ada, classId)
    const started = await pkg(plan)
    assert.equal(started.expiresAt?.toISOString(), addUtcMonths(T, 1).toISOString(), 'one month from the booking moment')
    const booking = await bookingRow(bookingId)
    assert.equal(booking.clientPackageId, plan)
    assert.equal(booking.creditsOrSessionsUsed, 0)
    assert.equal(booking.state, 'confirmed')
  })

  test('PKG-29 a Dormant Credit Bundle pays its credit and Activates with its frozen validity from the booking moment', async () => {
    const ben = await member(one)
    const bundle = await holds(one, ben, 'credit_bundle', { credits: 3 })
    const bookingId = await bookOk(ben, await addClass(one, { startsIn: 10 * DAY }))
    const started = await pkg(bundle)
    assert.equal(started.expiresAt?.toISOString(), days(30).toISOString(), 'validity_days from the booking, not from the purchase')
    assert.equal(started.creditsOrSessionsRemaining, 2)
    assert.equal((await bookingRow(bookingId)).creditsOrSessionsUsed, 1)
  })

  test('PKG-13 a Dormant plan that would end before the class is not used or Activated, and the booking is refused when nothing else covers it', async () => {
    const cal = await member(one)
    const plan = await holds(one, cal, 'unlimited')
    const classId = await addClass(one, { startsIn: 45 * DAY })

    await expectStatus(await book(cal, classId), 409, 'plan_expires_before_class')
    const still = await pkg(plan)
    assert.equal(still.expiresAt, null, 'the plan was Activated by a refused booking')
    assert.equal(still.active, true)
    assert.equal((await bookingsOf(cal)).length, 0)
  })

  test('PKG-14 with an Activated covering plan and a Dormant renewal, the Activated plan pays and the renewal stays Dormant', async () => {
    const dee = await member(one)
    const current = await holds(one, dee, 'unlimited', { expiresAt: days(20) })
    const renewal = await holds(one, dee, 'unlimited')
    const bookingId = await bookOk(dee, await addClass(one))

    assert.equal((await bookingRow(bookingId)).clientPackageId, current)
    assert.equal((await pkg(current)).expiresAt?.toISOString(), days(20).toISOString(), 'the running plan is unchanged')
    assert.equal((await pkg(renewal)).expiresAt, null, 'the renewal started early')
  })

  test('PKG-15 with an Activated Unlimited Plan and a Dormant Credit Bundle, the plan pays and no credit leaves the bundle', async () => {
    const eve = await member(one)
    const plan = await holds(one, eve, 'unlimited', { expiresAt: days(20) })
    const bundle = await holds(one, eve, 'credit_bundle', { credits: 5 })
    const bookingId = await bookOk(eve, await addClass(one))

    const booking = await bookingRow(bookingId)
    assert.equal(booking.clientPackageId, plan)
    assert.equal(booking.creditsOrSessionsUsed, 0)
    const untouched = await pkg(bundle)
    assert.equal(untouched.creditsOrSessionsRemaining, 5)
    assert.equal(untouched.expiresAt, null, 'the bundle started while the plan runs')
    assert.equal((await ledgerOf(bundle)).length, 0)
  })

  test('PKG-16 with a Dormant plan and a Credit Bundle, booking with use_credits pays by credits and the plan stays Dormant', async () => {
    const fin = await member(one)
    const plan = await holds(one, fin, 'unlimited')
    const bundle = await holds(one, fin, 'credit_bundle', { credits: 5 })
    const bookingId = await bookOk(fin, await addClass(one), { use_credits: true })

    const booking = await bookingRow(bookingId)
    assert.equal(booking.clientPackageId, bundle)
    assert.equal(booking.creditsOrSessionsUsed, 1)
    assert.equal((await pkg(bundle)).creditsOrSessionsRemaining, 4)
    assert.equal((await pkg(plan)).expiresAt, null, 'the plan was Activated by a credit booking')
  })

  test('PKG-17 a PT request or a workshop booking leaves a Dormant plan Dormant', async () => {
    const gus = await member(one)
    const plan = await holds(one, gus, 'unlimited')
    const ptPackage = await holds(one, gus, 'pt', { credits: 3 })

    const proposed = days(5).toISOString().slice(0, 10)
    await expectStatus(
      await post(gus.headers, '/api/v1/me/pt-sessions/request', {
        classTypeId: one.classTypeId,
        locationId: one.locationId,
        sessionType: '1on1',
        clientPackageId: ptPackage,
        slots: [{ proposedDate: proposed, startTime: '09:00', endTime: '10:00' }],
      }),
      201,
    )

    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: one.id, name: `${NAME} workshop`, locationId: one.locationId, createdByStaffId: one.admin.id })
      .returning({ id: schema.workshops.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: one.id, workshopId: workshop!.id, name: 'Free', regularPriceSgd: '0.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    const booked = await expectStatus(
      await post(gus.headers, '/api/v1/me/checkout/workshop', { workshop_id: workshop!.id, workshop_tier_id: tier!.id }),
      201,
    )
    assert.equal(booked.outcome, 'granted')

    const still = await pkg(plan)
    assert.equal(still.expiresAt, null, 'only a confirmed class booking Activates a plan')
    assert.equal(still.active, true)
    assert.ok((await pkg(ptPackage)).expiresAt, 'the PT package itself did start')
  })

  test('PKG-18 two first bookings arriving at once Activate a Dormant plan once, with a single end date', async () => {
    const hal = await member(one)
    const plan = await holds(one, hal, 'unlimited')
    const [first, second] = [await addClass(one), await addClass(one, { startsIn: 4 * DAY })]

    const answers = await Promise.all([book(hal, first), book(hal, second)])
    for (const res of answers) await expectStatus(res, 201)

    const started = await pkg(plan)
    assert.equal(started.expiresAt?.toISOString(), addUtcMonths(T, 1).toISOString())
    const booked = await bookingsOf(hal)
    assert.equal(booked.length, 2)
    assert.ok(booked.every(b => b.clientPackageId === plan))
    const running = await harness.db
      .select()
      .from(schema.clientPackages)
      .where(and(eq(schema.clientPackages.clientId, hal.clientId), sql`${schema.clientPackages.expiresAt} IS NOT NULL`))
    assert.equal(running.length, 1)
  })

  test('PKG-19 cancelling the booking that Activated a plan, by the member or by an admin, leaves its expiry where it is', async () => {
    const ian = await member(one)
    const memberPlan = await holds(one, ian, 'unlimited')
    const bookingId = await bookOk(ian, await addClass(one, { startsIn: 7 * DAY }))
    const stamped = (await pkg(memberPlan)).expiresAt
    assert.ok(stamped)
    await expectStatus(await harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers: ian.headers }), 200)
    assert.equal((await bookingRow(bookingId)).state, 'cancelled')
    const [cancellation] = await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))
    assert.equal(cancellation?.source, 'client')
    assert.equal((await pkg(memberPlan)).expiresAt?.toISOString(), stamped.toISOString(), 'a member cancel un-Activated the plan')

    const jo = await member(one)
    const adminPlan = await holds(one, jo, 'unlimited')
    const other = await bookOk(jo, await addClass(one, { startsIn: 7 * DAY }))
    const adminStamped = (await pkg(adminPlan)).expiresAt
    assert.ok(adminStamped)
    await expectStatus(await post(one.admin.headers, `/api/v1/portal/admin/bookings/${other}/cancel`), 200)
    assert.equal((await bookingRow(other)).state, 'cancelled')
    const [adminCancellation] = await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, other))
    assert.equal(adminCancellation?.source, 'admin')
    assert.equal((await pkg(adminPlan)).expiresAt?.toISOString(), adminStamped.toISOString(), 'an admin cancel un-Activated the plan')
  })

  test('PKG-30 a running Credit Bundle pays while a Dormant covering plan waits, and once the bundle is spent the next booking Activates the plan', async () => {
    const kai = await member(one)
    const bundle = await holds(one, kai, 'credit_bundle', { credits: 1, expiresAt: days(20) })
    const plan = await holds(one, kai, 'unlimited')

    const paidByBundle = await bookOk(kai, await addClass(one))
    assert.equal((await bookingRow(paidByBundle)).clientPackageId, bundle)
    assert.equal((await pkg(plan)).expiresAt, null, 'the plan started while the bundle ran')
    const spent = await pkg(bundle)
    assert.equal(spent.creditsOrSessionsRemaining, 0)
    assert.equal(spent.active, false, 'spent to zero is ended')

    const paidByPlan = await bookOk(kai, await addClass(one, { startsIn: 4 * DAY }))
    assert.equal((await bookingRow(paidByPlan)).clientPackageId, plan)
    assert.equal((await pkg(plan)).expiresAt?.toISOString(), addUtcMonths(T, 1).toISOString())
  })

  test('PKG-11 a class-family package an Admin gives beside an Activated one lands Dormant, and Activates only on the first booking after the current one ends', async () => {
    const lea = await member(one)
    const current = await holds(one, lea, 'credit_bundle', { credits: 2 })
    await bookOk(lea, await addClass(one))
    const before = await pkg(current)
    assert.ok(before.expiresAt)
    assert.equal(before.creditsOrSessionsRemaining, 1)

    const given = await expectStatus(
      await post(one.admin.headers, `/api/v1/portal/admin/clients/${lea.clientId}/packages/issue`, {
        package_kind: 'class',
        package_id: one.bundleId,
        reason: 'test: goodwill',
      }),
      201,
    )
    const gift = given.client_package_id as string
    assert.equal((await pkg(gift)).expiresAt, null, 'the given package started beside the running one')
    const unchanged = await pkg(current)
    assert.equal(unchanged.expiresAt?.toISOString(), before.expiresAt!.toISOString())
    assert.equal(unchanged.creditsOrSessionsRemaining, 1)

    // The current bundle pays its last credit; the gift still waits.
    const last = await bookOk(lea, await addClass(one, { startsIn: 4 * DAY }))
    assert.equal((await bookingRow(last)).clientPackageId, current)
    assert.equal((await pkg(gift)).expiresAt, null)

    // Now the current one has ended, the next booking starts the gift.
    const first = await bookOk(lea, await addClass(one, { startsIn: 5 * DAY }))
    assert.equal((await bookingRow(first)).clientPackageId, gift)
    assert.equal((await pkg(gift)).expiresAt?.toISOString(), days(30).toISOString())
  })

  /* ── an Admin's hand on a package ───────────────────────────────────── */

  test('PKG-25 an Admin editing the expiry of a Credit Bundle, Unlimited Plan or Trial with a reason moves it and writes a zero-delta ledger row naming both dates', async () => {
    for (const kind of ['credit_bundle', 'unlimited', 'trial'] as const) {
      const max = await member(one)
      const held = await holds(one, max, kind, { expiresAt: days(10) })
      const moved = days(40)
      const res = await expectStatus(await setExpiry(one.admin, max, held, moved, 'test: extended for an injury'), 200)
      assert.equal(new Date(res.expires_at).toISOString(), moved.toISOString())

      assert.equal((await pkg(held)).expiresAt?.toISOString(), moved.toISOString())
      const [row, ...more] = await ledgerOf(held)
      assert.equal(more.length, 0)
      assert.equal(row!.delta, 0)
      assert.equal(row!.actedByStaffId, one.admin.id)
      assert.ok(row!.reason.includes(days(10).toISOString().slice(0, 10)), `the old date is recorded: ${row!.reason}`)
      assert.ok(row!.reason.includes(moved.toISOString().slice(0, 10)), `the new date is recorded: ${row!.reason}`)
      assert.ok(row!.reason.includes('test: extended for an injury'))
    }
  })

  test('PKG-26 staff returning an Activated plan to Dormant clears its expiry, and the next booking Activates it again', async () => {
    const ned = await member(one)
    const plan = await holds(one, ned, 'unlimited')
    await bookOk(ned, await addClass(one))
    assert.ok((await pkg(plan)).expiresAt)

    await expectStatus(await setExpiry(one.admin, ned, plan, null, 'test: activated by a class we cancelled'), 200)
    const dormant = await pkg(plan)
    assert.equal(dormant.expiresAt, null)
    assert.equal(dormant.active, true)
    const [row] = await ledgerOf(plan)
    assert.equal(row!.delta, 0)
    assert.ok(row!.reason.includes('Dormant'), row!.reason)

    harness.clock.set(days(2))
    try {
      await bookOk(ned, await addClass(one))
      assert.equal((await pkg(plan)).expiresAt?.toISOString(), addUtcMonths(days(2), 1).toISOString(), 'Activated again, from the new booking')
    } finally {
      harness.clock.set(T)
    }
  })

  test('PKG-27 changing the Home Location of an Activated plan moves its Dormant renewal too, one ledger row each, and leaves bookings alone', async () => {
    const ola = await member(one)
    const current = await holds(one, ola, 'unlimited', { expiresAt: days(20) })
    const renewal = await holds(one, ola, 'unlimited')
    const bookingId = await bookOk(ola, await addClass(one))
    const before = await bookingRow(bookingId)

    await expectStatus(await moveHome(one.admin, ola, current, one.secondLocationId), 200)

    for (const id of [current, renewal]) {
      assert.equal((await pkg(id)).locationId, one.secondLocationId)
      const rows = await ledgerOf(id)
      assert.equal(rows.length, 1, `one ledger row for ${id}`)
      assert.equal(rows[0]!.delta, 0)
    }
    assert.equal((await pkg(current)).expiresAt?.toISOString(), days(20).toISOString())
    assert.equal((await pkg(renewal)).expiresAt, null)
    const after = await bookingRow(bookingId)
    assert.equal(after.state, 'confirmed')
    assert.equal(after.clientPackageId, before.clientPackageId)
  })

  test('PKG-31 an Admin setting an expiry on a Dormant package while another of its family runs is refused 409 family_already_activated, and nothing changes', async () => {
    const pam = await member(one)
    const running = await holds(one, pam, 'credit_bundle', { expiresAt: days(20) })
    const waiting = await holds(one, pam, 'credit_bundle')

    await expectStatus(await setExpiry(one.admin, pam, waiting, days(40)), 409, 'family_already_activated')
    assert.equal((await pkg(waiting)).expiresAt, null)
    assert.equal((await pkg(running)).expiresAt?.toISOString(), days(20).toISOString())
    assert.equal((await ledgerOf(waiting)).length, 0)
    assert.equal((await ledgerOf(running)).length, 0)
  })

  /* ── whose packages ─────────────────────────────────────────────────── */

  test("PKG-25, PKG-27 another studio's admin, an instructor, or an admin naming the wrong member cannot edit a package's expiry or Home Location", async () => {
    const rio = await member(one)
    const plan = await holds(one, rio, 'unlimited', { expiresAt: days(20) })
    const someoneElse = await member(one)

    // Another studio's admin: the member and the package are not there to find.
    await expectStatus(await setExpiry(two.admin, rio, plan, days(40)), 404)
    await expectStatus(await moveHome(two.admin, rio, plan, two.locationId), 404)
    // An instructor of the studio: not an admin.
    await expectStatus(await setExpiry(one.instructor, rio, plan, days(40)), 403)
    await expectStatus(await moveHome(one.instructor, rio, plan, one.secondLocationId), 403)
    // The studio's own admin, naming the wrong member for the package.
    await expectStatus(await setExpiry(one.admin, someoneElse, plan, days(40)), 404, 'client_package_not_found')
    await expectStatus(await moveHome(one.admin, someoneElse, plan, one.secondLocationId), 404, 'client_package_not_found')
    // A member cannot reach the admin routes at all.
    await expectStatus(await setExpiry({ id: rio.clientId, headers: rio.headers }, rio, plan, days(40)), 401)

    const after = await pkg(plan)
    assert.equal(after.expiresAt?.toISOString(), days(20).toISOString())
    assert.equal(after.locationId, one.locationId)
    assert.equal((await ledgerOf(plan)).length, 0)
  })

  test("PKG-12 a member's booking never Activates, or is paid by, another member's or another studio's package", async () => {
    const sid = await member(one)
    const tess = await member(one)
    const ula = await member(two)
    const tessPlan = await holds(one, tess, 'unlimited')
    const ulaPlan = await holds(two, ula, 'unlimited', { locationId: two.locationId })

    await expectStatus(await book(sid, await addClass(one)), 409, 'insufficient_credits')
    assert.equal((await pkg(tessPlan)).expiresAt, null)
    assert.equal((await pkg(ulaPlan)).expiresAt, null)
    assert.equal((await bookingsOf(sid)).length, 0)
  })
})
