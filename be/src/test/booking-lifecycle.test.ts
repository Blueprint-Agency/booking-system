import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.lifecycle.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Lifecycle class type ${run}`
const PACKAGE_NAME = `Lifecycle pass ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The booking rules that move credits, over real HTTP (#140).
 *
 * Every journey signs in with `signInAs`, acts through `/api/v1/me/bookings`
 * or the portal's `/admin/bookings`, and then reads the rows the request left
 * behind: the booking, the member's package balance, the cancellation. Fixtures
 * — a class, a bundle held by a member, the staff row — are written directly,
 * because which rows a person has is the test's to state; the rules under test
 * only ever run behind a route.
 *
 * The studio's policy is the seeded one (a 24-hour class window, three client
 * cancellations per 30 days), read back rather than assumed wherever a journey
 * depends on it.
 */
describe('booking lifecycle over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
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

  let one!: Studio
  let two!: Studio
  let staffAtOne!: Record<string, string>

  const emailFor = (name: string) => `${name}@${DOMAIN}`

  const expectStatus = async (res: Response, status: number) => {
    assert.equal(res.status, status, await res.text())
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
        name: 'Lifecycle Instructor',
        role: 'instructor',
        status: 'active',
        authUserId: `auth_lifecycle_${run}_${tenant.slug}`,
      })
      .returning()
    assert.ok(instructor)
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: instructor.id })

    const classPackage = await classPackagesSvc.createClassPackage(tenant.id, {
      name: PACKAGE_NAME,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
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

  /** A class `startsIn` from now, one credit a seat. */
  async function addClass(at: Studio, startsIn: number, capacityOnline = 10): Promise<string> {
    const startsAt = new Date(Date.now() + startsIn)
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
        capacityOnline,
        creditCost: 1,
        createdByStaffId: at.instructorId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /** A member signed in on `at`'s hostname, with a clients row there and a 10-credit bundle. */
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
      paymentIntentId: null,
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
    const res = await book(who, classId)
    const body = await res.text()
    assert.equal(res.status, 201, body)
    return (JSON.parse(body) as { booking_id: string }).booking_id
  }

  async function bookingRow(bookingId: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.ok(row, `no booking row ${bookingId}`)
    return row
  }

  async function creditsLeft(who: Member): Promise<number> {
    const [row] = await harness.db
      .select({ left: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.clientId, who.clientId))
    assert.ok(row)
    return row.left!
  }

  const bookingsOf = (who: Member, classId: string) =>
    harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.clientId, who.clientId), eq(schema.bookings.classId, classId)))

  const cancellationsOf = (bookingId: string) =>
    harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))

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

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)

    // Marking a no-show is `/admin/bookings`, which is admin-only.
    const staffEmail = emailFor('admin')
    staffAtOne = await harness.signInAs('staff', staffEmail, one)
    const [staffUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, staffEmail))
    await harness.db.insert(schema.staffUsers).values({
      tenantId: one.id,
      email: staffEmail,
      name: 'Lifecycle Admin',
      role: 'admin',
      status: 'active',
      authUserId: staffUser!.id,
    })
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
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

  test('a member books a class with a package credit: one booking, one credit spent', async () => {
    const ana = await member(one, 'ana')
    const classId = await addClass(one, 3 * DAY)

    const bookingId = await bookOk(ana, classId)

    const row = await bookingRow(bookingId)
    assert.equal(row.clientId, ana.clientId)
    assert.equal(row.state, 'confirmed')
    assert.equal(row.creditsOrSessionsUsed, 1)
    assert.equal(await creditsLeft(ana), 9)
    // Booking the same class twice is refused and spends nothing.
    await expectStatus(await book(ana, classId), 409)
    assert.equal((await bookingsOf(ana, classId)).length, 1)
    assert.equal(await creditsLeft(ana), 9)
  })

  test('a member cancels before the window closes: booking cancelled, credit returned', async () => {
    const ben = await member(one, 'ben')
    const classId = await addClass(one, 3 * DAY)
    const bookingId = await bookOk(ben, classId)
    assert.equal(await creditsLeft(ben), 9)

    await expectStatus(await cancel(ben, bookingId), 200)

    const row = await bookingRow(bookingId)
    assert.equal(row.state, 'cancelled')
    assert.equal(row.refundOutcome, 'credit_returned')
    assert.equal(await creditsLeft(ben), 10)
    const [cancellation] = await cancellationsOf(bookingId)
    assert.ok(cancellation)
    assert.equal(cancellation.source, 'client')
    assert.equal(cancellation.wasWithinWindow, true)
    assert.equal(cancellation.refundFired, true)
  })

  test('a member cannot cancel once the window has closed: refused, booking and credit untouched', async () => {
    // The service treats the window as a hard deadline for members (cancel.ts),
    // not a forfeit — the refusal is what is asserted here. The specs say
    // forfeit; which one is right is #151.
    const cal = await member(one, 'cal')
    const { classWindowHours } = await policyOf(one)
    const classId = await addClass(one, (classWindowHours / 2) * HOUR)
    const bookingId = await bookOk(cal, classId)
    const booked = await bookingRow(bookingId)

    await expectStatus(await cancel(cal, bookingId), 422)

    assert.deepEqual(await bookingRow(bookingId), booked)
    assert.equal(booked.state, 'confirmed')
    assert.equal(await creditsLeft(cal), 9)
    assert.equal((await cancellationsOf(bookingId)).length, 0)
  })

  test("a cancellation past the studio's cap is cancelled with its credit forfeited", async () => {
    const dee = await member(one, 'dee')
    const { cancelCapCount } = await policyOf(one)

    // Use up the allowance, each one in good time and refunded.
    for (let i = 0; i < cancelCapCount; i++) {
      const bookingId = await bookOk(dee, await addClass(one, (3 + i) * DAY))
      await expectStatus(await cancel(dee, bookingId), 200)
      assert.equal((await bookingRow(bookingId)).refundOutcome, 'credit_returned')
    }
    assert.equal(await creditsLeft(dee), 10)

    const bookingId = await bookOk(dee, await addClass(one, 10 * DAY))
    assert.equal(await creditsLeft(dee), 9)
    await expectStatus(await cancel(dee, bookingId), 200)

    const row = await bookingRow(bookingId)
    assert.equal(row.state, 'cancelled')
    assert.equal(row.refundOutcome, 'forfeited')
    assert.equal(await creditsLeft(dee), 9)
    const [cancellation] = await cancellationsOf(bookingId)
    assert.ok(cancellation)
    assert.equal(cancellation.wasWithinWindow, true)
    assert.equal(cancellation.wasWithinCap, false)
    assert.equal(cancellation.refundFired, false)
  })

  test('a full class refuses the next member, and the seat a cancellation frees is theirs to book', async () => {
    // Class waitlists are deferred in v1 (backend-architecture.md §8): a full
    // class refuses outright, nobody is queued, and nothing is promoted. What
    // the rules do guarantee is that the freed seat is bookable and charged.
    // Whether to build the waitlist before launch is #152.
    const eve = await member(one, 'eve')
    const fay = await member(one, 'fay')
    const classId = await addClass(one, 3 * DAY, 1)
    const eveBooking = await bookOk(eve, classId)

    await expectStatus(await book(fay, classId), 409)
    assert.equal((await bookingsOf(fay, classId)).length, 0)
    assert.equal(await creditsLeft(fay), 10)

    await expectStatus(await cancel(eve, eveBooking), 200)
    // Cancelling does not hand the seat to anyone by itself.
    assert.equal((await bookingsOf(fay, classId)).length, 0)

    const fayBooking = await bookOk(fay, classId)
    const row = await bookingRow(fayBooking)
    assert.equal(row.state, 'confirmed')
    assert.equal(row.creditsOrSessionsUsed, 1)
    assert.equal(await creditsLeft(fay), 9)
    assert.equal(await creditsLeft(eve), 10)
  })

  test('staff mark a no-show once the class has started: credit forfeited, no cancellation counted', async () => {
    const gus = await member(one, 'gus')
    const classId = await addClass(one, 3 * DAY)
    const bookingId = await bookOk(gus, classId)
    const noShow = (headers: Record<string, string>) =>
      harness.app.request(`/api/v1/portal/admin/bookings/${bookingId}/no-show`, { method: 'POST', headers })

    // Not before the class has started.
    await expectStatus(await noShow(staffAtOne), 422)
    assert.equal((await bookingRow(bookingId)).state, 'confirmed')

    // Time passes: the class began an hour ago.
    await harness.db
      .update(schema.classes)
      .set({ startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() - 1000) })
      .where(eq(schema.classes.id, classId))

    await expectStatus(await noShow(staffAtOne), 200)

    const row = await bookingRow(bookingId)
    assert.equal(row.state, 'no_show')
    assert.equal(row.checkInState, 'no_show')
    assert.equal(row.refundOutcome, 'forfeited')
    assert.equal(await creditsLeft(gus), 9)
    assert.equal((await cancellationsOf(bookingId)).length, 0)

    // And a member cannot mark themselves, or anyone, a no-show.
    await expectStatus(await noShow(gus.headers), 401)
  })

  test("a member cannot cancel or read another member's booking", async () => {
    const hal = await member(one, 'hal')
    const ivy = await member(one, 'ivy')
    const bookingId = await bookOk(hal, await addClass(one, 3 * DAY))

    await expectStatus(await cancel(ivy, bookingId), 403)
    await expectStatus(await harness.app.request(`/api/v1/me/bookings/${bookingId}`, { headers: ivy.headers }), 404)

    const row = await bookingRow(bookingId)
    assert.equal(row.state, 'confirmed')
    assert.equal(await creditsLeft(hal), 9)
    assert.equal(await creditsLeft(ivy), 10)
  })

  test("a member cannot act on another studio's booking", async () => {
    const jay = await member(one, 'jay')
    const kim = await member(two, 'kim')
    const classAtOne = await addClass(one, 3 * DAY)
    const bookingId = await bookOk(jay, classAtOne)

    // Signed in at studio two, naming studio one's booking and class.
    await expectStatus(await cancel(kim, bookingId), 404)
    await expectStatus(await book(kim, classAtOne), 404)
    assert.equal((await bookingsOf(kim, classAtOne)).length, 0)

    // Studio two's session carried to studio one's hostname is refused outright.
    const kimAtOne = {
      ...kim,
      headers: { ...kim.headers, 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('client', one) },
    }
    await expectStatus(await cancel(kimAtOne, bookingId), 403)

    const row = await bookingRow(bookingId)
    assert.equal(row.state, 'confirmed')
    assert.equal(await creditsLeft(jay), 9)
    assert.equal(await creditsLeft(kim), 10)
  })

  test('a studio with no cancellation policy refuses a cancel by name, not with a 500', async () => {
    const lou = await member(two, 'lou')
    const bookingId = await bookOk(lou, await addClass(two, 3 * DAY))
    const policy = await policyOf(two)

    await harness.db.delete(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, two.id))
    try {
      const res = await cancel(lou, bookingId)
      const text = await res.text()
      assert.equal(res.status, 404, text)
      assert.equal((JSON.parse(text) as { error: string }).error, 'policy_not_seeded')
    } finally {
      await harness.db.insert(schema.globalPolicy).values(policy)
    }
    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
  })
})
