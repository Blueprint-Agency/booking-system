import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.pt.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `PT focus ${run}`
const CLASS_PACKAGE_NAME = `PT-suite class pass ${run}`
const PT_PACKAGE_NAME = `PT-suite sessions ${run}`
const ROOM_NAME = `PT-suite room ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Private sessions over real HTTP (#202), written from the PT rows of the
 * Scenario Inventory (`docs/md/test-scenarios.md`) and `pt-session-lifecycle.md`:
 * a member's request debits their PT package, staff schedule it (the implicit
 * approval) into a session with bookings, and either side cancels it — with the
 * session(s) returned or forfeited by the PT window and the shared cap.
 *
 * Every journey acts through the member's `/api/v1/me/pt-sessions`, the admin's
 * `/api/v1/portal/admin/pt-sessions` or the instructor's
 * `/api/v1/portal/instructor/pt-requests`, then reads the rows it left behind.
 * Fixtures — staff, members, the packages they hold — are written directly:
 * which rows a person has is the test's to state.
 */
describe('PT requests over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let ptPackagesSvc!: typeof import('../services/packages/pt-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type Place = { locationId: string; roomId: string }
  type Studio = {
    id: string
    slug: string
    /** Two Locations at studio one (its fixture has two premises); one at studio two. */
    places: Place[]
    classTypeId: string
    classPackageId: string
    pt: { '1on1': string; '2on1': string }
  }
  type Staff = { staffId: string; headers: Record<string, string> }
  type Member = { clientId: string; email: string; name: string; headers: Record<string, string> }
  type SessionType = '1on1' | '2on1'

  let one!: Studio
  let two!: Studio
  let adminAtOne!: Staff
  let coachA!: Staff
  let coachB!: Staff
  let adminAtTwo!: Staff

  const emailFor = (name: string) => `${name.toLowerCase().replace(/\s+/g, '-')}@${DOMAIN}`

  const expectStatus = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as any) : null
  }

  // ── Fixtures ─────────────────────────────────────────────────────────────

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const locations = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenant.id))
    assert.ok(locations.length, `expected a seeded location for ${tenant.slug}`)
    // Rooms of our own, so a room clash can only be with a session this file made.
    const places: Place[] = []
    for (const location of locations) {
      const [room] = await harness.db
        .insert(schema.rooms)
        .values({ tenantId: tenant.id, locationId: location.id, name: ROOM_NAME, capacity: 4 })
        .returning({ id: schema.rooms.id })
      places.push({ locationId: location.id, roomId: room!.id })
    }
    const classType = await classTypesSvc.createClassType(tenant.id, { name: CLASS_TYPE_NAME })
    const classPackage = await classPackagesSvc.createClassPackage(tenant.id, {
      name: CLASS_PACKAGE_NAME,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    const ptPackage = (sessionType: SessionType) =>
      ptPackagesSvc.createPtPackage(tenant.id, {
        name: `${PT_PACKAGE_NAME} ${sessionType}`,
        sessionType,
        numSessions: 10,
        validityDays: 90,
        priceSgd: '900.00',
      })
    return {
      ...tenant,
      places,
      classTypeId: classType.id,
      classPackageId: classPackage.id,
      pt: { '1on1': (await ptPackage('1on1')).id, '2on1': (await ptPackage('2on1')).id },
    }
  }

  async function staff(at: Studio, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${name}-${at.slug}`)
    const headers = await harness.signInAs('staff', email, at)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    }
    return { staffId: row!.id, headers }
  }

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
    return { clientId: client!.id, email, name, headers }
  }

  /** A PT package held by `who`, Dormant as every purchase lands, with `sessions` left. */
  async function givePt(
    at: Studio,
    who: Member,
    sessionType: SessionType,
    opts: { sessions?: number; boundTo?: Staff } = {},
  ): Promise<string> {
    const { clientPackageId } = await purchaseSvc.grantPackage(at.id, {
      clientId: who.clientId,
      purchaseId: null,
      amountSgd: '900.00',
      packageKind: 'pt',
      packageId: at.pt[sessionType],
    })
    if (opts.sessions !== undefined || opts.boundTo) {
      await harness.db
        .update(schema.clientPackages)
        .set({
          ...(opts.sessions !== undefined ? { creditsOrSessionsRemaining: opts.sessions } : {}),
          ...(opts.boundTo ? { boundInstructorId: opts.boundTo.staffId } : {}),
        })
        .where(eq(schema.clientPackages.id, clientPackageId))
    }
    return clientPackageId
  }

  async function giveClassCredits(at: Studio, who: Member): Promise<void> {
    await purchaseSvc.grantPackage(at.id, {
      clientId: who.clientId,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: at.classPackageId,
    })
  }

  // ── Member routes ────────────────────────────────────────────────────────

  const proposedDate = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10)

  type RequestBody = {
    sessionType: SessionType
    clientPackageId: string
    locationId?: string
    partner?: { kind: 'existing'; coClientId: string } | { kind: 'new'; name: string; email: string }
    slots?: { proposedDate: string; startTime: string; endTime: string }[]
  }

  const submit = (at: Studio, who: Member, body: RequestBody) =>
    harness.app.request('/api/v1/me/pt-sessions/request', {
      method: 'POST',
      headers: { ...who.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classTypeId: at.classTypeId,
        locationId: body.locationId ?? at.places[0]!.locationId,
        sessionType: body.sessionType,
        clientPackageId: body.clientPackageId,
        slots: body.slots ?? [{ proposedDate, startTime: '09:00', endTime: '10:00' }],
        ...(body.partner ? { partner: body.partner } : {}),
      }),
    })

  async function requestOk(at: Studio, who: Member, body: RequestBody): Promise<string> {
    const res = await expectStatus(await submit(at, who, body), 201)
    return res.pt_request_id as string
  }

  const memberCancel = (who: Member, requestId: string) =>
    harness.app.request(`/api/v1/me/pt-sessions/${requestId}/cancel`, { method: 'POST', headers: who.headers })

  async function myRequests(who: Member): Promise<any[]> {
    const res = await expectStatus(await harness.app.request('/api/v1/me/pt-sessions', { headers: who.headers }), 200)
    return res.pt_requests
  }

  // ── Staff routes ─────────────────────────────────────────────────────────

  // Distinct times for every session this file schedules, so a clash is only
  // ever the one a test sets up. `far` is days out (outside the 24-hour PT
  // window); `near` is within it.
  let farSlots = 0
  let nearSlots = 0
  const far = () => new Date(Date.now() + 3 * DAY + farSlots++ * 2 * HOUR)
  const near = () => new Date(Date.now() + 2 * HOUR + nearSlots++ * 75 * MINUTE)

  type ScheduleOpts = { startsAt?: Date; place?: Place; instructor?: Staff }

  function scheduleBody(at: Studio, opts: ScheduleOpts) {
    const startsAt = opts.startsAt ?? far()
    const place = opts.place ?? at.places[0]!
    return {
      location_id: place.locationId,
      room_id: place.roomId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
    }
  }

  const adminSchedule = (at: Studio, by: Staff, requestId: string, opts: ScheduleOpts = {}) =>
    harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}/schedule`, {
      method: 'POST',
      headers: { ...by.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...scheduleBody(at, opts),
        instructor_id: (opts.instructor ?? coachA).staffId,
        instructor_pay_sgd: 60,
      }),
    })

  const instructorSchedule = (at: Studio, by: Staff, requestId: string, opts: ScheduleOpts & { instructor_id?: string } = {}) =>
    harness.app.request(`/api/v1/portal/instructor/pt-requests/${requestId}/schedule`, {
      method: 'POST',
      headers: { ...by.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...scheduleBody(at, opts), ...(opts.instructor_id ? { instructor_id: opts.instructor_id } : {}) }),
    })

  async function scheduled(requestId: string, opts: ScheduleOpts = {}): Promise<string> {
    const res = await expectStatus(await adminSchedule(one, adminAtOne, requestId, opts), 201)
    assert.equal(res.pt_request.status, 'scheduled')
    return res.pt_request.session.id as string
  }

  const adminCancel = (by: Staff, requestId: string) =>
    harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}/cancel`, { method: 'POST', headers: by.headers })

  const instructorCancel = (by: Staff, requestId: string) =>
    harness.app.request(`/api/v1/portal/instructor/pt-requests/${requestId}/cancel`, {
      method: 'POST',
      headers: by.headers,
    })

  async function adminQueue(by: Staff, query = ''): Promise<any[]> {
    const res = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/pt-sessions${query}`, { headers: by.headers }),
      200,
    )
    return res.pt_requests
  }

  async function instructorQueue(by: Staff): Promise<any[]> {
    const res = await expectStatus(
      await harness.app.request('/api/v1/portal/instructor/pt-requests', { headers: by.headers }),
      200,
    )
    return res.pt_requests
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async function pkg(clientPackageId: string) {
    const [row] = await harness.db
      .select()
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, clientPackageId))
    assert.ok(row, `no client package ${clientPackageId}`)
    return row
  }
  const sessionsLeft = async (clientPackageId: string) => (await pkg(clientPackageId)).creditsOrSessionsRemaining

  async function requestRow(requestId: string) {
    const [row] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, requestId))
    assert.ok(row, `no PT request ${requestId}`)
    return row
  }

  async function sessionRow(sessionId: string) {
    const [row] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.id, sessionId))
    assert.ok(row, `no PT session ${sessionId}`)
    return row
  }

  const sessionsFor = (requestId: string) =>
    harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.ptRequestId, requestId))

  const bookingsOn = (sessionId: string) =>
    harness.db.select().from(schema.bookings).where(eq(schema.bookings.ptSessionId, sessionId))

  const requestsOf = (who: Member) =>
    harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.clientId, who.clientId))

  const cancellationsOf = (who: Member) =>
    harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.clientId, who.clientId))

  // ── Setup ────────────────────────────────────────────────────────────────

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    assert.ok(one.places.length >= 2, 'studio one has two Locations to route between')
    adminAtOne = await staff(one, 'pt-admin', 'admin')
    coachA = await staff(one, 'coach-a', 'instructor')
    coachB = await staff(one, 'coach-b', 'instructor')
    adminAtTwo = await staff(two, 'pt-admin', 'admin')
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
    const sessions = sql`SELECT id FROM pt_sessions WHERE pt_request_id IN (${requests})`
    const bookings = sql`SELECT id FROM bookings WHERE client_id IN (${clients})`
    const run = (q: ReturnType<typeof sql>) => harness.db.execute(q)
    await run(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await run(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await run(sql`DELETE FROM check_ins WHERE booking_id IN (${bookings})`)
    await run(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await run(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await run(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${requests})`)
    await run(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await run(sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${sessions})`)
    await run(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (${sessions})`)
    await run(sql`DELETE FROM pt_sessions WHERE id IN (${sessions})`)
    await run(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
    await run(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await run(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
    await run(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await run(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await run(sql`DELETE FROM pt_packages WHERE name LIKE ${`${PT_PACKAGE_NAME}%`}`)
    await run(sql`DELETE FROM class_packages WHERE name = ${CLASS_PACKAGE_NAME}`)
    await run(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await run(sql`DELETE FROM rooms WHERE name = ${ROOM_NAME}`)
    await run(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await run(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await run(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await run(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await run(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  // ── Request ──────────────────────────────────────────────────────────────

  test('PT-02, PT-03, PT-05, PT-06, PT-01 a 1on1 request is pending at its Location, debits one session, takes no payment and expires after the book-in-advance days', async () => {
    const ana = await member(one, 'Ana Request')
    const packageId = await givePt(one, ana, '1on1')
    const place = one.places[1]!

    const before = Date.now()
    const requestId = await requestOk(one, ana, { sessionType: '1on1', clientPackageId: packageId, locationId: place.locationId })

    const row = await requestRow(requestId)
    assert.equal(row.status, 'pending')
    assert.equal(row.locationId, place.locationId)
    assert.equal(row.sessionType, '1on1')
    assert.equal(row.debitedClientPackageId, packageId)
    assert.equal(await sessionsLeft(packageId), 9)

    const [config] = await harness.db
      .select({ days: schema.ptBookingConfig.bookInAdvanceDays })
      .from(schema.ptBookingConfig)
      .where(eq(schema.ptBookingConfig.tenantId, one.id))
    assert.ok(config)
    const expected = before + config.days * DAY
    assert.ok(Math.abs(row.expiresAt.getTime() - expected) < 5 * MINUTE, `expires ${config.days} days after submit`)

    // No payment: nothing was sold, nothing charged.
    const purchases = await harness.db.select().from(schema.purchases).where(eq(schema.purchases.clientId, ana.clientId))
    const payments = await harness.db.select().from(schema.stripePayments).where(eq(schema.stripePayments.clientId, ana.clientId))
    assert.equal(purchases.length, 0)
    assert.equal(payments.length, 0)

    // The member's own list shows it pending; their packages show what is left and until when.
    const [mine] = await myRequests(ana)
    assert.equal(mine.id, requestId)
    assert.equal(mine.status, 'pending')
    assert.equal(mine.location_id, place.locationId)
    const packages = await expectStatus(await harness.app.request('/api/v1/me/packages', { headers: ana.headers }), 200)
    const held = packages.client_packages.find((p: any) => p.id === packageId)
    assert.equal(held.session_type, '1on1')
    assert.equal(held.credits_or_sessions_remaining, 9)
    assert.ok(held.expires_at, 'a running PT package shows its expiry date')
  })

  test('PT-04 a 2on1 request debits two sessions, not one', async () => {
    const ben = await member(one, 'Ben Pair')
    const bea = await member(one, 'Bea Partner')
    const packageId = await givePt(one, ben, '2on1')

    await requestOk(one, ben, {
      sessionType: '2on1',
      clientPackageId: packageId,
      partner: { kind: 'existing', coClientId: bea.clientId },
    })

    assert.equal(await sessionsLeft(packageId), 8)
  })

  test('PT-07 the entitlements reflect the debit on the matching session type only', async () => {
    const cy = await member(one, 'Cy Both')
    const cyb = await member(one, 'Cyb Partner')
    await givePt(one, cy, '1on1')
    const pairs = await givePt(one, cy, '2on1')
    const entitlements = async () =>
      (await expectStatus(await harness.app.request('/api/v1/me/packages', { headers: cy.headers }), 200)).entitlements
    const was = await entitlements()
    assert.equal(was.pt_1on1_remaining, 10)
    assert.equal(was.pt_2on1_remaining, 10)

    await requestOk(one, cy, { sessionType: '2on1', clientPackageId: pairs, partner: { kind: 'existing', coClientId: cyb.clientId } })

    const now = await entitlements()
    assert.equal(now.pt_2on1_remaining, 8)
    assert.equal(now.pt_1on1_remaining, 10)
  })

  test('PT-08, PT-09, PT-10 a partner is found by email at this studio, linked when they are a member, and kept by name when they are not', async () => {
    const dev = await member(one, 'Dev Host')
    const dot = await member(one, 'Dot Friend')
    const elsewhere = await member(two, 'Dot Elsewhere')
    const packageId = await givePt(one, dev, '2on1')
    const lookup = (email: string) =>
      harness.app.request(`/api/v1/me/pt-sessions/partner-lookup?email=${encodeURIComponent(email)}`, {
        headers: dev.headers,
      })

    const found = await expectStatus(await lookup(dot.email), 200)
    assert.equal(found.found, true)
    assert.equal(found.client_id, dot.clientId)
    // Another studio's member is nobody here.
    const stranger = await expectStatus(await lookup(elsewhere.email), 200)
    assert.equal(stranger.found, false)
    assert.equal(stranger.client_id, null)

    const linked = await requestOk(one, dev, {
      sessionType: '2on1',
      clientPackageId: packageId,
      partner: { kind: 'existing', coClientId: found.client_id },
    })
    assert.equal((await requestRow(linked)).coClientId, dot.clientId)

    const newcomer = await requestOk(one, dev, {
      sessionType: '2on1',
      clientPackageId: packageId,
      partner: { kind: 'new', name: 'Nia Newcomer', email: emailFor('nia-newcomer') },
    })
    const row = await requestRow(newcomer)
    assert.equal(row.coClientId, null)
    assert.equal(row.coClientName, 'Nia Newcomer')
    assert.equal(row.coClientEmail, emailFor('nia-newcomer'))
  })

  test('PT-12, PT-13, PT-14, PT-16, PT-17 a request the package or the form cannot back is refused, and nothing is created or debited', async () => {
    const eli = await member(one, 'Eli Refused')
    const pal = await member(one, 'Pal Refused')
    await giveClassCredits(one, eli)
    const [classPass] = await harness.db
      .select({ id: schema.clientPackages.id })
      .from(schema.clientPackages)
      .where(and(eq(schema.clientPackages.clientId, eli.clientId), eq(schema.clientPackages.kind, 'credit_bundle')))
    assert.ok(classPass)
    const solo = await givePt(one, eli, '1on1')
    const pair = await givePt(one, pal, '2on1', { sessions: 1 })
    const partner = { kind: 'existing' as const, coClientId: pal.clientId }

    // PT-12: a 1on1 package cannot pay for a 2on1.
    await expectStatus(await submit(one, eli, { sessionType: '2on1', clientPackageId: solo, partner }), 400)
    // PT-13: one session left cannot pay for two.
    await expectStatus(
      await submit(one, pal, { sessionType: '2on1', clientPackageId: pair, partner: { kind: 'existing', coClientId: eli.clientId } }),
      409,
    )
    // PT-14: a class pass is not a PT package.
    await expectStatus(await submit(one, eli, { sessionType: '1on1', clientPackageId: classPass.id }), 400)
    // PT-16: no slot, or a slot that ends before it starts.
    await expectStatus(await submit(one, eli, { sessionType: '1on1', clientPackageId: solo, slots: [] }), 400)
    await expectStatus(
      await submit(one, eli, {
        sessionType: '1on1',
        clientPackageId: solo,
        slots: [{ proposedDate, startTime: '10:00', endTime: '09:00' }],
      }),
      400,
    )
    // PT-17: a 1on1 with a partner.
    await expectStatus(await submit(one, eli, { sessionType: '1on1', clientPackageId: solo, partner }), 400)

    assert.equal((await requestsOf(eli)).length, 0)
    assert.equal((await requestsOf(pal)).length, 0)
    assert.equal(await sessionsLeft(solo), 10)
    assert.equal(await sessionsLeft(pair), 1)
    assert.equal(await sessionsLeft(classPass.id), 10)
  })

  test('PT-17 a 2on1 with no partner is refused', async () => {
    const fin = await member(one, 'Fin Alone')
    const pair = await givePt(one, fin, '2on1')
    await expectStatus(await submit(one, fin, { sessionType: '2on1', clientPackageId: pair }), 400)
    assert.equal((await requestsOf(fin)).length, 0)
    assert.equal(await sessionsLeft(pair), 10)
  })

  test('PT-15 an expired PT package is refused and nothing is debited', async () => {
    const gia = await member(one, 'Gia Expired')
    const packageId = await givePt(one, gia, '1on1')
    await harness.db
      .update(schema.clientPackages)
      .set({ expiresAt: new Date(Date.now() - DAY) })
      .where(eq(schema.clientPackages.id, packageId))

    await expectStatus(await submit(one, gia, { sessionType: '1on1', clientPackageId: packageId }), 409)

    assert.equal((await requestsOf(gia)).length, 0)
    assert.equal(await sessionsLeft(packageId), 10)
  })

  test('PT-67 a Dormant PT package waits behind a running one, and with nothing running a request Activates it', async () => {
    const hal = await member(one, 'Hal Dormant')
    const first = await givePt(one, hal, '1on1')
    const second = await givePt(one, hal, '1on1')
    assert.equal((await pkg(first)).expiresAt, null, 'a purchase lands Dormant')

    const before = Date.now()
    await requestOk(one, hal, { sessionType: '1on1', clientPackageId: first })
    const activated = await pkg(first)
    assert.ok(activated.expiresAt, 'the first request Activates the package')
    const validity = activated.validityDays!
    assert.ok(Math.abs(activated.expiresAt.getTime() - (before + validity * DAY)) < 5 * MINUTE)

    const refused = await expectStatus(await submit(one, hal, { sessionType: '1on1', clientPackageId: second }), 409)
    assert.equal(refused.error, 'pt_package_not_current')
    assert.equal(await sessionsLeft(second), 10)
    assert.equal((await pkg(second)).expiresAt, null)
  })

  test('PT-18 two requests racing for the last session: exactly one wins, and the balance never goes below zero', async () => {
    const ivy = await member(one, 'Ivy Race')
    const packageId = await givePt(one, ivy, '1on1', { sessions: 1 })

    const results = await Promise.all([
      submit(one, ivy, { sessionType: '1on1', clientPackageId: packageId }),
      submit(one, ivy, { sessionType: '1on1', clientPackageId: packageId }),
    ])

    assert.deepEqual(results.map(r => r.status).sort(), [201, 409])
    assert.equal(await sessionsLeft(packageId), 0)
    assert.equal((await requestsOf(ivy)).length, 1)
  })

  test("PT-65 another member's package cannot pay for a request: not found, and their balance is untouched", async () => {
    const jo = await member(one, 'Jo Owner')
    const jay = await member(one, 'Jay Borrower')
    const theirs = await givePt(one, jo, '1on1')

    const refused = await expectStatus(await submit(one, jay, { sessionType: '1on1', clientPackageId: theirs }), 404)
    assert.equal(refused.error, 'client_package_not_found')
    assert.equal(await sessionsLeft(theirs), 10)
    assert.equal((await requestsOf(jay)).length, 0)
  })

  test('PT-19 a member lists only their own requests and sessions', async () => {
    const kai = await member(one, 'Kai Mine')
    const kit = await member(one, 'Kit Theirs')
    const kaiRequest = await requestOk(one, kai, { sessionType: '1on1', clientPackageId: await givePt(one, kai, '1on1') })
    const kitRequest = await requestOk(one, kit, { sessionType: '1on1', clientPackageId: await givePt(one, kit, '1on1') })
    await scheduled(kitRequest)

    const ids = (await myRequests(kai)).map(r => r.id)
    assert.deepEqual(ids, [kaiRequest])
    assert.deepEqual((await myRequests(kit)).map(r => r.id), [kitRequest])
  })

  // ── Admin queue and scheduling ───────────────────────────────────────────

  test('PT-21 the admin queue lists only the Location asked for', async () => {
    const lia = await member(one, 'Lia Queue')
    const packageId = await givePt(one, lia, '1on1')
    const [here, there] = one.places
    const atHere = await requestOk(one, lia, { sessionType: '1on1', clientPackageId: packageId, locationId: here!.locationId })
    const atThere = await requestOk(one, lia, { sessionType: '1on1', clientPackageId: packageId, locationId: there!.locationId })

    const listed = (await adminQueue(adminAtOne, `?location_id=${here!.locationId}`)).map(r => r.id)
    assert.ok(listed.includes(atHere))
    assert.ok(!listed.includes(atThere))
    const everywhere = (await adminQueue(adminAtOne)).map(r => r.id)
    assert.ok(everywhere.includes(atHere) && everywhere.includes(atThere))
  })

  test('PT-22, PT-24, PT-25, PT-27 scheduling a 1on1 creates the session and one booking, re-debits nothing, may move Location, and shows on both sides', async () => {
    const max = await member(one, 'Max Scheduled')
    const packageId = await givePt(one, max, '1on1')
    const [asked, other] = one.places
    const requestId = await requestOk(one, max, { sessionType: '1on1', clientPackageId: packageId, locationId: asked!.locationId })
    assert.equal(await sessionsLeft(packageId), 9)
    const startsAt = far()

    // The request names its Location for the schedule dialog; the admin may place it elsewhere.
    const detail = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}`, { headers: adminAtOne.headers }),
      200,
    )
    assert.equal(detail.pt_request.location.id, asked!.locationId)
    const sessionId = await scheduled(requestId, { startsAt, place: other })

    const session = await sessionRow(sessionId)
    assert.equal(session.lifecycle, 'active')
    assert.equal(session.ptRequestId, requestId)
    assert.equal(session.instructorId, coachA.staffId)
    assert.equal(session.locationId, other!.locationId)
    assert.equal(session.roomId, other!.roomId)
    assert.equal(session.startsAt.getTime(), startsAt.getTime())
    assert.equal(session.capacityOnline, 1)

    const request = await requestRow(requestId)
    assert.equal(request.status, 'scheduled')
    assert.equal(request.scheduledPtSessionId, sessionId)
    assert.equal(request.resolvedByStaffId, adminAtOne.staffId)
    assert.ok(request.resolvedAt)

    const bookings = await bookingsOn(sessionId)
    assert.equal(bookings.length, 1)
    assert.equal(bookings[0]!.clientId, max.clientId)
    assert.equal(bookings[0]!.state, 'confirmed')
    assert.ok(bookings[0]!.qrToken)
    assert.ok(bookings[0]!.code)
    assert.equal(await sessionsLeft(packageId), 9, 'scheduling does not debit again')

    // The portal schedule and the member's account both carry it.
    const window = `?from=${new Date(startsAt.getTime() - HOUR).toISOString()}&to=${new Date(startsAt.getTime() + 2 * HOUR).toISOString()}`
    const schedule = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/schedule${window}`, { headers: adminAtOne.headers }),
      200,
    )
    assert.ok(JSON.stringify(schedule).includes(sessionId), 'the portal schedule lists the PT session')
    const [mine] = await myRequests(max)
    assert.equal(mine.status, 'scheduled')
    assert.equal(new Date(mine.session.starts_at).getTime(), startsAt.getTime())
    assert.equal(mine.booking.code, bookings[0]!.code)
  })

  test('PT-23, PT-32 a 2on1 with a newcomer partner waits for their account; once linked, both are booked on a two-seat session', async () => {
    const ned = await member(one, 'Ned Host')
    const packageId = await givePt(one, ned, '2on1')
    const requestId = await requestOk(one, ned, {
      sessionType: '2on1',
      clientPackageId: packageId,
      partner: { kind: 'new', name: 'Noa Later', email: emailFor('noa-later-one') },
    })

    const refused = await expectStatus(await adminSchedule(one, adminAtOne, requestId), 422)
    assert.equal(refused.error, 'partner_account_required')
    assert.equal((await sessionsFor(requestId)).length, 0)
    assert.equal((await requestRow(requestId)).status, 'pending')

    // The partner joins the studio, and the admin links them.
    const noa = await member(one, 'Noa Later')
    const linked = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}/link-partner`, {
        method: 'POST',
        headers: { ...adminAtOne.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: noa.email }),
      }),
      200,
    )
    assert.equal(linked.pt_request.co_client.clientId, noa.clientId)

    const sessionId = await scheduled(requestId)
    const session = await sessionRow(sessionId)
    assert.equal(session.capacityOnline, 2)
    const attendees = await harness.db
      .select({ clientId: schema.ptSessionClients.clientId })
      .from(schema.ptSessionClients)
      .where(eq(schema.ptSessionClients.ptSessionId, sessionId))
    assert.deepEqual(attendees.map(a => a.clientId).sort(), [ned.clientId, noa.clientId].sort())
    const bookings = await bookingsOn(sessionId)
    assert.deepEqual(bookings.map(b => b.clientId).sort(), [ned.clientId, noa.clientId].sort())
    assert.ok(bookings.every(b => b.state === 'confirmed' && b.code))
    assert.equal(await sessionsLeft(packageId), 8)
  })

  test('PT-31 a request already scheduled or cancelled cannot be scheduled again', async () => {
    const oli = await member(one, 'Oli Twice')
    const packageId = await givePt(one, oli, '1on1')
    const done = await requestOk(one, oli, { sessionType: '1on1', clientPackageId: packageId })
    await scheduled(done)
    const gone = await requestOk(one, oli, { sessionType: '1on1', clientPackageId: packageId })
    await expectStatus(await memberCancel(oli, gone), 200)

    for (const requestId of [done, gone]) {
      const refused = await expectStatus(await adminSchedule(one, adminAtOne, requestId), 409)
      assert.equal(refused.error, 'not_pending')
    }
    assert.equal((await sessionsFor(done)).length, 1)
    assert.equal((await sessionsFor(gone)).length, 0)
  })

  test('PT-33, PT-34, PT-35 an instructor or room already taken, or a room at another Location, is refused and no session is made', async () => {
    const pia = await member(one, 'Pia Clash')
    const packageId = await givePt(one, pia, '1on1')
    const first = await requestOk(one, pia, { sessionType: '1on1', clientPackageId: packageId })
    const second = await requestOk(one, pia, { sessionType: '1on1', clientPackageId: packageId })
    const startsAt = far()
    await scheduled(first, { startsAt, instructor: coachA, place: one.places[0] })
    const overlapping = new Date(startsAt.getTime() + 30 * MINUTE)

    // PT-33: coach A is teaching then, in another room.
    const busy = await expectStatus(
      await adminSchedule(one, adminAtOne, second, { startsAt: overlapping, instructor: coachA, place: one.places[1] }),
      409,
    )
    assert.equal(busy.error, 'schedule_conflict')
    // PT-35: the room is taken then, whoever teaches.
    const taken = await expectStatus(
      await adminSchedule(one, adminAtOne, second, { startsAt: overlapping, instructor: coachB, place: one.places[0] }),
      409,
    )
    assert.equal(taken.error, 'schedule_conflict')
    // PT-33 again: coach B is teaching a class then, in another room.
    const classAt = far()
    await harness.db.insert(schema.classes).values({
      tenantId: one.id,
      classTypeId: one.classTypeId,
      mainInstructorId: coachB.staffId,
      locationId: one.places[0]!.locationId,
      roomId: one.places[0]!.roomId,
      startsAt: classAt,
      endsAt: new Date(classAt.getTime() + HOUR),
      capacityOnline: 10,
      creditCost: 1,
      createdByStaffId: coachB.staffId,
    })
    const teaching = await expectStatus(
      await adminSchedule(one, adminAtOne, second, {
        startsAt: new Date(classAt.getTime() + 30 * MINUTE),
        instructor: coachB,
        place: one.places[1],
      }),
      409,
    )
    assert.equal(teaching.error, 'schedule_conflict')
    // PT-34: a room from the other Location.
    const [here, there] = one.places
    const misplaced = await adminSchedule(one, adminAtOne, second, {
      instructor: coachB,
      place: { locationId: here!.locationId, roomId: there!.roomId },
    })
    assert.equal(misplaced.status, 400, await misplaced.clone().text())
    assert.equal(((await misplaced.json()) as any).error, 'room_location_mismatch')

    assert.equal((await sessionsFor(second)).length, 0)
    assert.equal((await requestRow(second)).status, 'pending')
  })

  test('PT-36 two schedules of one request racing: one session, one refusal', async () => {
    const quin = await member(one, 'Quin Race')
    const requestId = await requestOk(one, quin, { sessionType: '1on1', clientPackageId: await givePt(one, quin, '1on1') })

    const results = await Promise.all([
      adminSchedule(one, adminAtOne, requestId, { instructor: coachA, place: one.places[0] }),
      adminSchedule(one, adminAtOne, requestId, { instructor: coachB, place: one.places[1] }),
    ])
    const statuses = results.map(r => r.status).sort()

    assert.equal((await sessionsFor(requestId)).length, 1)
    assert.deepEqual(statuses, [201, 409], `statuses were ${statuses.join(', ')}`)
  })

  test('PT-30 there is no way to make a PT session without a PT request', async () => {
    const before = await harness.db.select({ n: sql<number>`count(*)::int` }).from(schema.ptSessions)
    const startsAt = far()
    const body = JSON.stringify({
      instructor_id: coachA.staffId,
      location_id: one.places[0]!.locationId,
      room_id: one.places[0]!.roomId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
      session_type: '1on1',
      instructor_pay_sgd: 60,
    })
    for (const path of ['/api/v1/portal/admin/schedule/pt', '/api/v1/portal/admin/pt-sessions']) {
      const res = await harness.app.request(path, {
        method: 'POST',
        headers: { ...adminAtOne.headers, 'Content-Type': 'application/json' },
        body,
      })
      assert.equal(res.status, 404, `${path} answered ${res.status}`)
    }
    const after = await harness.db.select({ n: sql<number>`count(*)::int` }).from(schema.ptSessions)
    assert.equal(after[0]!.n, before[0]!.n)
  })

  // ── Instructor queue and scheduling ──────────────────────────────────────

  test('PT-20, PT-28, PT-29 an instructor sees unbound and their own bound requests, schedules them as themselves, and is refused the rest', async () => {
    const rae = await member(one, 'Rae Open')
    const ray = await member(one, 'Ray Bound A')
    const rex = await member(one, 'Rex Bound B')
    const open = await requestOk(one, rae, { sessionType: '1on1', clientPackageId: await givePt(one, rae, '1on1') })
    const boundToA = await requestOk(one, ray, {
      sessionType: '1on1',
      clientPackageId: await givePt(one, ray, '1on1', { boundTo: coachA }),
    })
    const boundToB = await requestOk(one, rex, {
      sessionType: '1on1',
      clientPackageId: await givePt(one, rex, '1on1', { boundTo: coachB }),
    })

    const queue = (await instructorQueue(coachA)).map(r => r.id)
    assert.ok(queue.includes(open))
    assert.ok(queue.includes(boundToA))
    assert.ok(!queue.includes(boundToB))

    // PT-28: whoever the body names, the session is the acting instructor's.
    const res = await expectStatus(await instructorSchedule(one, coachA, open, { instructor_id: coachB.staffId }), 201)
    assert.equal((await sessionRow(res.pt_request.session.id)).instructorId, coachA.staffId)
    await expectStatus(await instructorSchedule(one, coachA, boundToA), 201)

    // PT-29: B's bound request, even named directly.
    const refused = await expectStatus(await instructorSchedule(one, coachA, boundToB), 403)
    assert.equal(refused.error, 'pt_request_bound_to_other_instructor')
    assert.equal((await sessionsFor(boundToB)).length, 0)
    assert.equal((await requestRow(boundToB)).status, 'pending')
  })

  test('PT-52 an instructor may cancel only a scheduled session they run', async () => {
    const sal = await member(one, 'Sal Coached')
    const packageId = await givePt(one, sal, '1on1')
    const theirs = await requestOk(one, sal, { sessionType: '1on1', clientPackageId: packageId })
    const sessionId = await scheduled(theirs, { instructor: coachB })
    const pending = await requestOk(one, sal, { sessionType: '1on1', clientPackageId: packageId })

    const refused = await expectStatus(await instructorCancel(coachA, theirs), 403)
    assert.equal(refused.error, 'not_your_session')
    assert.equal((await requestRow(theirs)).status, 'scheduled')
    assert.equal((await sessionRow(sessionId)).lifecycle, 'active')
    // Triage is the admin's: an instructor cannot cancel a pending request either.
    await expectStatus(await instructorCancel(coachA, pending), 403)
    assert.equal((await requestRow(pending)).status, 'pending')

    // Their own, they can — and the member gets the session back.
    const left = await sessionsLeft(packageId)
    await expectStatus(await instructorCancel(coachB, theirs), 200)
    assert.equal((await requestRow(theirs)).status, 'cancelled_after_scheduled')
    assert.equal((await sessionRow(sessionId)).lifecycle, 'cancelled')
    assert.equal(await sessionsLeft(packageId), left! + 1)
  })

  // ── Cancelling ───────────────────────────────────────────────────────────

  test('PT-37, PT-38, PT-50 a member cancels a pending request: the exact debit returns to its package, once', async () => {
    const tam = await member(one, 'Tam Pending')
    const tia = await member(one, 'Tia Pal')
    const solo = await givePt(one, tam, '1on1')
    const soloRequest = await requestOk(one, tam, { sessionType: '1on1', clientPackageId: solo })
    assert.equal(await sessionsLeft(solo), 9)

    const res = await expectStatus(await memberCancel(tam, soloRequest), 200)
    assert.equal(res.status, 'cancelled_before_scheduled')
    assert.equal((await requestRow(soloRequest)).status, 'cancelled_before_scheduled')
    assert.equal(await sessionsLeft(solo), 10)

    // PT-50: again is a no-op.
    const again = await expectStatus(await memberCancel(tam, soloRequest), 200)
    assert.equal(again.status, 'noop')
    assert.equal(await sessionsLeft(solo), 10)

    // PT-38: a 2on1 returns both.
    const pair = await givePt(one, tia, '2on1')
    const pairRequest = await requestOk(one, tia, {
      sessionType: '2on1',
      clientPackageId: pair,
      partner: { kind: 'existing', coClientId: tam.clientId },
    })
    assert.equal(await sessionsLeft(pair), 8)
    await expectStatus(await memberCancel(tia, pairRequest), 200)
    assert.equal(await sessionsLeft(pair), 10)
  })

  test('PT-39 an admin cancels a pending 2on1: cancelled before scheduling, full debit returned', async () => {
    const uma = await member(one, 'Uma Admin')
    const uri = await member(one, 'Uri Pal')
    const pair = await givePt(one, uma, '2on1')
    const requestId = await requestOk(one, uma, {
      sessionType: '2on1',
      clientPackageId: pair,
      partner: { kind: 'existing', coClientId: uri.clientId },
    })

    const res = await expectStatus(await adminCancel(adminAtOne, requestId), 200)

    assert.equal(res.pt_request.status, 'cancelled_before_scheduled')
    const row = await requestRow(requestId)
    assert.equal(row.status, 'cancelled_before_scheduled')
    assert.equal(row.resolvedByStaffId, adminAtOne.staffId)
    assert.equal(await sessionsLeft(pair), 10)
  })

  test('PT-40 a package the debit emptied is active again once the pending request is cancelled', async () => {
    const val = await member(one, 'Val Empty')
    const packageId = await givePt(one, val, '1on1', { sessions: 1 })
    const requestId = await requestOk(one, val, { sessionType: '1on1', clientPackageId: packageId })
    const emptied = await pkg(packageId)
    assert.equal(emptied.creditsOrSessionsRemaining, 0)
    assert.equal(emptied.active, false)

    await expectStatus(await memberCancel(val, requestId), 200)

    const back = await pkg(packageId)
    assert.equal(back.creditsOrSessionsRemaining, 1)
    assert.equal(back.active, true)
  })

  test('PT-41, PT-42, PT-47 a member cancels a scheduled 2on1 outside the window: both sessions back, everything cancelled, a cancellation recorded', async () => {
    const wes = await member(one, 'Wes Early')
    const wyn = await member(one, 'Wyn Pal')
    const pair = await givePt(one, wes, '2on1')
    const requestId = await requestOk(one, wes, {
      sessionType: '2on1',
      clientPackageId: pair,
      partner: { kind: 'existing', coClientId: wyn.clientId },
    })
    const sessionId = await scheduled(requestId)
    assert.equal(await sessionsLeft(pair), 8)

    const res = await expectStatus(await memberCancel(wes, requestId), 200)

    assert.equal(res.status, 'cancelled_after_scheduled')
    assert.equal(await sessionsLeft(pair), 10)
    assert.equal((await requestRow(requestId)).status, 'cancelled_after_scheduled')
    assert.equal((await sessionRow(sessionId)).lifecycle, 'cancelled')
    const bookings = await bookingsOn(sessionId)
    assert.equal(bookings.length, 2)
    assert.ok(bookings.every(b => b.state === 'cancelled'), "the partner's booking is cancelled too")
    assert.equal(bookings.find(b => b.clientId === wes.clientId)!.refundOutcome, 'session_returned')

    const [cancellation] = await cancellationsOf(wes)
    assert.ok(cancellation)
    assert.equal(cancellation.kind, 'pt')
    assert.equal(cancellation.source, 'client')
    assert.equal(cancellation.wasWithinWindow, true)
    assert.equal(cancellation.wasWithinCap, true)
    assert.equal(cancellation.refundFired, true)
  })

  test('PT-48 a member cannot cancel inside the PT window: refused, still scheduled, nothing returned', async () => {
    const xia = await member(one, 'Xia Late')
    const packageId = await givePt(one, xia, '1on1')
    const requestId = await requestOk(one, xia, { sessionType: '1on1', clientPackageId: packageId })
    const sessionId = await scheduled(requestId, { startsAt: near() })

    const refused = await expectStatus(await memberCancel(xia, requestId), 422)

    assert.equal(refused.error, 'cancellation_window_passed')
    assert.equal((await requestRow(requestId)).status, 'scheduled')
    assert.equal((await sessionRow(sessionId)).lifecycle, 'active')
    assert.equal(await sessionsLeft(packageId), 9)
    assert.equal((await cancellationsOf(xia)).length, 0)
  })

  test('PT-49 a member cannot cancel a session that has started', async () => {
    const yan = await member(one, 'Yan Started')
    const packageId = await givePt(one, yan, '1on1')
    const requestId = await requestOk(one, yan, { sessionType: '1on1', clientPackageId: packageId })
    const sessionId = await scheduled(requestId)
    // Time passes: it began ten minutes ago.
    await harness.db
      .update(schema.ptSessions)
      .set({ startsAt: new Date(Date.now() - 10 * MINUTE), endsAt: new Date(Date.now() + 50 * MINUTE) })
      .where(eq(schema.ptSessions.id, sessionId))

    await expectStatus(await memberCancel(yan, requestId), 422)

    assert.equal((await requestRow(requestId)).status, 'scheduled')
    assert.equal(await sessionsLeft(packageId), 9)
  })

  test('PT-45, PT-47 an admin cancels inside the window: the full amount returns, recorded as an admin cancellation', async () => {
    const zed = await member(one, 'Zed Admin Late')
    const zoe = await member(one, 'Zoe Pal')
    const pair = await givePt(one, zed, '2on1')
    const requestId = await requestOk(one, zed, {
      sessionType: '2on1',
      clientPackageId: pair,
      partner: { kind: 'existing', coClientId: zoe.clientId },
    })
    const sessionId = await scheduled(requestId, { startsAt: near() })

    const res = await expectStatus(await adminCancel(adminAtOne, requestId), 200)

    assert.equal(res.pt_request.status, 'cancelled_after_scheduled')
    assert.equal(await sessionsLeft(pair), 10)
    const session = await sessionRow(sessionId)
    assert.equal(session.lifecycle, 'cancelled')
    assert.equal(session.cancelledByStaffId, adminAtOne.staffId)
    const [cancellation] = await cancellationsOf(zed)
    assert.ok(cancellation)
    assert.equal(cancellation.source, 'admin')
    assert.equal(cancellation.refundFired, true)
  })

  test('PT-41, PT-43, PT-45, PT-46 the cap: admin cancels do not count, and past the cap a member cancel is forfeited', async () => {
    const abe = await member(one, 'Abe Capped')
    const packageId = await givePt(one, abe, '1on1')
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, one.id))
    assert.ok(policy)

    // An admin cancel first (PT-46): it must not use up any of the allowance.
    const byAdmin = await requestOk(one, abe, { sessionType: '1on1', clientPackageId: packageId })
    await scheduled(byAdmin)
    await expectStatus(await adminCancel(adminAtOne, byAdmin), 200)

    // Then the member's whole allowance, each returned (PT-41).
    for (let i = 0; i < policy.cancelCapCount; i++) {
      const requestId = await requestOk(one, abe, { sessionType: '1on1', clientPackageId: packageId })
      await scheduled(requestId)
      const res = await expectStatus(await memberCancel(abe, requestId), 200)
      assert.equal(res.refundOutcome, 'session_returned', `cancel ${i + 1} of ${policy.cancelCapCount} is within the cap`)
    }
    assert.equal(await sessionsLeft(packageId), 10)

    // PT-43: one more is cancelled, but forfeited.
    const overCap = await requestOk(one, abe, { sessionType: '1on1', clientPackageId: packageId })
    const sessionId = await scheduled(overCap)
    const res = await expectStatus(await memberCancel(abe, overCap), 200)

    assert.equal(res.status, 'cancelled_after_scheduled')
    assert.equal(res.refundOutcome, 'forfeited')
    assert.equal(await sessionsLeft(packageId), 9)
    assert.equal((await sessionRow(sessionId)).lifecycle, 'cancelled')
    const [booking] = await bookingsOn(sessionId)
    assert.equal(booking!.state, 'cancelled')
    assert.equal(booking!.refundOutcome, 'forfeited')
    const last = (await cancellationsOf(abe)).find(c => c.bookingId === booking!.id)
    assert.ok(last)
    assert.equal(last.wasWithinCap, false)
    assert.equal(last.refundFired, false)

    // PT-45: over the cap, an admin cancel still returns the session.
    const byAdminOverCap = await requestOk(one, abe, { sessionType: '1on1', clientPackageId: packageId })
    await scheduled(byAdminOverCap)
    assert.equal(await sessionsLeft(packageId), 8)
    await expectStatus(await adminCancel(adminAtOne, byAdminOverCap), 200)
    assert.equal(await sessionsLeft(packageId), 9)
  })

  test("PT-44 class cancellations share the cap: once they reach it, a PT cancel is forfeited", async () => {
    const bo = await member(one, 'Bo Shared Cap')
    await giveClassCredits(one, bo)
    const packageId = await givePt(one, bo, '1on1')
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, one.id))
    assert.ok(policy)

    for (let i = 0; i < policy.cancelCapCount; i++) {
      const startsAt = new Date(Date.now() + (20 + i) * DAY)
      const [klass] = await harness.db
        .insert(schema.classes)
        .values({
          tenantId: one.id,
          classTypeId: one.classTypeId,
          mainInstructorId: coachB.staffId,
          locationId: one.places[0]!.locationId,
          roomId: one.places[0]!.roomId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + HOUR),
          capacityOnline: 10,
          creditCost: 1,
          createdByStaffId: coachB.staffId,
        })
        .returning({ id: schema.classes.id })
      const booked = await expectStatus(
        await harness.app.request('/api/v1/me/bookings/class', {
          method: 'POST',
          headers: { ...bo.headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ class_id: klass!.id }),
        }),
        201,
      )
      await expectStatus(
        await harness.app.request(`/api/v1/me/bookings/${booked.booking_id}`, { method: 'DELETE', headers: bo.headers }),
        200,
      )
    }

    const requestId = await requestOk(one, bo, { sessionType: '1on1', clientPackageId: packageId })
    await scheduled(requestId)
    const res = await expectStatus(await memberCancel(bo, requestId), 200)

    assert.equal(res.refundOutcome, 'forfeited')
    assert.equal(await sessionsLeft(packageId), 9)
  })

  test('PT-51 a member cannot cancel another member’s request', async () => {
    const cal = await member(one, 'Cal Owner')
    const cat = await member(one, 'Cat Other')
    const packageId = await givePt(one, cal, '1on1')
    const requestId = await requestOk(one, cal, { sessionType: '1on1', clientPackageId: packageId })

    await expectStatus(await memberCancel(cat, requestId), 403)

    assert.equal((await requestRow(requestId)).status, 'pending')
    assert.equal(await sessionsLeft(packageId), 9)
  })

  test('PT-66 a PT booking cancelled on its own, then the request cancelled: the session is returned at most once', async () => {
    const dan = await member(one, 'Dan Double')
    const packageId = await givePt(one, dan, '1on1')
    const requestId = await requestOk(one, dan, { sessionType: '1on1', clientPackageId: packageId })
    const sessionId = await scheduled(requestId)
    const [booking] = await bookingsOn(sessionId)
    assert.equal(await sessionsLeft(packageId), 9)

    await expectStatus(
      await harness.app.request(`/api/v1/me/bookings/${booking!.id}`, { method: 'DELETE', headers: dan.headers }),
      200,
    )
    await expectStatus(await memberCancel(dan, requestId), 200)

    assert.equal(await sessionsLeft(packageId), 10, 'one session was debited, so at most one comes back')
    assert.equal((await requestRow(requestId)).status, 'cancelled_after_scheduled')
    assert.equal((await sessionRow(sessionId)).lifecycle, 'cancelled')

    // The same through the admin's two cancels.
    const again = await requestOk(one, dan, { sessionType: '1on1', clientPackageId: packageId })
    const againSession = await scheduled(again)
    const [againBooking] = await bookingsOn(againSession)
    assert.equal(await sessionsLeft(packageId), 9)
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/bookings/${againBooking!.id}/cancel`, {
        method: 'POST',
        headers: adminAtOne.headers,
      }),
      200,
    )
    await expectStatus(await adminCancel(adminAtOne, again), 200)

    assert.equal(await sessionsLeft(packageId), 10)
    assert.equal((await requestRow(again)).status, 'cancelled_after_scheduled')
    assert.equal((await sessionRow(againSession)).lifecycle, 'cancelled')
  })

  // ── Type change ──────────────────────────────────────────────────────────

  test('PT-57, PT-58, PT-59, PT-60 an admin switches a session between 1on1 and 2on1: the difference is debited or returned, and the partner joins or leaves', async () => {
    const eve = await member(one, 'Eve Upgrade')
    const ed = await member(one, 'Ed Partner')
    const packageId = await givePt(one, eve, '1on1')
    const requestId = await requestOk(one, eve, { sessionType: '1on1', clientPackageId: packageId })
    const sessionId = await scheduled(requestId)
    const patch = (body: object) =>
      harness.app.request(`/api/v1/portal/admin/pt-sessions/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { ...adminAtOne.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    assert.equal(await sessionsLeft(packageId), 9)

    const up = await expectStatus(await patch({ session_type: '2on1', co_client_id: ed.clientId }), 200)
    assert.equal(up.session_type, '2on1')
    assert.equal(await sessionsLeft(packageId), 8)
    const partnerBooking = (await bookingsOn(sessionId)).find(b => b.clientId === ed.clientId)
    assert.equal(partnerBooking?.state, 'confirmed')

    const down = await expectStatus(await patch({ session_type: '1on1' }), 200)
    assert.equal(down.session_type, '1on1')
    assert.equal(await sessionsLeft(packageId), 9)
    const attendees = await harness.db
      .select({ clientId: schema.ptSessionClients.clientId })
      .from(schema.ptSessionClients)
      .where(eq(schema.ptSessionClients.ptSessionId, sessionId))
    assert.deepEqual(attendees.map(a => a.clientId), [eve.clientId])
    const partnerAfter = (await bookingsOn(sessionId)).filter(b => b.clientId === ed.clientId)
    assert.ok(partnerAfter.every(b => b.state === 'cancelled'), 'the partner no longer shows as attending')
  })

  test('PT-61 an upgrade the package cannot cover is refused and changes nothing', async () => {
    const fox = await member(one, 'Fox Short')
    const fay = await member(one, 'Fay Partner')
    const packageId = await givePt(one, fox, '1on1', { sessions: 1 })
    const requestId = await requestOk(one, fox, { sessionType: '1on1', clientPackageId: packageId })
    const sessionId = await scheduled(requestId)
    assert.equal(await sessionsLeft(packageId), 0)

    const res = await harness.app.request(`/api/v1/portal/admin/pt-sessions/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { ...adminAtOne.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_type: '2on1', co_client_id: fay.clientId }),
    })
    const body = await expectStatus(res, 409)
    assert.equal(body.error, 'insufficient_credits')

    assert.equal(await sessionsLeft(packageId), 0)
    assert.equal((await sessionRow(sessionId)).sessionType, '1on1')
    assert.equal((await requestRow(requestId)).sessionType, '1on1')
    assert.deepEqual((await bookingsOn(sessionId)).map(b => b.clientId), [fox.clientId])
  })

  // ── Who may ──────────────────────────────────────────────────────────────

  test('a member, or a staff session on the member app, is refused the staff PT routes; an instructor is refused the admin ones', async () => {
    const gil = await member(one, 'Gil Roles')
    const requestId = await requestOk(one, gil, { sessionType: '1on1', clientPackageId: await givePt(one, gil, '1on1') })

    for (const path of ['/api/v1/portal/admin/pt-sessions', '/api/v1/portal/instructor/pt-requests']) {
      await expectStatus(await harness.app.request(path, { headers: gil.headers }), 401)
    }
    await expectStatus(await adminSchedule(one, gil as unknown as Staff, requestId), 401)
    await expectStatus(await adminCancel(gil as unknown as Staff, requestId), 401)

    await expectStatus(await harness.app.request('/api/v1/portal/admin/pt-sessions', { headers: coachA.headers }), 403)
    await expectStatus(await adminSchedule(one, coachA, requestId), 403)
    await expectStatus(await adminCancel(coachA, requestId), 403)

    // The rest of the admin surface: detail, partner link, session edit.
    const sessionPath = `/api/v1/portal/admin/pt-sessions/sessions/${requestId}`
    const partnerPath = `/api/v1/portal/admin/pt-sessions/${requestId}/link-partner`
    for (const [who, status] of [[gil.headers, 401], [coachA.headers, 403]] as const) {
      await expectStatus(
        await harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}`, { headers: who }),
        status,
      )
      await expectStatus(
        await harness.app.request(partnerPath, {
          method: 'POST',
          headers: { ...who, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: gil.email }),
        }),
        status,
      )
      await expectStatus(
        await harness.app.request(sessionPath, {
          method: 'PATCH',
          headers: { ...who, 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_type: '2on1' }),
        }),
        status,
      )
    }

    // A staff session is nobody on the member app.
    await expectStatus(await harness.app.request('/api/v1/me/pt-sessions', { headers: adminAtOne.headers }), 401)
    await expectStatus(
      await harness.app.request(`/api/v1/me/pt-sessions/partner-lookup?email=${encodeURIComponent(gil.email)}`, {
        headers: adminAtOne.headers,
      }),
      401,
    )
    await expectStatus(await memberCancel({ ...gil, headers: adminAtOne.headers }, requestId), 401)

    const row = await requestRow(requestId)
    assert.equal(row.status, 'pending')
    assert.equal((await sessionsFor(requestId)).length, 0)
  })

  test("TEN-07 another studio's staff and members reach none of this studio's PT requests", async () => {
    const hua = await member(one, 'Hua Home')
    const hex = await member(two, 'Hex Away')
    const coachAtTwo = await staff(two, 'coach-two', 'instructor')
    const packageId = await givePt(one, hua, '1on1')
    const requestId = await requestOk(one, hua, { sessionType: '1on1', clientPackageId: packageId })
    const booked = await requestOk(one, hua, { sessionType: '1on1', clientPackageId: packageId })
    const sessionId = await scheduled(booked)

    // Studio two's instructor: not in their queue, not theirs to schedule or cancel.
    assert.ok(!(await instructorQueue(coachAtTwo)).some(r => r.id === requestId))
    await expectStatus(await instructorSchedule(two, coachAtTwo, requestId), 404)
    await expectStatus(await instructorCancel(coachAtTwo, booked), 404)

    // Studio two's admin cannot link a partner to it, or edit its session.
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}/link-partner`, {
        method: 'POST',
        headers: { ...adminAtTwo.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: hex.clientId }),
      }),
      404,
    )
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/pt-sessions/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { ...adminAtTwo.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ starts_at: far().toISOString() }),
      }),
      404,
    )
    const session = await sessionRow(sessionId)
    assert.equal(session.lifecycle, 'active')
    assert.equal((await requestRow(booked)).status, 'scheduled')
    assert.equal((await requestRow(requestId)).coClientId, null)

    // Studio two's admin: not listed, not found, not schedulable, not cancellable.
    assert.ok(!(await adminQueue(adminAtTwo, '?status=all')).some(r => r.id === requestId))
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}`, { headers: adminAtTwo.headers }),
      404,
    )
    await expectStatus(await adminSchedule(two, adminAtTwo, requestId, { instructor: adminAtTwo }), 404)
    await expectStatus(await adminCancel(adminAtTwo, requestId), 404)

    // Studio two's member: cannot cancel it, cannot spend the package.
    await expectStatus(await memberCancel(hex, requestId), 404)
    await expectStatus(await submit(two, hex, { sessionType: '1on1', clientPackageId: packageId }), 404)
    assert.ok(!(await myRequests(hex)).some(r => r.id === requestId))

    // Studio two's session carried to studio one's hostname is refused outright.
    const hexAtOne = {
      ...hex,
      headers: { ...hex.headers, 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('client', one) },
    }
    await expectStatus(await memberCancel(hexAtOne, requestId), 403)
    const adminTwoAtOne = {
      ...adminAtTwo,
      headers: { ...adminAtTwo.headers, 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('staff', one) },
    }
    await expectStatus(await adminCancel(adminTwoAtOne, requestId), 403)

    assert.equal((await requestRow(requestId)).status, 'pending')
    assert.equal((await sessionsFor(requestId)).length, 0)
    assert.equal((await sessionRow(sessionId)).startsAt.getTime(), session.startsAt.getTime())
    assert.equal(await sessionsLeft(packageId), 8)
  })
})
