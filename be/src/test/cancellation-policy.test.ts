import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.cancellation-policy.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Cancel policy class type ${run}`
const PACKAGE_NAME = `Cancel policy pass ${run}`
const PT_PACKAGE_NAME = `Cancel policy PT pack ${run}`
const WORKSHOP_NAME = `Cancel policy workshop ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The cancellation policy over real HTTP (#214): when a member's cancel returns
 * the credit, when it is refused, when it is recorded but forfeited, and what
 * an Admin's cancel — of one booking or of a whole class — puts back.
 *
 * Every test stands the app's clock at a chosen instant (`harness.clock`),
 * acts through a route, then reads what the request left: the booking and its
 * refund outcome, the package balance, the `cancellations` row and the ledger.
 * Fixtures — a class, a package a member holds, a staff row — are written
 * directly, because which rows a person has is the test's to state.
 *
 * **The ledger.** A package's balance is what it started with, less every
 * class booking's debit (kept on the booking), plus every `manual_adjustments`
 * row (refunds, PT debits). `assertLedger` checks that sum after each step
 * that moves credits, so a refund that fired twice, or fired without a ledger
 * row, fails here.
 *
 * The basic in-window / at-the-cutoff / late cases and the cap cycle rolling
 * over are `time-windows.test.ts`'s; they are not repeated here.
 */
describe('cancellation policy over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let evaluator!: typeof import('../services/policy/evaluate-cancellation')

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    classPackageId: string
    ptPackageId: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; headers: Record<string, string> }
  type PackageKind = 'credit_bundle' | 'unlimited' | 'pt'
  type Policy = typeof import('../db/schema').globalPolicy.$inferSelect

  let one!: Studio
  let two!: Studio
  /** Each studio's policy as seeded, put back after every test that changes it. */
  const seededPolicy = new Map<string, Policy>()

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }

  /** A week from the real today, on a whole minute: every class and PT session
   *  in this file is days after it, so the wall clock never reaches them. */
  const aWeekOut = () => new Date(Math.floor((Date.now() + 7 * DAY) / MINUTE) * MINUTE)
  const shifted = (from: Date, ms: number) => new Date(from.getTime() + ms)

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

    const classType = await classTypesSvc.createClassType(tenant.id, { name: CLASS_TYPE_NAME })
    const admin = await staffAt(tenant, 'admin', 'admin')
    const instructor = await staffAt(tenant, 'instructor', 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: instructor.id })

    const [classPackage] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: PACKAGE_NAME, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const [ptPackage] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: PT_PACKAGE_NAME, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00' })
      .returning({ id: schema.ptPackages.id })

    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      classTypeId: classType.id,
      classPackageId: classPackage!.id,
      ptPackageId: ptPackage!.id,
      admin,
      instructor,
    }
  }

  /** A class starting at `startsAt`, taught by the studio's instructor. */
  async function addClass(at: Studio, startsAt: Date, options: { creditCost?: number; capacityOnline?: number } = {}): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.instructor.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: shifted(startsAt, HOUR),
        capacityOnline: options.capacityOnline ?? 10,
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

  /**
   * A package the member holds, as a purchase would have left it. A Credit
   * Bundle or PT pack is Dormant; an Unlimited Plan is Activated until
   * `expiresAt`, so it pays for the classes in this file.
   */
  async function give(at: Studio, who: Member, kind: PackageKind, options: { credits?: number; expiresAt?: Date } = {}): Promise<string> {
    const unlimited = kind === 'unlimited'
    const credits = unlimited ? null : (options.credits ?? 10)
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind,
        sourceClassPackageId: kind === 'credit_bundle' ? at.classPackageId : null,
        sourcePtPackageId: kind === 'pt' ? at.ptPackageId : null,
        locationId: unlimited ? at.locationId : null,
        durationMonths: unlimited ? 1 : null,
        validityDays: unlimited ? null : 90,
        creditsOrSessionsRemaining: credits,
        expiresAt: unlimited ? (options.expiresAt ?? null) : null,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    if (credits !== null) startingBalance.set(row!.id, credits)
    return row!.id
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

  const adminCancel = (as: Record<string, string>, bookingId: string) =>
    harness.app.request(`/api/v1/portal/admin/bookings/${bookingId}/cancel`, { method: 'POST', headers: as })

  const adminCancelClass = (as: Record<string, string>, classId: string) =>
    harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}/cancel`, { method: 'POST', headers: as })

  const noShow = (as: Record<string, string>, bookingId: string) =>
    harness.app.request(`/api/v1/portal/admin/bookings/${bookingId}/no-show`, { method: 'POST', headers: as })

  const patchPolicy = (as: Record<string, string>, body: Record<string, unknown>) =>
    harness.app.request('/api/v1/portal/admin/policy/global', {
      method: 'PATCH',
      headers: { ...as, ...json },
      body: JSON.stringify(body),
    })

  async function ptRequestOk(who: Member, at: Studio, packageId: string): Promise<string> {
    const res = await harness.app.request('/api/v1/me/pt-sessions/request', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({
        classTypeId: at.classTypeId,
        locationId: at.locationId,
        sessionType: '1on1',
        clientPackageId: packageId,
        slots: [{ proposedDate: '2030-01-15', startTime: '09:00', endTime: '10:00' }],
      }),
    })
    return (await expectStatus(res, 201)).pt_request_id as string
  }

  /** The studio's admin schedules the request with the studio's instructor at `startsAt`. */
  async function schedulePt(at: Studio, requestId: string, startsAt: Date): Promise<void> {
    const res = await harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}/schedule`, {
      method: 'POST',
      headers: { ...at.admin.headers, ...json },
      body: JSON.stringify({
        instructor_id: at.instructor.id,
        location_id: at.locationId,
        room_id: at.roomId,
        starts_at: startsAt.toISOString(),
        ends_at: shifted(startsAt, HOUR).toISOString(),
        instructor_pay_sgd: 0,
      }),
    })
    await expectStatus(res, 201)
  }

  /**
   * A PT session an hour of its own on the day `day` days after `t0`, clear of
   * every class (classes here start on the whole day and last an hour).
   */
  let ptSlots = 0
  const ptStart = (t0: Date, day: number) => shifted(t0, day * DAY + 2 * HOUR + (ptSlots++ % 10) * 2 * HOUR)

  const ptCancel = (who: Member, requestId: string) =>
    harness.app.request(`/api/v1/me/pt-sessions/${requestId}/cancel`, { method: 'POST', headers: who.headers })

  const instructorPtCancel = (as: Record<string, string>, requestId: string) =>
    harness.app.request(`/api/v1/portal/instructor/pt-requests/${requestId}/cancel`, { method: 'POST', headers: as })

  /* ── state ──────────────────────────────────────────────────────────── */

  async function bookingRow(bookingId: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.ok(row, `no booking row ${bookingId}`)
    return row
  }

  async function ptBookingOf(requestId: string) {
    const [session] = await harness.db.select().from(schema.ptSessions).where(eq(schema.ptSessions.ptRequestId, requestId))
    assert.ok(session, `no PT session for ${requestId}`)
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.ptSessionId, session.id))
    assert.ok(row, `no booking on the PT session for ${requestId}`)
    return row
  }

  async function balanceOf(packageId: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, packageId))
    assert.ok(row, `no package ${packageId}`)
    return row.creditsOrSessionsRemaining
  }

  async function cancellationOf(bookingId: string) {
    const rows = await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))
    assert.ok(rows.length <= 1, `more than one cancellation recorded for ${bookingId}`)
    return rows[0]
  }

  const adjustmentsOf = (packageId: string) =>
    harness.db
      .select()
      .from(schema.manualAdjustments)
      .where(eq(schema.manualAdjustments.clientPackageId, packageId))
      .orderBy(schema.manualAdjustments.createdAt)

  const confirmedOn = async (classId: string) =>
    (
      await harness.db
        .select()
        .from(schema.bookings)
        .where(and(eq(schema.bookings.classId, classId), eq(schema.bookings.state, 'confirmed')))
    ).length

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

  /** The refund ledger rows on a package — one per refund that fired. */
  const refundsOn = async (packageId: string) => (await adjustmentsOf(packageId)).filter(a => a.delta > 0)

  async function policyOf(at: Studio) {
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, at.id))
    assert.ok(policy, `expected a seeded policy for ${at.slug}`)
    return policy
  }

  /** Put every studio's policy back as seeded. */
  async function restorePolicies(): Promise<void> {
    for (const [tenantId, p] of seededPolicy) {
      await harness.db
        .update(schema.globalPolicy)
        .set({
          cancelCapCount: p.cancelCapCount,
          cancelCapCycleDays: p.cancelCapCycleDays,
          classWindowHours: p.classWindowHours,
          ptWindowHours: p.ptWindowHours,
          updatedByStaffId: p.updatedByStaffId,
        })
        .where(eq(schema.globalPolicy.tenantId, tenantId))
    }
  }

  /** Spend `n` of the member's cap: a class booked and cancelled in good time, `n` times. */
  async function cancelInTime(at: Studio, who: Member, t0: Date, n: number, body: Record<string, unknown> = {}): Promise<string[]> {
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      const bookingId = await bookOk(who, await addClass(at, shifted(t0, (3 + i) * DAY)), body)
      await expectStatus(await cancel(who, bookingId), 200)
      ids.push(bookingId)
    }
    return ids
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    evaluator = inTenantContext(await import('../services/policy/evaluate-cancellation'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    seededPolicy.set(one.id, await policyOf(one))
    seededPolicy.set(two.id, await policyOf(two))
  })

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    await restorePolicies()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const workshops = sql`SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME}`
    const ptRequests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'cancelledByStaffId' IN (SELECT id::text FROM (${staff}) s)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_session_clients WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (SELECT id FROM pt_sessions WHERE pt_request_id IN (${ptRequests}))`)
    await harness.db.execute(sql`DELETE FROM pt_sessions WHERE pt_request_id IN (${ptRequests})`)
    await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${ptRequests})`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name = ${PT_PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name = ${WORKSHOP_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── a member's cancel ──────────────────────────────────────────────── */

  test('CXL-01, CXL-02, CXL-11 an in-time cancel of a two-credit class returns both credits to the package that paid, with a ledger row and a client cancellation record', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const ana = await member(one, 'ana')
    const bundle = await give(one, ana, 'credit_bundle', { credits: 5 })
    const bookingId = await bookOk(ana, await addClass(one, shifted(t0, 3 * DAY), { creditCost: 2 }))
    assert.equal(await balanceOf(bundle), 3)

    harness.clock.set(shifted(t0, HOUR))
    const res = await expectStatus(await cancel(ana, bookingId), 200)
    assert.equal(res.refund_outcome, 'credit_returned')
    assert.equal(res.refund_fired, true)

    const row = await bookingRow(bookingId)
    assert.equal(row.state, 'cancelled')
    assert.equal(row.refundOutcome, 'credit_returned')
    assert.equal(row.cancelledAt?.getTime(), shifted(t0, HOUR).getTime())
    // In full, to the package that paid — never a part of it.
    assert.equal(await balanceOf(bundle), 5)
    const refunds = await refundsOn(bundle)
    assert.equal(refunds.length, 1)
    assert.equal(refunds[0]!.delta, 2)
    assert.equal(refunds[0]!.reason, 'client_cancellation_refund')
    await assertLedger(bundle)

    const record = await cancellationOf(bookingId)
    assert.ok(record, 'the cancellation is recorded')
    assert.equal(record.source, 'client')
    assert.equal(record.kind, 'class')
    assert.equal(record.clientId, ana.clientId)
    assert.equal(record.wasWithinWindow, true)
    assert.equal(record.wasWithinCap, true)
    assert.equal(record.refundFired, true)
  })

  test('CXL-04 cancelling an Unlimited-paid booking releases the seat with outcome n_a and writes no balance', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const bo = await member(one, 'bo')
    const plan = await give(one, bo, 'unlimited', { expiresAt: shifted(t0, 60 * DAY) })
    const classId = await addClass(one, shifted(t0, 3 * DAY), { capacityOnline: 1 })
    const bookingId = await bookOk(bo, classId)
    assert.equal((await bookingRow(bookingId)).creditsOrSessionsUsed, 0)

    const res = await expectStatus(await cancel(bo, bookingId), 200)
    assert.equal(res.refund_outcome, 'n_a')
    assert.equal(res.refund_fired, false)

    const row = await bookingRow(bookingId)
    assert.equal(row.state, 'cancelled')
    assert.equal(row.refundOutcome, 'n_a')
    assert.equal(await balanceOf(plan), null)
    assert.equal((await adjustmentsOf(plan)).length, 0, 'no balance write for an Unlimited booking')
    const record = await cancellationOf(bookingId)
    assert.ok(record)
    assert.equal(record.source, 'client')
    assert.equal(record.refundFired, false)

    // The one seat is free again.
    assert.equal(await confirmedOn(classId), 0)
    const cy = await member(one, 'cy')
    await give(one, cy, 'credit_bundle', { credits: 1 })
    await bookOk(cy, classId)
  })

  test('CXL-07 rescheduling is a cancel judged by the window plus a rebook that spends a fresh credit', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const dee = await member(one, 'dee')
    const bundle = await give(one, dee, 'credit_bundle', { credits: 3 })
    const { classWindowHours } = await policyOf(one)
    const first = await addClass(one, shifted(t0, 3 * DAY))
    const moved = await addClass(one, shifted(t0, 4 * DAY))
    const late = await addClass(one, shifted(t0, 5 * DAY))
    const firstBooking = await bookOk(dee, first)
    const lateBooking = await bookOk(dee, late)
    assert.equal(await balanceOf(bundle), 1)

    // In good time: the credit comes back, and the new class takes a fresh one.
    await expectStatus(await cancel(dee, firstBooking), 200)
    assert.equal((await bookingRow(firstBooking)).refundOutcome, 'credit_returned')
    assert.equal(await balanceOf(bundle), 2)
    const rebooked = await bookOk(dee, moved)
    const rebookedRow = await bookingRow(rebooked)
    assert.equal(rebookedRow.clientPackageId, bundle)
    assert.equal(rebookedRow.creditsOrSessionsUsed, 1)
    assert.equal(await balanceOf(bundle), 1)
    await assertLedger(bundle)

    // Too late to move the other: the cancel is refused like any late cancel.
    harness.clock.set(shifted(t0, 5 * DAY - classWindowHours * HOUR + MINUTE))
    await expectStatus(await cancel(dee, lateBooking), 422, 'cancellation_window_passed')
    assert.equal((await bookingRow(lateBooking)).state, 'confirmed')
    assert.equal(await cancellationOf(lateBooking), undefined)
    assert.equal(await balanceOf(bundle), 1)
    await assertLedger(bundle)
  })

  test('CXL-10, CXL-11 each window and cap combination: full refund only when both pass, otherwise nothing, with the reason to match', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const { cancelCapCount, classWindowHours } = await policyOf(one)
    const eve = await member(one, 'eve')
    const bundle = await give(one, eve, 'credit_bundle', { credits: 10 })
    const startsAt = shifted(t0, 10 * DAY)
    const lateAt = shifted(startsAt, -classWindowHours * HOUR + MINUTE)
    const judge = (now: Date) =>
      evaluator.evaluateCancellation({ tenantId: one.id, clientId: eve.clientId, kind: 'class', sessionStartsAt: startsAt, now })

    // In time, under the cap: the credit (two of them) comes back whole.
    assert.deepEqual(
      { ...(await judge(t0)) },
      { allowed: true, refund: 'full', reason: 'within_window_within_cap', wasWithinWindow: true, wasWithinCap: true, windowHours: classWindowHours },
    )
    const late = await bookOk(eve, await addClass(one, startsAt, { creditCost: 2 }))
    // Late, under the cap: the reason is `late`, and a member's late cancel is refused.
    harness.clock.set(lateAt)
    assert.equal((await judge(lateAt)).reason, 'late')
    assert.equal((await judge(lateAt)).refund, 'forfeit')
    await expectStatus(await cancel(eve, late), 422, 'cancellation_window_passed')
    assert.equal((await bookingRow(late)).state, 'confirmed')

    harness.clock.set(t0)
    const inTime = await cancelInTime(one, eve, t0, cancelCapCount, { use_credits: true })
    for (const id of inTime) {
      const row = await bookingRow(id)
      assert.equal(row.refundOutcome, 'credit_returned')
      assert.equal((await cancellationOf(id))?.refundFired, true)
    }

    // In time, over the cap: recorded, nothing returned.
    assert.equal((await judge(t0)).reason, 'over_cap')
    assert.equal((await judge(t0)).refund, 'forfeit')
    const overCap = await bookOk(eve, await addClass(one, shifted(t0, 9 * DAY), { creditCost: 2 }))
    const balanceBefore = await balanceOf(bundle)
    const res = await expectStatus(await cancel(eve, overCap), 200)
    assert.equal(res.refund_outcome, 'forfeited')
    assert.equal(res.refund_fired, false)
    const row = await bookingRow(overCap)
    assert.equal(row.state, 'cancelled')
    assert.equal(row.refundOutcome, 'forfeited')
    assert.equal(await balanceOf(bundle), balanceBefore, 'not even part of the two credits comes back')
    const record = await cancellationOf(overCap)
    assert.ok(record)
    assert.equal(record.wasWithinWindow, true)
    assert.equal(record.wasWithinCap, false)
    assert.equal(record.refundFired, false)

    // Late and over the cap: both reasons, and still refused outright.
    harness.clock.set(lateAt)
    assert.equal((await judge(lateAt)).reason, 'late_and_over_cap')
    assert.equal((await judge(lateAt)).refund, 'forfeit')
    await expectStatus(await cancel(eve, late), 422, 'cancellation_window_passed')
    assert.equal((await bookingRow(late)).state, 'confirmed')
    assert.equal(await cancellationOf(late), undefined)
    await assertLedger(bundle)
  })

  /* ── the shared cap ─────────────────────────────────────────────────── */

  test('CXL-13, CXL-11 with a cap of 3 and two class cancels, an early PT cancel is refunded and the next class cancel forfeits: one shared cap', async () => {
    try {
      await expectStatus(await patchPolicy(one.admin.headers, { cancel_cap_count: 3 }), 200)
      const t0 = aWeekOut()
      harness.clock.set(t0)
      const fay = await member(one, 'fay')
      const bundle = await give(one, fay, 'credit_bundle', { credits: 10 })
      const pack = await give(one, fay, 'pt', { credits: 3 })

      await cancelInTime(one, fay, t0, 2)
      assert.equal(await balanceOf(bundle), 10)

      const requestId = await ptRequestOk(fay, one, pack)
      await schedulePt(one, requestId, ptStart(t0, 4))
      assert.equal(await balanceOf(pack), 2)
      const ptRes = await expectStatus(await ptCancel(fay, requestId), 200)
      assert.equal(ptRes.status, 'cancelled_after_scheduled')
      assert.equal(ptRes.refundOutcome, 'session_returned')
      assert.equal(ptRes.refundedSessions, 1)
      const ptBooking = await ptBookingOf(requestId)
      assert.equal(ptBooking.state, 'cancelled')
      assert.equal(ptBooking.refundOutcome, 'session_returned')
      assert.equal(await balanceOf(pack), 3)
      await assertLedger(pack)
      const ptRecord = await cancellationOf(ptBooking.id)
      assert.ok(ptRecord)
      assert.equal(ptRecord.kind, 'pt')
      assert.equal(ptRecord.source, 'client')
      assert.equal(ptRecord.wasWithinCap, true)
      assert.equal(ptRecord.refundFired, true)

      // The PT cancel was the third: this class cancel is over the shared cap.
      const bookingId = await bookOk(fay, await addClass(one, shifted(t0, 6 * DAY)))
      const res = await expectStatus(await cancel(fay, bookingId), 200)
      assert.equal(res.refund_outcome, 'forfeited')
      assert.equal((await bookingRow(bookingId)).refundOutcome, 'forfeited')
      assert.equal(await balanceOf(bundle), 9)
      await assertLedger(bundle)
      const record = await cancellationOf(bookingId)
      assert.ok(record)
      assert.equal(record.wasWithinWindow, true)
      assert.equal(record.wasWithinCap, false)
      assert.equal(record.refundFired, false)
    } finally {
      await restorePolicies()
    }
  })

  test('CXL-14 cancelled Unlimited-paid bookings count toward the cap: the next in-time PT cancel forfeits its session', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const { cancelCapCount } = await policyOf(one)
    const gus = await member(one, 'gus')
    const plan = await give(one, gus, 'unlimited', { expiresAt: shifted(t0, 60 * DAY) })
    // A running Unlimited Plan pays for every class, so the money that the cap
    // decides on here is a PT session.
    const pack = await give(one, gus, 'pt', { credits: 2 })
    const requestId = await ptRequestOk(gus, one, pack)
    await schedulePt(one, requestId, ptStart(t0, 8))
    assert.equal(await balanceOf(pack), 1)

    for (const id of await cancelInTime(one, gus, t0, cancelCapCount)) {
      const row = await bookingRow(id)
      assert.equal(row.clientPackageId, plan, 'the Unlimited Plan paid')
      assert.equal(row.refundOutcome, 'n_a')
      const record = await cancellationOf(id)
      assert.ok(record)
      assert.equal(record.source, 'client')
      assert.equal(record.wasWithinWindow, true)
      assert.equal(record.wasWithinCap, true)
      assert.equal(record.refundFired, false)
    }

    assert.equal((await adjustmentsOf(plan)).length, 0)

    const res = await expectStatus(await ptCancel(gus, requestId), 200)
    assert.equal(res.refundOutcome, 'forfeited')
    assert.equal(res.refundedSessions, 0)
    const booking = await ptBookingOf(requestId)
    assert.equal(booking.state, 'cancelled')
    assert.equal(booking.refundOutcome, 'forfeited')
    assert.equal(await balanceOf(pack), 1)
    await assertLedger(pack)
    const record = await cancellationOf(booking.id)
    assert.ok(record)
    assert.equal(record.wasWithinWindow, true)
    assert.equal(record.wasWithinCap, false)
    assert.equal(record.refundFired, false)
  })

  test('CXL-15 no-shows and admin-made cancellations in the cycle do not count: the member’s early cancel is refunded', async () => {
    const t0 = aWeekOut()
    const { cancelCapCount, cancelCapCycleDays } = await policyOf(one)
    // The no-show is today and the cap is judged a week on: both inside one cycle.
    assert.ok(cancelCapCycleDays > 8, `a ${cancelCapCycleDays}-day cycle would not hold the no-show`)
    const hal = await member(one, 'hal')
    const bundle = await give(one, hal, 'credit_bundle', { credits: 10 })

    // A no-show, on a class that really has started (marking one reads the wall clock).
    const startedAt = new Date(Math.floor((Date.now() - 2 * HOUR) / MINUTE) * MINUTE)
    harness.clock.set(shifted(startedAt, -3 * DAY))
    const missed = await bookOk(hal, await addClass(one, startedAt))
    harness.clock.reset()
    await expectStatus(await noShow(one.admin.headers, missed), 200)
    assert.equal((await bookingRow(missed)).state, 'no_show')

    // As many admin cancels as the cap allows client ones.
    harness.clock.set(t0)
    for (let i = 0; i < cancelCapCount; i++) {
      const id = await bookOk(hal, await addClass(one, shifted(t0, (3 + i) * DAY)))
      await expectStatus(await adminCancel(one.admin.headers, id), 200)
      assert.equal((await cancellationOf(id))?.source, 'admin')
    }

    const bookingId = await bookOk(hal, await addClass(one, shifted(t0, 9 * DAY)))
    const balanceBefore = await balanceOf(bundle)
    assert.equal(typeof balanceBefore, 'number')
    const res = await expectStatus(await cancel(hal, bookingId), 200)
    assert.equal(res.refund_outcome, 'credit_returned')
    assert.equal(res.refund_fired, true)
    assert.equal((await bookingRow(bookingId)).refundOutcome, 'credit_returned')
    assert.equal(await balanceOf(bundle), balanceBefore! + 1)
    await assertLedger(bundle)
    const record = await cancellationOf(bookingId)
    assert.ok(record)
    assert.equal(record.wasWithinCap, true)
    assert.equal(record.refundFired, true)
  })

  /* ── the policy an Admin saves ──────────────────────────────────────── */

  test('CXL-08 the class window, PT window, cap and cycle an Admin saves are what the next cancels are judged by', async () => {
    try {
      // Tenant two, so the change is visibly that studio's own.
      const policy = await expectStatus(
        await patchPolicy(two.admin.headers, { class_window_hours: 2, pt_window_hours: 48, cancel_cap_count: 1, cancel_cap_cycle_days: 5 }),
        200,
      )
      assert.deepEqual(
        [policy.class_window_hours, policy.pt_window_hours, policy.cancel_cap_count, policy.cancel_cap_cycle_days, policy.updated_by_staff_id],
        [2, 48, 1, 5, two.admin.id],
      )
      assert.equal((await policyOf(one)).classWindowHours, seededPolicy.get(one.id)!.classWindowHours, 'the other studio’s policy is untouched')

      const t0 = aWeekOut()
      const ida = await member(two, 'ida')
      const bundle = await give(two, ida, 'credit_bundle', { credits: 10 })
      const pack = await give(two, ida, 'pt', { credits: 2 })

      // Class window 2h: three hours before start is in good time (the seeded 24h would refuse it).
      harness.clock.set(t0)
      const classStart = shifted(t0, 3 * DAY)
      const first = await bookOk(ida, await addClass(two, classStart))
      harness.clock.set(shifted(classStart, -3 * HOUR))
      const res = await expectStatus(await cancel(ida, first), 200)
      assert.equal(res.refund_outcome, 'credit_returned')
      assert.equal(await balanceOf(bundle), 10)
      assert.equal((await cancellationOf(first))?.wasWithinWindow, true)

      // Cap 1: the second cancel in the 5-day cycle forfeits…
      harness.clock.set(t0)
      const second = await bookOk(ida, await addClass(two, shifted(t0, 4 * DAY)))
      const forfeited = await expectStatus(await cancel(ida, second), 200)
      assert.equal(forfeited.refund_outcome, 'forfeited')
      assert.equal(await balanceOf(bundle), 9)
      assert.equal((await cancellationOf(second))?.wasWithinCap, false)

      // …and five days after the later of the two (at 3 days less 3 hours), the cycle has passed them both.
      harness.clock.set(shifted(t0, 8 * DAY))
      const third = await bookOk(ida, await addClass(two, shifted(t0, 11 * DAY)))
      const refunded = await expectStatus(await cancel(ida, third), 200)
      assert.equal(refunded.refund_outcome, 'credit_returned')
      assert.equal(await balanceOf(bundle), 9)
      await assertLedger(bundle)

      // PT window 48h: a PT cancel 30 hours out is refused (the seeded 24h would allow it).
      harness.clock.set(t0)
      const requestId = await ptRequestOk(ida, two, pack)
      const ptAt = ptStart(t0, 5)
      await schedulePt(two, requestId, ptAt)
      harness.clock.set(shifted(ptAt, -30 * HOUR))
      await expectStatus(await ptCancel(ida, requestId), 422, 'cancellation_window_passed')
      assert.equal((await ptBookingOf(requestId)).state, 'confirmed')
      assert.equal(await balanceOf(pack), 1)
      await assertLedger(pack)
    } finally {
      await restorePolicies()
    }
  })

  test('CXL-19 with a 24-hour PT window and a 12-hour class window, a PT cancel 18 hours out is refused; a class cancel 18 hours out is not', async () => {
    try {
      await expectStatus(await patchPolicy(one.admin.headers, { pt_window_hours: 24, class_window_hours: 12 }), 200)
      const t0 = aWeekOut()
      harness.clock.set(t0)
      const jon = await member(one, 'jon')
      const bundle = await give(one, jon, 'credit_bundle', { credits: 2 })
      const pack = await give(one, jon, 'pt', { credits: 2 })

      const requestId = await ptRequestOk(jon, one, pack)
      const ptAt = ptStart(t0, 3)
      await schedulePt(one, requestId, ptAt)
      const classAt = shifted(t0, 4 * DAY)
      const bookingId = await bookOk(jon, await addClass(one, classAt))

      harness.clock.set(shifted(ptAt, -18 * HOUR))
      const refused = await expectStatus(await ptCancel(jon, requestId), 422, 'cancellation_window_passed')
      assert.equal(refused.window_hours, 24, 'the PT window, not the class window')
      const ptBooking = await ptBookingOf(requestId)
      assert.equal(ptBooking.state, 'confirmed')
      assert.equal(await cancellationOf(ptBooking.id), undefined)
      assert.equal(await balanceOf(pack), 1)
      await assertLedger(pack)

      harness.clock.set(shifted(classAt, -18 * HOUR))
      const res = await expectStatus(await cancel(jon, bookingId), 200)
      assert.equal(res.refund_outcome, 'credit_returned')
      assert.equal(await balanceOf(bundle), 2)
      await assertLedger(bundle)
    } finally {
      await restorePolicies()
    }
  })

  /* ── refusals ───────────────────────────────────────────────────────── */

  test('CXL-20 another member’s booking cannot be cancelled, nor can another studio’s: the booking and balance are unchanged', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const kit = await member(one, 'kit')
    const bundle = await give(one, kit, 'credit_bundle', { credits: 2 })
    const bookingId = await bookOk(kit, await addClass(one, shifted(t0, 3 * DAY)))
    const lou = await member(one, 'lou')
    const max = await member(two, 'max')

    await expectStatus(await cancel(lou, bookingId), 403, 'not_your_booking')
    await expectStatus(await cancel(max, bookingId), 404)
    // Staff are not members, and a member is not staff.
    await expectStatus(await cancel({ clientId: '', headers: one.admin.headers }, bookingId), 401)
    await expectStatus(await adminCancel(kit.headers, bookingId), 401)
    await expectStatus(await adminCancel(one.instructor.headers, bookingId), 403)
    await expectStatus(await adminCancel(two.admin.headers, bookingId), 404)

    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
    assert.equal(await cancellationOf(bookingId), undefined)
    assert.equal(await balanceOf(bundle), 1)
    await assertLedger(bundle)
  })

  test('CXL-21 cancelling a booking twice is refused 409 and the credit comes back once', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const ned = await member(one, 'ned')
    const bundle = await give(one, ned, 'credit_bundle', { credits: 2 })
    const bookingId = await bookOk(ned, await addClass(one, shifted(t0, 3 * DAY)))

    await expectStatus(await cancel(ned, bookingId), 200)
    await expectStatus(await cancel(ned, bookingId), 409, 'not_cancellable')
    // Nor may an admin refund it a second time.
    await expectStatus(await adminCancel(one.admin.headers, bookingId), 409, 'not_cancellable')

    assert.equal((await bookingRow(bookingId)).refundOutcome, 'credit_returned')
    assert.equal(await balanceOf(bundle), 2)
    assert.equal((await refundsOn(bundle)).length, 1)
    assert.ok(await cancellationOf(bookingId))
    await assertLedger(bundle)
  })

  test('CXL-22 cancelling a booking id that does not exist is 404', async () => {
    const oz = await member(one, 'oz')
    await expectStatus(await cancel(oz, randomUUID()), 404, 'booking_not_found')
    await expectStatus(await adminCancel(one.admin.headers, randomUUID()), 404, 'booking_not_found')
    await expectStatus(await adminCancelClass(one.admin.headers, randomUUID()), 404, 'class_not_found')
  })

  test('CXL-23 a workshop purchase cannot be cancelled for a refund', async () => {
    const pia = await member(one, 'pia')
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: one.id, name: WORKSHOP_NAME, locationId: one.locationId, createdByStaffId: one.admin.id })
      .returning({ id: schema.workshops.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: one.id, workshopId: workshop!.id, name: 'Full', regularPriceSgd: '80.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    const [booking] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: one.id,
        clientId: pia.clientId,
        kind: 'workshop',
        workshopId: workshop!.id,
        workshopTierId: tier!.id,
        listPriceSgd: '80.00',
        amountPaidSgd: '80.00',
        qrToken: `qr-${randomUUID()}`,
        code: `W${run}`.slice(0, 12),
      })
      .returning({ id: schema.bookings.id })

    await expectStatus(await cancel(pia, booking!.id), 400, 'workshop_cancel_unsupported')

    const row = await bookingRow(booking!.id)
    assert.equal(row.state, 'confirmed')
    assert.equal(row.refundOutcome, 'n_a')
    assert.equal(await cancellationOf(booking!.id), undefined)
  })

  /* ── an Admin's cancel ──────────────────────────────────────────────── */

  test('CXL-24 an admin force-cancel inside the window, or over the cap, returns the credits in full and records source admin', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const { cancelCapCount, classWindowHours } = await policyOf(one)
    const quin = await member(one, 'quin')
    const bundle = await give(one, quin, 'credit_bundle', { credits: 10 })
    const insideStart = shifted(t0, 8 * DAY)
    const inside = await bookOk(quin, await addClass(one, insideStart, { creditCost: 2 }))
    const overCap = await bookOk(quin, await addClass(one, shifted(t0, 9 * DAY), { creditCost: 2 }))
    await cancelInTime(one, quin, t0, cancelCapCount)
    assert.equal(await balanceOf(bundle), 6)

    // Over the cap, in good time.
    const res = await expectStatus(await adminCancel(one.admin.headers, overCap), 200)
    assert.equal(res.refund_outcome, 'credit_returned')
    assert.equal(res.refund_fired, true)
    // Inside the window, where the member themself would be refused.
    harness.clock.set(shifted(insideStart, -classWindowHours * HOUR + HOUR))
    await expectStatus(await cancel(quin, inside), 422, 'cancellation_window_passed')
    await expectStatus(await adminCancel(one.admin.headers, inside), 200)

    for (const id of [overCap, inside]) {
      const row = await bookingRow(id)
      assert.equal(row.state, 'cancelled')
      assert.equal(row.refundOutcome, 'credit_returned')
      const record = await cancellationOf(id)
      assert.ok(record)
      assert.equal(record.source, 'admin')
      assert.equal(record.refundFired, true)
    }
    assert.equal(await balanceOf(bundle), 10)
    const adminRefunds = (await refundsOn(bundle)).filter(a => a.reason === 'admin_cancellation_refund')
    assert.deepEqual(adminRefunds.map(a => [a.delta, a.actedByStaffId]), [[2, one.admin.id], [2, one.admin.id]])
    await assertLedger(bundle)
  })

  test('CXL-26 an Instructor cancelling their own PT session returns it to the member’s package and raises an Inbox item', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const { ptWindowHours } = await policyOf(one)
    const rae = await member(one, 'rae')
    const pack = await give(one, rae, 'pt', { credits: 2 })
    const requestId = await ptRequestOk(rae, one, pack)
    const ptAt = ptStart(t0, 3)
    await schedulePt(one, requestId, ptAt)
    assert.equal(await balanceOf(pack), 1)

    // Another instructor, another studio's instructor, and the member themself cannot.
    const other = await staffAt(one, 'other-instructor', 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: other.id })
    await expectStatus(await instructorPtCancel(other.headers, requestId), 403)
    await expectStatus(await instructorPtCancel(two.instructor.headers, requestId), 404)
    await expectStatus(await instructorPtCancel(rae.headers, requestId), 401)
    assert.equal((await ptBookingOf(requestId)).state, 'confirmed')

    // Inside the member's window: the instructor's cancel still returns the session.
    harness.clock.set(shifted(ptAt, -(ptWindowHours * HOUR) / 2))
    const res = await expectStatus(await instructorPtCancel(one.instructor.headers, requestId), 200)
    assert.equal((res.result as Record<string, unknown>).refundOutcome, 'session_returned')

    const booking = await ptBookingOf(requestId)
    assert.equal(booking.state, 'cancelled')
    assert.equal(booking.refundOutcome, 'session_returned')
    assert.equal(await balanceOf(pack), 2)
    await assertLedger(pack)
    const record = await cancellationOf(booking.id)
    assert.ok(record)
    assert.equal(record.kind, 'pt')
    // Staff-made, so it never counts toward the member's cap. Whether it should
    // read `instructor` like the class path rather than today's `admin` is #239.
    assert.notEqual(record.source, 'client')
    assert.equal(record.refundFired, true)

    const inbox = await harness.db
      .select()
      .from(schema.inboxItems)
      .where(and(eq(schema.inboxItems.tenantId, one.id), sql`${schema.inboxItems.payload}->>'ptRequestId' = ${requestId}`))
    assert.equal(inbox.length, 1)
    assert.equal(inbox[0]!.type, 'admin_cancel_class_pt')
    assert.equal((inbox[0]!.payload as Record<string, unknown>).actorStaffId, one.instructor.id)
  })

  test('CXL-28, CXL-29, CXL-30 an Admin cancelling a class stamps it and cancels every booking: credits back in full whatever the window or cap, Unlimited ones n_a', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const { cancelCapCount, classWindowHours } = await policyOf(one)
    const startsAt = shifted(t0, 12 * DAY)
    const classId = await addClass(one, startsAt, { creditCost: 2 })

    // One over their cap, one who will be inside their window, one on an Unlimited Plan.
    const sal = await member(one, 'sal')
    const salBundle = await give(one, sal, 'credit_bundle', { credits: 10 })
    await cancelInTime(one, sal, t0, cancelCapCount)
    const salBooking = await bookOk(sal, classId)
    const tam = await member(one, 'tam')
    const tamBundle = await give(one, tam, 'credit_bundle', { credits: 4 })
    const tamBooking = await bookOk(tam, classId)
    const uma = await member(one, 'uma')
    const umaPlan = await give(one, uma, 'unlimited', { expiresAt: shifted(t0, 60 * DAY) })
    const umaBooking = await bookOk(uma, classId)
    assert.equal(await balanceOf(salBundle), 8)
    assert.equal(await balanceOf(tamBundle), 2)

    harness.clock.set(shifted(startsAt, -classWindowHours * HOUR + HOUR))
    await expectStatus(await cancel(tam, tamBooking), 422, 'cancellation_window_passed')

    const res = await expectStatus(await adminCancelClass(one.admin.headers, classId), 200)
    assert.equal(res.total_bookings, 3)
    assert.equal(res.refunded_count, 2)

    const [cls] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, classId))
    assert.equal(cls!.lifecycle, 'cancelled')
    assert.ok(cls!.cancelledAt, 'cancelled_at is stamped')
    assert.equal(cls!.cancelledByStaffId, one.admin.id)
    assert.equal(await confirmedOn(classId), 0)

    for (const [id, bundle] of [[salBooking, salBundle], [tamBooking, tamBundle]] as const) {
      const row = await bookingRow(id)
      assert.equal(row.state, 'cancelled')
      assert.equal(row.refundOutcome, 'credit_returned')
      const record = await cancellationOf(id)
      assert.ok(record)
      assert.equal(record.source, 'admin')
      assert.equal(record.refundFired, true)
      const classRefund = (await refundsOn(bundle)).filter(a => a.reason === 'admin_class_cancellation_refund')
      assert.deepEqual(classRefund.map(a => a.delta), [2], 'both credits, to the package that paid')
      await assertLedger(bundle)
    }
    assert.equal(await balanceOf(salBundle), 10)
    assert.equal(await balanceOf(tamBundle), 4)

    const umaRow = await bookingRow(umaBooking)
    assert.equal(umaRow.state, 'cancelled')
    assert.equal(umaRow.refundOutcome, 'n_a')
    const umaRecord = await cancellationOf(umaBooking)
    assert.ok(umaRecord)
    assert.equal(umaRecord.refundFired, false)
    assert.equal(await balanceOf(umaPlan), null)
    assert.equal((await adjustmentsOf(umaPlan)).length, 0)
  })

  test('CXL-31 cancelling a class already cancelled is refused 409 class_not_active and refunds no one twice', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const vic = await member(one, 'vic')
    const bundle = await give(one, vic, 'credit_bundle', { credits: 3 })
    const classId = await addClass(one, shifted(t0, 3 * DAY))
    const bookingId = await bookOk(vic, classId)

    await expectStatus(await adminCancelClass(one.admin.headers, classId), 200)
    await expectStatus(await adminCancelClass(one.admin.headers, classId), 409, 'class_not_active')

    assert.equal((await bookingRow(bookingId)).refundOutcome, 'credit_returned')
    assert.equal(await balanceOf(bundle), 3)
    assert.equal((await refundsOn(bundle)).length, 1)
    assert.ok(await cancellationOf(bookingId))
    await assertLedger(bundle)
  })

  test('CXL-32 a booking made while the class is being cancelled is either refunded by the cancel or refused, never left confirmed', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    for (let i = 0; i < 6; i++) {
      const wes = await member(one, `wes-${i}`)
      const bundle = await give(one, wes, 'credit_bundle', { credits: 2 })
      const classId = await addClass(one, shifted(t0, (3 + i) * DAY))

      const [booked, cancelled] = await Promise.all([book(wes, classId), adminCancelClass(one.admin.headers, classId)])
      await expectStatus(cancelled, 200)

      const rows = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.classId, classId))
      if (booked.status === 201) {
        // It landed first: the cancel took it and gave the credit back.
        assert.equal(rows.length, 1)
        assert.equal(rows[0]!.state, 'cancelled')
        assert.equal(rows[0]!.refundOutcome, 'credit_returned')
        assert.equal((await cancellationOf(rows[0]!.id))?.source, 'admin')
      } else {
        // The class was no longer active when it tried.
        await expectStatus(booked, 404, 'class_not_found')
        assert.equal(rows.length, 0)
      }
      assert.equal(await confirmedOn(classId), 0)
      assert.equal(await balanceOf(bundle), 2)
      await assertLedger(bundle)
    }
  })

  /* ── who may call each endpoint ─────────────────────────────────────── */

  test('cancelling a class: another studio’s admin, an instructor or a member is refused and nothing moves', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const xia = await member(one, 'xia')
    const bundle = await give(one, xia, 'credit_bundle', { credits: 2 })
    const classId = await addClass(one, shifted(t0, 3 * DAY))
    await bookOk(xia, classId)

    await expectStatus(await adminCancelClass(two.admin.headers, classId), 404)
    await expectStatus(await adminCancelClass(one.instructor.headers, classId), 403)
    await expectStatus(await adminCancelClass(xia.headers, classId), 401)

    const [cls] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, classId))
    assert.equal(cls!.lifecycle, 'active')
    assert.equal(await confirmedOn(classId), 1)
    assert.equal(await balanceOf(bundle), 1)
    await assertLedger(bundle)
  })

  test('cancelling a PT session: another member or another studio’s member is refused', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const yan = await member(one, 'yan')
    const pack = await give(one, yan, 'pt', { credits: 2 })
    const requestId = await ptRequestOk(yan, one, pack)
    await schedulePt(one, requestId, ptStart(t0, 3))
    const zed = await member(one, 'zed')
    const amy = await member(two, 'amy')

    await expectStatus(await ptCancel(zed, requestId), 403, 'not_your_request')
    await expectStatus(await ptCancel(amy, requestId), 404)
    await expectStatus(await ptCancel({ clientId: '', headers: one.admin.headers }, requestId), 401)

    assert.equal((await ptBookingOf(requestId)).state, 'confirmed')
    assert.equal(await balanceOf(pack), 1)
    await assertLedger(pack)
  })

  test('saving the policy: another studio’s admin changes only their own; an instructor or a member is refused', async () => {
    try {
      const seeded = seededPolicy.get(one.id)!
      await expectStatus(await patchPolicy(one.instructor.headers, { cancel_cap_count: 0 }), 403)
      const bea = await member(one, 'bea')
      await expectStatus(await patchPolicy(bea.headers, { cancel_cap_count: 0 }), 401)
      // Studio two's admin, naming studio one from studio one's portal.
      const asOne = { ...two.admin.headers, 'X-Tenant-Slug': one.slug, Origin: `http://${one.slug}.portal.localhost:3001` }
      await expectStatus(await patchPolicy(asOne, { cancel_cap_count: 0 }), 403)
      await expectStatus(await patchPolicy(two.admin.headers, { cancel_cap_count: seeded.cancelCapCount + 1 }), 200)
      assert.equal((await policyOf(one)).cancelCapCount, seeded.cancelCapCount)
      assert.equal((await policyOf(two)).cancelCapCount, seeded.cancelCapCount + 1)
    } finally {
      await restorePolicies()
    }
  })
})
