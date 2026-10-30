import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.pt-jobs.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const PT_PACKAGE_NAME = `PT-jobs sessions ${run}`
const CLASS_TYPE_NAME = `PT-jobs roster ${run}`
const ROOM_NAME = `PT-jobs room ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The scheduled jobs that change a member's private sessions, and a session's
 * event state, driven by the harness clock.
 *
 * Time moves only through `harness.clock`; each job is fired through
 * `scheduledJobs` — one cron tick, with the same fan-out over every Tenant the
 * scheduler runs. Requests are made and scheduled over HTTP, as a member and an
 * admin would; what a job did is read back from the member's own
 * `/api/v1/me/pt-sessions` and from the rows it left: the request, the package
 * balance, and the ledger (`credit_movements`, `manual_adjustments`).
 */
describe('PT jobs on the app clock', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let jobs!: typeof import('../jobs')
  let ptPackagesSvc!: typeof import('../services/packages/pt-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')
  let tenantDb!: typeof import('../db')
  let scheduleSvc!: typeof import('../services/pt-sessions/schedule')
  let bookingCancelSvc!: typeof import('../services/bookings/cancel')

  type SessionType = '1on1' | '2on1'
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    pt: Record<SessionType, string>
  }
  type Staff = { staffId: string; headers: Record<string, string> }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio
  let adminAtOne!: Staff
  let adminAtTwo!: Staff
  let coachAtOne!: Staff
  let coachAtTwo!: Staff
  let made = 0

  const expectStatus = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as any) : null
  }

  // ── Fixtures ─────────────────────────────────────────────────────────────

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenant.id))
      .limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    // A room of our own, so a clash can only be with a session this file made.
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location.id, name: ROOM_NAME, capacity: 4 })
      .returning({ id: schema.rooms.id })
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
      locationId: location.id,
      roomId: room!.id,
      pt: { '1on1': (await ptPackage('1on1')).id, '2on1': (await ptPackage('2on1')).id },
    }
  }

  async function staff(at: Studio, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = `${name}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, at)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, at.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    }
    return { staffId: row!.id, headers }
  }

  async function member(at: Studio): Promise<Member> {
    const email = `member-${made++}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: `Member ${made}`, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  /** A 10-session PT package of `sessionType` held by `who`, Dormant as every purchase lands. */
  async function givePt(at: Studio, who: Member, sessionType: SessionType): Promise<string> {
    const { clientPackageId } = await purchaseSvc.grantPackage(at.id, {
      clientId: who.clientId,
      purchaseId: null,
      amountSgd: '900.00',
      packageKind: 'pt',
      packageId: at.pt[sessionType],
    })
    return clientPackageId
  }

  // ── Routes ───────────────────────────────────────────────────────────────

  /** A slot five Singapore days after the app's today: inside every studio's Book in advance window. */
  const slotDate = () => new Date(harness.clock.now().getTime() + 5 * DAY + 8 * HOUR).toISOString().slice(0, 10)

  /** The member's request over HTTP, on whatever day the app's clock says it is. */
  async function request(at: Studio, who: Member, sessionType: SessionType, clientPackageId: string): Promise<string> {
    const res = await harness.app.request('/api/v1/me/pt-sessions/request', {
      method: 'POST',
      headers: { ...who.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId: at.locationId,
        sessionType,
        clientPackageId,
        slots: [{ proposedDate: slotDate(), startTime: '09:00' }],
        ...(sessionType === '2on1'
          ? { partner: { kind: 'new', name: 'Partner', email: `partner-${made++}@${DOMAIN}` } }
          : {}),
      }),
    })
    return (await expectStatus(res, 201)).pt_request_id as string
  }

  /** An admin schedules the request into a one-hour session starting at `startsAt`. */
  async function schedule(at: Studio, by: Staff, coach: Staff, requestId: string, startsAt: Date): Promise<void> {
    const res = await harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}/schedule`, {
      method: 'POST',
      headers: { ...by.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location_id: at.locationId,
        room_id: at.roomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        instructor_id: coach.staffId,
        instructor_pay_sgd: 60,
      }),
    })
    assert.equal((await expectStatus(res, 201)).pt_request.status, 'scheduled')
  }

  /** The request as the member's own list shows it. */
  async function asMemberSees(who: Member, requestId: string): Promise<any> {
    const res = await expectStatus(await harness.app.request('/api/v1/me/pt-sessions', { headers: who.headers }), 200)
    const found = (res.pt_requests as any[]).find(r => r.id === requestId)
    assert.ok(found, `request ${requestId} is on the member's list`)
    return found
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async function requestRow(requestId: string) {
    const [row] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, requestId))
    assert.ok(row, `no PT request ${requestId}`)
    return row
  }

  async function pkg(clientPackageId: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, clientPackageId))
    assert.ok(row, `no client package ${clientPackageId}`)
    return row
  }

  const movementsOf = (clientPackageId: string) =>
    harness.db.select().from(schema.creditMovements).where(eq(schema.creditMovements.clientPackageId, clientPackageId))

  const adjustmentsOf = (clientPackageId: string) =>
    harness.db.select().from(schema.manualAdjustments).where(eq(schema.manualAdjustments.clientPackageId, clientPackageId))

  async function sessionOf(requestId: string) {
    const [session] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.ptRequestId, requestId))
    assert.ok(session, `no PT session for ${requestId}`)
    const booked = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.ptSessionId, session.id))
    assert.equal(booked.length, 1, `one booking on the session for ${requestId}`)
    return { session, booking: booked[0]! }
  }

  async function untilBlockedBy(pid: number): Promise<void> {
    const deadline = Date.now() + 10_000
    for (;;) {
      const [blocked] = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND ${pid}::int = ANY(pg_blocking_pids(pid))`,
      )
      if (blocked!.n > 0) return
      assert.ok(Date.now() < deadline, 'the tick never queued behind the write')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  async function tickBehindUncommittedWrite(
    at: Studio,
    write: () => Promise<unknown>,
    tick: () => Promise<void>,
  ): Promise<void> {
    let commit!: () => void
    const released = new Promise<void>(resolve => (commit = resolve))
    let holding!: (pid: number) => void
    const held = new Promise<number>(resolve => (holding = resolve))
    const writing = tenantDb.withTenant(at.id, async () => {
      await write()
      const [row] = await tenantDb.db.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      holding(row!.pid)
      await released
    })
    const pid = await Promise.race([held, writing.then(() => 0)])
    let ticking: Promise<void> = Promise.resolve()
    try {
      ticking = tick()
      await untilBlockedBy(pid)
    } finally {
      commit()
      await writing
      await ticking
    }
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    jobs = await import('../jobs')
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    tenantDb = await import('../db')
    scheduleSvc = await import('../services/pt-sessions/schedule')
    bookingCancelSvc = await import('../services/bookings/cancel')

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    adminAtOne = await staff(one, 'admin', 'admin')
    adminAtTwo = await staff(two, 'admin', 'admin')
    coachAtOne = await staff(one, 'coach', 'instructor')
    coachAtTwo = await staff(two, 'coach', 'instructor')
  })

  after(async () => {
    if (!harness) return
    try {
      harness.clock.reset()
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
      const sessions = sql`SELECT id FROM pt_sessions WHERE pt_request_id IN (${requests})`
      const exec = (q: ReturnType<typeof sql>) => harness.db.execute(q)
      await exec(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await exec(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await exec(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${requests})`)
      await exec(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${sessions})`)
      await exec(sql`DELETE FROM pt_sessions WHERE id IN (${sessions})`)
      await exec(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
      await exec(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
      await exec(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await exec(sql`DELETE FROM pt_packages WHERE name LIKE ${`${PT_PACKAGE_NAME}%`}`)
      await exec(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
      await exec(sql`DELETE FROM rooms WHERE name = ${ROOM_NAME}`)
      await exec(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
      await exec(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await exec(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await exec(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await exec(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  // ── PT request expiry ────────────────────────────────────────────────────

  test('PT-53 a pending request past its expiry is cancelled before scheduling by the expiry job, its full debit (1 or 2) back on the package it came from, with a matching ledger row and no staff resolver', async () => {
    harness.clock.set(new Date())
    const ana = await member(one)
    const single = await givePt(one, ana, '1on1')
    const double = await givePt(one, ana, '2on1')
    const oneOnOne = await request(one, ana, '1on1', single)
    const twoOnOne = await request(one, ana, '2on1', double)
    assert.equal((await pkg(single)).creditsOrSessionsRemaining, 9)
    assert.equal((await pkg(double)).creditsOrSessionsRemaining, 8)

    const expiresAt = (await requestRow(twoOnOne)).expiresAt
    assert.ok(expiresAt, 'a member request lapses')
    harness.clock.set(new Date(expiresAt.getTime() + MINUTE))
    await jobs.scheduledJobs.expireStaleSessions()

    for (const [requestId, packageId, debit] of [
      [oneOnOne, single, 1],
      [twoOnOne, double, 2],
    ] as const) {
      const row = await requestRow(requestId)
      assert.equal(row.status, 'cancelled_before_scheduled')
      assert.equal(row.cancelSource, 'system')
      assert.equal(row.resolvedByStaffId, null, 'no staff member resolved it')
      assert.equal((await pkg(packageId)).creditsOrSessionsRemaining, 10, 'the member loses no session')

      const returned = (await movementsOf(packageId)).filter(m => m.delta > 0)
      assert.deepEqual(
        returned.map(m => [m.cause, m.delta, m.balanceAfter, m.actor, m.actedByStaffId]),
        [['pt_returned', debit, 10, 'system', null]],
      )
      const audit = (await adjustmentsOf(packageId)).filter(a => a.delta > 0)
      assert.deepEqual(audit.map(a => [a.reason, a.delta, a.actedByStaffId]), [['pt_request_expiry_refund', debit, null]])

      const seen = await asMemberSees(ana, requestId)
      assert.equal(seen.status, 'cancelled_before_scheduled')
      assert.equal(seen.expired, true)
    }

    // A second tick finds nothing left to expire: nothing is returned twice.
    harness.clock.advance(5 * MINUTE)
    await jobs.scheduledJobs.expireStaleSessions()
    assert.equal((await pkg(single)).creditsOrSessionsRemaining, 10)
    assert.equal((await pkg(double)).creditsOrSessionsRemaining, 10)
    assert.equal((await movementsOf(double)).filter(m => m.delta > 0).length, 1)
  })

  test('PT-55 the expiry job leaves alone a pending request not yet past its expiry, and a scheduled request past it', async () => {
    const start = new Date()
    harness.clock.set(start)
    const ben = await member(one)
    const forScheduled = await givePt(one, ben, '1on1')
    const forPending = await givePt(one, ben, '1on1')

    // Scheduled first, into a session after the moment the job will run.
    const scheduledId = await request(one, ben, '1on1', forScheduled)
    const lapses = (await requestRow(scheduledId)).expiresAt
    assert.ok(lapses)
    await schedule(one, adminAtOne, coachAtOne, scheduledId, new Date(lapses.getTime() + 2 * DAY))

    // Two days on, a fresh request: its expiry is two days after the first's.
    harness.clock.advance(2 * DAY)
    const pendingId = await request(one, ben, '1on1', forPending)
    const pendingLapses = (await requestRow(pendingId)).expiresAt
    assert.ok(pendingLapses && pendingLapses > lapses)

    const before = {
      scheduled: await requestRow(scheduledId),
      pending: await requestRow(pendingId),
      balances: [(await pkg(forScheduled)).creditsOrSessionsRemaining, (await pkg(forPending)).creditsOrSessionsRemaining],
      movements: (await movementsOf(forScheduled)).length + (await movementsOf(forPending)).length,
    }

    // Past the scheduled request's expiry, short of the pending one's.
    harness.clock.set(new Date(lapses.getTime() + HOUR))
    assert.ok(harness.clock.now() < pendingLapses)
    await jobs.scheduledJobs.expireStaleSessions()

    assert.deepEqual(await requestRow(scheduledId), before.scheduled)
    assert.deepEqual(await requestRow(pendingId), before.pending)
    assert.deepEqual(
      [(await pkg(forScheduled)).creditsOrSessionsRemaining, (await pkg(forPending)).creditsOrSessionsRemaining],
      before.balances,
    )
    assert.deepEqual(before.balances, [9, 9])
    assert.equal((await movementsOf(forScheduled)).length + (await movementsOf(forPending)).length, before.movements)
    assert.equal((await asMemberSees(ben, scheduledId)).status, 'scheduled')
    assert.equal((await asMemberSees(ben, pendingId)).status, 'pending')
  })

  test('TEN-08 with stale pending requests at two studios, one expiry tick refunds, cancels and ledgers each under the request\'s own studio', async () => {
    harness.clock.set(new Date())
    const dana = await member(one)
    const eli = await member(two)
    const atOne = await givePt(one, dana, '2on1')
    const atTwo = await givePt(two, eli, '1on1')
    const requestAtOne = await request(one, dana, '2on1', atOne)
    const requestAtTwo = await request(two, eli, '1on1', atTwo)

    const lapses = [(await requestRow(requestAtOne)).expiresAt, (await requestRow(requestAtTwo)).expiresAt]
    assert.ok(lapses[0] && lapses[1])
    harness.clock.set(new Date(Math.max(lapses[0].getTime(), lapses[1].getTime()) + MINUTE))
    // One tick, as the scheduler runs it: every studio in turn, each inside its own context.
    await jobs.scheduledJobs.expireStaleSessions()

    for (const [at, who, requestId, packageId, debit] of [
      [one, dana, requestAtOne, atOne, 2],
      [two, eli, requestAtTwo, atTwo, 1],
    ] as const) {
      const row = await requestRow(requestId)
      assert.equal(row.tenantId, at.id)
      assert.equal(row.status, 'cancelled_before_scheduled', `the request at ${at.slug} expired`)
      const held = await pkg(packageId)
      assert.equal(held.tenantId, at.id)
      assert.equal(held.creditsOrSessionsRemaining, 10, `the debit came back at ${at.slug}`)

      const returned = (await movementsOf(packageId)).filter(m => m.delta > 0)
      assert.deepEqual(returned.map(m => [m.tenantId, m.delta]), [[at.id, debit]])
      const audit = (await adjustmentsOf(packageId)).filter(a => a.delta > 0)
      assert.deepEqual(audit.map(a => [a.tenantId, a.delta]), [[at.id, debit]])

      // Nothing about this member was written under the other studio.
      const other = at.id === one.id ? two.id : one.id
      const strays = await harness.db.execute<{ n: number }>(sql`
        SELECT (SELECT count(*) FROM credit_movements WHERE client_id = ${who.clientId} AND tenant_id = ${other})
             + (SELECT count(*) FROM manual_adjustments WHERE client_id = ${who.clientId} AND tenant_id = ${other})
             + (SELECT count(*) FROM pt_requests WHERE client_id = ${who.clientId} AND tenant_id = ${other})
             + (SELECT count(*) FROM client_packages WHERE client_id = ${who.clientId} AND tenant_id = ${other}) AS n`)
      assert.equal(Number(strays[0]!.n), 0)

      assert.equal((await asMemberSees(who, requestId)).status, 'cancelled_before_scheduled')
    }
  })

  test('PT-132 staff schedule a pending request past its expiry while an expiry tick that read it as pending is under way: the schedule stands and no session comes back', async () => {
    harness.clock.set(new Date())
    const gus = await member(one)
    const packageId = await givePt(one, gus, '1on1')
    const requestId = await request(one, gus, '1on1', packageId)
    const lapses = (await requestRow(requestId)).expiresAt
    assert.ok(lapses)
    harness.clock.set(new Date(lapses.getTime() + MINUTE))
    const startsAt = new Date(lapses.getTime() + 3 * DAY + 5 * HOUR)

    await tickBehindUncommittedWrite(
      one,
      async () => {
        const scheduled = await scheduleSvc.schedulePtRequest(one.id, {
          ptRequestId: requestId,
          instructorId: coachAtOne.staffId,
          locationId: one.locationId,
          roomId: one.roomId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + HOUR),
          actorStaffId: adminAtOne.staffId,
          actorIsAdmin: true,
        })
        assert.ok(scheduled.ok, JSON.stringify(scheduled))
      },
      jobs.scheduledJobs.expireStaleSessions,
    )

    const row = await requestRow(requestId)
    assert.equal(row.status, 'scheduled')
    assert.equal(row.cancelSource, null)
    const { session, booking } = await sessionOf(requestId)
    assert.equal(session.lifecycle, 'active')
    assert.equal(booking.state, 'confirmed')
    assert.equal((await pkg(packageId)).creditsOrSessionsRemaining, 9, 'the session it cost stays spent')
    assert.deepEqual((await movementsOf(packageId)).filter(m => m.delta > 0), [])
    assert.equal((await asMemberSees(gus, requestId)).status, 'scheduled')
  })

  // ── PT session completion ────────────────────────────────────────────────

  test('PT-56 a scheduled PT session whose end has passed is moved to attended by the completion job, and leaves the member\'s upcoming list', async () => {
    harness.clock.set(new Date())
    const cleo = await member(one)
    const packageId = await givePt(one, cleo, '1on1')
    const requestId = await request(one, cleo, '1on1', packageId)
    const startsAt = new Date(harness.clock.now().getTime() + 4 * DAY + 3 * HOUR)
    const endsAt = new Date(startsAt.getTime() + HOUR)
    await schedule(one, adminAtOne, coachAtOne, requestId, startsAt)

    // A minute before it ends, the session is still the member's to come.
    harness.clock.set(new Date(endsAt.getTime() - MINUTE))
    await jobs.scheduledJobs.completeEndedPtSessions()
    assert.equal((await requestRow(requestId)).status, 'scheduled')
    assert.equal((await asMemberSees(cleo, requestId)).status, 'scheduled')

    harness.clock.set(new Date(endsAt.getTime() + MINUTE))
    await jobs.scheduledJobs.completeEndedPtSessions()

    assert.equal((await requestRow(requestId)).status, 'attended')
    const seen = await asMemberSees(cleo, requestId)
    // Upcoming holds a request still pending or scheduled; an attended one is history.
    assert.equal(seen.status, 'attended')
    assert.equal(seen.session.ends_at, endsAt.toISOString())
    assert.equal(seen.cancelled_at, null)
    // Completing the request moves no session: the one it cost stays spent.
    assert.equal((await pkg(packageId)).creditsOrSessionsRemaining, 9)
  })

  test('PT-166 a request that is no longer scheduled, whose session still reads active and has ended, keeps its status when the completion job runs: the job checks the request, not only the session', async () => {
    harness.clock.set(new Date())
    const dana = await member(one)
    const packageId = await givePt(one, dana, '1on1')
    const requestId = await request(one, dana, '1on1', packageId)
    // An hour of its own in the room, apart from PT-56's.
    const startsAt = new Date(harness.clock.now().getTime() + 4 * DAY + 5 * HOUR)
    const endsAt = new Date(startsAt.getTime() + HOUR)
    await schedule(one, adminAtOne, coachAtOne, requestId, startsAt)

    // A state no current path produces: the request cancelled on its own, its session left active.
    // Written straight to the row, because what is under test is the job's check, not a flow.
    await harness.db.update(schema.ptRequests).set({ status: 'cancelled_after_scheduled' }).where(eq(schema.ptRequests.id, requestId))
    assert.equal((await sessionOf(requestId)).session.lifecycle, 'active')

    harness.clock.set(new Date(endsAt.getTime() + MINUTE))
    await jobs.scheduledJobs.completeEndedPtSessions()

    assert.equal((await requestRow(requestId)).status, 'cancelled_after_scheduled')
    assert.equal((await asMemberSees(dana, requestId)).status, 'cancelled_after_scheduled')
  })

  test('PT-167 a request still scheduled whose session is cancelled and has ended is not moved to attended when the completion job runs: the job checks the session, not only the request', async () => {
    harness.clock.set(new Date())
    const eli = await member(one)
    const packageId = await givePt(one, eli, '1on1')
    const requestId = await request(one, eli, '1on1', packageId)
    // An hour of its own in the room, apart from PT-56's and PT-166's.
    const startsAt = new Date(harness.clock.now().getTime() + 4 * DAY + 7 * HOUR)
    const endsAt = new Date(startsAt.getTime() + HOUR)
    await schedule(one, adminAtOne, coachAtOne, requestId, startsAt)

    // A state no current path produces: the session cancelled on its own, its request left scheduled.
    const { session } = await sessionOf(requestId)
    await harness.db.update(schema.ptSessions).set({ lifecycle: 'cancelled' }).where(eq(schema.ptSessions.id, session.id))

    harness.clock.set(new Date(endsAt.getTime() + MINUTE))
    await jobs.scheduledJobs.completeEndedPtSessions()

    // Left as the job leaves a request it does not complete: still scheduled, and never attended.
    assert.equal((await requestRow(requestId)).status, 'scheduled')
    assert.notEqual((await asMemberSees(eli, requestId)).status, 'attended')
  })

  test('PT-133 the studio cancels the booking of an ended session, returning its session, while a completion tick that read it as scheduled is under way: the request ends cancelled, not attended', async () => {
    harness.clock.set(new Date())
    const hal = await member(one)
    const packageId = await givePt(one, hal, '1on1')
    const requestId = await request(one, hal, '1on1', packageId)
    const startsAt = new Date(harness.clock.now().getTime() + 4 * DAY + 6 * HOUR)
    await schedule(one, adminAtOne, coachAtOne, requestId, startsAt)
    const { booking } = await sessionOf(requestId)
    harness.clock.set(new Date(startsAt.getTime() + HOUR + MINUTE))

    await tickBehindUncommittedWrite(
      one,
      () =>
        bookingCancelSvc.cancelBooking(one.id, {
          bookingId: booking.id,
          source: 'system',
          credit: 'return',
        }),
      jobs.scheduledJobs.completeEndedPtSessions,
    )

    assert.equal((await requestRow(requestId)).status, 'cancelled_after_scheduled')
    const after = await sessionOf(requestId)
    assert.equal(after.session.lifecycle, 'cancelled')
    assert.equal(after.booking.state, 'cancelled')
    assert.equal((await pkg(packageId)).creditsOrSessionsRemaining, 10, 'the cancel returned the session')
    assert.equal((await asMemberSees(hal, requestId)).status, 'cancelled_after_scheduled')
  })

  test('PT-134 staff move a session that has just ended to later the same day while a completion tick that read it as ended is under way: the request stays scheduled', async () => {
    harness.clock.set(new Date())
    const ivy = await member(one)
    const packageId = await givePt(one, ivy, '1on1')
    const requestId = await request(one, ivy, '1on1', packageId)
    const startsAt = new Date(harness.clock.now().getTime() + 4 * DAY + 9 * HOUR)
    await schedule(one, adminAtOne, coachAtOne, requestId, startsAt)
    const { session } = await sessionOf(requestId)
    harness.clock.set(new Date(startsAt.getTime() + HOUR + MINUTE))
    const movedTo = new Date(startsAt.getTime() + 2 * HOUR)

    await tickBehindUncommittedWrite(
      one,
      () =>
        scheduleSvc.updatePtSession(one.id, session.id, {
          startsAt: movedTo,
          endsAt: new Date(movedTo.getTime() + HOUR),
          actorStaffId: adminAtOne.staffId,
        }),
      jobs.scheduledJobs.completeEndedPtSessions,
    )

    assert.equal((await requestRow(requestId)).status, 'scheduled')
    const after = await sessionOf(requestId)
    assert.equal(after.session.lifecycle, 'active')
    assert.equal(after.session.startsAt.toISOString(), movedTo.toISOString())
    assert.equal(after.booking.state, 'confirmed')
    assert.equal((await asMemberSees(ivy, requestId)).status, 'scheduled')
  })

  // ── Event state ──────────────────────────────────────────────────────────

  test('ROS-02 a scheduled session reads scheduled, then ongoing, then completed on the timetable as its start and end pass', async () => {
    harness.clock.set(new Date())
    const [classType] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: one.id, name: CLASS_TYPE_NAME })
      .returning({ id: schema.classTypes.id })
    const startsAt = new Date(harness.clock.now().getTime() + 6 * DAY)
    const endsAt = new Date(startsAt.getTime() + HOUR)
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: one.id,
        classTypeId: classType!.id,
        mainInstructorId: coachAtOne.staffId,
        locationId: one.locationId,
        roomId: one.roomId,
        startsAt,
        endsAt,
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: adminAtOne.staffId,
      })
      .returning({ id: schema.classes.id })

    const window = new URLSearchParams({
      from: new Date(startsAt.getTime() - DAY).toISOString(),
      to: new Date(endsAt.getTime() + DAY).toISOString(),
      type: 'class',
    })
    const stateAt = async (at: Date) => {
      harness.clock.set(at)
      const res = await expectStatus(
        await harness.app.request(`/api/v1/portal/admin/schedule?${window}`, { headers: adminAtOne.headers }),
        200,
      )
      const entry = (res.entries as any[]).find(e => e.id === cls!.id)
      assert.ok(entry, 'the class is on the timetable')
      return entry.event_state as string
    }

    assert.equal(await stateAt(new Date(startsAt.getTime() - MINUTE)), 'scheduled')
    assert.equal(await stateAt(new Date(startsAt.getTime() + MINUTE)), 'ongoing')
    assert.equal(await stateAt(new Date(endsAt.getTime() - MINUTE)), 'ongoing')
    assert.equal(await stateAt(new Date(endsAt.getTime() + MINUTE)), 'completed')
  })

  // ── Who may call the routes above ────────────────────────────────────────

  test('the routes these jobs are read and set up through refuse another studio\'s session and the wrong role, and write nothing', async () => {
    harness.clock.set(new Date())
    const fay = await member(one)
    const away = await member(two)
    const packageId = await givePt(one, fay, '1on1')
    const requestId = await request(one, fay, '1on1', packageId)

    /** Present `signedIn`'s session from studio one's own frontend for `pool`. */
    const atOne = (signedIn: Record<string, string>, pool: 'client' | 'staff') => ({
      Authorization: signedIn.Authorization!,
      'X-Tenant-Slug': one.slug,
      Origin: frontendOrigin(pool, one),
      'X-Forwarded-For': signedIn['X-Forwarded-For']!,
    })
    const refused = async (res: Response, status: number, code: string) => {
      const body = await expectStatus(res, status)
      assert.equal(body.error, code)
    }
    const json = (headers: Record<string, string>, body: unknown) => ({
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const requestBody = { locationId: one.locationId, sessionType: '1on1', clientPackageId: packageId, slots: [{ proposedDate: slotDate(), startTime: '09:00' }] }
    const scheduleBody = {
      location_id: one.locationId,
      room_id: one.roomId,
      starts_at: new Date(harness.clock.now().getTime() + 20 * DAY).toISOString(),
      ends_at: new Date(harness.clock.now().getTime() + 20 * DAY + HOUR).toISOString(),
      instructor_id: coachAtOne.staffId,
    }
    const before = { requests: (await harness.db.select().from(schema.ptRequests).where(inArray(schema.ptRequests.clientId, [fay.clientId, away.clientId]))).length }

    // The member's list and request: another studio's member, and a staff session, are nobody here.
    await refused(await harness.app.request('/api/v1/me/pt-sessions', { headers: atOne(away.headers, 'client') }), 401, 'invalid_token')
    await refused(await harness.app.request('/api/v1/me/pt-sessions', { headers: atOne(adminAtOne.headers, 'client') }), 401, 'invalid_token')
    await refused(await harness.app.request('/api/v1/me/pt-sessions/request', json(atOne(away.headers, 'client'), requestBody)), 401, 'invalid_token')
    await refused(await harness.app.request('/api/v1/me/pt-sessions/request', json(atOne(adminAtOne.headers, 'client'), requestBody)), 401, 'invalid_token')

    // The timetable and scheduling: another studio's admin is nobody here; an instructor is not an admin.
    await refused(await harness.app.request('/api/v1/portal/admin/schedule', { headers: atOne(adminAtTwo.headers, 'staff') }), 401, 'invalid_token')
    await refused(await harness.app.request('/api/v1/portal/admin/schedule', { headers: coachAtOne.headers }), 403, 'forbidden_role')
    const schedulePath = `/api/v1/portal/admin/pt-sessions/${requestId}/schedule`
    await refused(await harness.app.request(schedulePath, json(atOne(adminAtTwo.headers, 'staff'), scheduleBody)), 401, 'invalid_token')
    await refused(await harness.app.request(schedulePath, json(coachAtOne.headers, scheduleBody)), 403, 'forbidden_role')

    const row = await requestRow(requestId)
    assert.equal(row.status, 'pending')
    assert.equal(row.scheduledPtSessionId, null)
    assert.equal((await pkg(packageId)).creditsOrSessionsRemaining, 9)
    assert.equal(
      (await harness.db.select().from(schema.ptRequests).where(inArray(schema.ptRequests.clientId, [fay.clientId, away.clientId]))).length,
      before.requests,
    )
    assert.equal((await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.ptRequestId, requestId))).length, 0)
  })
})
