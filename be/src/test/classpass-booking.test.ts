import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { MailTransport, OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.classpass-booking.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `ClassPass booking class type ${run}`
const PACKAGE_NAME = `ClassPass booking pass ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * A ClassPass booking: a booking ClassPass paid for, made through the
 * booking service's ClassPass payer. It spends none of the member's credits,
 * takes seats in the staff order and never refuses, and shows on the roster
 * and the member's profile as ClassPass. Nothing imports one yet, so these
 * tests call the service directly and read what it left through the portal's
 * routes.
 */
describe('a ClassPass booking', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let bookSvc!: typeof import('../services/bookings/book')

  type Staff = { id: string; headers: Record<string, string> }
  type Member = { clientId: string; email: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    classPackageId: string
    admin: Staff
    instructor: Staff
  }

  let one!: Studio
  let two!: Studio

  const sent: OutboundMessage[] = []
  const recording: MailTransport = {
    name: 'null',
    async send(message) {
      sent.push(message)
      return { messageId: `classpass-booking-${sent.length}`, response: 'recorded' }
    },
  }
  let restoreMail: () => void = () => {}

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }
  const aWeekOut = () => new Date(Math.floor((Date.now() + 7 * DAY) / MINUTE) * MINUTE)
  const shifted = (from: Date, ms: number) => new Date(from.getTime() + ms)
  /** A ClassPass reservation ID: 32 hex characters. */
  const reservationId = () => randomUUID().replace(/-/g, '')

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
    }
  }

  async function addClass(
    at: Studio,
    startsAt: Date,
    options: { capacityOnline?: number; capacityBuffer?: number; creditCost?: number } = {},
  ): Promise<string> {
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
        capacityBuffer: options.capacityBuffer ?? 0,
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
    return { clientId: client!.id, email, headers }
  }

  /** An Activated Credit Bundle the member holds. */
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

  /* ── acting ─────────────────────────────────────────────────────────── */

  const classPassBook = (at: Studio, who: Member, classId: string, id = reservationId()) =>
    bookSvc.classPassBookClass(at.id, { clientId: who.clientId, classId, reservationId: id })

  async function memberBook(who: Member, classId: string): Promise<string> {
    const res = await harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({ class_id: classId }),
    })
    return (await expectStatus(res, 201)).booking_id as string
  }

  async function staffBook(at: Studio, who: Member, classId: string, overbook = false): Promise<string> {
    const res = await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}/bookings`, {
      method: 'POST',
      headers: { ...at.admin.headers, ...json },
      body: JSON.stringify({ client_id: who.clientId, overbook }),
    })
    return (await expectStatus(res, 201)).booking_id as string
  }

  /* ── reading ────────────────────────────────────────────────────────── */

  async function adminRoster(at: Studio, classId: string) {
    return expectStatus(
      await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: at.admin.headers }),
      200,
    )
  }

  async function instructorRoster(at: Studio, classId: string) {
    return expectStatus(
      await harness.app.request(`/api/v1/portal/instructor/sessions/class/${classId}/roster`, {
        headers: at.instructor.headers,
      }),
      200,
    )
  }

  async function profile(at: Studio, who: Member) {
    return expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${who.clientId}`, { headers: at.admin.headers }),
      200,
    )
  }

  const attendee = (roster: Record<string, any>, bookingId: string) => {
    const a = (roster.attendees as Record<string, any>[]).find(x => x.booking_id === bookingId)
    assert.ok(a, `booking ${bookingId} is not on the roster`)
    return a
  }

  async function balanceOf(packageId: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, packageId))
    return row!.creditsOrSessionsRemaining
  }

  async function finance(at: Studio, from: Date, to: Date) {
    const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })
    return expectStatus(
      await harness.app.request(`/api/v1/portal/admin/finance?${qs}`, { headers: at.admin.headers }),
      200,
    )
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    bookSvc = inTenantContext(await import('../services/bookings/book'))
    restoreMail = (await import('../lib/mailer')).useTransport(recording)
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    restoreMail()
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM waitlist_entries WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
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

  /* ── tests ──────────────────────────────────────────────────────────── */

  test('CPS-01 a member booking themselves and staff booking a member both make a direct booking', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const classId = await addClass(one, shifted(t0, 2 * DAY))
    const ada = await member(one, 'ada-direct')
    await give(one, ada)
    const bea = await member(one, 'bea-direct')
    await give(one, bea)

    const own = await memberBook(ada, classId)
    const staffMade = await staffBook(one, bea, classId)

    const roster = await adminRoster(one, classId)
    assert.equal(attendee(roster, own).source, 'direct')
    assert.equal(attendee(roster, staffMade).source, 'direct')
    const history = await profile(one, ada)
    assert.deepEqual(
      (history.upcoming_bookings as Record<string, any>[]).map(b => [b.booking_id, b.source]),
      [[own, 'direct']],
    )
  })

  test('CPS-02 a ClassPass booking spends no credits, writes no Credit movement or Purchase, and moves no finance figure', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const startsAt = shifted(t0, 2 * DAY)
    const classId = await addClass(one, startsAt, { creditCost: 2 })
    const cy = await member(one, 'cy-credits')
    const bundle = await give(one, cy)
    const before = await finance(one, shifted(t0, -DAY), shifted(startsAt, DAY))

    const booked = await classPassBook(one, cy, classId)

    assert.equal(booked.paidWith, null)
    assert.equal(await balanceOf(bundle), 10)
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, booked.bookingId))
    assert.equal(row!.clientPackageId, null)
    assert.equal(row!.creditsOrSessionsUsed, 0)
    const movements = await harness.db
      .select()
      .from(schema.creditMovements)
      .where(eq(schema.creditMovements.clientId, cy.clientId))
    assert.deepEqual(movements, [])
    const purchases = await harness.db.select().from(schema.purchases).where(eq(schema.purchases.clientId, cy.clientId))
    assert.deepEqual(purchases, [])
    const afterwards = await finance(one, shifted(t0, -DAY), shifted(startsAt, DAY))
    assert.deepEqual(afterwards.totals, before.totals)
    assert.deepEqual(afterwards.rows, before.rows)
  })

  test('CPS-03 a ClassPass booking takes Online, then Buffer, then an Overbook seat, and is never refused for capacity', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const classId = await addClass(one, shifted(t0, 2 * DAY), { capacityOnline: 1, capacityBuffer: 1 })
    const seats: string[] = []
    for (const name of ['dee-seat', 'eve-seat', 'fay-seat']) {
      seats.push((await classPassBook(one, await member(one, name), classId)).seat)
    }
    assert.deepEqual(seats, ['online', 'buffer', 'overbook'])

    const roster = await adminRoster(one, classId)
    assert.deepEqual(
      (roster.attendees as Record<string, any>[]).map(a => [a.seat, a.source]).sort(),
      [
        ['buffer', 'classpass'],
        ['online', 'classpass'],
        ['overbook', 'classpass'],
      ],
    )
  })

  test('CPS-04 a second ClassPass booking with the same reservation ID is refused in the same Tenant and allowed in another', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const id = reservationId()
    const first = await addClass(one, shifted(t0, 2 * DAY))
    const second = await addClass(one, shifted(t0, 3 * DAY))
    await classPassBook(one, await member(one, 'gus-dup'), first, id)

    await assert.rejects(
      classPassBook(one, await member(one, 'hal-dup'), second, id),
      (err: { code?: string; status?: number }) => err.code === 'classpass_reservation_taken' && err.status === 409,
    )
    const [{ n }] = (await harness.db.execute(
      sql`SELECT count(*)::int AS n FROM bookings WHERE tenant_id = ${one.id} AND classpass_reservation_id = ${id}`,
    )) as unknown as [{ n: number }]
    assert.equal(n, 1)

    const elsewhere = await classPassBook(two, await member(two, 'gus-dup'), await addClass(two, shifted(t0, 2 * DAY)), id)
    assert.equal(elsewhere.seat, 'online')
  })

  test('CPS-05 the roster, to an Admin and an Instructor, and the member profile show a ClassPass booking as ClassPass', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const classId = await addClass(one, shifted(t0, 2 * DAY))
    const ida = await member(one, 'ida-badge')
    const { bookingId } = await classPassBook(one, ida, classId)

    assert.equal(attendee(await adminRoster(one, classId), bookingId).source, 'classpass')
    assert.equal(attendee(await instructorRoster(one, classId), bookingId).source, 'classpass')
    const history = await profile(one, ida)
    assert.deepEqual(
      (history.upcoming_bookings as Record<string, any>[]).map(b => [b.booking_id, b.source, b.package_name]),
      [[bookingId, 'classpass', null]],
    )
  })

  test('CPS-06 staff cancelling a ClassPass booking frees the seat with refund outcome n_a and no credit to choose about', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const classId = await addClass(one, shifted(t0, 2 * DAY), { capacityOnline: 1 })
    const jo = await member(one, 'jo-cancel')
    const { bookingId } = await classPassBook(one, jo, classId)

    const preview = attendee(await adminRoster(one, classId), bookingId).cancel_preview
    assert.equal(preview.credits, 0)
    assert.equal(preview.package_name, null)

    const res = await harness.app.request(`/api/v1/portal/admin/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: { ...one.admin.headers, ...json },
      body: JSON.stringify({ credit: 'return' }),
    })
    assert.deepEqual(await expectStatus(res, 200), { refund_outcome: 'n_a', refund_fired: false })

    const roster = await adminRoster(one, classId)
    assert.deepEqual(roster.attendees, [])
    const cancelled = await profile(one, jo)
    assert.deepEqual(
      (cancelled.cancelled_bookings as Record<string, any>[]).map(b => [b.booking_id, b.source, b.refund_outcome]),
      [[bookingId, 'classpass', 'n_a']],
    )
    // The freed seat is the Online one: a member can book it.
    const kit = await member(one, 'kit-after')
    await give(one, kit)
    await memberBook(kit, classId)
  })

  test('CPS-07 a ClassPass booking is recorded on a class that has already started', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const startsAt = shifted(t0, 2 * DAY)
    const classId = await addClass(one, startsAt)
    harness.clock.set(shifted(startsAt, 10 * MINUTE))

    const { bookingId } = await classPassBook(one, await member(one, 'lu-late'), classId)

    assert.equal(attendee(await adminRoster(one, classId), bookingId).source, 'classpass')
  })

  test('CPS-08 a ClassPass booking withdraws the member\'s waiting Waitlist entry for that class and books a member who holds a clashing booking', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const startsAt = shifted(t0, 2 * DAY)
    const classId = await addClass(one, startsAt)
    const clashing = await addClass(one, shifted(startsAt, 30 * MINUTE))
    const mo = await member(one, 'mo-waiting')
    await give(one, mo)
    await memberBook(mo, clashing)
    const [entry] = await harness.db
      .insert(schema.waitlistEntries)
      .values({ tenantId: one.id, clientId: mo.clientId, classId })
      .returning({ id: schema.waitlistEntries.id })

    const { bookingId } = await classPassBook(one, mo, classId)

    assert.equal(attendee(await adminRoster(one, classId), bookingId).source, 'classpass')
    const [settled] = await harness.db
      .select({ status: schema.waitlistEntries.status, resolvedBy: schema.waitlistEntries.resolvedBy })
      .from(schema.waitlistEntries)
      .where(and(eq(schema.waitlistEntries.id, entry!.id)))
    assert.deepEqual(settled, { status: 'withdrawn', resolvedBy: 'client' })
  })

  test('CPS-116 a ClassPass booking on a class that has already started leaves the member\'s waiting entry for the expiry sweep', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const startsAt = shifted(t0, 2 * DAY)
    const classId = await addClass(one, startsAt)
    const mo = await member(one, 'mo-started')
    const [entry] = await harness.db
      .insert(schema.waitlistEntries)
      .values({ tenantId: one.id, clientId: mo.clientId, classId })
      .returning({ id: schema.waitlistEntries.id })
    harness.clock.set(shifted(startsAt, 10 * MINUTE))

    const { bookingId } = await classPassBook(one, mo, classId)

    assert.equal(attendee(await adminRoster(one, classId), bookingId).source, 'classpass')
    const resolution = async () =>
      (
        await harness.db
          .select({ status: schema.waitlistEntries.status, resolvedBy: schema.waitlistEntries.resolvedBy })
          .from(schema.waitlistEntries)
          .where(eq(schema.waitlistEntries.id, entry!.id))
      )[0]!
    assert.deepEqual(await resolution(), { status: 'waiting', resolvedBy: null }, 'booking leaves a started class\'s line alone')
    await (await import('../jobs')).scheduledJobs.expireWaitlists()
    assert.deepEqual(await resolution(), { status: 'expired', resolvedBy: 'system' })
  })

  test('CPS-09 a ClassPass booking sends the member no email', async () => {
    const t0 = aWeekOut()
    harness.clock.set(t0)
    const classId = await addClass(one, shifted(t0, 2 * DAY))
    const ned = await member(one, 'ned-quiet')
    sent.splice(0)

    await classPassBook(one, ned, classId)

    assert.deepEqual(
      sent.splice(0).map(m => m.to),
      [],
    )
  })
})
