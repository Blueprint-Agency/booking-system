import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.home-location.test`
// Every name carries `run`; none ends in "Flow" / "Bundle", which isolation.test.ts purges by.
const NAME = `Home-location ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * An Unlimited Plan's **Home Location** as the member meets it, over real HTTP
 * (#226): which Location's classes it pays for, what the Cross-Location Add-On
 * changes, and that a Credit Bundle is never spent in its place without the
 * member asking. Then the Inbox item a member's own cancellation leaves.
 *
 * Written from the LOC and INB rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`). Fixtures — a class, a package a member holds —
 * are written directly; every action goes through a route.
 */
describe('home location and member cancellations over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    home: { id: string; roomId: string }
    away: { id: string; roomId: string }
    classTypeId: string
    bundlePackageId: string
    ptPackageId: string
    renewalPackageId: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; headers: Record<string, string> }

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
    const [user] = await harness.db.select({ id: schema.staffAuthUsers.id }).from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    return { id: row!.id, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const premises = async (name: string) => {
      const [location] = await harness.db
        .insert(schema.locations)
        .values({ tenantId: tenant.id, name: `${NAME} ${name}` })
        .returning({ id: schema.locations.id })
      const [room] = await harness.db
        .insert(schema.rooms)
        .values({ tenantId: tenant.id, locationId: location!.id, name: `${name} room`, capacity: 20 })
        .returning({ id: schema.rooms.id })
      return { id: location!.id, roomId: room!.id }
    }
    const [classType] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: `${NAME} class type` })
      .returning({ id: schema.classTypes.id })
    const [bundle] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} pass`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00' })
      .returning({ id: schema.classPackages.id })
    // A plan the member can renew on the spot: free, so the grant needs no payment provider.
    const [renewal] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} month`, kind: 'unlimited', durationMonths: 1, priceSgd: '0.00' })
      .returning({ id: schema.classPackages.id })
    const [pt] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: `${NAME} PT`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00' })
      .returning({ id: schema.ptPackages.id })
    const instructor = await staffAt(tenant, 'instructor', 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: instructor.id })
    return {
      ...tenant,
      home: await premises('home'),
      away: await premises('away'),
      classTypeId: classType!.id,
      bundlePackageId: bundle!.id,
      renewalPackageId: renewal!.id,
      ptPackageId: pt!.id,
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor,
    }
  }

  /** Each class gets an hour of its own, so none clash in a room. */
  let slots = 0
  async function addClass(at: Studio, where: 'home' | 'away', creditCost = 1): Promise<string> {
    const startsAt = new Date(Date.now() + 3 * DAY + slots++ * 2 * HOUR)
    const place = at[where]
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.instructor.id,
        locationId: place.id,
        roomId: place.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost,
        createdByStaffId: at.instructor.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  async function member(at: Studio, name: string): Promise<Member> {
    const email = emailFor(`${name}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  /** An Activated Unlimited Plan with its Home Location at `at.home`. */
  async function plan(at: Studio, who: Member, options: { crossLocation?: boolean } = {}): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'unlimited',
        locationId: at.home.id,
        durationMonths: 1,
        crossLocationPaidSgd: options.crossLocation ? '50.00' : null,
        expiresAt: new Date(Date.now() + 30 * DAY),
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /** A Credit Bundle, bought and waiting (Dormant). */
  async function bundle(at: Studio, who: Member, credits = 5): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'credit_bundle',
        sourceClassPackageId: at.bundlePackageId,
        validityDays: 90,
        creditsOrSessionsRemaining: credits,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  const book = (who: Member, classId: string, body: Record<string, unknown> = {}) =>
    harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({ class_id: classId, ...body }),
    })

  const pkg = async (id: string) => (await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, id)))[0]!
  const bookingRow = async (id: string) => (await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!
  const bookingsOn = (who: Member, classId: string) =>
    harness.db.select().from(schema.bookings).where(and(eq(schema.bookings.clientId, who.clientId), eq(schema.bookings.classId, classId)))
  const adjustmentsOf = (who: Member) => harness.db.select().from(schema.manualAdjustments).where(eq(schema.manualAdjustments.clientId, who.clientId))
  const inboxFor = async (at: Studio, key: string, value: string) =>
    harness.db.select().from(schema.inboxItems).where(and(eq(schema.inboxItems.tenantId, at.id), sql`${schema.inboxItems.payload}->>${key} = ${value}`))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const named = `${NAME}%`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_session_clients WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (SELECT id FROM pt_sessions WHERE pt_request_id IN (${requests}))`)
    await harness.db.execute(sql`DELETE FROM pt_sessions WHERE pt_request_id IN (${requests})`)
    await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${named}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${named}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE ${named}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (SELECT id FROM locations WHERE name LIKE ${named})`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name LIKE ${named}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── which Location a plan pays for ─────────────────────────────────── */

  test('LOC-09 a plan with the Cross-Location Add-On pays for a class at its other Location, 0 credits debited', async () => {
    const ann = await member(one, 'ann')
    const planId = await plan(one, ann, { crossLocation: true })
    const credits = await bundle(one, ann)
    const away = await addClass(one, 'away', 2)

    const { booking_id } = await expectStatus(await book(ann, away), 201)
    const row = await bookingRow(booking_id)
    assert.equal(row.state, 'confirmed')
    assert.equal(row.clientPackageId, planId, 'the plan paid, not the bundle')
    assert.equal(row.creditsOrSessionsUsed, 0)
    assert.equal((await pkg(credits)).creditsOrSessionsRemaining, 5)
    assert.equal((await adjustmentsOf(ann)).length, 0)
  })

  test('LOC-12 a plan without the Add-On is refused at its other Location as location_not_covered', async () => {
    const ben = await member(one, 'ben')
    await plan(one, ben)
    const away = await addClass(one, 'away')
    await expectStatus(await book(ben, away), 409, 'location_not_covered')
    assert.equal((await bookingsOn(ben, away)).length, 0)

    // At home the same plan pays.
    await expectStatus(await book(ben, await addClass(one, 'home')), 201)
  })

  test('LOC-13 holding a plan for home and a Credit Bundle, a booking elsewhere without use_credits is refused and no credit is spent', async () => {
    const cat = await member(one, 'cat')
    await plan(one, cat)
    const credits = await bundle(one, cat)
    const away = await addClass(one, 'away')

    await expectStatus(await book(cat, away), 409, 'location_not_covered')
    assert.equal((await bookingsOn(cat, away)).length, 0)
    const held = await pkg(credits)
    assert.equal(held.creditsOrSessionsRemaining, 5, 'the bundle was not silently spent')
    assert.equal(held.expiresAt, null, 'nor started')
    assert.equal((await adjustmentsOf(cat)).length, 0)
  })

  test('LOC-10 with the plan running, use_credits does not start a waiting bundle: refused, nothing debited, the bundle stays Dormant', async () => {
    const dan = await member(one, 'dan')
    await plan(one, dan)
    const credits = await bundle(one, dan)
    const away = await addClass(one, 'away')

    await expectStatus(await book(dan, away, { use_credits: true }), 409, 'location_not_covered')
    assert.equal((await bookingsOn(dan, away)).length, 0)
    const held = await pkg(credits)
    assert.equal(held.creditsOrSessionsRemaining, 5)
    assert.equal(held.expiresAt, null, 'still Dormant')
    assert.equal((await adjustmentsOf(dan)).length, 0)
  })

  test('LOC-11 a booking the Add-On paid for stays confirmed after the member renews without the Add-On', async () => {
    const eve = await member(one, 'eve')
    const first = await plan(one, eve, { crossLocation: true })
    const away = await addClass(one, 'away')
    const { booking_id } = await expectStatus(await book(eve, away), 201)

    // Renew at the same Home Location, without the Add-On, through checkout.
    const renewed = await expectStatus(
      await harness.app.request('/api/v1/me/checkout/package', {
        method: 'POST',
        headers: { ...eve.headers, ...json },
        body: JSON.stringify({ package_kind: 'class', package_id: one.renewalPackageId, location_id: one.home.id }),
      }),
      201,
    )
    assert.equal(renewed.outcome, 'granted')
    const renewal = await pkg(renewed.client_package_id)
    assert.equal(renewal.crossLocationPaidSgd, null, 'the renewal carries no Add-On')

    // The first plan runs out; only the renewal is left.
    await harness.db.update(schema.clientPackages).set({ expiresAt: new Date(Date.now() - HOUR) }).where(eq(schema.clientPackages.id, first))

    const mine = await expectStatus(await harness.app.request(`/api/v1/me/bookings/${booking_id}`, { headers: eve.headers }), 200)
    assert.equal(mine.state, 'confirmed', 'coverage is never re-tested on an existing booking')
    assert.equal((await bookingRow(booking_id)).state, 'confirmed')

    // A new booking there is judged by the renewal, which does not cover it.
    await expectStatus(await book(eve, await addClass(one, 'away')), 409, 'location_not_covered')
  })

  test('another studio\'s plan pays for nothing here, and this studio\'s class is not found from there', async () => {
    const fay = await member(two, 'fay')
    await plan(two, fay, { crossLocation: true })
    const res = await book(fay, await addClass(one, 'home'))
    assert.equal(res.status, 404, await res.text())
  })

  /* ── a member's own cancellation, in the Inbox ─────────────────────── */

  test('INB-03 a member cancelling a class booking leaves a client-cancellation Inbox item naming them, the booking and its refund', async () => {
    const gus = await member(one, 'gus')
    await bundle(one, gus)
    const { booking_id } = await expectStatus(await book(gus, await addClass(one, 'home')), 201)

    await expectStatus(await harness.app.request(`/api/v1/me/bookings/${booking_id}`, { method: 'DELETE', headers: gus.headers }), 200)

    const items = await inboxFor(one, 'bookingId', booking_id)
    assert.equal(items.length, 1)
    const [item] = items
    assert.equal(item!.type, 'client_cancellation')
    const payload = item!.payload as Record<string, unknown>
    assert.equal(payload.clientId, gus.clientId)
    assert.equal(payload.kind, 'class')
    assert.equal(payload.refundOutcome, 'credit_returned')
    assert.equal(payload.refundFired, true)
    assert.equal((await inboxFor(two, 'bookingId', booking_id)).length, 0, 'written under the member\'s own studio only')
  })

  test('INB-03 a member cancelling a scheduled PT session leaves a client-cancellation Inbox item naming them, the session and its refund', async () => {
    const hal = await member(one, 'hal')
    const [pack] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: one.id,
        clientId: hal.clientId,
        kind: 'pt',
        sourcePtPackageId: one.ptPackageId,
        validityDays: 90,
        creditsOrSessionsRemaining: 2,
        active: true,
        amountPaidSgd: '400.00',
        listPriceSgd: '400.00',
      })
      .returning({ id: schema.clientPackages.id })

    const requested = await expectStatus(
      await harness.app.request('/api/v1/me/pt-sessions/request', {
        method: 'POST',
        headers: { ...hal.headers, ...json },
        body: JSON.stringify({
          classTypeId: one.classTypeId,
          locationId: one.home.id,
          sessionType: '1on1',
          clientPackageId: pack!.id,
          slots: [{ proposedDate: '2030-01-15', startTime: '09:00', endTime: '10:00' }],
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
          location_id: one.home.id,
          room_id: one.home.roomId,
          starts_at: startsAt.toISOString(),
          ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
          instructor_pay_sgd: 0,
        }),
      }),
      201,
    )
    const [session] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.ptRequestId, requestId))
    assert.ok(session)

    const cancelled = await expectStatus(await harness.app.request(`/api/v1/me/pt-sessions/${requestId}/cancel`, { method: 'POST', headers: hal.headers }), 200)
    assert.equal(cancelled.refundOutcome, 'session_returned')

    const items = await inboxFor(one, 'ptSessionId', session.id)
    assert.equal(items.length, 1)
    const [item] = items
    assert.equal(item!.type, 'client_cancellation')
    const payload = item!.payload as Record<string, unknown>
    assert.equal(payload.clientId, hal.clientId)
    assert.equal(payload.ptRequestId, requestId)
    assert.equal(payload.kind, 'pt')
    assert.equal(payload.refundOutcome, 'session_returned')
    assert.equal(payload.refundedSessions, 1)
    assert.equal((await inboxFor(two, 'ptSessionId', session.id)).length, 0, 'written under the member\'s own studio only')
  })
})
