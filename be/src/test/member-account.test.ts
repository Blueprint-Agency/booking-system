import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.account.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Account class type ${run}`
const BUNDLE_NAME = `Account pass ${run}`
const PLAN_NAME = `Account plan ${run}`
const PT_PACKAGE_NAME = `Account PT ${run}`
const WORKSHOP_NAME = `Account workshop ${run}`
const CORPORATE_NAME = `Account corporate ${run}`
const MERCH_TITLE = `Account tote ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The member's account pages over real HTTP (#206): what `/account` and its
 * sub-pages read — packages, profile, My Classes, My Workshops, My Private
 * Sessions, My Corporate, My Merch and unfinished purchases.
 *
 * Every read is checked three ways: the member sees their own rows with the
 * fields the page renders; a staff session is nobody on the member app; and
 * another studio's member — signed in at their own studio or carrying that
 * session to this one — sees none of it. Fixtures are written directly where
 * which rows a person holds is the test's to state, and driven through the
 * real routes where the state is what a flow leaves behind (a PT request that
 * was scheduled, then cancelled).
 */
describe('member account over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let ptPackagesSvc!: typeof import('../services/packages/pt-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    bundleId: string
    planId: string
    pt: { '1on1': string; '2on1': string }
  }
  type Staff = { staffId: string; headers: Record<string, string> }
  type Member = { clientId: string; email: string; headers: Record<string, string> }
  type Reply = { status: number; body: any }

  let one!: Studio
  let two!: Studio
  let adminAtOne!: Staff
  let teacherAtOne!: Staff

  const emailFor = (name: string) => `${name.toLowerCase().replace(/\s+/g, '-')}@${DOMAIN}`

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
    const bundle = await classPackagesSvc.createClassPackage(tenant.id, {
      name: BUNDLE_NAME,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    const plan = await classPackagesSvc.createClassPackage(tenant.id, {
      name: PLAN_NAME,
      kind: 'unlimited',
      durationMonths: 1,
      priceSgd: '300.00',
    })
    const ptPackage = (sessionType: '1on1' | '2on1') =>
      ptPackagesSvc.createPtPackage(tenant.id, {
        name: `${PT_PACKAGE_NAME} ${sessionType}`,
        sessionType,
        numSessions: 5,
        validityDays: 60,
        priceSgd: '500.00',
      })
    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      classTypeId: classType.id,
      bundleId: bundle.id,
      planId: plan.id,
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
    return { clientId: client!.id, email, headers }
  }

  /**
   * A package granted as the checkout webhook grants one, then Activated to end
   * at `expiresAt` — or left Dormant, as every purchase lands, when it is null.
   */
  async function hold(
    at: Studio,
    who: Member,
    item: 'bundle' | 'plan' | '1on1' | '2on1',
    expiresAt: Date | null,
  ): Promise<string> {
    const { clientPackageId } = await purchaseSvc.grantPackage(at.id, {
      clientId: who.clientId,
      purchaseId: null,
      amountSgd: '100.00',
      packageKind: item === 'bundle' || item === 'plan' ? 'class' : 'pt',
      packageId: item === 'bundle' ? at.bundleId : item === 'plan' ? at.planId : at.pt[item],
      ...(item === 'plan' ? { locationId: at.locationId } : {}),
    })
    if (expiresAt) {
      await harness.db
        .update(schema.clientPackages)
        .set({ expiresAt })
        .where(eq(schema.clientPackages.id, clientPackageId))
    }
    return clientPackageId
  }

  async function addClass(at: Studio, startsIn: number): Promise<string> {
    const startsAt = new Date(Date.now() + startsIn)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: teacherAtOne.staffId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: teacherAtOne.staffId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /** A class booking in whatever end state the test names. */
  async function classBooking(
    at: Studio,
    who: Member,
    classId: string,
    end: { state: 'confirmed' | 'cancelled' | 'no_show'; checkIn: 'pending' | 'attended' | 'no_show' | 'n_a' },
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'class',
        classId,
        creditsOrSessionsUsed: 1,
        state: end.state,
        checkInState: end.checkIn,
        ...(end.state === 'cancelled' ? { refundOutcome: 'credit_returned' as const, cancelledAt: new Date() } : {}),
        qrToken: `account-${randomUUID()}`,
        code: `AC-${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning({ id: schema.bookings.id })
    return row!.id
  }

  /** A one-tier workshop whose days run from `startsIn` for `days` days. */
  async function addWorkshop(at: Studio, startsIn: number, days = 1) {
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: at.id, name: WORKSHOP_NAME, locationId: at.locationId, createdByStaffId: adminAtOne.staffId })
      .returning({ id: schema.workshops.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: at.id, workshopId: workshop!.id, name: 'Full', regularPriceSgd: '120.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    const first = new Date(Date.now() + startsIn)
    for (let d = 0; d < days; d++) {
      const startsAt = new Date(first.getTime() + d * DAY)
      const [day] = await harness.db
        .insert(schema.workshopDays)
        .values({
          tenantId: at.id,
          workshopId: workshop!.id,
          ord: d + 1,
          roomId: at.roomId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * HOUR),
          basePriceSgd: '120.00',
          capacityOnline: 10,
        })
        .returning({ id: schema.workshopDays.id })
      await harness.db
        .insert(schema.workshopTierDays)
        .values({ tenantId: at.id, workshopTierId: tier!.id, workshopDayId: day!.id })
    }
    return {
      workshopId: workshop!.id,
      tierId: tier!.id,
      startsAt: first,
      endsAt: new Date(first.getTime() + (days - 1) * DAY + 2 * HOUR),
    }
  }

  async function workshopBooking(
    at: Studio,
    who: Member,
    w: { workshopId: string; tierId: string },
    state: 'confirmed' | 'cancelled' = 'confirmed',
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'workshop',
        workshopId: w.workshopId,
        workshopTierId: w.tierId,
        creditsOrSessionsUsed: 0,
        listPriceSgd: '120.00',
        amountPaidSgd: '120.00',
        state,
        ...(state === 'cancelled'
          ? { cancelledAt: new Date(), checkInState: 'n_a' as const, refundOutcome: 'stripe_refunded' as const }
          : {}),
        qrToken: `account-ws-${randomUUID()}`,
        code: `AW-${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning({ id: schema.bookings.id })
    return row!.id
  }

  async function reply(res: Response): Promise<Reply> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const get = async (path: string, headers: Record<string, string>) =>
    reply(await harness.app.request(`/api/v1${path}`, { headers }))

  const send = async (path: string, headers: Record<string, string>, method: string, body?: unknown) =>
    reply(
      await harness.app.request(`/api/v1${path}`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )

  const ok = async (p: Promise<Reply>, status = 200) => {
    const res = await p
    assert.equal(res.status, status, JSON.stringify(res.body))
    return res.body
  }

  // ── PT requests, driven through the real flow ─────────────────────────────

  let slot = 0
  const proposedDate = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10)

  async function ptRequest(at: Studio, who: Member, sessionType: '1on1' | '2on1', packageId: string): Promise<string> {
    const body = await ok(
      send('/me/pt-sessions/request', who.headers, 'POST', {
        classTypeId: at.classTypeId,
        locationId: at.locationId,
        sessionType,
        clientPackageId: packageId,
        slots: [{ proposedDate, startTime: '09:00', endTime: '10:00' }],
      }),
      201,
    )
    return body.pt_request_id as string
  }

  async function schedulePt(requestId: string): Promise<Date> {
    const startsAt = new Date(Date.now() + 4 * DAY + slot++ * 2 * HOUR)
    await ok(
      send(`/portal/admin/pt-sessions/${requestId}/schedule`, adminAtOne.headers, 'POST', {
        location_id: one.locationId,
        room_id: one.roomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        instructor_id: teacherAtOne.staffId,
        instructor_pay_sgd: 60,
      }),
      201,
    )
    return startsAt
  }

  // ── The member routes this file covers, for the refusal sweeps ───────────

  const MEMBER_READS = [
    '/me',
    '/me/packages',
    '/me/bookings/upcoming',
    '/me/bookings/past',
    '/me/workshop-bookings',
    '/me/pt-sessions',
    '/me/corporate-requests',
    '/me/merch-orders',
    '/me/purchases/open',
  ]

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    adminAtOne = await staff(one, 'owner', 'admin')
    teacherAtOne = await staff(one, 'teacher', 'instructor')
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
    const sessions = sql`SELECT id FROM pt_sessions WHERE pt_request_id IN (${requests})`
    const corporate = sql`SELECT id FROM corporate_requests WHERE client_id IN (${clients})`
    const q = (query: ReturnType<typeof sql>) => harness.db.execute(query)
    await q(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await q(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await q(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await q(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${requests})`)
    await q(sql`UPDATE corporate_requests SET scheduled_corporate_session_id = NULL WHERE id IN (${corporate})`)
    await q(sql`DELETE FROM corporate_session_supporting_instructors WHERE corporate_session_id IN (SELECT id FROM corporate_sessions WHERE corporate_request_id IN (${corporate}))`)
    await q(sql`DELETE FROM corporate_sessions WHERE corporate_request_id IN (${corporate})`)
    await q(sql`DELETE FROM corporate_requests WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${sessions})`)
    await q(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (${sessions})`)
    await q(sql`DELETE FROM pt_sessions WHERE id IN (${sessions})`)
    await q(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
    await q(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM merch_orders WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM merch WHERE title LIKE ${`${MERCH_TITLE}%`}`)
    await q(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await q(sql`DELETE FROM corporate_packages WHERE name = ${CORPORATE_NAME}`)
    await q(sql`DELETE FROM class_packages WHERE name IN (${BUNDLE_NAME}, ${PLAN_NAME})`)
    await q(sql`DELETE FROM pt_packages WHERE name LIKE ${`${PT_PACKAGE_NAME}%`}`)
    await q(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
    await q(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME}))`)
    await q(sql`DELETE FROM workshop_days WHERE workshop_id IN (SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME})`)
    await q(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME})`)
    await q(sql`DELETE FROM workshops WHERE name = ${WORKSHOP_NAME}`)
    await q(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await q(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await q(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await q(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await q(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await q(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  // ── Packages ─────────────────────────────────────────────────────────────

  test('ACC-01 /account shows bundle credits, the Unlimited plan and PT sessions per format, each with its expiry', async () => {
    const ana = await member(one, 'Ana Packages')
    const planEnds = new Date(Date.now() + 20 * DAY)
    const oneOnOneEnds = new Date(Date.now() + 40 * DAY)
    const plan = await hold(one, ana, 'plan', planEnds)
    // One package per family runs at a time, so the bundle and the 2on1 pack
    // wait Dormant: their expiry is the validity they run for once started.
    const bundle = await hold(one, ana, 'bundle', null)
    const pt1 = await hold(one, ana, '1on1', oneOnOneEnds)
    const pt2 = await hold(one, ana, '2on1', null)

    const body = await ok(get('/me/packages', ana.headers))
    const byId = new Map<string, any>(body.client_packages.map((p: any) => [p.id, p]))
    assert.equal(byId.size, 4, 'exactly the four packages she holds')

    const b = byId.get(bundle)
    assert.equal(b.kind, 'credit_bundle')
    assert.equal(b.package_name, BUNDLE_NAME)
    assert.equal(b.credits_or_sessions_remaining, 10)
    assert.equal(b.dormant, true)
    assert.equal(b.expires_at, null)
    assert.equal(b.validity_days, 90)

    const u = byId.get(plan)
    assert.equal(u.kind, 'unlimited')
    assert.equal(u.unlimited_location.id, one.locationId)
    assert.equal(new Date(u.expires_at).getTime(), planEnds.getTime())

    const p1 = byId.get(pt1)
    assert.equal(p1.kind, 'pt')
    assert.equal(p1.session_type, '1on1')
    assert.equal(p1.credits_or_sessions_remaining, 5)
    assert.equal(new Date(p1.expires_at).getTime(), oneOnOneEnds.getTime())

    const p2 = byId.get(pt2)
    assert.equal(p2.session_type, '2on1')
    assert.equal(p2.credits_or_sessions_remaining, 5)
    assert.equal(p2.dormant, true)
    assert.equal(p2.expires_at, null)
    assert.equal(p2.validity_days, 60)

    assert.equal(body.entitlements.has_active_unlimited, true)
    assert.equal(body.entitlements.pt_1on1_remaining, 5)

    // Another member at the same studio holds nothing of hers.
    const ben = await member(one, 'Ben Packages')
    assert.deepEqual((await ok(get('/me/packages', ben.headers))).client_packages, [])
  })

  // ── Profile ──────────────────────────────────────────────────────────────

  test('ACC-07, ACC-08 the profile shows the member, saves a new name and phone, and never changes the email', async () => {
    const cleo = await member(one, 'Cleo Profile')

    const shown = await ok(get('/me', cleo.headers))
    assert.equal(shown.id, cleo.clientId)
    assert.equal(shown.email, cleo.email)
    assert.equal(shown.name, 'Cleo Profile')

    const saved = await ok(
      send('/me', cleo.headers, 'PATCH', { name: 'Cleo Renamed', phone: '+6591112222', email: emailFor('elsewhere') }),
    )
    assert.equal(saved.name, 'Cleo Renamed')
    assert.equal(saved.phone, '+6591112222')
    assert.equal(saved.email, cleo.email, 'the email in the body is ignored')

    // An email on its own is not an edit the profile accepts at all.
    const refused = await send('/me', cleo.headers, 'PATCH', { email: emailFor('elsewhere') })
    assert.equal(refused.status, 400, JSON.stringify(refused.body))

    const [row] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, cleo.clientId))
    assert.equal(row!.name, 'Cleo Renamed')
    assert.equal(row!.phone, '+6591112222')
    assert.equal(row!.email, cleo.email)
  })

  // ── My Classes ───────────────────────────────────────────────────────────

  test('ACC-03 the Past tab gives each finished class its outcome: attended, no-show and cancelled', async () => {
    const dev = await member(one, 'Dev Classes')
    const eve = await member(one, 'Eve Classes')
    const attended = await classBooking(one, dev, await addClass(one, -3 * DAY), { state: 'confirmed', checkIn: 'attended' })
    const noShow = await classBooking(one, dev, await addClass(one, -2 * DAY), { state: 'no_show', checkIn: 'no_show' })
    const cancelled = await classBooking(one, dev, await addClass(one, -1 * DAY), { state: 'cancelled', checkIn: 'n_a' })
    const upcoming = await classBooking(one, dev, await addClass(one, 2 * DAY), { state: 'confirmed', checkIn: 'pending' })
    // Someone else's finished class, at the same studio.
    await classBooking(one, eve, await addClass(one, -1 * DAY), { state: 'confirmed', checkIn: 'attended' })

    const past = (await ok(get('/me/bookings/past', dev.headers))).bookings as any[]
    assert.deepEqual(
      past.map(b => b.booking_id),
      [cancelled, noShow, attended],
      'her three finished classes, most recent first, and nobody else’s',
    )
    const outcome = (b: any) => ({ state: b.state, check_in_state: b.check_in_state })
    assert.deepEqual(outcome(past[0]), { state: 'cancelled', check_in_state: 'n_a' })
    assert.deepEqual(outcome(past[1]), { state: 'no_show', check_in_state: 'no_show' })
    assert.deepEqual(outcome(past[2]), { state: 'confirmed', check_in_state: 'attended' })

    const next = (await ok(get('/me/bookings/upcoming', dev.headers))).bookings as any[]
    assert.deepEqual(next.map(b => b.booking_id), [upcoming])
    assert.ok(next[0].qr_token && next[0].code, 'an upcoming class carries its QR token and code')
  })

  // ── My Workshops ─────────────────────────────────────────────────────────

  test('ACC-04 /account/workshops: each booking carries its dates, so upcoming and past list apart, and a cancelled one says so', async () => {
    const fay = await member(one, 'Fay Workshops')
    const gus = await member(one, 'Gus Workshops')
    const past = await addWorkshop(one, -10 * DAY, 2)
    const soon = await addWorkshop(one, 7 * DAY)
    const dropped = await addWorkshop(one, -5 * DAY)
    const pastBooking = await workshopBooking(one, fay, past)
    const soonBooking = await workshopBooking(one, fay, soon)
    const droppedBooking = await workshopBooking(one, fay, dropped, 'cancelled')
    await workshopBooking(one, gus, soon)

    const rows = (await ok(get('/me/workshop-bookings', fay.headers))).workshop_bookings as any[]
    const byId = new Map<string, any>(rows.map(r => [r.id, r]))
    assert.deepEqual([...byId.keys()].sort(), [pastBooking, soonBooking, droppedBooking].sort(), 'hers only')

    const when = (r: any) => [new Date(r.starts_at).getTime(), new Date(r.ends_at).getTime()]
    assert.deepEqual(when(byId.get(pastBooking)), [past.startsAt.getTime(), past.endsAt.getTime()], 'a two-day workshop spans both days')
    assert.deepEqual(when(byId.get(soonBooking)), [soon.startsAt.getTime(), soon.endsAt.getTime()])
    assert.ok(new Date(byId.get(pastBooking).ends_at).getTime() < Date.now(), 'the finished one reads as past')
    assert.ok(new Date(byId.get(soonBooking).starts_at).getTime() > Date.now(), 'the coming one reads as upcoming')
    assert.equal(byId.get(soonBooking).state, 'confirmed')
    assert.equal(byId.get(droppedBooking).state, 'cancelled')
    assert.ok(byId.get(droppedBooking).cancelled_at)
    assert.equal(byId.get(droppedBooking).refund_outcome, 'stripe_refunded', 'a cancelled past workshop says it was refunded')
    assert.equal(byId.get(soonBooking).refund_outcome, 'n_a')
    assert.equal(byId.get(soonBooking).location.id, one.locationId)
    assert.equal(byId.get(soonBooking).amount_paid_sgd, '120.00')
  })

  // ── My Private Sessions ──────────────────────────────────────────────────

  test('ACC-05, ACC-06 /account/private-sessions returns every state, and a cancelled request says whether its sessions came back', async () => {
    const hal = await member(one, 'Hal Private')
    const packageId = await hold(one, hal, '1on1', new Date(Date.now() + 60 * DAY))

    const pending = await ptRequest(one, hal, '1on1', packageId)
    const scheduled = await ptRequest(one, hal, '1on1', packageId)
    const scheduledAt = await schedulePt(scheduled)
    const attended = await ptRequest(one, hal, '1on1', packageId)
    await schedulePt(attended)
    const withdrawn = await ptRequest(one, hal, '1on1', packageId)
    const withdrawnReply = await ok(send(`/me/pt-sessions/${withdrawn}/cancel`, hal.headers, 'POST'))
    const dropped = await ptRequest(one, hal, '1on1', packageId)
    await schedulePt(dropped)
    const droppedReply = await ok(send(`/me/pt-sessions/${dropped}/cancel`, hal.headers, 'POST'))

    // Attendance is recorded at the front desk; the request mirrors it.
    const [attendedRow] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, attended))
    await harness.db.update(schema.ptRequests).set({ status: 'attended' }).where(eq(schema.ptRequests.id, attended))
    await harness.db
      .update(schema.bookings)
      .set({ checkInState: 'attended' })
      .where(eq(schema.bookings.ptSessionId, attendedRow!.scheduledPtSessionId!))

    const rows = (await ok(get('/me/pt-sessions', hal.headers))).pt_requests as any[]
    const byId = new Map<string, any>(rows.map(r => [r.id, r]))
    assert.equal(byId.size, 5)

    // Pending: the proposed slots, nothing scheduled, nothing refunded.
    assert.equal(byId.get(pending).status, 'pending')
    assert.deepEqual(byId.get(pending).slots, [{ proposed_date: proposedDate, start_time: '09:00:00', end_time: '10:00:00' }])
    assert.equal(byId.get(pending).session, null)
    assert.equal(byId.get(pending).refund_outcome, null)

    // Confirmed: the final time, instructor and the QR for the door.
    const confirmed = byId.get(scheduled)
    assert.equal(confirmed.status, 'scheduled')
    assert.equal(new Date(confirmed.session.starts_at).getTime(), scheduledAt.getTime())
    assert.equal(confirmed.session.instructor_name, 'teacher')
    assert.ok(confirmed.booking.qr_token && confirmed.booking.code)
    assert.equal(confirmed.refund_outcome, null)

    // Past: the check-in outcome.
    assert.equal(byId.get(attended).status, 'attended')
    assert.equal(byId.get(attended).booking.check_in_state, 'attended')

    // Cancelled, both ways, each saying whether the session came back.
    assert.equal(byId.get(withdrawn).status, 'cancelled_before_scheduled')
    assert.equal(byId.get(withdrawn).refund_outcome, 'session_returned')
    assert.equal(withdrawnReply.status, 'cancelled_before_scheduled')
    assert.equal(byId.get(dropped).status, 'cancelled_after_scheduled')
    assert.ok(byId.get(dropped).refund_outcome, 'a cancelled request always states its outcome')
    assert.equal(byId.get(dropped).refund_outcome, droppedReply.refundOutcome, 'the outcome the cancel reported')
  })

  // ── My Corporate ─────────────────────────────────────────────────────────

  test('CORP-04 /account/corporate shows each request’s status, and a scheduled one its date, Location and instructor', async () => {
    const ida = await member(one, 'Ida Corporate')
    const [pkg] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: one.id, name: CORPORATE_NAME, priceSgd: '800.00', createdByStaffId: adminAtOne.staffId })
      .returning({ id: schema.corporatePackages.id })
    const request = async () =>
      (await ok(send('/me/corporate-requests', ida.headers, 'POST', { package_id: pkg!.id }), 201)).corporate_request_id as string
    const schedule = (id: string, startsAt: Date) =>
      ok(
        send(`/portal/admin/corporate-requests/${id}/schedule`, adminAtOne.headers, 'POST', {
          main_instructor_id: teacherAtOne.staffId,
          location_id: one.locationId,
          starts_at: startsAt.toISOString(),
          ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        }),
        201,
      )

    const pending = await request()
    const scheduled = await request()
    const scheduledAt = new Date(Date.now() + 10 * DAY)
    await schedule(scheduled, scheduledAt)
    const done = await request()
    await schedule(done, new Date(Date.now() + 11 * DAY))
    await ok(send(`/portal/admin/corporate-requests/${done}/attended`, adminAtOne.headers, 'POST'))
    const calledOff = await request()
    await ok(send(`/portal/admin/corporate-requests/${calledOff}/cancel`, adminAtOne.headers, 'POST'))

    const rows = (await ok(get('/me/corporate-requests', ida.headers))).corporate_requests as any[]
    const byId = new Map<string, any>(rows.map(r => [r.id, r]))
    assert.equal(byId.size, 4)
    assert.equal(byId.get(pending).status, 'pending')
    assert.equal(byId.get(pending).session, null)
    assert.equal(byId.get(scheduled).status, 'scheduled')
    assert.equal(new Date(byId.get(scheduled).session.starts_at).getTime(), scheduledAt.getTime())
    assert.ok(byId.get(scheduled).session.location_name, 'names the Location')
    assert.equal(byId.get(scheduled).session.instructor_name, 'teacher')
    assert.equal(byId.get(done).status, 'attended')
    assert.equal(byId.get(calledOff).status, 'cancelled')
    assert.equal(byId.get(pending).package.name, CORPORATE_NAME)
  })

  // ── My Merch ─────────────────────────────────────────────────────────────

  test('MRC-05 /account/merch keeps the title and amount paid at purchase after the item is renamed and repriced, newest first', async () => {
    const jo = await member(one, 'Jo Merch')
    const [item] = await harness.db
      .insert(schema.merch)
      .values({ tenantId: one.id, title: MERCH_TITLE, priceSgd: '25.00' })
      .returning({ id: schema.merch.id })
    const [older] = await harness.db
      .insert(schema.merchOrders)
      .values({
        tenantId: one.id,
        clientId: jo.clientId,
        merchId: item!.id,
        title: MERCH_TITLE,
        amountSgd: '25.00',
        createdAt: new Date(Date.now() - 5 * DAY),
      })
      .returning({ id: schema.merchOrders.id })
    const [newer] = await harness.db
      .insert(schema.merchOrders)
      .values({ tenantId: one.id, clientId: jo.clientId, merchId: item!.id, title: MERCH_TITLE, amountSgd: '20.00' })
      .returning({ id: schema.merchOrders.id })

    await harness.db
      .update(schema.merch)
      .set({ title: `${MERCH_TITLE} renamed`, priceSgd: '99.00' })
      .where(eq(schema.merch.id, item!.id))

    const orders = (await ok(get('/me/merch-orders', jo.headers))).orders as any[]
    assert.deepEqual(orders.map(o => o.id), [newer!.id, older!.id])
    assert.deepEqual(
      orders.map(o => [o.title, o.amount_sgd]),
      [
        [MERCH_TITLE, '20.00'],
        [MERCH_TITLE, '25.00'],
      ],
    )
  })

  // ── Unfinished purchases ─────────────────────────────────────────────────

  test('ACC-11 unfinished purchases list only the member’s own part-paid ones, with what is still owed', async () => {
    const kit = await member(one, 'Kit Owes')
    const lee = await member(one, 'Lee Owes')

    const purchase = async (who: Member, paid: string | null) => {
      const [row] = await harness.db
        .insert(schema.purchases)
        .values({
          tenantId: one.id,
          clientId: who.clientId,
          kind: 'class_package',
          totalSgd: '200.00',
          amountPaidSgd: paid ?? '0.00',
          metadata: { item_name: BUNDLE_NAME },
          ...(paid ? { partPaidAt: new Date() } : {}),
        })
        .returning({ id: schema.purchases.id })
      if (paid) {
        await harness.db.insert(schema.stripePayments).values({
          tenantId: one.id,
          paymentIntentId: `pi_account_${randomUUID().slice(0, 12)}`,
          purchaseId: row!.id,
          amountSgd: paid,
          kind: 'class_package',
          clientId: who.clientId,
          status: 'succeeded',
        })
      }
      return row!.id
    }

    const partPaid = await purchase(kit, '50.00')
    await purchase(kit, null) // opened at the payment page and closed: owes nothing
    await purchase(lee, '80.00')

    const open = (await ok(get('/me/purchases/open', kit.headers))).purchases as any[]
    assert.deepEqual(open.map(p => p.id), [partPaid])
    assert.equal(open[0].item_name, BUNDLE_NAME)
    assert.equal(open[0].total_sgd, '200.00')
    assert.equal(open[0].paid_sgd, '50.00')
    assert.equal(open[0].outstanding_sgd, '150.00')

    // She cannot pay towards someone else's either.
    const [leeRow] = await harness.db.select().from(schema.purchases).where(eq(schema.purchases.clientId, lee.clientId))
    const resume = await send(`/me/purchases/${leeRow!.id}/resume`, kit.headers, 'POST', {})
    assert.equal(resume.status, 403, JSON.stringify(resume.body))
    assert.equal(resume.body.error, 'not_your_purchase')
    const [untouched] = await harness.db.select().from(schema.purchases).where(eq(schema.purchases.id, leeRow!.id))
    assert.equal(untouched!.checkoutSessionId, null, 'no payment session was opened on it')
  })

  // ── Refusals ─────────────────────────────────────────────────────────────

  test('ACC-12 a staff session or no session reads none of the member account pages', async () => {
    const signedOut = { 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('client', one) }
    for (const path of MEMBER_READS) {
      assert.equal((await get(path, signedOut)).status, 401, `${path}, signed out`)
      assert.equal((await get(path, adminAtOne.headers)).status, 401, `${path}, as an admin`)
      assert.equal((await get(path, teacherAtOne.headers)).status, 401, `${path}, as an instructor`)
    }
    for (const headers of [signedOut, adminAtOne.headers, teacherAtOne.headers]) {
      assert.equal((await send('/me', headers, 'PATCH', { name: 'Staff' })).status, 401)
      assert.equal((await send(`/me/purchases/${randomUUID()}/resume`, headers, 'POST', {})).status, 401)
    }
  })

  test('TEN-13, ACC-13 another studio’s member sees none of this studio’s account rows, and their session is refused here', async () => {
    const mia = await member(one, 'Mia Home')
    const nat = await member(two, 'Nat Away')
    await hold(one, mia, 'bundle', new Date(Date.now() + 30 * DAY))
    await classBooking(one, mia, await addClass(one, -DAY), { state: 'confirmed', checkIn: 'attended' })
    await classBooking(one, mia, await addClass(one, DAY), { state: 'confirmed', checkIn: 'pending' })
    await workshopBooking(one, mia, await addWorkshop(one, 3 * DAY))
    await ptRequest(one, mia, '1on1', await hold(one, mia, '1on1', null))
    const [pkg] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: one.id, name: CORPORATE_NAME, priceSgd: '800.00', createdByStaffId: adminAtOne.staffId })
      .returning({ id: schema.corporatePackages.id })
    await ok(send('/me/corporate-requests', mia.headers, 'POST', { package_id: pkg!.id }), 201)
    await harness.db
      .insert(schema.merchOrders)
      .values({ tenantId: one.id, clientId: mia.clientId, title: MERCH_TITLE, amountSgd: '25.00' })
    const [owed] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId: one.id, clientId: mia.clientId, kind: 'class_package', totalSgd: '200.00', amountPaidSgd: '50.00', partPaidAt: new Date() })
      .returning({ id: schema.purchases.id })
    await harness.db.insert(schema.stripePayments).values({
      tenantId: one.id,
      paymentIntentId: `pi_account_${randomUUID().slice(0, 12)}`,
      purchaseId: owed!.id,
      amountSgd: '50.00',
      kind: 'class_package',
      clientId: mia.clientId,
      status: 'succeeded',
    })
    // Every page has a row of hers to leak.
    assert.equal((await ok(get('/me/purchases/open', mia.headers))).purchases.length, 1)
    assert.equal((await ok(get('/me/merch-orders', mia.headers))).orders.length, 1)

    // At their own studio, nothing of hers.
    const empty: Record<string, string> = {
      '/me/packages': 'client_packages',
      '/me/bookings/upcoming': 'bookings',
      '/me/bookings/past': 'bookings',
      '/me/workshop-bookings': 'workshop_bookings',
      '/me/pt-sessions': 'pt_requests',
      '/me/corporate-requests': 'corporate_requests',
      '/me/merch-orders': 'orders',
      '/me/purchases/open': 'purchases',
    }
    for (const [path, key] of Object.entries(empty)) {
      assert.deepEqual((await ok(get(path, nat.headers)))[key], [], path)
    }
    assert.equal((await ok(get('/me', nat.headers))).id, nat.clientId)

    // Their session carried to this studio's hostname is refused outright.
    const crossed = { ...nat.headers, 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('client', one) }
    for (const path of MEMBER_READS) {
      assert.equal((await get(path, crossed)).status, 403, path)
    }
    assert.equal((await send('/me', crossed, 'PATCH', { name: 'Crossed' })).status, 403)
    // Nor can they pay towards her unfinished purchase, from either studio.
    assert.equal((await send(`/me/purchases/${owed!.id}/resume`, crossed, 'POST', {})).status, 403)
    assert.equal((await send(`/me/purchases/${owed!.id}/resume`, nat.headers, 'POST', {})).status, 404)
    assert.equal((await harness.db.select().from(schema.purchases).where(eq(schema.purchases.id, owed!.id)))[0]!.checkoutSessionId, null)
    const [row] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, nat.clientId))
    assert.equal(row!.name, 'Nat Away')
  })
})
