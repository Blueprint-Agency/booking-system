import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { classPassEmail, newReservationId, type ClassPassEmailOptions } from './classpass-email'
import type { InboundEmail } from '../services/classpass/receive'

const run = Date.now().toString(36)
const DOMAIN = `${run}.classpass-cancel.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const STRETCH = `Yoga Stretch ${run}`
const PACKAGE_NAME = `ClassPass cancel pass ${run}`
const LOCATION = `ClassPass cancel room ${run}`
/** What ClassPass calls the Location in its emails. */
const CLASSPASS_LOCATION = `Northwind-Cancel ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Importing a ClassPass cancellation email (#412): a forwarded `ClassPass
 * reservation canceled by user` email cancels the ClassPass booking its
 * Reservation key names, as ClassPass's cancel: nothing to return, never a
 * Late cancel, never toward the Cancellation Cap, and the freed seat promotes
 * the Waitlist. A key with no live booking here changes nothing (`noop`).
 *
 * Every test drives the one entry point, `receiveClassPassEmail`, with fixture
 * emails (`classpass-email.ts`), and reads what it did through the portal.
 */
describe('importing a ClassPass cancellation email', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let receiveSvc!: typeof import('../services/classpass/receive')
  let bookSvc!: typeof import('../services/bookings/book')
  let cancelSvc!: typeof import('../services/bookings/cancel')

  type Staff = { id: string; email: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    timezone: string
    locationId: string
    stretchTypeId: string
    classPackageId: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; email: string; name: string }

  let one!: Studio
  let two!: Studio
  const keptIds: string[] = []

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }
  const shifted = (from: Date, ms: number) => new Date(from.getTime() + ms)
  /** A whole minute about a week out, a few hours apart per call, so no two tests share a start. */
  let slot = 0
  const nextStart = () => new Date(Math.floor((Date.now() + 7 * DAY) / HOUR) * HOUR + slot++ * 3 * HOUR + 30 * MINUTE)

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as Record<string, any>) : {}
  }

  /** The date and time as ClassPass writes them, in the studio's own timezone. */
  function classPassWhen(at: Date, timezone: string): { date: string; time: string } {
    const plain = (s: string) => s.replace(/\s/g, ' ')
    const date = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(at)
    const time = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(at)
    return { date: plain(date), time: plain(time) }
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
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { id: row!.id, email, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [t] = await harness.db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, tenant.id))
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: LOCATION })
      .returning({ id: schema.locations.id })
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: STRETCH })
      .returning({ id: schema.classTypes.id })
    const [classPackage] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: PACKAGE_NAME, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const admin = await staffAt(tenant, 'admin', 'admin')
    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass/locations', {
        method: 'POST',
        headers: { ...admin.headers, ...json },
        body: JSON.stringify({ location_name: CLASSPASS_LOCATION, location_id: location!.id }),
      }),
      201,
    )
    await setImport(admin, true)
    return {
      ...tenant,
      timezone: t!.timezone,
      locationId: location!.id,
      stretchTypeId: type!.id,
      classPackageId: classPackage!.id,
      admin,
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
    }
  }

  async function setImport(admin: Staff, enabled: boolean) {
    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass', {
        method: 'PATCH',
        headers: { ...admin.headers, ...json },
        body: JSON.stringify({ enabled }),
      }),
      200,
    )
  }

  async function addClass(at: Studio, startsAt: Date, capacityOnline = 10): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.stretchTypeId,
        mainInstructorId: at.instructor.id,
        locationId: at.locationId,
        startsAt,
        endsAt: shifted(startsAt, HOUR),
        capacityOnline,
        capacityBuffer: 0,
        creditCost: 1,
        createdByStaffId: at.instructor.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  async function member(at: Studio, name: string): Promise<Member> {
    const email = emailFor(`${name}-${at.slug}`)
    await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, name }
  }

  async function give(at: Studio, who: Member, credits = 10): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'credit_bundle',
        sourceClassPackageId: at.classPackageId,
        validityDays: 90,
        creditsOrSessionsRemaining: credits,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /** A ClassPass booking email for the class starting at `startsAt`, at the mapped Location. */
  function bookingEmail(at: Studio, startsAt: Date, options: ClassPassEmailOptions = {}): InboundEmail {
    return classPassEmail({
      className: STRETCH,
      location: CLASSPASS_LOCATION,
      ...classPassWhen(startsAt, at.timezone),
      memberName: 'Placeholder Member',
      memberEmail: emailFor(`placeholder-${randomUUID().slice(0, 8)}`),
      ...options,
    })
  }

  /** ClassPass's cancellation of reservation `reservationId`, in the 2026 layout. */
  function cancellationEmail(at: Studio, startsAt: Date, reservationId: string, options: ClassPassEmailOptions = {}): InboundEmail {
    return bookingEmail(at, startsAt, { kind: 'cancellation', reservationId, ...options })
  }

  async function receive(at: Studio, email: InboundEmail) {
    const result = await receiveSvc.receiveClassPassEmail(at.id, email)
    keptIds.push(result.id)
    return result
  }

  /** A ClassPass booking imported from its email; its reservation ID and booking. */
  async function imported(at: Studio, startsAt: Date, who?: Member) {
    const reservationId = newReservationId()
    const result = await receive(
      at,
      bookingEmail(at, startsAt, { reservationId, ...(who ? { memberName: who.name, memberEmail: who.email } : {}) }),
    )
    assert.equal(result.outcome, 'imported')
    return { reservationId, bookingId: result.bookingId! }
  }

  /* ── reading ────────────────────────────────────────────────────────── */

  async function classDetail(at: Studio, classId: string) {
    return expectStatus(
      await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: at.admin.headers }),
      200,
    )
  }

  async function profile(at: Studio, clientId: string) {
    return expectStatus(await harness.app.request(`/api/v1/portal/admin/clients/${clientId}`, { headers: at.admin.headers }), 200)
  }

  async function bookingRow(bookingId: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    return row!
  }

  async function cancellationsOf(bookingId: string) {
    return harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))
  }

  async function inboundRow(id: string) {
    const [row] = await harness.db.select().from(schema.classpassInboundEmails).where(eq(schema.classpassInboundEmails.id, id))
    return row!
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    receiveSvc = inTenantContext(await import('../services/classpass/receive'))
    bookSvc = inTenantContext(await import('../services/bookings/book'))
    cancelSvc = inTenantContext(await import('../services/bookings/cancel'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const ourClasses = sql`SELECT id FROM classes WHERE created_by_staff_id IN (${staff})`
    await harness.db.execute(sql`DELETE FROM classpass_inbound_emails WHERE member_email LIKE ${ours} OR client_id IN (${clients}) OR booking_id IN (SELECT id FROM bookings WHERE class_id IN (${ourClasses}))`)
    for (const id of keptIds) await harness.db.execute(sql`DELETE FROM classpass_inbound_emails WHERE id = ${id}`)
    await harness.db.execute(sql`DELETE FROM classpass_location_mappings WHERE location_id IN (SELECT id FROM locations WHERE name = ${LOCATION})`)
    await harness.db.execute(sql`UPDATE classpass_settings SET enabled = false WHERE tenant_id IN (${one.id}, ${two.id})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM waitlist_entries WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE class_id IN (${ourClasses})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${STRETCH}`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name = ${LOCATION}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM auth_events WHERE actor_user_id IN (SELECT id FROM staff_auth_users WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── tests ──────────────────────────────────────────────────────────── */

  test('CPS-50 a cancellation for an imported booking cancels it and frees its seat, and the waiting member is promoted', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt, 1)
    const { reservationId, bookingId } = await imported(one, startsAt)
    const wren = await member(one, 'wren-waiting')
    await give(one, wren)
    await harness.db.insert(schema.waitlistEntries).values({ tenantId: one.id, clientId: wren.clientId, classId })

    const result = await receive(one, cancellationEmail(one, startsAt, reservationId))

    assert.equal(result.outcome, 'cancelled')
    assert.equal(result.bookingId, bookingId)
    assert.equal((await bookingRow(bookingId)).state, 'cancelled')
    const detail = await classDetail(one, classId)
    assert.deepEqual(
      (detail.attendees as Record<string, any>[]).map(a => [a.client.id, a.source, a.promoted_from_waitlist]),
      [[wren.clientId, 'direct', true]],
    )
    const kept = await inboundRow(result.id)
    assert.equal(kept.kind, 'cancellation')
    assert.equal(kept.reservationId, reservationId)
    assert.equal(kept.bookingId, bookingId)
  })

  test("CPS-51 a cancellation inside the class's window is ClassPass's, with nothing to return, and is not a Late cancel", async () => {
    // Between two and three hours out: well inside a class's cancellation window.
    const startsAt = new Date(Math.ceil((Date.now() + 2 * HOUR) / HOUR) * HOUR + 15 * MINUTE)
    await addClass(one, startsAt)
    const lia = await member(one, 'lia-late')
    const { reservationId, bookingId } = await imported(one, startsAt, lia)

    const result = await receive(one, cancellationEmail(one, startsAt, reservationId, { memberName: lia.name, memberEmail: lia.email }))

    assert.equal(result.outcome, 'cancelled')
    assert.equal((await bookingRow(bookingId)).refundOutcome, 'n_a')
    const [record] = await cancellationsOf(bookingId)
    assert.equal(record?.source, 'classpass')
    assert.equal(record?.refundFired, false)
    const history = await profile(one, lia.clientId)
    assert.equal(history.attendance.late_cancels, 0)
    const cancelled = (history.cancelled_bookings as Record<string, any>[]).find(b => b.booking_id === bookingId)
    assert.deepEqual(
      [cancelled?.late, cancelled?.outcome, cancelled?.cancelled_by, cancelled?.who_line],
      [false, 'nothing_to_return', 'member', 'Member'],
    )
  })

  test("CPS-52 ClassPass cancellations do not count toward the member's Cancellation Cap", async () => {
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, one.id))
    assert.ok(policy?.cancelCapEnabled, 'the studio caps cancellations')
    const startsAt = nextStart()
    await addClass(one, startsAt)
    const cy = await member(one, 'cy-capped')
    const bundle = await give(one, cy)
    // As many ClassPass cancellations as the Cap allows the member's own.
    for (let i = 0; i < policy.cancelCapCount; i++) {
      const { reservationId } = await imported(one, startsAt, cy)
      assert.equal((await receive(one, cancellationEmail(one, startsAt, reservationId))).outcome, 'cancelled')
    }
    const own = await addClass(one, nextStart())
    const { bookingId } = await bookSvc.bookClass(one.id, { clientId: cy.clientId, classId: own, clientPackageId: bundle })

    const result = await cancelSvc.cancelBooking(one.id, { source: 'client', clientId: cy.clientId, bookingId })

    assert.deepEqual(result, { refundOutcome: 'credit_returned', refundFired: true })
    const [record] = await cancellationsOf(bookingId)
    assert.equal(record?.wasWithinCap, true)
  })

  test('CPS-53 a cancellation for a reservation never imported changes nothing and is noop', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const { bookingId } = await imported(one, startsAt)

    const result = await receive(one, cancellationEmail(one, startsAt, newReservationId()))

    assert.equal(result.outcome, 'noop')
    assert.equal(result.bookingId, null)
    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
    assert.equal((await classDetail(one, classId)).attendees.length, 1)
  })

  test('CPS-54 a cancellation for a booking already cancelled changes nothing and is noop', async () => {
    const startsAt = nextStart()
    await addClass(one, startsAt)
    const { reservationId, bookingId } = await imported(one, startsAt)
    await cancelSvc.cancelBooking(one.id, { source: 'admin', actorStaffId: one.admin.id, credit: 'return', bookingId })
    const before = await bookingRow(bookingId)

    const result = await receive(one, cancellationEmail(one, startsAt, reservationId))

    assert.equal(result.outcome, 'noop')
    assert.equal(result.bookingId, bookingId)
    assert.deepEqual(await bookingRow(bookingId), before)
    assert.deepEqual(
      (await cancellationsOf(bookingId)).map(c => c.source),
      ['admin'],
    )
  })

  test('CPS-55 the same cancellation email twice, and the same reservation in a second email, cancel once', async () => {
    const startsAt = nextStart()
    await addClass(one, startsAt)
    const { reservationId, bookingId } = await imported(one, startsAt)
    const email = cancellationEmail(one, startsAt, reservationId)

    const first = await receive(one, email)
    const again = await receive(one, { ...email, receivedAt: new Date() })
    const forwardedTwice = await receive(one, cancellationEmail(one, startsAt, reservationId))

    assert.equal(first.outcome, 'cancelled')
    assert.equal(again.duplicate, true)
    assert.equal(forwardedTwice.outcome, 'noop')
    assert.equal((await cancellationsOf(bookingId)).length, 1)
  })

  test('CPS-56 a cancellation that arrives before its booking is noop, and the booking email still books', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const reservationId = newReservationId()

    const early = await receive(one, cancellationEmail(one, startsAt, reservationId))
    const booked = await receive(one, bookingEmail(one, startsAt, { reservationId }))

    assert.equal(early.outcome, 'noop')
    assert.equal(booked.outcome, 'imported')
    const attendees = (await classDetail(one, classId)).attendees as Record<string, any>[]
    assert.deepEqual(
      attendees.map(a => [a.booking_id, a.source]),
      [[booked.bookingId, 'classpass']],
    )
  })

  test('CPS-57 with the import switched off, a cancellation is kept for review as import_off and cancels nothing', async () => {
    const startsAt = nextStart()
    await addClass(one, startsAt)
    const { reservationId, bookingId } = await imported(one, startsAt)
    await setImport(one.admin, false)
    try {
      const result = await receive(one, cancellationEmail(one, startsAt, reservationId))

      assert.deepEqual([result.outcome, result.reason], ['review', 'import_off'])
      assert.equal((await bookingRow(bookingId)).state, 'confirmed')
      assert.equal((await inboundRow(result.id)).reservationId, reservationId)
    } finally {
      await setImport(one.admin, true)
    }
  })

  test("CPS-58 a cancellation reaches only its own studio's bookings: the same key at another studio is noop there", async () => {
    const startsAt = nextStart()
    await addClass(one, startsAt)
    const { reservationId, bookingId } = await imported(one, startsAt)

    const result = await receive(two, cancellationEmail(two, startsAt, reservationId))

    assert.equal(result.outcome, 'noop')
    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
  })

  test('CPS-59 a cancellation whose Reservation key cannot be read is kept as unparsed and cancels nothing', async () => {
    const startsAt = nextStart()
    await addClass(one, startsAt)
    const { bookingId } = await imported(one, startsAt)

    const result = await receive(one, cancellationEmail(one, startsAt, 'not-a-reservation-key'))

    assert.equal(result.outcome, 'unparsed')
    assert.equal(result.reason, 'unparsed')
    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
    assert.match((await inboundRow(result.id)).text ?? '', /not-a-reservation-key/)
  })

  test('CPS-73 a booking imported from a 2025-layout email is cancelled by its cancellation, which ClassPass wrote the same in both eras', async () => {
    const startsAt = nextStart()
    await addClass(one, startsAt)
    const reservationId = newReservationId()
    const booked = await receive(one, bookingEmail(one, startsAt, { layout: '2025-text', reservationId }))
    assert.equal(booked.outcome, 'imported')

    const result = await receive(one, cancellationEmail(one, startsAt, reservationId, { layout: '2025-text' }))

    assert.equal(result.outcome, 'cancelled')
    assert.equal(result.bookingId, booked.bookingId)
    assert.equal((await bookingRow(booked.bookingId!)).state, 'cancelled')
    assert.equal((await inboundRow(result.id)).reservationId, reservationId)
  })

  test('CPS-99 a member cannot cancel a ClassPass booking themselves: it is refused, shown to them as ClassPass, and staff can still cancel it', async () => {
    const startsAt = nextStart()
    await addClass(one, startsAt)
    const dee = await member(one, 'dee-own-cancel')
    const { bookingId } = await imported(one, startsAt, dee)
    const headers = await harness.signInAs('client', dee.email, one)

    const upcoming = await expectStatus(await harness.app.request('/api/v1/me/bookings/upcoming', { headers }), 200)
    const listed = upcoming.bookings as Record<string, any>[]
    assert.equal(listed.find(b => b.booking_id === bookingId)?.source, 'classpass')

    const refused = await expectStatus(
      await harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers }),
      409,
    )
    assert.equal(refused.error, 'classpass_booking_cancel_on_classpass')
    assert.equal((await bookingRow(bookingId)).state, 'confirmed')
    assert.deepEqual(await cancellationsOf(bookingId), [])

    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ credit: 'return' }),
      }),
      200,
    )
    assert.equal((await bookingRow(bookingId)).state, 'cancelled')
  })
})
