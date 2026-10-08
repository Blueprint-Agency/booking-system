import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.client-launch.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Launch class type ${run}`
const PACKAGE_NAME = `Launch pass ${run}`
const FREE_PACKAGE_NAME = `Launch free pass ${run}`
const PLAN_NAME = `Launch plan ${run}`
const PT_PACKAGE_NAME = `Launch PT pack ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The member-side promises the September client-scenarios draft (#128) made
 * that the Scenario Inventory did not yet state (#361): which package pays when
 * the member names none, what a refused booking leaves behind, a package that
 * waits a year, the catalogue edited under a Dormant package, a cancel that
 * meets an attended booking or a double click, and who may cancel a 2on1.
 *
 * Every test acts through the member's or the studio's route and then reads the
 * rows it left. Fixtures — a class, a package a member already holds — are
 * written directly, because what a member holds is the test's to state.
 */
describe('client launch scenarios over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let withTenant!: typeof import('../db')['withTenant']
  let expirePackages!: typeof import('../services/packages/expire')['expirePackages']

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    bundleId: string
    planId: string
    pt2on1Id: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; headers: Record<string, string> }
  type Kind = 'credit_bundle' | 'unlimited' | 'pt'

  let one!: Studio
  let two!: Studio

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }

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
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    return { id: row!.id, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location.id)).limit(1)
    assert.ok(room, `expected a seeded room for ${tenant.slug}`)
    const classType = await classTypesSvc.createClassType(tenant.id, { name: CLASS_TYPE_NAME })
    const [bundle] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: PACKAGE_NAME, kind: 'credit_bundle', credits: 10, validityDays: 30, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const [plan] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: PLAN_NAME, kind: 'unlimited', durationMonths: 1, priceSgd: '300.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const [pt] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: `${PT_PACKAGE_NAME} 2on1`, sessionType: '2on1', numSessions: 6, validityDays: 90, priceSgd: '400.00' })
      .returning({ id: schema.ptPackages.id })
    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      classTypeId: classType.id,
      bundleId: bundle!.id,
      planId: plan!.id,
      pt2on1Id: pt!.id,
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
    }
  }

  /** A free Credit Bundle of `validityDays` in the studio's catalogue: bought with no payment step. */
  async function freeBundle(at: Studio, validityDays: number): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: at.id, name: FREE_PACKAGE_NAME, kind: 'credit_bundle', credits: 5, validityDays, priceSgd: '0.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    return row!.id
  }

  // Each class this file makes takes the next two hours from three days out,
  // so no member is ever asked to be in two classes at once.
  let classSlots = 0
  async function addClass(at: Studio, options: { startsIn?: number; creditCost?: number; capacityOnline?: number } = {}) {
    const startsAt = new Date(Date.now() + (options.startsIn ?? 3 * DAY + classSlots++ * 2 * HOUR))
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
        capacityOnline: options.capacityOnline ?? 10,
        capacityBuffer: 0,
        creditCost: options.creditCost ?? 1,
        createdByStaffId: at.instructor.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  let members = 0
  async function member(at: Studio, name: string): Promise<Member> {
    const email = emailFor(`${name}-${members++}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  type Holding = { credits?: number; expiresAt?: Date | null; purchasedAt?: Date; validityDays?: number }

  /** A package the member already holds, as a purchase would have left it; Dormant unless `expiresAt` is given. */
  async function give(at: Studio, who: Member, kind: Kind, h: Holding = {}): Promise<string> {
    const unlimited = kind === 'unlimited'
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind,
        sourceClassPackageId: kind === 'credit_bundle' ? at.bundleId : unlimited ? at.planId : null,
        sourcePtPackageId: kind === 'pt' ? at.pt2on1Id : null,
        locationId: unlimited ? at.locationId : null,
        durationMonths: unlimited ? 1 : null,
        validityDays: unlimited ? null : (h.validityDays ?? 30),
        creditsOrSessionsRemaining: unlimited ? null : (h.credits ?? 10),
        expiresAt: h.expiresAt ?? null,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
        ...(h.purchasedAt ? { purchasedAt: h.purchasedAt } : {}),
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /* ── requests and state ─────────────────────────────────────────────── */

  const book = (who: Member, classId: string, body: Record<string, unknown> = {}) =>
    harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({ class_id: classId, ...body }),
    })

  const cancel = (who: Member, bookingId: string) =>
    harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers: who.headers })

  const checkout = (who: Member, packageId: string) =>
    harness.app.request('/api/v1/me/checkout/package', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({ package_kind: 'class', package_id: packageId }),
    })

  async function pkg(id: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, id))
    assert.ok(row, `no package ${id}`)
    return row
  }

  const packagesOf = (who: Member) =>
    harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, who.clientId))

  const bookingsOn = (classId: string) =>
    harness.db.select().from(schema.bookings).where(eq(schema.bookings.classId, classId))

  const cancellationsOf = (bookingId: string) =>
    harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))

  /** Days between now and an expiry, to a tenth. */
  const daysFromNow = (at: Date | null) => {
    assert.ok(at, 'expected an expiry')
    return Math.round(((at.getTime() - Date.now()) / DAY) * 10) / 10
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    ;({ withTenant } = await import('../db'))
    ;({ expirePackages } = await import('../services/packages/expire'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    try {
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
      await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM check_ins WHERE booking_id IN (SELECT id FROM bookings WHERE client_id IN (${clients}))`)
      await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM pt_session_clients WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (SELECT id FROM pt_sessions WHERE pt_request_id IN (${requests}))`)
      await harness.db.execute(sql`DELETE FROM pt_sessions WHERE pt_request_id IN (${requests})`)
      await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
      await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name IN (${PACKAGE_NAME}, ${FREE_PACKAGE_NAME}, ${PLAN_NAME})`)
      await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${`${PT_PACKAGE_NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  /* ── who pays when the member names no package ──────────────────────── */

  test('BKG-46 with only Dormant packages, the plan pays before a bundle bought earlier, and the earlier of two bundles before the later; the other waits', async () => {
    const ann = await member(one, 'ann')
    const bundle = await give(one, ann, 'credit_bundle', { credits: 5, purchasedAt: new Date(Date.now() - 2 * DAY) })
    const plan = await give(one, ann, 'unlimited', { purchasedAt: new Date(Date.now() - DAY) })

    const paid = await expectStatus(await book(ann, await addClass(one)), 201)
    assert.equal(paid.paid_with.client_package_id, plan, 'the plan pays, though the bundle was bought first')
    assert.ok((await pkg(plan)).expiresAt, 'and it alone Activates')
    assert.equal((await pkg(bundle)).expiresAt, null, 'the bundle stays Dormant')
    assert.equal((await pkg(bundle)).creditsOrSessionsRemaining, 5, 'with every credit')

    const ben = await member(one, 'ben')
    const earlier = await give(one, ben, 'credit_bundle', { credits: 5, purchasedAt: new Date(Date.now() - 2 * DAY) })
    const later = await give(one, ben, 'credit_bundle', { credits: 5, purchasedAt: new Date(Date.now() - DAY) })

    const second = await expectStatus(await book(ben, await addClass(one)), 201)
    assert.equal(second.paid_with.client_package_id, earlier, 'the bundle bought first pays')
    assert.equal((await pkg(earlier)).creditsOrSessionsRemaining, 4)
    assert.ok((await pkg(earlier)).expiresAt, 'and Activates')
    assert.equal((await pkg(later)).expiresAt, null, 'the later bundle waits')
    assert.equal((await pkg(later)).creditsOrSessionsRemaining, 5)
  })

  test('BKG-47 a running bundle that cannot pay — short of the cost, or past its expiry before the nightly job — gives way to a Dormant one, which pays and Activates', async () => {
    const cam = await member(one, 'cam')
    const runningEnds = new Date(Date.now() + 20 * DAY)
    const short = await give(one, cam, 'credit_bundle', { credits: 1, expiresAt: runningEnds })
    const waiting = await give(one, cam, 'credit_bundle', { credits: 5 })

    const res = await expectStatus(await book(cam, await addClass(one, { creditCost: 2 })), 201)
    assert.equal(res.paid_with.client_package_id, waiting, 'the Dormant bundle pays')
    assert.equal((await pkg(waiting)).creditsOrSessionsRemaining, 3)
    assert.equal(daysFromNow((await pkg(waiting)).expiresAt), 30, 'and Activates from now for its validity')
    const kept = await pkg(short)
    assert.equal(kept.creditsOrSessionsRemaining, 1, 'the short one keeps its credit')
    assert.equal(kept.expiresAt?.getTime(), runningEnds.getTime(), 'and its end date')
    assert.equal(kept.active, true)

    const dot = await member(one, 'dot')
    const stale = await give(one, dot, 'credit_bundle', { credits: 5, expiresAt: new Date(Date.now() - HOUR) })
    const next = await give(one, dot, 'credit_bundle', { credits: 5 })

    const swept = await expectStatus(await book(dot, await addClass(one)), 201)
    assert.equal(swept.paid_with.client_package_id, next, 'the Dormant bundle pays')
    assert.ok((await pkg(next)).expiresAt, 'and Activates')
    assert.equal((await pkg(stale)).active, false, 'the stale one is marked ended in the same booking')
    assert.equal((await pkg(stale)).creditsOrSessionsRemaining, 5, 'and nothing is taken from it')
  })

  test('BKG-48 a PT package never pays for a class: naming none is insufficient_credits, naming it is client_package_not_found, and no session is taken', async () => {
    const eli = await member(one, 'eli')
    const pt = await give(one, eli, 'pt', { credits: 6, validityDays: 90 })
    const classId = await addClass(one)

    await expectStatus(await book(eli, classId), 409, 'insufficient_credits')
    await expectStatus(await book(eli, classId, { client_package_id: pt }), 404, 'client_package_not_found')

    assert.equal((await bookingsOn(classId)).length, 0, 'no booking is made')
    const held = await pkg(pt)
    assert.equal(held.creditsOrSessionsRemaining, 6, 'no session is taken')
    assert.equal(held.expiresAt, null, 'and it stays Dormant')
  })

  test('BKG-49 a booking refused as full — outright, or losing the last seat to another member — leaves a Dormant bundle Dormant with all its credits', async () => {
    const fay = await member(one, 'fay')
    const gus = await member(one, 'gus')
    await give(one, fay, 'credit_bundle', { credits: 5 })
    const gusBundle = await give(one, gus, 'credit_bundle', { credits: 5 })
    const full = await addClass(one, { capacityOnline: 1 })
    await expectStatus(await book(fay, full), 201)

    await expectStatus(await book(gus, full), 409, 'class_full')
    assert.equal((await pkg(gusBundle)).expiresAt, null, 'still Dormant')
    assert.equal((await pkg(gusBundle)).creditsOrSessionsRemaining, 5)

    for (let round = 0; round < 3; round++) {
      const a = await member(one, `race-a${round}`)
      const b = await member(one, `race-b${round}`)
      const bundleA = await give(one, a, 'credit_bundle', { credits: 5 })
      const bundleB = await give(one, b, 'credit_bundle', { credits: 5 })
      const classId = await addClass(one, { capacityOnline: 1 })

      const [resA, resB] = await Promise.all([book(a, classId), book(b, classId)])
      const bodies = [await resA.text(), await resB.text()]
      assert.deepEqual([resA.status, resB.status].sort(), [201, 409], bodies.join(' | '))
      assert.ok(bodies.some(body => body.includes('class_full')), bodies.join(' | '))
      const [winner, loser] = resA.status === 201 ? [bundleA, bundleB] : [bundleB, bundleA]
      assert.ok((await pkg(winner)).expiresAt, 'the winner’s bundle Activates')
      assert.equal((await pkg(loser)).expiresAt, null, 'the loser’s bundle stays Dormant')
      assert.equal((await pkg(loser)).creditsOrSessionsRemaining, 5, 'with every credit')
    }
  })

  test('TEN-34 a member booking another studio’s class by id is refused 404 class_not_found, and nothing is booked or debited at either studio', async () => {
    const hal = await member(two, 'hal')
    const bundle = await give(two, hal, 'credit_bundle', { credits: 5 })
    const theirs = await addClass(one)

    await expectStatus(await book(hal, theirs), 404, 'class_not_found')
    await expectStatus(await book(hal, theirs, { client_package_id: bundle }), 404, 'class_not_found')

    assert.equal((await bookingsOn(theirs)).length, 0, 'no booking on the class')
    const own = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.clientId, hal.clientId))
    assert.equal(own.length, 0, 'no booking for the member anywhere')
    assert.equal((await pkg(bundle)).creditsOrSessionsRemaining, 5)
    assert.equal((await pkg(bundle)).expiresAt, null)
  })

  /* ── buying beside what runs, and the frozen length ─────────────────── */

  test('PKG-37 a member with a running Credit Bundle, or a running Unlimited Plan, buys a Credit Bundle: it waits Dormant and the running one is untouched', async () => {
    const free = await freeBundle(one, 30)
    for (const kind of ['credit_bundle', 'unlimited'] as const) {
      const ivy = await member(one, `ivy-${kind}`)
      const ends = new Date(Date.now() + 10 * DAY)
      const running = await give(one, ivy, kind, { credits: 3, expiresAt: ends })

      const bought = await expectStatus(await checkout(ivy, free), 201)
      assert.equal(bought.outcome, 'granted', JSON.stringify(bought))

      const fresh = await pkg(bought.client_package_id)
      assert.equal(fresh.kind, 'credit_bundle')
      assert.equal(fresh.expiresAt, null, 'the new bundle waits Dormant')
      assert.equal(fresh.creditsOrSessionsRemaining, 5)
      const kept = await pkg(running)
      assert.equal(kept.expiresAt?.getTime(), ends.getTime(), `the running ${kind} keeps its end date`)
      assert.equal(kept.creditsOrSessionsRemaining, kind === 'unlimited' ? null : 3, `the running ${kind} keeps its balance`)
      assert.equal((await packagesOf(ivy)).length, 2)
    }
  })

  test('PKG-38 a Dormant bundle bought at 30 days Activates for 30 after the Admin changes the catalogue to 60', async () => {
    const free = await freeBundle(one, 30)
    const jo = await member(one, 'jo')
    const bought = await expectStatus(await checkout(jo, free), 201)
    const held = bought.client_package_id as string

    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/class-packages/${free}`, {
        method: 'PATCH',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ validity_days: 60 }),
      }),
      200,
    )
    const [catalogue] = await harness.db.select().from(schema.classPackages).where(eq(schema.classPackages.id, free))
    assert.equal(catalogue!.validityDays, 60, 'the catalogue now says 60')

    await expectStatus(await book(jo, await addClass(one)), 201)
    assert.equal(daysFromNow((await pkg(held)).expiresAt), 30, 'the purchase keeps the 30 days it was sold with')
  })

  test('PKG-39 a Dormant bundle bought a year ago, longer than its validity, is left alone by the expiry job and Activates from today when booked', async () => {
    const kit = await member(one, 'kit')
    const old = await give(one, kit, 'credit_bundle', { credits: 5, validityDays: 30, purchasedAt: new Date(Date.now() - 365 * DAY) })

    await withTenant(one.id, () => expirePackages())
    const waited = await pkg(old)
    assert.equal(waited.active, true, 'the expiry job does not end a Dormant package')
    assert.equal(waited.expiresAt, null)

    const res = await expectStatus(await book(kit, await addClass(one)), 201)
    assert.equal(res.paid_with.client_package_id, old)
    const started = await pkg(old)
    assert.equal(started.creditsOrSessionsRemaining, 4)
    assert.equal(daysFromNow(started.expiresAt), 30, 'its full validity, from today')
  })

  /* ── cancelling ─────────────────────────────────────────────────────── */

  test('CXL-64 a member cannot cancel a booking already checked in: 409 booking_attended, nothing moves and no cancellation is recorded', async () => {
    const lee = await member(one, 'lee')
    const bundle = await give(one, lee, 'credit_bundle', { credits: 5 })
    // Five minutes out: inside the studio's Check-in Window, before the start.
    const classId = await addClass(one, { startsIn: 5 * MINUTE })
    const booked = await expectStatus(await book(lee, classId), 201)
    const scanned = await expectStatus(
      await harness.app.request('/api/v1/portal/admin/check-in/scan', {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ code: booked.code }),
      }),
      200,
    )
    assert.equal(scanned.outcome, 'checked_in')

    await expectStatus(await cancel(lee, booked.booking_id), 409, 'booking_attended')

    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, booked.booking_id))
    assert.equal(row!.state, 'confirmed')
    assert.equal(row!.checkInState, 'attended')
    assert.equal((await pkg(bundle)).creditsOrSessionsRemaining, 4, 'the credit stays spent')
    assert.equal((await cancellationsOf(booked.booking_id)).length, 0)
  })

  test('CXL-65 two cancels of one booking at the same moment: one cancels, the other is 409 not_cancellable, and the credit comes back once', async () => {
    const mo = await member(one, 'mo')
    const bundle = await give(one, mo, 'credit_bundle', { credits: 5 })
    const booked = await expectStatus(await book(mo, await addClass(one)), 201)
    assert.equal((await pkg(bundle)).creditsOrSessionsRemaining, 4)

    const [a, b] = await Promise.all([cancel(mo, booked.booking_id), cancel(mo, booked.booking_id)])
    const bodies = [await a.text(), await b.text()]
    assert.deepEqual([a.status, b.status].sort(), [200, 409], bodies.join(' | '))
    assert.ok(bodies.some(body => body.includes('not_cancellable')), bodies.join(' | '))

    assert.equal((await pkg(bundle)).creditsOrSessionsRemaining, 5, 'one credit back, not two')
    assert.equal((await cancellationsOf(booked.booking_id)).length, 1)
  })

  test('PT-127 a member looking up their own email as a 2on1 partner finds no one, as for an address the studio does not know', async () => {
    const ora = await member(one, 'ora')
    const other = await member(one, 'ora-friend')
    const [self] = await harness.db.select({ email: schema.clients.email }).from(schema.clients).where(eq(schema.clients.id, ora.clientId))
    const [friend] = await harness.db.select({ email: schema.clients.email }).from(schema.clients).where(eq(schema.clients.id, other.clientId))
    const lookup = (email: string) =>
      harness.app.request(`/api/v1/me/pt-sessions/partner-lookup?email=${encodeURIComponent(email)}`, { headers: ora.headers })

    assert.deepEqual(await expectStatus(await lookup(self!.email.toUpperCase()), 200), { found: false, client_id: null, name: null })
    assert.deepEqual(await expectStatus(await lookup(emailFor('nobody-here')), 200), { found: false, client_id: null, name: null })
    // The same lookup does find another member of the studio.
    assert.equal((await expectStatus(await lookup(friend!.email), 200)).client_id, other.clientId)
  })

  test('PT-128 the partner on a member’s 2on1 request cannot cancel it: 403 not_your_request, and the session, both bookings and the requester’s balance stand', async () => {
    const nia = await member(one, 'nia')
    const pal = await member(one, 'pal')
    const pack = await give(one, nia, 'pt', { credits: 6, validityDays: 90 })
    const requested = await expectStatus(
      await harness.app.request('/api/v1/me/pt-sessions/request', {
        method: 'POST',
        headers: { ...nia.headers, ...json },
        body: JSON.stringify({
          classTypeId: one.classTypeId,
          locationId: one.locationId,
          sessionType: '2on1',
          clientPackageId: pack,
          slots: [{ proposedDate: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10), startTime: '09:00', endTime: '10:00' }],
          partner: { kind: 'existing', coClientId: pal.clientId },
        }),
      }),
      201,
    )
    const requestId = requested.pt_request_id as string
    const startsAt = new Date(Date.now() + 200 * DAY)
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}/schedule`, {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({
          instructor_id: one.instructor.id,
          location_id: one.locationId,
          room_id: one.roomId,
          starts_at: startsAt.toISOString(),
          ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
          instructor_pay_sgd: 0,
        }),
      }),
      201,
    )
    assert.equal((await pkg(pack)).creditsOrSessionsRemaining, 4, 'the request took two sessions')

    await expectStatus(
      await harness.app.request(`/api/v1/me/pt-sessions/${requestId}/cancel`, { method: 'POST', headers: pal.headers }),
      403,
      'not_your_request',
    )

    const [request] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, requestId))
    assert.equal(request!.status, 'scheduled')
    const [session] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.ptRequestId, requestId))
    assert.equal(session!.lifecycle, 'active')
    const seats = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.ptSessionId, session!.id))
    assert.deepEqual(
      seats.map(s => [s.clientId, s.state]).sort(),
      [[nia.clientId, 'confirmed'], [pal.clientId, 'confirmed']].sort(),
    )
    assert.equal((await pkg(pack)).creditsOrSessionsRemaining, 4, 'nothing returned')
  })
})
