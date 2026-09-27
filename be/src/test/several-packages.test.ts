import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.several-packages.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `Several ${run}`
const CLASS_TYPE_NAME = `Several class type ${run}`
const SECOND_LOCATION_NAME = `Several second premises ${run}`
const FLAG = 'waitlist_enabled'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** Where the app's clock stands for every test here: a mid-month instant, so month arithmetic has no edge to fall off. */
const T = new Date('2031-04-10T04:00:00Z')

/**
 * Several packages run per Family, and the member picks the payer
 * (be/docs/adr/0010), over real HTTP: the Book sheet's pick honoured or refused
 * with its reason, the Default payer wherever nobody picks (an old client,
 * staff booking, staff promoting, the automatic promotion), the class detail
 * listing a member's packages classified, and several packages Activated at
 * once. Named from the Scenario Inventory (`docs/md/test-scenarios.md`).
 */
describe('several packages per Family, the member picks the payer', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
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
    ptId: string
  }
  type Member = { clientId: string; headers: Record<string, string> }
  type Kind = 'credit_bundle' | 'unlimited' | 'pt'

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

    const catalogue = async (values: Partial<typeof schema.classPackages.$inferInsert> & { kind: 'credit_bundle' | 'unlimited' }) => {
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
      .values({ tenantId: at.id, email, name: 'Ria', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  /**
   * A package the member holds, as a purchase would have left it: Dormant (null
   * expiry) unless `expiresAt` says it is already running. Purchases are a
   * second apart in the order made.
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
        sourceClassPackageId: kind === 'pt' ? null : { credit_bundle: at.bundleId, unlimited: at.unlimitedId }[kind],
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
  async function addClass(
    at: Studio,
    options: {
      startsIn?: number
      atSecond?: boolean
      creditCost?: number
      capacityOnline?: number
      capacityWaitlist?: number
      capacityBuffer?: number
    } = {},
  ): Promise<string> {
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
        capacityOnline: options.capacityOnline ?? 10,
        capacityWaitlist: options.capacityWaitlist ?? 0,
        capacityBuffer: options.capacityBuffer ?? 0,
        creditCost: options.creditCost ?? 1,
        createdByStaffId: at.instructor.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  const send = (method: string, headers: Record<string, string>, path: string, body?: unknown) =>
    harness.app.request(path, {
      method,
      headers: { ...headers, ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const book = (who: Member, classId: string, extra: Record<string, unknown> = {}) =>
    send('POST', who.headers, '/api/v1/me/bookings/class', { class_id: classId, ...extra })

  const setFlag = (at: Studio, enabled: boolean) =>
    send('PATCH', at.admin.headers, `/api/v1/portal/admin/feature-flags/${FLAG}`, { enabled })

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

  const bookingsOn = (who: Member, classId: string) =>
    harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.clientId, who.clientId), eq(schema.bookings.classId, classId)))

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
    if (one) await setFlag(one, false)
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM feature_flags WHERE key = ${FLAG} AND updated_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM waitlist_entries WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
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

  /* ── the member's pick ──────────────────────────────────────────────── */

  test('BKG-21 a member picking a running package the Default payer would not pays with it, and the response names it', async () => {
    const ada = await member(one)
    const sooner = await holds(one, ada, 'credit_bundle', { expiresAt: days(10) })
    const plan = await holds(one, ada, 'unlimited', { expiresAt: days(20) })

    const res = await expectStatus(await book(ada, await addClass(one), { client_package_id: plan }), 201)
    const row = await bookingRow(res.booking_id)
    assert.equal(row.clientPackageId, plan, 'the pick paid, not the soonest-ending bundle')
    assert.equal(row.creditsOrSessionsUsed, 0)
    assert.deepEqual(res.paid_with, { client_package_id: plan, name: `${NAME} unlimited`, kind: 'unlimited' })
    assert.equal((await pkg(sooner)).creditsOrSessionsRemaining, 5, 'the bundle was not touched')
  })

  test('BKG-22 a member picking a Dormant package while another runs Activates it from today, and both run', async () => {
    const bo = await member(one)
    const running = await holds(one, bo, 'credit_bundle', { expiresAt: days(10) })
    const waiting = await holds(one, bo, 'unlimited')

    const res = await expectStatus(await book(bo, await addClass(one), { client_package_id: waiting }), 201)
    assert.equal((await bookingRow(res.booking_id)).clientPackageId, waiting)
    assert.equal((await pkg(waiting)).expiresAt?.toISOString(), addUtcMonths(T, 1).toISOString(), 'stamped from the booking moment')
    const still = await pkg(running)
    assert.equal(still.expiresAt?.toISOString(), days(10).toISOString(), 'the running bundle keeps running')
    assert.equal(still.creditsOrSessionsRemaining, 5)
  })

  test('BKG-23 a member picking an Ineligible package is refused with its own reason, and nothing is debited or started', async () => {
    const cy = await member(one)
    const away = await holds(one, cy, 'unlimited', { locationId: one.secondLocationId, expiresAt: days(20) })
    const lapsing = await holds(one, cy, 'credit_bundle', { expiresAt: days(2) })
    const short = await holds(one, cy, 'credit_bundle', { credits: 1 })
    // One package the Default payer could use, so every refusal below is the pick's own.
    await holds(one, cy, 'credit_bundle', { credits: 5, expiresAt: days(20) })
    const classId = await addClass(one, { creditCost: 2 })

    await expectStatus(await book(cy, classId, { client_package_id: away }), 409, 'location_not_covered')
    await expectStatus(await book(cy, classId, { client_package_id: lapsing }), 409, 'plan_expires_before_class')
    await expectStatus(await book(cy, classId, { client_package_id: short }), 409, 'insufficient_credits')

    assert.equal((await bookingsOn(cy, classId)).length, 0)
    assert.equal((await pkg(lapsing)).creditsOrSessionsRemaining, 5)
    const stillShort = await pkg(short)
    assert.equal(stillShort.creditsOrSessionsRemaining, 1)
    assert.equal(stillShort.expiresAt, null, 'a refused pick does not start its clock')
  })

  test("BKG-24 a member naming another member's package, or another studio's, is refused 404 and nothing is debited", async () => {
    const dot = await member(one)
    await holds(one, dot, 'credit_bundle')
    const owner = await member(one)
    const theirs = await holds(one, owner, 'credit_bundle')
    const elsewhere = await member(two)
    const otherStudios = await holds(two, elsewhere, 'credit_bundle')
    const classId = await addClass(one)

    await expectStatus(await book(dot, classId, { client_package_id: theirs }), 404, 'client_package_not_found')
    await expectStatus(await book(dot, classId, { client_package_id: otherStudios }), 404, 'client_package_not_found')
    assert.equal((await bookingsOn(dot, classId)).length, 0)
    assert.equal((await pkg(theirs)).creditsOrSessionsRemaining, 5)
    assert.equal((await pkg(theirs)).expiresAt, null)
  })

  test('BKG-25 a client still sending use_credits gets a 400 and no booking', async () => {
    const eli = await member(one)
    const bundle = await holds(one, eli, 'credit_bundle')
    const classId = await addClass(one)

    await expectStatus(await book(eli, classId, { use_credits: true }), 400)
    assert.equal((await bookingsOn(eli, classId)).length, 0)
    assert.equal((await pkg(bundle)).creditsOrSessionsRemaining, 5)
  })

  test('BKG-26 a client naming no package is paid for by the Default payer, and the response names it', async () => {
    const fay = await member(one)
    const running = await holds(one, fay, 'credit_bundle', { expiresAt: days(10) })
    const waiting = await holds(one, fay, 'unlimited')

    const res = await expectStatus(await book(fay, await addClass(one)), 201)
    assert.equal((await bookingRow(res.booking_id)).clientPackageId, running, 'a running package before a Dormant one')
    assert.deepEqual(res.paid_with, { client_package_id: running, name: `${NAME} credit_bundle`, kind: 'credit_bundle' })
    assert.equal((await pkg(waiting)).expiresAt, null, 'no new clock started')
  })

  /* ── what the Book sheet lists ──────────────────────────────────────── */

  test('BKG-27 the class detail lists the member’s class packages classified, in default order, with the Default payer named', async () => {
    const gus = await member(one)
    const away = await holds(one, gus, 'unlimited', { locationId: one.secondLocationId, expiresAt: days(8) })
    const running = await holds(one, gus, 'credit_bundle', { expiresAt: days(15) })
    const short = await holds(one, gus, 'credit_bundle', { credits: 1 })
    const plan = await holds(one, gus, 'unlimited')
    await holds(one, gus, 'pt')
    await holds(one, await member(one), 'credit_bundle')
    const classId = await addClass(one, { creditCost: 2 })

    const res = await expectStatus(await send('GET', gus.headers, `/api/v1/me/classes/${classId}`), 200)
    assert.equal(res.id, classId, 'the public detail comes with it')
    assert.equal(res.default_client_package_id, running)
    assert.deepEqual(
      res.my_packages.map((p: any) => [p.id, p.running, p.eligible, p.reason]),
      [
        [away, true, false, 'location_not_covered'],
        [running, true, true, null],
        [plan, false, true, null],
        [short, false, false, 'insufficient_credits'],
      ],
      'running soonest-ending first, then Dormant with a plan before credits; no PT package, nobody else’s',
    )
    const byId = new Map(res.my_packages.map((p: any) => [p.id, p]))
    const dormantPlan = byId.get(plan) as any
    assert.equal(dormantPlan.activation_end_if_picked, addUtcMonths(T, 1).toISOString(), 'what picking it would stamp')
    assert.equal(dormantPlan.remaining, null)
    assert.equal(dormantPlan.name, `${NAME} unlimited`)
    const awayPlan = byId.get(away) as any
    assert.deepEqual(awayPlan.location, { id: one.secondLocationId, name: SECOND_LOCATION_NAME })
    assert.equal(awayPlan.activation_end_if_picked, null, 'a running package starts nothing')
    assert.equal((byId.get(running) as any).remaining, 5)

    // Another studio's class is not there to be read.
    await expectStatus(await send('GET', gus.headers, `/api/v1/me/classes/${await addClass(two)}`), 404)
  })

  /* ── several packages Activated at once ─────────────────────────────── */

  test('PKG-35 a running bundle, a running plan and a second plan Activated by a pick all run at once', async () => {
    const hal = await member(one)
    const bundle = await holds(one, hal, 'credit_bundle', { expiresAt: days(10) })
    const home = await holds(one, hal, 'unlimited')
    const second = await holds(one, hal, 'unlimited', { locationId: one.secondLocationId })

    await expectStatus(await book(hal, await addClass(one), { client_package_id: home }), 201)
    await expectStatus(await book(hal, await addClass(one, { atSecond: true }), { client_package_id: second }), 201)

    for (const id of [bundle, home, second]) {
      const row = await pkg(id)
      assert.ok(row.expiresAt && row.expiresAt > T, `package ${id} is running`)
      assert.equal(row.active, true)
    }
    // And the member's account says so.
    const account = await expectStatus(await send('GET', hal.headers, '/api/v1/me/packages'), 200)
    const running = account.client_packages.filter((p: any) => p.active && !p.dormant)
    assert.deepEqual(running.map((p: any) => p.id).sort(), [bundle, home, second].sort(), 'all three read as running')
    assert.deepEqual(
      account.entitlements.unlimited_plans.map((p: any) => p.location.id).sort(),
      [one.locationId, one.secondLocationId].sort(),
      'every live plan is listed with its Home Location',
    )
  })

  test('LOC-16 holding plans homed at two Locations, a booking at each is paid by the plan homed there', async () => {
    const ivy = await member(one)
    const home = await holds(one, ivy, 'unlimited')
    const away = await holds(one, ivy, 'unlimited', { locationId: one.secondLocationId })

    const atHome = await expectStatus(await book(ivy, await addClass(one)), 201)
    assert.equal((await bookingRow(atHome.booking_id)).clientPackageId, home)
    const atSecond = await expectStatus(await book(ivy, await addClass(one, { atSecond: true })), 201)
    assert.equal((await bookingRow(atSecond.booking_id)).clientPackageId, away, 'the plan homed there, not the one already running')
    assert.ok((await pkg(home)).expiresAt)
    assert.ok((await pkg(away)).expiresAt)
  })

  /* ── the Default payer where nobody picks ───────────────────────────── */

  test('BKG-28 staff booking a member charge the Default payer and name it', async () => {
    const jo = await member(one)
    await holds(one, jo, 'unlimited', { locationId: one.secondLocationId, expiresAt: days(20) })
    const bundle = await holds(one, jo, 'credit_bundle')
    // Staff book into a buffer seat (spec-waitlist §7).
    const classId = await addClass(one, { capacityBuffer: 2 })

    const res = await expectStatus(
      await send('POST', one.admin.headers, `/api/v1/portal/admin/schedule/classes/${classId}/bookings`, { client_id: jo.clientId }),
      201,
    )
    assert.equal((await bookingRow(res.booking_id)).clientPackageId, bundle, 'the plan does not Cover it, so the bundle pays')
    assert.deepEqual(res.paid_with, { client_package_id: bundle, name: `${NAME} credit_bundle`, kind: 'credit_bundle' })
    assert.ok((await pkg(bundle)).expiresAt, 'and starts')
  })

  test('WTL-29, WTL-30 promotion from the waitlist, automatic or by staff, is paid by the Default payer', async () => {
    assert.equal((await setFlag(one, true)).status, 200)

    // Automatic: the waiting member's running plan does not Cover the class, so
    // their Dormant bundle pays and starts when a seat frees.
    const seated = await member(one)
    await holds(one, seated, 'credit_bundle')
    const kit = await member(one)
    const plan = await holds(one, kit, 'unlimited', { locationId: one.secondLocationId, expiresAt: days(20) })
    const bundle = await holds(one, kit, 'credit_bundle')
    const classId = await addClass(one, { capacityOnline: 1, capacityWaitlist: 3 })

    const seat = await expectStatus(await book(seated, classId), 201)
    await expectStatus(await send('POST', kit.headers, `/api/v1/me/waitlist/classes/${classId}`), 201)
    await expectStatus(await send('DELETE', seated.headers, `/api/v1/me/bookings/${seat.booking_id}`), 200)

    const [promoted] = await bookingsOn(kit, classId)
    assert.ok(promoted, 'the waiting member was promoted')
    assert.equal(promoted.state, 'confirmed')
    assert.equal(promoted.clientPackageId, bundle)
    assert.ok((await pkg(bundle)).expiresAt, 'the bundle started')
    assert.equal((await pkg(plan)).expiresAt?.toISOString(), days(20).toISOString())

    // By staff: the same Default payer, named in the result.
    const lou = await member(one)
    await holds(one, lou, 'unlimited', { locationId: one.secondLocationId, expiresAt: days(20) })
    const lousBundle = await holds(one, lou, 'credit_bundle')
    const full = await addClass(one, { capacityOnline: 1, capacityWaitlist: 3 })
    await expectStatus(await book(await (async () => {
      const m = await member(one)
      await holds(one, m, 'credit_bundle')
      return m
    })(), full), 201)
    const entry = await expectStatus(await send('POST', lou.headers, `/api/v1/me/waitlist/classes/${full}`), 201)

    // The panel says what would pay before staff act.
    const detail = await expectStatus(await send('GET', one.admin.headers, `/api/v1/portal/admin/schedule/classes/${full}`), 200)
    const line = detail.waitlist.find((w: any) => w.entry_id === entry.entry_id)
    assert.deepEqual(line.payment_status, { status: 'pending', package_name: `${NAME} credit_bundle` })

    const res = await expectStatus(
      await send('POST', one.admin.headers, `/api/v1/portal/admin/schedule/classes/${full}/waitlist/${entry.entry_id}/promote`, {
        overbook: true,
      }),
      201,
    )
    assert.equal((await bookingRow(res.booking_id)).clientPackageId, lousBundle)
    assert.deepEqual(res.paid_with, { client_package_id: lousBundle, name: `${NAME} credit_bundle`, kind: 'credit_bundle' })
  })
})
