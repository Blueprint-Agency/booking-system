import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.staff-cancel.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Staff cancel class type ${run}`
const PACKAGE_NAME = `Staff cancel pass ${run}`
const WORKSHOP_NAME = `Staff cancel workshop ${run}`
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
    const workshops = sql`SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME}`
    await harness.db.execute(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${workshops}))`)
    await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshops})`)
    await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name = ${WORKSHOP_NAME}`)
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

  /* ── who cancelled (#350) ───────────────────────────────────────────── */

  test('CXL-60 a staff cancel records which staff member cancelled; a member’s own cancel records none', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const jo = await member(one, 'jo-who')
    await give(one, jo, 'credit_bundle')
    for (const role of ['admin', 'instructor'] as const) {
      const bookingId = await book(jo, await addClass(one, shifted(t0, 3 * DAY)))
      await expectStatus(await staffCancel(role, staffOf(one, role), bookingId, { credit: 'return' }), 200)
      const record = await cancellationOf(bookingId)
      assert.deepEqual([record?.source, record?.cancelledByStaffId], [role, staffOf(one, role).id], role)
    }
    const own = await book(jo, await addClass(one, shifted(t0, 4 * DAY)))
    await expectStatus(await memberCancel(jo, own), 200)
    const record = await cancellationOf(own)
    assert.deepEqual([record?.source, record?.cancelledByStaffId], ['client', null])
  })

  test('CXL-61 a whole-class cancel records, for each booking, whether it came in time, and who cancelled the class', async () => {
    const { classWindowHours } = await policyOf(one)
    const kim = await member(one, 'kim-class-cancel')
    const lou = await member(one, 'lou-class-cancel')
    await give(one, kim, 'credit_bundle')
    await give(one, lou, 'credit_bundle')
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const inTime = await addClass(one, shifted(t0, 3 * DAY))
    const late = await addClass(one, shifted(t0, classWindowHours * HOUR - HOUR))
    const bookings = {
      inTime: [await book(kim, inTime), await book(lou, inTime)],
      late: [await book(kim, late), await book(lou, late)],
    }

    const cancelWhole = (classId: string, role: Role) =>
      harness.app.request(`/api/v1/portal/${role}/schedule/classes/${classId}/cancel`, {
        method: 'POST',
        headers: { ...staffOf(one, role).headers, ...json },
        body: JSON.stringify({ reason: 'Studio flooded' }),
      })
    await expectStatus(await cancelWhole(inTime, 'admin'), 200)
    await expectStatus(await cancelWhole(late, 'instructor'), 200)

    for (const id of bookings.inTime) {
      const record = await cancellationOf(id)
      assert.deepEqual([record?.source, record?.wasWithinWindow, record?.cancelledByStaffId], ['admin', true, one.admin.id])
    }
    for (const id of bookings.late) {
      const record = await cancellationOf(id)
      assert.deepEqual(
        [record?.source, record?.wasWithinWindow, record?.cancelledByStaffId],
        ['instructor', false, one.instructor.id],
      )
    }
  })

  test('CXL-62 removing a Complimentary Package records the classes it cancels as a system cancel, naming no staff member', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const max = await member(one, 'max-comp')
    const given = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${max.clientId}/packages/issue`, {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ package_kind: 'class', package_id: one.classPackageId, reason: 'Given by mistake' }),
      }),
      201,
    )
    const bookingId = await book(max, await addClass(one, shifted(t0, 3 * DAY)))

    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${max.clientId}/packages/${given.client_package_id}/remove`, {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ reason: 'Given to the wrong member' }),
      }),
      200,
    )
    assert.equal((await bookingRow(bookingId)).state, 'cancelled')
    const record = await cancellationOf(bookingId)
    assert.deepEqual([record?.source, record?.cancelledByStaffId], ['system', null])
  })

  /* ── the profile's Cancelled tab and the roster's Cancelled section (#352) ── */

  const profileOf = async (who: Member) =>
    expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${who.clientId}`, { headers: one.admin.headers }),
      200,
    )

  const issueComp = async (who: Member) =>
    (
      await expectStatus(
        await harness.app.request(`/api/v1/portal/admin/clients/${who.clientId}/packages/issue`, {
          method: 'POST',
          headers: { ...one.admin.headers, ...json },
          body: JSON.stringify({ package_kind: 'class', package_id: one.classPackageId, reason: 'Given by mistake' }),
        }),
        201,
      )
    ).client_package_id as string

  const cancelWholeClass = (classId: string, role: Role) =>
    harness.app.request(`/api/v1/portal/${role}/schedule/classes/${classId}/cancel`, {
      method: 'POST',
      headers: { ...staffOf(one, role).headers, ...json },
      body: JSON.stringify({ reason: 'Studio flooded' }),
    })

  /** A class booking written straight in, already held or not, for history that predates the test. */
  async function heldBooking(who: Member, classId: string, checkIn: 'attended' | 'no_show'): Promise<string> {
    const [row] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: one.id,
        clientId: who.clientId,
        kind: 'class',
        classId,
        creditsOrSessionsUsed: 1,
        state: checkIn === 'no_show' ? 'no_show' : 'confirmed',
        checkInState: checkIn,
        qrToken: `staff-cancel-${randomUUID()}`,
        code: `SC-${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning({ id: schema.bookings.id })
    return row!.id
  }

  test('CUS-21 a cancelled class is on the profile’s cancelled list the moment it is cancelled, newest cancellation first, with its outcome, when, and who: the member, the named staff member, or automatic; History holds only what was held', async () => {
    const { classWindowHours } = await policyOf(one)
    const nia = await member(one, 'nia-profile')
    await give(one, nia, 'credit_bundle')

    // Held before the test: an attended class two days ago, a no-show yesterday.
    const realNow = Date.now()
    const attended = await heldBooking(nia, await addClass(one, new Date(realNow - 2 * DAY)), 'attended')
    const noShow = await heldBooking(nia, await addClass(one, new Date(realNow - DAY)), 'no_show')

    const t0 = aWeekOut()
    harness.clock.set(t0)
    const comp = await issueComp(nia)
    const inTime = await book(nia, await addClass(one, shifted(t0, 3 * DAY)))
    const kept = await book(nia, await addClass(one, shifted(t0, 4 * DAY)))
    const compClass = await addClass(one, shifted(t0, 4 * DAY + 2 * HOUR))
    const removed = await expectStatus(
      await harness.app.request('/api/v1/me/bookings/class', {
        method: 'POST',
        headers: { ...nia.headers, ...json },
        body: JSON.stringify({ class_id: compClass, client_package_id: comp }),
      }),
      201,
    )
    const wholeClass = await addClass(one, shifted(t0, 5 * DAY))
    const struck = await book(nia, wholeClass)
    // Its window opens two hours after t0, so a cancel four hours in is late.
    const late = await book(nia, await addClass(one, shifted(t0, (classWindowHours + 2) * HOUR)))

    await expectStatus(await memberCancel(nia, inTime), 200)
    harness.clock.set(shifted(t0, HOUR))
    await expectStatus(await staffCancel('admin', one.admin, kept, { credit: 'keep' }), 200)
    harness.clock.set(shifted(t0, 2 * HOUR))
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${nia.clientId}/packages/${comp}/remove`, {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ reason: 'Given to the wrong member' }),
      }),
      200,
    )
    harness.clock.set(shifted(t0, 3 * HOUR))
    await expectStatus(await cancelWholeClass(wholeClass, 'instructor'), 200)
    harness.clock.set(shifted(t0, 4 * HOUR))
    await expectStatus(await memberCancel(nia, late), 200)

    const profile = await profileOf(nia)
    // Every one of them is still to come, and none is on Upcoming.
    assert.deepEqual(profile.upcoming_bookings.map((b: any) => b.booking_id), [])
    assert.deepEqual(
      profile.past_bookings.map((b: any) => [b.booking_id, b.check_in_state]),
      [
        [noShow, 'no_show'],
        [attended, 'attended'],
      ],
    )
    assert.deepEqual(
      profile.cancelled_bookings.map((b: any) => [b.booking_id, b.kind, b.cancelled_by, b.cancelled_by_name, b.late, b.outcome]),
      [
        [late, 'class', 'member', null, true, 'credit_kept_late'],
        [struck, 'class', 'staff', 'instructor', false, 'credit_returned'],
        [removed.booking_id, 'class', 'automatic', null, false, 'nothing_to_return'],
        [kept, 'class', 'staff', 'admin', false, 'credit_kept'],
        [inTime, 'class', 'member', null, false, 'credit_returned'],
      ],
    )
    const cancelledAt = new Map(profile.cancelled_bookings.map((b: any) => [b.booking_id, b.cancelled_at]))
    assert.equal(cancelledAt.get(inTime), t0.toISOString())
    assert.equal(cancelledAt.get(late), shifted(t0, 4 * HOUR).toISOString())
    // Two class cancels kept the credit: the late one and staff's Keep credit.
    assert.equal(profile.attendance.late_cancels, 2)
  })

  test('CUS-08, CUS-11 History lists the 50 most recent held bookings newest first and no cancelled one, while the attendance strip counts every booking ever', async () => {
    const ola = await member(one, 'ola-history')
    await give(one, ola, 'credit_bundle')
    const realNow = Date.now()
    // 52 attended classes, one a day back from yesterday, and a no-show before them all.
    const held: string[] = []
    for (let d = 1; d <= 52; d++) held.push(await heldBooking(ola, await addClass(one, new Date(realNow - d * DAY)), 'attended'))
    await heldBooking(ola, await addClass(one, new Date(realNow - 60 * DAY)), 'no_show')
    // A class from twelve hours ago, newer than any of them, cancelled before it ran.
    const [gone] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: one.id,
        clientId: ola.clientId,
        kind: 'class',
        classId: await addClass(one, new Date(realNow - 12 * HOUR)),
        creditsOrSessionsUsed: 1,
        state: 'cancelled',
        checkInState: 'n_a',
        refundOutcome: 'credit_returned',
        cancelledAt: new Date(realNow - 2 * DAY),
        qrToken: `staff-cancel-${randomUUID()}`,
        code: `SC-${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning({ id: schema.bookings.id })
    // A class cancelled late, still to come, and one cancelled in time.
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const { classWindowHours } = await policyOf(one)
    const late = await book(ola, await addClass(one, shifted(t0, (classWindowHours - 1) * HOUR)))
    const inTime = await book(ola, await addClass(one, shifted(t0, 3 * DAY)))
    await expectStatus(await memberCancel(ola, late), 200)
    harness.clock.set(shifted(t0, MINUTE))
    await expectStatus(await memberCancel(ola, inTime), 200)

    const profile = await profileOf(ola)
    assert.deepEqual(
      profile.past_bookings.map((b: any) => b.booking_id),
      held.slice(0, 50),
    )
    assert.deepEqual(profile.cancelled_bookings.map((b: any) => b.booking_id), [inTime, late, gone!.id])
    assert.deepEqual(
      [profile.attendance.attended, profile.attendance.no_shows, profile.attendance.late_cancels],
      [52, 1, 1],
    )
  })

  test('CUS-24 a workshop place is on the profile’s cancelled list: cancelled with its Workshop, by the admin who cancelled it, nothing returned; refunded, automatic', async () => {
    // A workshop is cancelled on the wall clock, so this test keeps to it.
    harness.clock.reset()
    const t0 = new Date()
    const uma = await member(one, 'uma-workshop')
    const workshopPlace = async (state: 'confirmed' | 'cancelled') => {
      const [workshop] = await harness.db
        .insert(schema.workshops)
        .values({ tenantId: one.id, name: WORKSHOP_NAME, locationId: one.locationId, createdByStaffId: one.admin.id })
        .returning({ id: schema.workshops.id })
      const [tier] = await harness.db
        .insert(schema.workshopTiers)
        .values({ tenantId: one.id, workshopId: workshop!.id, name: 'Full', regularPriceSgd: '120.00', ord: 1 })
        .returning({ id: schema.workshopTiers.id })
      const [day] = await harness.db
        .insert(schema.workshopDays)
        .values({
          tenantId: one.id,
          workshopId: workshop!.id,
          ord: 1,
          roomId: one.roomId,
          startsAt: shifted(t0, 3 * DAY),
          endsAt: shifted(t0, 3 * DAY + 2 * HOUR),
          basePriceSgd: '120.00',
          capacityOnline: 10,
        })
        .returning({ id: schema.workshopDays.id })
      await harness.db
        .insert(schema.workshopTierDays)
        .values({ tenantId: one.id, workshopTierId: tier!.id, workshopDayId: day!.id })
      const [booking] = await harness.db
        .insert(schema.bookings)
        .values({
          tenantId: one.id,
          clientId: uma.clientId,
          kind: 'workshop',
          workshopId: workshop!.id,
          workshopTierId: tier!.id,
          creditsOrSessionsUsed: 0,
          listPriceSgd: '120.00',
          amountPaidSgd: '120.00',
          state,
          // Refunded through its purchase: the unwind cancels the place.
          ...(state === 'cancelled'
            ? { cancelledAt: shifted(t0, -HOUR), checkInState: 'n_a' as const, refundOutcome: 'stripe_refunded' as const }
            : {}),
          qrToken: `staff-cancel-ws-${randomUUID()}`,
          code: `SW-${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning({ id: schema.bookings.id })
      return { workshopId: workshop!.id, bookingId: booking!.id }
    }
    const refunded = await workshopPlace('cancelled')
    const struck = await workshopPlace('confirmed')
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/workshops/${struck.workshopId}/cancel`, {
        method: 'POST',
        headers: one.admin.headers,
      }),
      200,
    )

    const profile = await profileOf(uma)
    assert.deepEqual(profile.upcoming_bookings, [])
    assert.deepEqual(
      profile.cancelled_bookings.map((b: any) => [b.booking_id, b.kind, b.title, b.cancelled_by, b.cancelled_by_name, b.outcome]),
      [
        [struck.bookingId, 'workshop', WORKSHOP_NAME, 'staff', 'admin', 'nothing_to_return'],
        [refunded.bookingId, 'workshop', WORKSHOP_NAME, 'automatic', null, 'refunded'],
      ],
    )
    assert.equal(profile.cancelled_bookings[1].cancelled_at, shifted(t0, -HOUR).toISOString())
    assert.ok(new Date(profile.cancelled_bookings[0].cancelled_at).getTime() >= t0.getTime())
  })

  test('ROS-06 the class detail lists cancelled bookings apart from the roster, with when, outcome and late cancels marked, for the admin and for the instructor who leads it', async () => {
    const { classWindowHours } = await policyOf(one)
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const pia = await member(one, 'pia-roster')
    const quin = await member(one, 'quin-roster')
    const rae = await member(one, 'rae-roster')
    for (const who of [pia, quin, rae]) await give(one, who, 'credit_bundle')
    const startsAt = shifted(t0, (classWindowHours + 2) * HOUR)
    const classId = await addClass(one, startsAt)
    const inTime = await book(pia, classId)
    const late = await book(quin, classId)
    const staying = await book(rae, classId)

    await expectStatus(await memberCancel(pia, inTime), 200)
    harness.clock.set(shifted(t0, 4 * HOUR))
    await expectStatus(await memberCancel(quin, late), 200)

    const admin = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: one.admin.headers }),
      200,
    )
    const instructor = await expectStatus(
      await harness.app.request(`/api/v1/portal/instructor/sessions/class/${classId}/roster`, { headers: one.instructor.headers }),
      200,
    )
    for (const detail of [admin, instructor]) {
      assert.deepEqual(detail.attendees.map((a: any) => a.booking_id), [staying])
      assert.deepEqual(
        detail.cancelled_bookings.map((b: any) => [b.booking_id, b.client.name, b.cancelled_at, b.cancelled_by, b.late, b.outcome]),
        [
          [late, 'quin-roster', shifted(t0, 4 * HOUR).toISOString(), 'member', true, 'credit_kept_late'],
          [inTime, 'pia-roster', t0.toISOString(), 'member', false, 'credit_returned'],
        ],
      )
    }
    // The other instructor does not lead it, so reads none of it.
    await expectStatus(
      await harness.app.request(`/api/v1/portal/instructor/sessions/class/${classId}/roster`, { headers: one.otherInstructor.headers }),
      403,
    )
  })

  test('ROS-07 a cancelled class still lists who was booked, each under Cancelled, with no check-in action on them', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const sam = await member(one, 'sam-struck')
    const tia = await member(one, 'tia-struck')
    for (const who of [sam, tia]) await give(one, who, 'credit_bundle')
    const classId = await addClass(one, shifted(t0, 3 * DAY))
    const bookings = [await book(sam, classId), await book(tia, classId)]
    await expectStatus(await cancelWholeClass(classId, 'admin'), 200)

    const detail = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: one.admin.headers }),
      200,
    )
    assert.equal(detail.lifecycle, 'cancelled')
    assert.deepEqual(detail.attendees, [])
    assert.deepEqual(
      detail.cancelled_bookings.map((b: any) => [b.booking_id, b.cancelled_by, b.cancelled_by_name, b.outcome]).sort(),
      bookings.map(id => [id, 'staff', 'admin', 'credit_returned']).sort(),
    )
    // A cancelled booking cannot be checked in.
    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/check-in/manual', {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ booking_id: bookings[0], attended: true }),
      }),
      409,
      'booking_cancelled',
    )
    assert.equal((await bookingRow(bookings[0]!)).checkInState, 'n_a')
  })
})
