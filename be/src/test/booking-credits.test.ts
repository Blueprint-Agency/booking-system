import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.credits.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Credits class type ${run}`
const PACKAGE_NAME = `Credits pass ${run}`
const PT_PACKAGE_NAME = `Credits PT pack ${run}`
const SECOND_LOCATION_NAME = `Credits second premises ${run}`
const WORKSHOP_NAME = `Credits workshop ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * Class booking and the credit ledger, over real HTTP (#213): what booking a
 * class does to a member's balance — a Credit Bundle or trial pays the class's
 * credit cost, an Activated Unlimited Plan pays nothing — every refusal, and
 * what a cancellation or an admin's hand on the balance puts back.
 *
 * Every test acts through a route and then reads the rows it left: the booking,
 * the package balance and `active` flag, the cancellation, the ledger. Fixtures
 * — a class, a package a member holds, a staff row — are written directly,
 * because which rows a person has is the test's to state.
 *
 * **The ledger.** A package's balance must always equal what it started with
 * plus every movement recorded against it. A class booking records its debit
 * on the booking itself (`credits_or_sessions_used`, `client_package_id` —
 * booking debits are kept out of `manual_adjustments` on purpose, see
 * `packages/ledger.ts`); every other movement — refunds, PT debits, admin
 * adjustments — is a `manual_adjustments` row. `assertLedger` checks that sum
 * after every step that moves credits.
 */
describe('class booking and the credit ledger over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
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
    classPackageId: string
    pt1on1PackageId: string
    pt2on1PackageId: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; headers: Record<string, string> }
  type PackageKind = 'credit_bundle' | 'trial' | 'unlimited' | 'pt'

  let one!: Studio
  let two!: Studio

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, unknown>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${name}-${tenant.slug}`)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
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

    // A second Location of the studio's own, for the rows about which Location pays.
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

    const [classPackage] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: PACKAGE_NAME, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const ptPackage = async (sessionType: '1on1' | '2on1') => {
      const [row] = await harness.db
        .insert(schema.ptPackages)
        .values({ tenantId: tenant.id, name: `${PT_PACKAGE_NAME} ${sessionType}`, sessionType, numSessions: 5, validityDays: 90, priceSgd: '400.00' })
        .returning({ id: schema.ptPackages.id })
      return row!.id
    }

    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      secondLocationId: second!.id,
      secondRoomId: secondRoom!.id,
      classTypeId: classType.id,
      classPackageId: classPackage!.id,
      pt1on1PackageId: await ptPackage('1on1'),
      pt2on1PackageId: await ptPackage('2on1'),
      admin,
      instructor,
    }
  }

  type ClassOptions = { startsIn?: number; creditCost?: number; capacityOnline?: number; capacityBuffer?: number; atSecond?: boolean }

  /** A class `startsIn` from now (three days by default), taught by the studio's instructor. */
  async function addClass(at: Studio, options: ClassOptions = {}): Promise<string> {
    const startsAt = new Date(Date.now() + (options.startsIn ?? 3 * DAY))
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
        capacityBuffer: options.capacityBuffer ?? 0,
        creditCost: options.creditCost ?? 1,
        createdByStaffId: at.instructor.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /** A member signed in on `at`'s hostname, holding nothing yet. */
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
    return { clientId: client!.id, headers }
  }

  /** What each package started with — the first term of the ledger sum. */
  const startingBalance = new Map<string, number>()

  type PackageOptions = {
    credits?: number
    /** Null (the default) is Dormant: bought, clock not started. */
    expiresAt?: Date | null
    /** An Unlimited Plan's Home Location. */
    locationId?: string
    crossLocation?: boolean
    purchasedAt?: Date
  }

  /** A package the member holds, as a purchase would have left it. */
  async function give(at: Studio, who: Member, kind: PackageKind, options: PackageOptions = {}): Promise<string> {
    const unlimited = kind === 'unlimited'
    const credits = unlimited ? null : (options.credits ?? 10)
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind,
        sourceClassPackageId: kind === 'credit_bundle' ? at.classPackageId : null,
        sourcePtPackageId: kind === 'pt' ? at.pt1on1PackageId : null,
        locationId: unlimited ? (options.locationId ?? at.locationId) : null,
        durationMonths: unlimited ? 1 : null,
        validityDays: unlimited ? null : 90,
        crossLocationPaidSgd: options.crossLocation ? '50.00' : null,
        creditsOrSessionsRemaining: credits,
        expiresAt: options.expiresAt ?? null,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
        ...(options.purchasedAt ? { purchasedAt: options.purchasedAt } : {}),
      })
      .returning({ id: schema.clientPackages.id })
    if (credits !== null) startingBalance.set(row!.id, credits)
    return row!.id
  }

  /** A PT package of `sessionType` holding `sessions`, Dormant. */
  async function givePt(at: Studio, who: Member, sessionType: '1on1' | '2on1', sessions: number): Promise<string> {
    const id = await give(at, who, 'pt', { credits: sessions })
    await harness.db
      .update(schema.clientPackages)
      .set({ sourcePtPackageId: sessionType === '1on1' ? at.pt1on1PackageId : at.pt2on1PackageId })
      .where(eq(schema.clientPackages.id, id))
    return id
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  const book = (who: Member, classId: string, body: Record<string, unknown> = {}) =>
    harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({ class_id: classId, ...body }),
    })

  async function bookOk(who: Member, classId: string, body: Record<string, unknown> = {}): Promise<string> {
    const res = await expectStatus(await book(who, classId, body), 201)
    return res.booking_id as string
  }

  const cancel = (who: Member, bookingId: string) =>
    harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers: who.headers })

  const adminCancelBooking = (as: Record<string, string>, bookingId: string) =>
    harness.app.request(`/api/v1/portal/admin/bookings/${bookingId}/cancel`, { method: 'POST', headers: as })

  const adminCancelClass = (as: Record<string, string>, classId: string) =>
    harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}/cancel`, { method: 'POST', headers: as })

  const instructorCancelClass = (as: Record<string, string>, classId: string, reason: string) =>
    harness.app.request(`/api/v1/portal/instructor/schedule/classes/${classId}/cancel`, {
      method: 'POST',
      headers: { ...as, ...json },
      body: JSON.stringify({ reason }),
    })

  const adjust = (as: Record<string, string>, who: Member, packageId: string, body: Record<string, unknown>) =>
    harness.app.request(`/api/v1/portal/admin/clients/${who.clientId}/packages/${packageId}/adjust`, {
      method: 'POST',
      headers: { ...as, ...json },
      body: JSON.stringify(body),
    })

  const setBalance = (as: Record<string, string>, who: Member, packageId: string, body: Record<string, unknown>) =>
    harness.app.request(`/api/v1/portal/admin/clients/${who.clientId}/packages/${packageId}/balance`, {
      method: 'POST',
      headers: { ...as, ...json },
      body: JSON.stringify(body),
    })

  const ptRequest = (who: Member, at: Studio, packageId: string, sessionType: '1on1' | '2on1' = '1on1') =>
    harness.app.request('/api/v1/me/pt-sessions/request', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({
        classTypeId: at.classTypeId,
        locationId: at.locationId,
        sessionType,
        clientPackageId: packageId,
        slots: [{ proposedDate: '2030-01-15', startTime: '09:00', endTime: '10:00' }],
        ...(sessionType === '2on1' ? { partner: { kind: 'new', name: 'Partner', email: emailFor(`partner-${run}`) } } : {}),
      }),
    })

  async function ptRequestOk(who: Member, at: Studio, packageId: string): Promise<string> {
    const res = await expectStatus(await ptRequest(who, at, packageId), 201)
    return res.pt_request_id as string
  }

  const schedulePt = (as: Record<string, string>, requestId: string, startsAt: Date) =>
    harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}/schedule`, {
      method: 'POST',
      headers: { ...as, ...json },
      body: JSON.stringify({
        instructor_id: one.instructor.id,
        location_id: one.locationId,
        room_id: one.roomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        instructor_pay_sgd: 0,
      }),
    })

  /** Each scheduled PT session gets an hour of its own, far from every class. */
  let ptSlots = 0
  async function scheduledPtSession(requestId: string): Promise<string> {
    await expectStatus(await schedulePt(one.admin.headers, requestId, new Date(Date.now() + 200 * DAY + ptSlots++ * 2 * HOUR)), 201)
    const [session] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.ptRequestId, requestId))
    assert.ok(session)
    return session.id
  }

  const ptCancel = (who: Member, requestId: string) =>
    harness.app.request(`/api/v1/me/pt-sessions/${requestId}/cancel`, { method: 'POST', headers: who.headers })

  /* ── state ──────────────────────────────────────────────────────────── */

  async function bookingRow(bookingId: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.ok(row, `no booking row ${bookingId}`)
    return row
  }

  async function pkg(packageId: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, packageId))
    assert.ok(row, `no package ${packageId}`)
    return row
  }

  const balanceOf = async (packageId: string) => (await pkg(packageId)).creditsOrSessionsRemaining

  const bookingsOf = (who: Member, classId: string) =>
    harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.clientId, who.clientId), eq(schema.bookings.classId, classId)))

  const confirmedOn = async (classId: string) =>
    (
      await harness.db
        .select()
        .from(schema.bookings)
        .where(and(eq(schema.bookings.classId, classId), eq(schema.bookings.state, 'confirmed')))
    ).length

  const cancellationsOf = (bookingId: string) =>
    harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))

  const adjustmentsOf = (packageId: string) =>
    harness.db
      .select()
      .from(schema.manualAdjustments)
      .where(eq(schema.manualAdjustments.clientPackageId, packageId))
      .orderBy(schema.manualAdjustments.createdAt)

  /** The balance equals its start plus every movement: class-booking debits and ledger rows. */
  async function assertLedger(packageId: string): Promise<void> {
    const start = startingBalance.get(packageId)
    assert.ok(start !== undefined, `no starting balance recorded for ${packageId}`)
    const [{ debited }] = (await harness.db.execute<{ debited: number }>(sql`
      SELECT COALESCE(SUM(credits_or_sessions_used), 0)::int AS debited
      FROM bookings WHERE client_package_id = ${packageId} AND kind = 'class'`)) as unknown as [{ debited: number }]
    const moved = (await adjustmentsOf(packageId)).reduce((sum, a) => sum + a.delta, 0)
    assert.equal(await balanceOf(packageId), start + moved - debited, `ledger of ${packageId} does not add up`)
  }

  async function policyOf(at: Studio) {
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, at.id))
    assert.ok(policy, `expected a seeded policy for ${at.slug}`)
    return policy
  }

  /** Time passes: the class now starts (or started) at `startsAt`. */
  const moveClassTo = (classId: string, startsAt: Date) =>
    harness.db
      .update(schema.classes)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + HOUR) })
      .where(eq(schema.classes.id, classId))

  async function classCard(who: Member, classId: string) {
    const body = await expectStatus(await harness.app.request('/api/v1/me/classes', { headers: who.headers }), 200)
    return (body.classes as Array<Record<string, unknown>>).find(c => c.id === classId)
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const workshops = sql`SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'cancelledByStaffId' IN (SELECT id::text FROM (${staff}) s)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_session_clients WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (SELECT id FROM pt_sessions WHERE pt_request_id IN (SELECT id FROM pt_requests WHERE client_id IN (${clients})))`)
    await harness.db.execute(sql`DELETE FROM pt_sessions WHERE pt_request_id IN (SELECT id FROM pt_requests WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (SELECT id FROM pt_requests WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${`${PT_PACKAGE_NAME}%`}`)
    await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name = ${WORKSHOP_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (SELECT id FROM locations WHERE name = ${SECOND_LOCATION_NAME})`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name = ${SECOND_LOCATION_NAME}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── booking: who pays ──────────────────────────────────────────────── */

  test('BKG-01, BKG-02, BKG-05 a member books with a Credit Bundle: confirmed, codes issued, the cost debited from that bundle', async () => {
    const ana = await member(one, 'ana')
    const bundle = await give(one, ana, 'credit_bundle', { credits: 5 })
    const classId = await addClass(one, { creditCost: 2, capacityOnline: 10 })

    const res = await expectStatus(await book(ana, classId), 201)
    assert.ok(res.qr_token, 'a QR token is issued')
    assert.ok(res.code, 'a booking code is issued')

    const row = await bookingRow(res.booking_id as string)
    assert.equal(row.state, 'confirmed')
    assert.equal(row.clientId, ana.clientId)
    assert.equal(row.qrToken, res.qr_token)
    assert.equal(row.code, res.code)
    // It records which package paid and how much.
    assert.equal(row.clientPackageId, bundle)
    assert.equal(row.creditsOrSessionsUsed, 2)
    assert.equal(await balanceOf(bundle), 3)
    // The debit is at the moment of booking: the bundle's clock has started.
    assert.ok((await pkg(bundle)).expiresAt, 'the first booking Activates the bundle')
    await assertLedger(bundle)
    // The seat is held.
    const card = await classCard(ana, classId)
    assert.equal(card?.booked_count, 1)
    assert.equal(card?.spots_left, 9)
  })

  test('BKG-02 a trial pays like a Credit Bundle', async () => {
    const bo = await member(one, 'bo')
    const trial = await give(one, bo, 'trial', { credits: 1 })
    const bookingId = await bookOk(bo, await addClass(one))

    const row = await bookingRow(bookingId)
    assert.equal(row.clientPackageId, trial)
    assert.equal(row.creditsOrSessionsUsed, 1)
    assert.equal(await balanceOf(trial), 0)
    await assertLedger(trial)
  })

  test('BKG-03 one Credit Bundle pays at either of the studio’s Locations', async () => {
    const cy = await member(one, 'cy')
    const bundle = await give(one, cy, 'credit_bundle', { credits: 4 })

    const here = await bookOk(cy, await addClass(one))
    const there = await bookOk(cy, await addClass(one, { atSecond: true }))

    for (const bookingId of [here, there]) {
      const row = await bookingRow(bookingId)
      assert.equal(row.state, 'confirmed')
      assert.equal(row.clientPackageId, bundle)
      assert.equal(row.creditsOrSessionsUsed, 1)
    }
    assert.equal(await balanceOf(bundle), 2)
    await assertLedger(bundle)
  })

  test('BKG-04 an Activated Unlimited Plan covering the Location pays, with 0 credits used, and leaves credits alone', async () => {
    const di = await member(one, 'di')
    const plan = await give(one, di, 'unlimited', { expiresAt: new Date(Date.now() + 30 * DAY) })
    const classId = await addClass(one, { creditCost: 2 })

    const row = await bookingRow(await bookOk(di, classId))
    assert.equal(row.state, 'confirmed')
    assert.equal(row.clientPackageId, plan)
    assert.equal(row.creditsOrSessionsUsed, 0)
    assert.equal((await pkg(plan)).creditsOrSessionsRemaining, null)
    assert.equal((await harness.db.select().from(schema.manualAdjustments).where(eq(schema.manualAdjustments.clientId, di.clientId))).length, 0)
  })

  test('BKG-04 a plan with the Cross-Location Add-On covers the other Location too; one without is refused there', async () => {
    const ed = await member(one, 'ed')
    await give(one, ed, 'unlimited', { expiresAt: new Date(Date.now() + 30 * DAY), crossLocation: true })
    const row = await bookingRow(await bookOk(ed, await addClass(one, { atSecond: true })))
    assert.equal(row.creditsOrSessionsUsed, 0)

    // Without the Add-On the plan covers its Home Location only — and the
    // bundle it holds is not silently spent instead.
    const flo = await member(one, 'flo')
    await give(one, flo, 'unlimited', { expiresAt: new Date(Date.now() + 30 * DAY) })
    const bundle = await give(one, flo, 'credit_bundle', { credits: 5 })
    const elsewhere = await addClass(one, { atSecond: true })
    await expectStatus(await book(flo, elsewhere), 409, 'location_not_covered')
    assert.equal((await bookingsOf(flo, elsewhere)).length, 0)
    assert.equal(await balanceOf(bundle), 5)
    await assertLedger(bundle)
  })

  test('BKG-07 a booked class shows as booked in the member’s class list, and only that one', async () => {
    const gil = await member(one, 'gil')
    await give(one, gil, 'credit_bundle')
    const booked = await addClass(one)
    const other = await addClass(one)
    await bookOk(gil, booked)

    assert.equal((await classCard(gil, booked))?.is_booked, true)
    assert.equal((await classCard(gil, other))?.is_booked, false)
  })

  test('BKG-10 a class at a Location the plan does not cover is listed, not hidden, with what the chip and Add-On link need', async () => {
    const hal = await member(one, 'hal')
    const plan = await give(one, hal, 'unlimited', { expiresAt: new Date(Date.now() + 30 * DAY) })
    const elsewhere = await addClass(one, { atSecond: true })

    const card = await classCard(hal, elsewhere)
    assert.ok(card, 'the uncovered class is still in the list')
    assert.equal((card.location as { id: string }).id, one.secondLocationId)
    const packages = await expectStatus(await harness.app.request('/api/v1/me/packages', { headers: hal.headers }), 200)
    const ent = packages.entitlements as Record<string, unknown>
    assert.equal((ent.unlimited_location as { id: string }).id, one.locationId)
    assert.equal(ent.unlimited_plan_id, plan)
    assert.equal(ent.unlimited_covers_both, false)
  })

  /* ── booking: refusals ──────────────────────────────────────────────── */

  test('BKG-12 too few credits, or none, is refused as insufficient_credits and nothing is debited', async () => {
    const ivy = await member(one, 'ivy')
    const bundle = await give(one, ivy, 'credit_bundle', { credits: 1 })
    const classId = await addClass(one, { creditCost: 2 })

    await expectStatus(await book(ivy, classId), 409, 'insufficient_credits')
    assert.equal((await bookingsOf(ivy, classId)).length, 0)
    assert.equal(await balanceOf(bundle), 1)
    assert.equal((await pkg(bundle)).expiresAt, null, 'a refused booking does not Activate the bundle')
    await assertLedger(bundle)

    const jo = await member(one, 'jo')
    await expectStatus(await book(jo, classId), 409, 'insufficient_credits')
    assert.equal((await bookingsOf(jo, classId)).length, 0)
  })

  test('BKG-13 a Credit Bundle that expires before the class is refused and spends nothing', async () => {
    // Already running, and ending before the class.
    const kai = await member(one, 'kai')
    const running = await give(one, kai, 'credit_bundle', { credits: 5, expiresAt: new Date(Date.now() + 2 * DAY) })
    const late = await addClass(one, { startsIn: 5 * DAY })
    await expectStatus(await book(kai, late), 409, 'plan_expires_before_class')
    assert.equal((await bookingsOf(kai, late)).length, 0)
    assert.equal(await balanceOf(running), 5)
    await assertLedger(running)

    // Dormant, but its 90 days would run out before a class further away than that.
    const lu = await member(one, 'lu')
    const dormant = await give(one, lu, 'credit_bundle', { credits: 5 })
    const farOff = await addClass(one, { startsIn: 100 * DAY })
    await expectStatus(await book(lu, farOff), 409, 'insufficient_credits')
    assert.equal((await bookingsOf(lu, farOff)).length, 0)
    assert.equal(await balanceOf(dormant), 5)
    assert.equal((await pkg(dormant)).expiresAt, null)
  })

  test('BKG-14 an Unlimited Plan that expires before the class is refused as plan_expires_before_class, not as a Location problem', async () => {
    const max = await member(one, 'max')
    await give(one, max, 'unlimited', { expiresAt: new Date(Date.now() + 2 * DAY) })
    const classId = await addClass(one, { startsIn: 5 * DAY })

    await expectStatus(await book(max, classId), 409, 'plan_expires_before_class')
    assert.equal((await bookingsOf(max, classId)).length, 0)
  })

  test('BKG-15 a class that is not active cannot be booked and nothing is debited', async () => {
    const ned = await member(one, 'ned')
    const bundle = await give(one, ned, 'credit_bundle', { credits: 3 })
    const classId = await addClass(one)
    await harness.db.update(schema.classes).set({ lifecycle: 'cancelled', cancelledAt: new Date() }).where(eq(schema.classes.id, classId))

    await expectStatus(await book(ned, classId), 404, 'class_not_found')
    assert.equal((await bookingsOf(ned, classId)).length, 0)
    assert.equal(await balanceOf(bundle), 3)
    await assertLedger(bundle)
  })

  test('BKG-16 a class that has started or ended is refused as already started and nothing is debited', async () => {
    const oz = await member(one, 'oz')
    const bundle = await give(one, oz, 'credit_bundle', { credits: 3 })
    const started = await addClass(one)
    await moveClassTo(started, new Date(Date.now() - 10 * 60 * 1000))
    const ended = await addClass(one)
    await moveClassTo(ended, new Date(Date.now() - 3 * HOUR))

    for (const classId of [started, ended]) {
      await expectStatus(await book(oz, classId), 400, 'class_already_started')
      assert.equal((await bookingsOf(oz, classId)).length, 0)
    }
    assert.equal(await balanceOf(bundle), 3)
    await assertLedger(bundle)
  })

  test('BKG-17 a class whose online seats are taken is full: the buffer is kept back and nothing is debited', async () => {
    const classId = await addClass(one, { capacityOnline: 2, capacityBuffer: 2 })
    for (const name of ['pia', 'quin']) {
      const m = await member(one, name)
      await give(one, m, 'credit_bundle')
      await bookOk(m, classId)
    }
    const ray = await member(one, 'ray')
    const bundle = await give(one, ray, 'credit_bundle', { credits: 3 })

    await expectStatus(await book(ray, classId), 409, 'class_full')
    assert.equal(await confirmedOn(classId), 2, 'no buffer seat was taken')
    assert.equal((await bookingsOf(ray, classId)).length, 0)
    assert.equal(await balanceOf(bundle), 3)
    await assertLedger(bundle)
    assert.equal((await classCard(ray, classId))?.spots_left, 0)
  })

  test('BKG-18 two members booking the last seat at once: exactly one is confirmed, the other refused as full', async () => {
    for (let round = 0; round < 3; round++) {
      const classId = await addClass(one, { capacityOnline: 1 })
      const a = await member(one, `sam${round}`)
      const b = await member(one, `tia${round}`)
      const bundleA = await give(one, a, 'credit_bundle', { credits: 3 })
      const bundleB = await give(one, b, 'credit_bundle', { credits: 3 })

      const [resA, resB] = await Promise.all([book(a, classId), book(b, classId)])
      const statuses = [resA.status, resB.status].sort()
      const bodies = [await resA.text(), await resB.text()]
      assert.deepEqual(statuses, [201, 409], bodies.join(' | '))
      assert.ok(bodies.some(body => body.includes('class_full')), bodies.join(' | '))

      assert.equal(await confirmedOn(classId), 1, 'exactly one confirmed booking for the last seat')
      const winner = resA.status === 201 ? bundleA : bundleB
      const loser = resA.status === 201 ? bundleB : bundleA
      assert.equal(await balanceOf(winner), 2)
      assert.equal(await balanceOf(loser), 3)
      await assertLedger(winner)
      await assertLedger(loser)
    }
  })

  test('BKG-19 a double submit books once and spends one credit', async () => {
    const uma = await member(one, 'uma')
    const bundle = await give(one, uma, 'credit_bundle', { credits: 3 })
    const classId = await addClass(one)

    const [first, second] = await Promise.all([book(uma, classId), book(uma, classId)])
    const bodies = [await first.text(), await second.text()]
    assert.deepEqual([first.status, second.status].sort(), [201, 409], bodies.join(' | '))
    assert.ok(bodies.some(body => body.includes('already_booked')), bodies.join(' | '))

    // And again, after the first has settled.
    await expectStatus(await book(uma, classId), 409, 'already_booked')
    const rows = await bookingsOf(uma, classId)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.state, 'confirmed')
    assert.equal(await balanceOf(bundle), 2)
    await assertLedger(bundle)
  })

  test('BKG-08 a member can book a class again after cancelling their booking on it', async () => {
    const vic = await member(one, 'vic')
    const bundle = await give(one, vic, 'credit_bundle', { credits: 3 })
    const classId = await addClass(one)
    const firstId = await bookOk(vic, classId)
    await expectStatus(await cancel(vic, firstId), 200)
    assert.equal(await balanceOf(bundle), 3)

    const againId = await bookOk(vic, classId)

    assert.notEqual(againId, firstId)
    assert.equal((await bookingRow(firstId)).state, 'cancelled')
    const again = await bookingRow(againId)
    assert.equal(again.state, 'confirmed')
    assert.equal(again.creditsOrSessionsUsed, 1)
    assert.equal(await balanceOf(bundle), 2)
    assert.equal(await confirmedOn(classId), 1)
    await assertLedger(bundle)
  })

  /* ── the credit ledger ──────────────────────────────────────────────── */

  test('CRD-01 a Credit Bundle spent to exactly zero is inactive and pays for nothing more', async () => {
    const wes = await member(one, 'wes')
    const bundle = await give(one, wes, 'credit_bundle', { credits: 2 })
    await bookOk(wes, await addClass(one, { creditCost: 2 }))

    const row = await pkg(bundle)
    assert.equal(row.creditsOrSessionsRemaining, 0)
    assert.equal(row.active, false)
    await assertLedger(bundle)
    await expectStatus(await book(wes, await addClass(one)), 409, 'insufficient_credits')
  })

  test('CRD-02 an overdraw is refused as insufficient_credits (class booking, PT type change) and insufficient_pt_credit (PT request), balance unchanged', async () => {
    // A class booking against the running bundle, which holds less than the cost.
    const xia = await member(one, 'xia')
    const bundle = await give(one, xia, 'credit_bundle', { credits: 1, expiresAt: new Date(Date.now() + 30 * DAY) })
    const costsTwo = await addClass(one, { creditCost: 2 })
    await expectStatus(await book(xia, costsTwo), 409, 'insufficient_credits')
    assert.equal(await balanceOf(bundle), 1)
    await assertLedger(bundle)

    // A 2on1 request needs two sessions; one is refused before anything moves.
    const pair = await givePt(one, xia, '2on1', 1)
    await expectStatus(await ptRequest(xia, one, pair, '2on1'), 409, 'insufficient_pt_credit')
    assert.equal(await balanceOf(pair), 1)
    assert.equal((await adjustmentsOf(pair)).length, 0)
    await assertLedger(pair)

    // A scheduled 1on1 made 2on1 by an admin, on a package with nothing left.
    const yan = await member(one, 'yan')
    const partner = await member(one, 'yan-partner')
    const solo = await givePt(one, yan, '1on1', 1)
    const requestId = await ptRequestOk(yan, one, solo)
    assert.equal(await balanceOf(solo), 0)
    const sessionId = await scheduledPtSession(requestId)
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/pt-sessions/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ session_type: '2on1', co_client_id: partner.clientId }),
      }),
      409,
      'insufficient_credits',
    )
    assert.equal(await balanceOf(solo), 0)
    await assertLedger(solo)
  })

  test('CRD-03 a good-time cancel returns the credit to a bundle spent to zero, which is active again and pays for the next class', async () => {
    const zed = await member(one, 'zed')
    const bundle = await give(one, zed, 'credit_bundle', { credits: 1 })
    const bookingId = await bookOk(zed, await addClass(one))
    assert.equal((await pkg(bundle)).active, false)

    await expectStatus(await cancel(zed, bookingId), 200)

    const back = await pkg(bundle)
    assert.equal(back.creditsOrSessionsRemaining, 1)
    assert.equal(back.active, true)
    const [cancellation] = await cancellationsOf(bookingId)
    assert.equal(cancellation?.refundFired, true)
    assert.equal((await bookingRow(bookingId)).refundOutcome, 'credit_returned')

    const next = await bookingRow(await bookOk(zed, await addClass(one)))
    assert.equal(next.clientPackageId, bundle)
    assert.equal(await balanceOf(bundle), 0)
    await assertLedger(bundle)
  })

  test('CRD-04 an admin cancelling the whole class returns the credit, and the bundle pays for another class', async () => {
    const amy = await member(one, 'amy')
    const bundle = await give(one, amy, 'credit_bundle', { credits: 1 })
    const classId = await addClass(one)
    const bookingId = await bookOk(amy, classId)
    assert.equal((await pkg(bundle)).active, false)

    const res = await expectStatus(await adminCancelClass(one.admin.headers, classId), 200)
    assert.equal(res.total_bookings, 1)
    assert.equal(res.refunded_count, 1)

    const row = await bookingRow(bookingId)
    assert.equal(row.state, 'cancelled')
    assert.equal(row.refundOutcome, 'credit_returned')
    const [cancellation] = await cancellationsOf(bookingId)
    assert.equal(cancellation?.source, 'admin')
    assert.equal(cancellation?.refundFired, true)
    const back = await pkg(bundle)
    assert.equal(back.creditsOrSessionsRemaining, 1)
    assert.equal(back.active, true)

    assert.equal((await bookingRow(await bookOk(amy, await addClass(one)))).clientPackageId, bundle)
    await assertLedger(bundle)
  })

  test('CRD-05, CRD-10 a PT request debits the package with a ledger row; cancelling it returns the session and the package is usable again', async () => {
    const bea = await member(one, 'bea')
    const pack = await givePt(one, bea, '1on1', 1)

    const requestId = await ptRequestOk(bea, one, pack)
    let row = await pkg(pack)
    assert.equal(row.creditsOrSessionsRemaining, 0)
    assert.equal(row.active, false)

    const res = await expectStatus(await ptCancel(bea, requestId), 200)
    assert.equal(res.refundOutcome, 'session_returned')
    row = await pkg(pack)
    assert.equal(row.creditsOrSessionsRemaining, 1)
    assert.equal(row.active, true)

    const ledger = await adjustmentsOf(pack)
    assert.deepEqual(
      ledger.map(a => [a.delta, a.reason, a.clientId]),
      [
        [-1, 'pt_request_submit', bea.clientId],
        [1, 'pt_request_cancel_refund', bea.clientId],
      ],
    )
    await assertLedger(pack)

    // Spent to zero again, this time on a session that is then scheduled and
    // cancelled in good time: the session comes back just the same.
    const scheduled = await ptRequestOk(bea, one, pack)
    assert.equal((await pkg(pack)).active, false)
    await scheduledPtSession(scheduled)
    const afterScheduled = await expectStatus(await ptCancel(bea, scheduled), 200)
    assert.equal(afterScheduled.status, 'cancelled_after_scheduled')
    assert.equal(afterScheduled.refundOutcome, 'session_returned')
    row = await pkg(pack)
    assert.equal(row.creditsOrSessionsRemaining, 1)
    assert.equal(row.active, true)
    await assertLedger(pack)

    await ptRequestOk(bea, one, pack)
    assert.equal(await balanceOf(pack), 0)
    await assertLedger(pack)
  })

  test('CRD-06 credits refunded into an expired bundle raise its balance but it stays inactive and pays for nothing', async () => {
    const cal = await member(one, 'cal')
    const bundle = await give(one, cal, 'credit_bundle', { credits: 1, expiresAt: new Date(Date.now() + 3 * DAY) })
    const classId = await addClass(one, { startsIn: 2 * DAY })
    const bookingId = await bookOk(cal, classId)
    assert.equal(await balanceOf(bundle), 0)

    // Four days pass: the class ran two days ago and the bundle expired yesterday.
    await moveClassTo(classId, new Date(Date.now() - 2 * DAY))
    await harness.db.update(schema.clientPackages).set({ expiresAt: new Date(Date.now() - DAY) }).where(eq(schema.clientPackages.id, bundle))

    await expectStatus(await adminCancelBooking(one.admin.headers, bookingId), 200)

    const row = await pkg(bundle)
    assert.equal(row.creditsOrSessionsRemaining, 1)
    assert.equal(row.active, false)
    await assertLedger(bundle)
    await expectStatus(await book(cal, await addClass(one)), 409, 'insufficient_credits')
    assert.equal(await balanceOf(bundle), 1)
  })

  test('CRD-07 after a refund the balance the member is shown is exactly what booking lets them spend', async () => {
    const dot = await member(one, 'dot')
    const bundle = await give(one, dot, 'credit_bundle', { credits: 2 })
    await expectStatus(await cancel(dot, await bookOk(dot, await addClass(one))), 200)

    const body = await expectStatus(await harness.app.request('/api/v1/me/packages', { headers: dot.headers }), 200)
    const shown = (body.client_packages as Array<{ id: string; credits_or_sessions_remaining: number }>).find(p => p.id === bundle)
    assert.equal(shown?.credits_or_sessions_remaining, 2)

    for (let i = 0; i < shown!.credits_or_sessions_remaining; i++) await bookOk(dot, await addClass(one))
    await expectStatus(await book(dot, await addClass(one)), 409, 'insufficient_credits')
    await assertLedger(bundle)
  })

  test('CRD-08 a cancellation that fails after its refund step leaves the balance untouched, and the retry refunds exactly once', async () => {
    const eli = await member(one, 'eli')
    const bundle = await give(one, eli, 'credit_bundle', { credits: 3 })
    const bookingId = await bookOk(eli, await addClass(one, { creditCost: 2 }))
    assert.equal(await balanceOf(bundle), 1)

    // The cancellation record is written after the credit is returned; make
    // that write fail for this booking only.
    const fn = sql.raw(`crd08_fail_${run}`)
    await harness.db.execute(sql`
      CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.booking_id = '${sql.raw(bookingId)}' THEN RAISE EXCEPTION 'CRD-08 injected failure'; END IF;
        RETURN NEW;
      END $$`)
    await harness.db.execute(sql`CREATE TRIGGER ${fn} BEFORE INSERT ON cancellations FOR EACH ROW EXECUTE FUNCTION ${fn}()`)
    try {
      const failed = await cancel(eli, bookingId)
      await failed.text()
      assert.equal(failed.status, 500)
    } finally {
      await harness.db.execute(sql`DROP TRIGGER IF EXISTS ${fn} ON cancellations`)
      await harness.db.execute(sql`DROP FUNCTION IF EXISTS ${fn}()`)
    }
    assert.equal(await balanceOf(bundle), 1, 'the failed attempt returned nothing')
    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
    assert.equal((await adjustmentsOf(bundle)).length, 0)
    await assertLedger(bundle)

    await expectStatus(await cancel(eli, bookingId), 200)
    await expectStatus(await cancel(eli, bookingId), 409, 'not_cancellable')

    assert.equal(await balanceOf(bundle), 3)
    assert.equal((await adjustmentsOf(bundle)).length, 1)
    assert.equal((await cancellationsOf(bookingId)).length, 1)
    await assertLedger(bundle)
  })

  test('CRD-09 every cancellation refund writes a ledger row with the amount, the package and the reason', async () => {
    const fay = await member(one, 'fay')
    const bundle = await give(one, fay, 'credit_bundle', { credits: 10 })
    const bySelf = await bookOk(fay, await addClass(one, { creditCost: 2 }))
    const byAdmin = await bookOk(fay, await addClass(one, { creditCost: 3 }))
    const bulkClass = await addClass(one, { creditCost: 1 })
    await bookOk(fay, bulkClass)
    assert.equal(await balanceOf(bundle), 4)

    await expectStatus(await cancel(fay, bySelf), 200)
    await expectStatus(await adminCancelBooking(one.admin.headers, byAdmin), 200)
    await expectStatus(await adminCancelClass(one.admin.headers, bulkClass), 200)

    const ledger = await adjustmentsOf(bundle)
    assert.deepEqual(
      ledger.map(a => [a.delta, a.reason, a.actedByStaffId]),
      [
        [2, 'client_cancellation_refund', null],
        [3, 'admin_cancellation_refund', one.admin.id],
        [1, 'admin_class_cancellation_refund', one.admin.id],
      ],
    )
    assert.equal(await balanceOf(bundle), 10)
    await assertLedger(bundle)
  })

  test('CRD-11 a class cancelled by its main instructor refunds with the instructor-cancellation reason', async () => {
    const gus = await member(one, 'gus')
    const bundle = await give(one, gus, 'credit_bundle', { credits: 3 })
    const classId = await addClass(one)
    const bookingId = await bookOk(gus, classId)

    const res = await expectStatus(await instructorCancelClass(one.instructor.headers, classId, 'Unwell'), 200)
    assert.equal(res.refunded_count, 1)

    const [refund] = await adjustmentsOf(bundle)
    assert.equal(refund?.delta, 1)
    assert.equal(refund?.reason, 'instructor_class_cancellation_refund')
    assert.equal(refund?.actedByStaffId, one.instructor.id)
    assert.equal((await cancellationsOf(bookingId))[0]?.source, 'instructor')
    assert.equal(await balanceOf(bundle), 3)
    await assertLedger(bundle)
  })

  test('CRD-12 an admin sees each credit movement on the member with its signed amount and reason', async () => {
    const hen = await member(one, 'hen')
    const bundle = await give(one, hen, 'credit_bundle', { credits: 5 })
    const pack = await givePt(one, hen, '1on1', 3)
    await expectStatus(await cancel(hen, await bookOk(hen, await addClass(one))), 200)
    const cancelledClass = await addClass(one)
    await bookOk(hen, cancelledClass)
    await expectStatus(await adminCancelClass(one.admin.headers, cancelledClass), 200)
    await expectStatus(await ptCancel(hen, await ptRequestOk(hen, one, pack)), 200)

    const profile = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${hen.clientId}`, { headers: one.admin.headers }),
      200,
    )
    const seen = (profile.adjustments as Array<{ client_package_id: string; delta: number; reason: string }>)
      .map(a => [a.client_package_id, a.delta, a.reason])
      .sort()
    assert.deepEqual(
      seen,
      [
        [bundle, 1, 'admin_class_cancellation_refund'],
        [bundle, 1, 'client_cancellation_refund'],
        [pack, -1, 'pt_request_submit'],
        [pack, 1, 'pt_request_cancel_refund'],
      ].sort(),
    )
    await assertLedger(bundle)
    await assertLedger(pack)
  })

  test('CRD-13 an admin adjusts a Credit Bundle or PT pack by +N or −N with a reason: balance moves, a ledger row names the admin', async () => {
    const ian = await member(one, 'ian')
    const bundle = await give(one, ian, 'credit_bundle', { credits: 3 })
    const pack = await givePt(one, ian, '1on1', 2)

    let res = await expectStatus(await adjust(one.admin.headers, ian, bundle, { delta: 4, reason: 'Goodwill' }), 200)
    assert.equal(res.credits_or_sessions_remaining, 7)
    res = await expectStatus(await adjust(one.admin.headers, ian, pack, { delta: -1, reason: 'Session taken off-system' }), 200)
    assert.equal(res.credits_or_sessions_remaining, 1)

    assert.equal(await balanceOf(bundle), 7)
    assert.equal(await balanceOf(pack), 1)
    assert.deepEqual(
      (await adjustmentsOf(bundle)).map(a => [a.delta, a.reason, a.actedByStaffId, a.clientId]),
      [[4, 'Goodwill', one.admin.id, ian.clientId]],
    )
    assert.deepEqual(
      (await adjustmentsOf(pack)).map(a => [a.delta, a.reason, a.actedByStaffId]),
      [[-1, 'Session taken off-system', one.admin.id]],
    )
    await assertLedger(bundle)
    await assertLedger(pack)
  })

  test('CRD-14 setting a balance of 3 to 5 records a delta of +2', async () => {
    const jan = await member(one, 'jan')
    for (const kind of ['credit_bundle', 'trial'] as const) {
      const p = await give(one, jan, kind, { credits: 3 })
      const res = await expectStatus(await setBalance(one.admin.headers, jan, p, { balance: 5, reason: 'Corrected' }), 200)
      assert.equal(res.credits_or_sessions_remaining, 5)
      assert.equal(await balanceOf(p), 5)
      const [row] = await adjustmentsOf(p)
      assert.equal(row?.delta, 2)
      assert.equal(row?.actedByStaffId, one.admin.id)
      await assertLedger(p)
    }
  })

  test('CRD-15 an adjustment below zero, or a negative balance, is refused and the balance is unchanged', async () => {
    const kip = await member(one, 'kip')
    const bundle = await give(one, kip, 'credit_bundle', { credits: 2 })

    await expectStatus(await adjust(one.admin.headers, kip, bundle, { delta: -3, reason: 'Too much' }), 400, 'balance_cannot_go_negative')
    const negative = await setBalance(one.admin.headers, kip, bundle, { balance: -1, reason: 'Too much' })
    assert.equal(negative.status, 400, await negative.text())

    assert.equal(await balanceOf(bundle), 2)
    assert.equal((await adjustmentsOf(bundle)).length, 0)
    await assertLedger(bundle)
  })

  test('CRD-16 an adjustment with an empty reason is refused and the balance is unchanged', async () => {
    const lea = await member(one, 'lea')
    const bundle = await give(one, lea, 'credit_bundle', { credits: 2 })

    // An empty string is refused by the request schema; a blank one by the service.
    for (const res of [
      await adjust(one.admin.headers, lea, bundle, { delta: 1, reason: '' }),
      await setBalance(one.admin.headers, lea, bundle, { balance: 4, reason: '' }),
    ]) {
      assert.equal(res.status, 400, await res.text())
    }
    await expectStatus(await adjust(one.admin.headers, lea, bundle, { delta: 1, reason: '   ' }), 400, 'reason_required')
    await expectStatus(await setBalance(one.admin.headers, lea, bundle, { balance: 4, reason: '   ' }), 400, 'reason_required')
    assert.equal(await balanceOf(bundle), 2)
    assert.equal((await adjustmentsOf(bundle)).length, 0)
  })

  test('CRD-17 a manual adjustment does not count toward the member’s cancellation cap', async () => {
    const mo = await member(one, 'mo')
    const bundle = await give(one, mo, 'credit_bundle', { credits: 10 })
    const { cancelCapCount } = await policyOf(one)
    for (let i = 0; i < cancelCapCount - 1; i++) {
      await expectStatus(await cancel(mo, await bookOk(mo, await addClass(one))), 200)
    }
    const countCancellations = async () =>
      (await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.clientId, mo.clientId))).length
    const before = await countCancellations()

    await expectStatus(await adjust(one.admin.headers, mo, bundle, { delta: 2, reason: 'Goodwill' }), 200)
    await expectStatus(await adjust(one.admin.headers, mo, bundle, { delta: -1, reason: 'Correction' }), 200)
    assert.equal(await countCancellations(), before)

    // The last cancellation under the cap is still refunded.
    const bookingId = await bookOk(mo, await addClass(one))
    await expectStatus(await cancel(mo, bookingId), 200)
    const [cancellation] = await cancellationsOf(bookingId)
    assert.equal(cancellation?.wasWithinCap, true)
    assert.equal(cancellation?.refundFired, true)
    assert.equal((await bookingRow(bookingId)).refundOutcome, 'credit_returned')
    assert.equal(await balanceOf(bundle), 11)
    await assertLedger(bundle)
  })

  test('CRD-18 a member holding only credits pays for a workshop directly; no credit is spent', async () => {
    const ned = await member(one, 'ned-ws')
    const bundle = await give(one, ned, 'credit_bundle', { credits: 10 })
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: one.id, name: WORKSHOP_NAME, locationId: one.locationId, createdByStaffId: one.admin.id })
      .returning({ id: schema.workshops.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: one.id, workshopId: workshop!.id, name: 'Full', regularPriceSgd: '80.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })

    const stripe = (await import('./stripe-fake')).installStripeFake()
    try {
      stripe.reply('customers.create', { id: `cus_${run}` })
      stripe.reply('checkout.sessions.create', { id: `cs_${run}`, url: `https://checkout.test/${run}` })
      const res = await expectStatus(
        await harness.app.request('/api/v1/me/checkout/workshop', {
          method: 'POST',
          headers: { ...ned.headers, ...json },
          // Asking to pay with credits changes nothing: the checkout has no such option.
          body: JSON.stringify({ workshop_id: workshop!.id, workshop_tier_id: tier!.id, use_credits: true }),
        }),
        200,
      )
      assert.equal(res.url, `https://checkout.test/${run}`)
      assert.equal(stripe.callsTo('checkout.sessions.create').length, 1)
    } finally {
      stripe.restore()
    }

    assert.equal(await balanceOf(bundle), 10)
    assert.equal((await adjustmentsOf(bundle)).length, 0)
    const workshopBookings = await harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.clientId, ned.clientId), eq(schema.bookings.workshopId, workshop!.id)))
    assert.equal(workshopBookings.length, 0, 'nothing is booked until the payment lands')
    await assertLedger(bundle)
  })

  test('CRD-19 a refund into a spent bundle while an Unlimited Plan runs returns it to Dormant, and the cancel succeeds', async () => {
    const oli = await member(one, 'oli')
    const bundle = await give(one, oli, 'credit_bundle', { credits: 1, purchasedAt: new Date(Date.now() - 2 * DAY) })
    const paidByBundle = await bookOk(oli, await addClass(one))
    assert.equal((await pkg(bundle)).active, false)

    // The plan, bought afterwards, Activates on the next booking.
    const plan = await give(one, oli, 'unlimited')
    const paidByPlan = await bookingRow(await bookOk(oli, await addClass(one)))
    assert.equal(paidByPlan.clientPackageId, plan)
    assert.ok((await pkg(plan)).expiresAt, 'the plan is running')

    await expectStatus(await cancel(oli, paidByBundle), 200)

    const back = await pkg(bundle)
    assert.equal(back.creditsOrSessionsRemaining, 1)
    assert.equal(back.expiresAt, null, 'back to Dormant, not running beside the plan')
    assert.equal(back.active, true)
    assert.equal((await bookingRow(paidByBundle)).refundOutcome, 'credit_returned')
    await assertLedger(bundle)
  })

  /* ── who may call these endpoints ───────────────────────────────────── */

  test('booking: another studio’s class is not found, and a staff session cannot book as a member', async () => {
    const pat = await member(two, 'pat')
    const bundle = await give(two, pat, 'credit_bundle', { credits: 3 })
    const classAtOne = await addClass(one)

    await expectStatus(await book(pat, classAtOne), 404)
    assert.equal((await bookingsOf(pat, classAtOne)).length, 0)
    assert.equal(await balanceOf(bundle), 3)

    const staffAsMember = await book({ clientId: '', headers: one.admin.headers }, classAtOne)
    assert.equal(staffAsMember.status, 401, await staffAsMember.text())
    assert.equal(await confirmedOn(classAtOne), 0)
  })

  test('cancelling a booking: another studio’s booking is not found, another member’s is refused', async () => {
    const quo = await member(one, 'quo')
    const bundle = await give(one, quo, 'credit_bundle', { credits: 3 })
    const bookingId = await bookOk(quo, await addClass(one))
    const rex = await member(one, 'rex')
    const sue = await member(two, 'sue')

    await expectStatus(await cancel(rex, bookingId), 403)
    await expectStatus(await cancel(sue, bookingId), 404)
    await expectStatus(await adminCancelBooking(two.admin.headers, bookingId), 404)
    await expectStatus(await adminCancelBooking(one.instructor.headers, bookingId), 403)
    await expectStatus(await adminCancelBooking(quo.headers, bookingId), 401)

    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
    assert.equal(await balanceOf(bundle), 2)
    assert.equal((await cancellationsOf(bookingId)).length, 0)
    await assertLedger(bundle)
  })

  test('cancelling a class: another studio’s admin, a member, or an instructor who does not teach it is refused', async () => {
    const tom = await member(one, 'tom')
    const bundle = await give(one, tom, 'credit_bundle', { credits: 3 })
    const classId = await addClass(one)
    await bookOk(tom, classId)
    const otherInstructor = await staffAt(one, 'other-instructor', 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: otherInstructor.id })

    await expectStatus(await adminCancelClass(two.admin.headers, classId), 404)
    await expectStatus(await adminCancelClass(one.instructor.headers, classId), 403)
    await expectStatus(await adminCancelClass(tom.headers, classId), 401)
    await expectStatus(await instructorCancelClass(otherInstructor.headers, classId, 'Not mine'), 403)
    await expectStatus(await instructorCancelClass(two.instructor.headers, classId, 'Not ours'), 404)

    assert.equal(await confirmedOn(classId), 1)
    assert.equal(await balanceOf(bundle), 2)
    await assertLedger(bundle)
  })

  test('adjusting a balance: another studio’s admin, an instructor or a member is refused', async () => {
    const una = await member(one, 'una')
    const bundle = await give(one, una, 'credit_bundle', { credits: 3 })

    await expectStatus(await adjust(two.admin.headers, una, bundle, { delta: 5, reason: 'x' }), 404)
    await expectStatus(await setBalance(two.admin.headers, una, bundle, { balance: 9, reason: 'x' }), 404)
    await expectStatus(await adjust(one.instructor.headers, una, bundle, { delta: 5, reason: 'x' }), 403)
    await expectStatus(await setBalance(one.instructor.headers, una, bundle, { balance: 9, reason: 'x' }), 403)
    await expectStatus(await adjust(una.headers, una, bundle, { delta: 5, reason: 'x' }), 401)
    await expectStatus(await setBalance(una.headers, una, bundle, { balance: 9, reason: 'x' }), 401)
    // Nor may they read the member's ledger.
    const profile = (as: Record<string, string>) =>
      harness.app.request(`/api/v1/portal/admin/clients/${una.clientId}`, { headers: as })
    await expectStatus(await profile(two.admin.headers), 404)
    await expectStatus(await profile(one.instructor.headers), 403)
    // Another member's package named under this member is not theirs to move.
    const val = await member(one, 'val')
    await expectStatus(await adjust(one.admin.headers, val, bundle, { delta: 5, reason: 'x' }), 404)

    assert.equal(await balanceOf(bundle), 3)
    assert.equal((await adjustmentsOf(bundle)).length, 0)
  })

  test('PT requests: another studio’s package or another member’s request is refused', async () => {
    const wyn = await member(one, 'wyn')
    const pack = await givePt(one, wyn, '1on1', 2)
    const requestId = await ptRequestOk(wyn, one, pack)
    const xan = await member(one, 'xan')
    const yul = await member(two, 'yul')

    await expectStatus(await ptCancel(xan, requestId), 403)
    await expectStatus(await ptCancel(yul, requestId), 404)
    await expectStatus(await ptRequest(yul, two, pack), 404)
    await expectStatus(await ptRequest(xan, one, pack), 404)
    // Scheduling it is for this studio's admins only.
    await expectStatus(await schedulePt(two.admin.headers, requestId, new Date(Date.now() + 300 * DAY)), 404)
    await expectStatus(await schedulePt(one.instructor.headers, requestId, new Date(Date.now() + 300 * DAY)), 403)
    await expectStatus(await schedulePt(wyn.headers, requestId, new Date(Date.now() + 300 * DAY)), 401)

    assert.equal(await balanceOf(pack), 1)
    await assertLedger(pack)
  })
})
