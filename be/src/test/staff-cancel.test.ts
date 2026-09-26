import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.staff-cancel.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Staff cancel class type ${run}`
const PACKAGE_NAME = `Staff cancel pass ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * A staff member cancels one member's class booking from the portal (#320):
 * an admin on any class, an instructor on a class they lead. Every staff cancel
 * chooses — Return credit or Keep credit — and neither the window nor the cap
 * chooses for them; a staff cancel never counts toward the member's cap.
 *
 * Each test stands the app's clock at a chosen instant, acts through the
 * route, then reads what it left: the booking and its outcome, the package
 * balance, the `cancellations` row and the refund ledger.
 */
describe('staff cancel of a member booking over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')

  type Staff = { id: string; headers: Record<string, string> }
  type Member = { clientId: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    classPackageId: string
    admin: Staff
    instructor: Staff
    otherInstructor: Staff
  }
  type Role = 'admin' | 'instructor'

  let one!: Studio
  let two!: Studio

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }
  const aWeekOut = () => new Date(Math.floor((Date.now() + 7 * DAY) / MINUTE) * MINUTE)
  const shifted = (from: Date, ms: number) => new Date(from.getTime() + ms)

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: Role): Promise<Staff> {
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
    const [classPackage] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: PACKAGE_NAME, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      classTypeId: classType.id,
      classPackageId: classPackage!.id,
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
      otherInstructor: await staffAt(tenant, 'other-instructor', 'instructor'),
    }
  }

  /** A class starting at `startsAt`, led by the studio's (first) instructor. */
  async function addClass(at: Studio, startsAt: Date, options: { creditCost?: number } = {}): Promise<string> {
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
        capacityOnline: 10,
        creditCost: options.creditCost ?? 1,
        createdByStaffId: at.instructor.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
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
    return { clientId: client!.id, headers }
  }

  /** A Dormant Credit Bundle, or an Activated Unlimited Plan, the member holds. */
  async function give(at: Studio, who: Member, kind: 'credit_bundle' | 'unlimited', credits = 10): Promise<string> {
    const unlimited = kind === 'unlimited'
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind,
        sourceClassPackageId: unlimited ? null : at.classPackageId,
        locationId: unlimited ? at.locationId : null,
        durationMonths: unlimited ? 1 : null,
        validityDays: unlimited ? null : 90,
        creditsOrSessionsRemaining: unlimited ? null : credits,
        expiresAt: unlimited ? shifted(aWeekOut(), 60 * DAY) : null,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  async function book(who: Member, classId: string): Promise<string> {
    const res = await harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({ class_id: classId }),
    })
    return (await expectStatus(res, 201)).booking_id as string
  }

  const memberCancel = (who: Member, bookingId: string) =>
    harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers: who.headers })

  const staffCancel = (role: Role, as: Staff, bookingId: string, body: unknown) =>
    harness.app.request(`/api/v1/portal/${role}/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: { ...as.headers, ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  /* ── state ──────────────────────────────────────────────────────────── */

  async function bookingRow(bookingId: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.ok(row, `no booking row ${bookingId}`)
    return row
  }

  async function balanceOf(packageId: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, packageId))
    return row!.creditsOrSessionsRemaining
  }

  async function cancellationOf(bookingId: string) {
    const rows = await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))
    assert.ok(rows.length <= 1, `more than one cancellation recorded for ${bookingId}`)
    return rows[0]
  }

  const refundsOn = async (packageId: string) =>
    (
      await harness.db
        .select()
        .from(schema.manualAdjustments)
        .where(eq(schema.manualAdjustments.clientPackageId, packageId))
    ).filter(a => a.delta > 0)

  async function policyOf(at: Studio) {
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, at.id))
    assert.ok(policy, `expected a seeded policy for ${at.slug}`)
    return policy
  }

  const staffOf = (at: Studio, role: Role) => (role === 'admin' ? at.admin : at.instructor)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── Return credit / Keep credit ────────────────────────────────────── */

  for (const role of ['admin', 'instructor'] as const) {
    test(`CXL-45 an ${role} cancel choosing Return credit puts the credits back to the paying package and records source ${role}`, async () => {
      const t0 = aWeekOut()
      harness.clock.set(t0)
      const ada = await member(one, `ada-return-${role}`)
      const bundle = await give(one, ada, 'credit_bundle')
      const bookingId = await book(ada, await addClass(one, shifted(t0, 3 * DAY), { creditCost: 2 }))
      assert.equal(await balanceOf(bundle), 8)

      const res = await expectStatus(await staffCancel(role, staffOf(one, role), bookingId, { credit: 'return' }), 200)
      assert.deepEqual(res, { refund_outcome: 'credit_returned', refund_fired: true })

      const row = await bookingRow(bookingId)
      assert.equal(row.state, 'cancelled')
      assert.equal(row.refundOutcome, 'credit_returned')
      assert.equal(await balanceOf(bundle), 10)
      const refunds = await refundsOn(bundle)
      assert.deepEqual(
        refunds.map(r => [r.delta, r.reason, r.actedByStaffId]),
        [[2, `${role}_cancellation_refund`, staffOf(one, role).id]],
      )
      const record = await cancellationOf(bookingId)
      assert.equal(record?.source, role)
      assert.equal(record?.refundFired, true)
      assert.equal(record?.wasWithinWindow, true)
    })

    test(`CXL-46 an ${role} cancel choosing Keep credit moves nothing, records a forfeit and shows on the member's history as a late cancel`, async () => {
      const t0 = aWeekOut()
      harness.clock.set(t0)
      const { classWindowHours } = await policyOf(one)
      const bea = await member(one, `bea-keep-${role}`)
      const bundle = await give(one, bea, 'credit_bundle')
      const startsAt = shifted(t0, 3 * DAY)
      const bookingId = await book(bea, await addClass(one, startsAt))
      assert.equal(await balanceOf(bundle), 9)

      // Inside the class's window, so the record says so.
      harness.clock.set(shifted(startsAt, -classWindowHours * HOUR + HOUR))
      const res = await expectStatus(await staffCancel(role, staffOf(one, role), bookingId, { credit: 'keep' }), 200)
      assert.deepEqual(res, { refund_outcome: 'forfeited', refund_fired: false })

      assert.equal((await bookingRow(bookingId)).refundOutcome, 'forfeited')
      assert.equal(await balanceOf(bundle), 9)
      assert.deepEqual(await refundsOn(bundle), [])
      const record = await cancellationOf(bookingId)
      assert.equal(record?.source, role)
      assert.equal(record?.refundFired, false)
      assert.equal(record?.wasWithinWindow, false)

      const profile = await expectStatus(
        await harness.app.request(`/api/v1/portal/admin/clients/${bea.clientId}`, { headers: one.admin.headers }),
        200,
      )
      assert.equal(profile.attendance.late_cancels, 1)
    })
  }

  test('CXL-47 an Unlimited-paid booking is n_a whichever credit choice staff make', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const cy = await member(one, 'cy-unlimited')
    await give(one, cy, 'unlimited')
    for (const [role, credit] of [['admin', 'return'], ['admin', 'keep'], ['instructor', 'return'], ['instructor', 'keep']] as const) {
      const bookingId = await book(cy, await addClass(one, shifted(t0, 3 * DAY)))
      const res = await expectStatus(await staffCancel(role, staffOf(one, role), bookingId, { credit }), 200)
      assert.deepEqual(res, { refund_outcome: 'n_a', refund_fired: false }, `${role} ${credit}`)
      assert.equal((await bookingRow(bookingId)).refundOutcome, 'n_a')
    }
  })

  /* ── refusals ───────────────────────────────────────────────────────── */

  test('CXL-48 an instructor cannot cancel a booking on a class they do not lead', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const dee = await member(one, 'dee-not-theirs')
    const bundle = await give(one, dee, 'credit_bundle')
    const bookingId = await book(dee, await addClass(one, shifted(t0, 3 * DAY)))

    await expectStatus(
      await staffCancel('instructor', one.otherInstructor, bookingId, { credit: 'return' }),
      403,
      'not_your_session',
    )
    // Another studio's admin, naming this studio's booking.
    await expectStatus(await staffCancel('admin', two.admin, bookingId, { credit: 'return' }), 404)
    // An instructor on the admin route.
    await expectStatus(await staffCancel('admin', one.instructor, bookingId, { credit: 'return' }), 403)

    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
    assert.equal(await balanceOf(bundle), 9)
    assert.equal(await cancellationOf(bookingId), undefined)
  })

  test('CXL-49 a booking marked attended is refused booking_attended until it is unticked', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const eve = await member(one, 'eve-attended')
    const bundle = await give(one, eve, 'credit_bundle')
    const bookingId = await book(eve, await addClass(one, shifted(t0, 3 * DAY)))
    await harness.db.update(schema.bookings).set({ checkInState: 'attended' }).where(eq(schema.bookings.id, bookingId))

    for (const role of ['admin', 'instructor'] as const) {
      await expectStatus(await staffCancel(role, staffOf(one, role), bookingId, { credit: 'return' }), 409, 'booking_attended')
    }
    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
    assert.equal(await balanceOf(bundle), 9)
  })

  test('CXL-50 a staff cancel without a credit choice, or with another value, is a validation error', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const fay = await member(one, 'fay-no-choice')
    await give(one, fay, 'credit_bundle')
    const bookingId = await book(fay, await addClass(one, shifted(t0, 3 * DAY)))

    for (const role of ['admin', 'instructor'] as const) {
      for (const body of [undefined, {}, { credit: 'refund' }, { credit: null }]) {
        await expectStatus(await staffCancel(role, staffOf(one, role), bookingId, body), 400)
      }
    }
    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
    assert.equal(await cancellationOf(bookingId), undefined)
  })

  /* ── the cap ────────────────────────────────────────────────────────── */

  test('CXL-51 staff cancels never count toward the member’s Cancellation Cap', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const { cancelCapCount, cancelCapEnabled } = await policyOf(one)
    assert.equal(cancelCapEnabled, true, 'the seeded policy has the cap on')
    const gus = await member(one, 'gus-cap')
    const bundle = await give(one, gus, 'credit_bundle', 100)

    // More staff cancels, of both kinds and both roles, than the cap allows.
    for (let i = 0; i < cancelCapCount + 1; i++) {
      const role = i % 2 === 0 ? 'admin' : 'instructor'
      const credit = i % 3 === 0 ? 'keep' : 'return'
      const bookingId = await book(gus, await addClass(one, shifted(t0, (3 + i) * DAY)))
      await expectStatus(await staffCancel(role, staffOf(one, role), bookingId, { credit }), 200)
    }

    // The member's own in-time cancel still returns the credit.
    const before = await balanceOf(bundle)
    const own = await book(gus, await addClass(one, shifted(t0, 30 * DAY)))
    await expectStatus(await memberCancel(gus, own), 200)
    const record = await cancellationOf(own)
    assert.equal(record?.wasWithinCap, true)
    assert.equal((await bookingRow(own)).refundOutcome, 'credit_returned')
    assert.equal(await balanceOf(bundle), before)
  })

  /* ── the preview ────────────────────────────────────────────────────── */

  test('CXL-52 the roster rows and the admin member-booking view carry the cancel preview the dialog asks from', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const { classWindowHours } = await policyOf(one)
    const hal = await member(one, 'hal-preview')
    const ivy = await member(one, 'ivy-preview')
    await give(one, hal, 'credit_bundle')
    await give(one, ivy, 'unlimited')
    const startsAt = shifted(t0, 3 * DAY)
    const classId = await addClass(one, startsAt, { creditCost: 2 })
    const halBooking = await book(hal, classId)
    const ivyBooking = await book(ivy, classId)

    const rosterFor = async (inside: boolean) => {
      const admin = await expectStatus(
        await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: one.admin.headers }),
        200,
      )
      const instructor = await expectStatus(
        await harness.app.request(`/api/v1/portal/instructor/sessions/class/${classId}/roster`, { headers: one.instructor.headers }),
        200,
      )
      for (const roster of [admin, instructor]) {
        const byId = new Map(roster.attendees.map((a: any) => [a.booking_id, a.cancel_preview]))
        assert.deepEqual(byId.get(halBooking), { credits: 2, package_name: PACKAGE_NAME, unlimited: false, late: inside })
        assert.deepEqual(byId.get(ivyBooking), { credits: 0, package_name: null, unlimited: true, late: inside })
      }
    }
    await rosterFor(false)
    harness.clock.set(shifted(startsAt, -classWindowHours * HOUR + HOUR))
    await rosterFor(true)

    const profile = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${hal.clientId}`, { headers: one.admin.headers }),
      200,
    )
    const upcoming = profile.upcoming_bookings.find((b: any) => b.booking_id === halBooking)
    assert.deepEqual(upcoming.cancel_preview, { credits: 2, package_name: PACKAGE_NAME, unlimited: false, late: true })

    // Attended: no cancel offered, so no preview.
    await harness.db.update(schema.bookings).set({ checkInState: 'attended' }).where(eq(schema.bookings.id, halBooking))
    const roster = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: one.admin.headers }),
      200,
    )
    assert.equal(roster.attendees.find((a: any) => a.booking_id === halBooking).cancel_preview, null)
  })
})
