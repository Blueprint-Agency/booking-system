import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.time-windows.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Time window class type ${run}`
const PACKAGE_NAME = `Time window pass ${run}`
const VALIDITY_DAYS = 90
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The rules that turn on what time it is, over real HTTP, with the app's clock
 * held by the test (#201).
 *
 * Every journey stands the clock at a chosen instant (`harness.clock`), books
 * and cancels through `/api/v1/me/bookings`, then reads the rows the request
 * left. Nothing here waits for time to pass or leans on how far away a class
 * happens to be from the moment the suite runs: a cutoff is hit to the
 * millisecond, a cap cycle is stepped over by a day, a package's expiry is
 * passed by a day.
 *
 * Each journey runs in both fixture Tenants, against each one's own seeded
 * policy, read back rather than assumed.
 */
describe('time-window rules over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    instructorId: string
    classPackageId: string
  }
  type Member = { clientId: string; headers: Record<string, string> }

  const studios: Studio[] = []
  const emailFor = (name: string) => `${name}@${DOMAIN}`

  /** A week from the real today, on a whole minute: far enough that nothing the
   *  wall clock does during the run can reach it. */
  const aWeekOut = () => new Date(Math.floor((Date.now() + 7 * DAY) / MINUTE) * MINUTE)

  const expectStatus = async (res: Response, status: number) => {
    const body = await res.text()
    assert.equal(res.status, status, body)
    return body
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
    const [instructor] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId: tenant.id,
        email: emailFor(`instructor-${tenant.slug}`),
        name: 'Time Window Instructor',
        role: 'instructor',
        status: 'active',
        authUserId: `auth_time_windows_${run}_${tenant.slug}`,
      })
      .returning()
    assert.ok(instructor)
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: instructor.id })

    const classPackage = await classPackagesSvc.createClassPackage(tenant.id, {
      name: PACKAGE_NAME,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: VALIDITY_DAYS,
      priceSgd: '200.00',
    })

    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      classTypeId: classType.id,
      instructorId: instructor.id,
      classPackageId: classPackage.id,
    }
  }

  /** A one-credit class starting at `startsAt`. */
  async function addClass(at: Studio, startsAt: Date): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.instructorId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: at.instructorId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /** A member signed in on `at`'s hostname, holding a Dormant 10-credit bundle. */
  async function member(at: Studio, name: string): Promise<Member> {
    const email = emailFor(`${name}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    assert.ok(user)
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user.id })
      .returning({ id: schema.clients.id })
    await purchaseSvc.grantPackage(at.id, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: at.classPackageId,
    })
    return { clientId: client!.id, headers }
  }

  const book = (who: Member, classId: string) =>
    harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...who.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_id: classId }),
    })

  const cancel = (who: Member, bookingId: string) =>
    harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers: who.headers })

  async function bookOk(who: Member, classId: string): Promise<string> {
    const body = await expectStatus(await book(who, classId), 201)
    return (JSON.parse(body) as { booking_id: string }).booking_id
  }

  async function bookingRow(bookingId: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.ok(row, `no booking row ${bookingId}`)
    return row
  }

  async function packageOf(who: Member) {
    const rows = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, who.clientId))
    assert.equal(rows.length, 1, 'expected the one granted package')
    return rows[0]!
  }

  const cancellationOf = async (bookingId: string) => {
    const [row] = await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))
    return row
  }

  async function policyOf(at: Studio) {
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, at.id))
    assert.ok(policy, `expected a seeded policy for ${at.slug}`)
    return policy
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    studios.push(await studio(harness.tenants.one), await studio(harness.tenants.two))
  })

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
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
    await harness.close()
  })

  for (const which of ['one', 'two'] as const) {
    const at = () => studios[which === 'one' ? 0 : 1]!

    test(`CXL-09, CXL-01, CXL-17 a cancel exactly at the cutoff returns the credit; a millisecond later it is refused (tenant ${which})`, async () => {
      const { classWindowHours } = await policyOf(at())
      const t0 = aWeekOut()
      const startsAt = new Date(t0.getTime() + 3 * DAY)
      const cutoff = new Date(startsAt.getTime() - classWindowHours * HOUR)
      const ana = await member(at(), `ana-${which}`)
      const onTime = await addClass(at(), startsAt)
      const late = await addClass(at(), startsAt)

      harness.clock.set(t0)
      const onTimeBooking = await bookOk(ana, onTime)
      const lateBooking = await bookOk(ana, late)
      assert.equal((await packageOf(ana)).creditsOrSessionsRemaining, 8)

      harness.clock.set(cutoff)
      await expectStatus(await cancel(ana, onTimeBooking), 200)
      const cancelled = await bookingRow(onTimeBooking)
      assert.equal(cancelled.state, 'cancelled')
      assert.equal(cancelled.refundOutcome, 'credit_returned')
      assert.equal(cancelled.cancelledAt?.getTime(), cutoff.getTime())
      const onTimeCancellation = await cancellationOf(onTimeBooking)
      assert.ok(onTimeCancellation)
      assert.equal(onTimeCancellation.wasWithinWindow, true)
      assert.equal(onTimeCancellation.refundFired, true)
      assert.equal((await packageOf(ana)).creditsOrSessionsRemaining, 9)

      // Past the cutoff a member's cancel is refused outright rather than
      // forfeited (cancel.ts); whether it should forfeit instead is #151.
      harness.clock.set(new Date(cutoff.getTime() + 1))
      const refused = JSON.parse(await expectStatus(await cancel(ana, lateBooking), 422)) as { error: string }
      assert.equal(refused.error, 'cancellation_window_passed')
      assert.equal((await bookingRow(lateBooking)).state, 'confirmed')
      assert.equal(await cancellationOf(lateBooking), undefined)
      assert.equal((await packageOf(ana)).creditsOrSessionsRemaining, 9)
    })

    test(`CXL-12, CXL-16 over the cap an in-time cancel forfeits; once the cycle has passed the same cancel returns the credit (tenant ${which})`, async () => {
      const { cancelCapCount, cancelCapCycleDays } = await policyOf(at())
      const t0 = aWeekOut()
      const ben = await member(at(), `ben-${which}`)
      harness.clock.set(t0)

      // Spend the allowance: every one in good time, every one refunded.
      for (let i = 0; i < cancelCapCount; i++) {
        const bookingId = await bookOk(ben, await addClass(at(), new Date(t0.getTime() + (3 + i) * DAY)))
        await expectStatus(await cancel(ben, bookingId), 200)
        assert.equal((await bookingRow(bookingId)).refundOutcome, 'credit_returned')
      }
      assert.equal((await packageOf(ben)).creditsOrSessionsRemaining, 10)

      // A day on, inside the cycle: in good time, but over the cap.
      harness.clock.set(new Date(t0.getTime() + DAY))
      const forfeited = await bookOk(ben, await addClass(at(), new Date(t0.getTime() + 10 * DAY)))
      await expectStatus(await cancel(ben, forfeited), 200)
      assert.equal((await bookingRow(forfeited)).refundOutcome, 'forfeited')
      const overCap = await cancellationOf(forfeited)
      assert.ok(overCap)
      assert.equal(overCap.wasWithinWindow, true)
      assert.equal(overCap.wasWithinCap, false)
      assert.equal(overCap.refundFired, false)
      assert.equal((await packageOf(ben)).creditsOrSessionsRemaining, 9)

      // The first cancellations age out of the rolling cycle; the forfeited one
      // (a day later) still counts, which is under the cap.
      const later = new Date(t0.getTime() + cancelCapCycleDays * DAY + HOUR)
      harness.clock.set(later)
      const refunded = await bookOk(ben, await addClass(at(), new Date(later.getTime() + 3 * DAY)))
      await expectStatus(await cancel(ben, refunded), 200)
      assert.equal((await bookingRow(refunded)).refundOutcome, 'credit_returned')
      const underCap = await cancellationOf(refunded)
      assert.ok(underCap)
      assert.equal(underCap.wasWithinCap, true)
      assert.equal(underCap.refundFired, true)
      assert.equal((await packageOf(ben)).creditsOrSessionsRemaining, 9)
    })

    test(`PKG-32 a Credit Bundle past its expiry cannot pay for a booking, even before the nightly sweep (tenant ${which})`, async () => {
      const t0 = aWeekOut()
      const cal = await member(at(), `cal-${which}`)

      // The first booking Activates the bundle, counted from this instant.
      harness.clock.set(t0)
      await bookOk(cal, await addClass(at(), new Date(t0.getTime() + DAY)))
      const activated = await packageOf(cal)
      assert.equal(activated.expiresAt?.getTime(), t0.getTime() + VALIDITY_DAYS * DAY)
      assert.equal(activated.creditsOrSessionsRemaining, 9)

      // A day after it ended. No job has run, so the row still says active.
      const afterExpiry = new Date(t0.getTime() + (VALIDITY_DAYS + 1) * DAY)
      harness.clock.set(afterExpiry)
      assert.equal((await packageOf(cal)).active, true)
      const classId = await addClass(at(), new Date(afterExpiry.getTime() + DAY))

      const refused = JSON.parse(await expectStatus(await book(cal, classId), 409)) as { error: string }
      assert.equal(refused.error, 'insufficient_credits')
      const [booked] = await harness.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.bookings)
        .where(eq(schema.bookings.classId, classId))
      assert.equal(booked!.n, 0)
      assert.equal((await packageOf(cal)).creditsOrSessionsRemaining, 9)

      // A day before the end, the same bundle still pays.
      harness.clock.set(new Date(t0.getTime() + (VALIDITY_DAYS - 1) * DAY))
      await bookOk(cal, await addClass(at(), new Date(t0.getTime() + (VALIDITY_DAYS - 1) * DAY + HOUR)))
      assert.equal((await packageOf(cal)).creditsOrSessionsRemaining, 8)
    })
  }
})
