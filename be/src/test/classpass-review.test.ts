import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { classPassEmail, newReservationId, type ClassPassEmailOptions } from './classpass-email'
import { withEnv } from './with-env'
import type { MailTransport, OutboundMessage } from '../lib/mailer'
import type { InboundEmail } from '../services/classpass/receive'

const run = Date.now().toString(36)
const DOMAIN = `${run}.classpass-review.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const STRETCH = `Review Stretch ${run}`
const LOCATION = `ClassPass review room ${run}`
/** What ClassPass calls the mapped Location in its emails. */
const CLASSPASS_LOCATION = `Northwind-Review ${run}`
const INBOUND_DOMAIN = 'classpass-review-inbound.test'
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * ClassPass review: every ClassPass booking email the importer could not
 * place is an open item on the ClassPass page, with its reason, what was read
 * from it and the email itself, until an Admin books it into a class, dismisses
 * it, or maps its location.
 *
 * Emails go in through the one entry point, `receiveClassPassEmail`; everything
 * else is read and done through the ClassPass page's routes and the roster.
 */
describe('ClassPass review', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ CLASSPASS_INBOUND_DOMAIN: INBOUND_DOMAIN })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let receiveSvc!: typeof import('../services/classpass/receive')

  type Staff = { id: string; email: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    timezone: string
    locationId: string
    otherLocationId: string
    stretchTypeId: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; email: string; name: string }

  let one!: Studio
  let two!: Studio

  const sent: OutboundMessage[] = []
  const recording: MailTransport = {
    name: 'null',
    async send(message) {
      sent.push(message)
      return { messageId: `classpass-review-${sent.length}`, response: 'recorded' }
    },
  }
  let restoreMail: () => void = () => {}
  const keptIds: string[] = []

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }
  const shifted = (from: Date, ms: number) => new Date(from.getTime() + ms)
  let slot = 0
  /** A whole minute about two weeks out, a few hours apart per call, so no two tests share a start. */
  const nextStart = () => new Date(Math.floor((Date.now() + 14 * DAY) / HOUR) * HOUR + slot++ * 3 * HOUR + 30 * MINUTE)

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

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
    const rooms = await harness.db
      .insert(schema.locations)
      .values([
        { tenantId: tenant.id, name: LOCATION },
        { tenantId: tenant.id, name: `${LOCATION} annex` },
      ])
      .returning({ id: schema.locations.id })
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: STRETCH })
      .returning({ id: schema.classTypes.id })
    const admin = await staffAt(tenant, 'admin', 'admin')
    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass/locations', {
        method: 'POST',
        headers: { ...admin.headers, ...json },
        body: JSON.stringify({ location_name: CLASSPASS_LOCATION, location_id: rooms[0]!.id }),
      }),
      201,
    )
    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass', {
        method: 'PATCH',
        headers: { ...admin.headers, ...json },
        body: JSON.stringify({ enabled: true }),
      }),
      200,
    )
    return {
      ...tenant,
      timezone: t!.timezone,
      locationId: rooms[0]!.id,
      otherLocationId: rooms[1]!.id,
      stretchTypeId: type!.id,
      admin,
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
    }
  }

  async function addClass(
    at: Studio,
    startsAt: Date,
    options: { locationId?: string; capacityOnline?: number; lifecycle?: 'active' | 'cancelled' } = {},
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.stretchTypeId,
        mainInstructorId: at.instructor.id,
        locationId: options.locationId ?? at.locationId,
        startsAt,
        endsAt: shifted(startsAt, HOUR),
        capacityOnline: options.capacityOnline ?? 10,
        capacityBuffer: 0,
        creditCost: 1,
        createdByStaffId: at.instructor.id,
        lifecycle: options.lifecycle ?? 'active',
        cancelledAt: options.lifecycle === 'cancelled' ? new Date() : null,
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

  async function receive(at: Studio, email: InboundEmail) {
    const result = await receiveSvc.receiveClassPassEmail(at.id, email)
    keptIds.push(result.id)
    return result
  }

  /* ── the ClassPass page ─────────────────────────────────────────────── */

  async function reviewList(at: Studio, staff: Staff = at.admin): Promise<Record<string, any>[]> {
    const body = await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass/review', { headers: staff.headers }),
      200,
    )
    return body.items as Record<string, any>[]
  }

  async function itemOf(at: Studio, id: string) {
    return (await reviewList(at)).find(i => i.id === id)
  }

  function act(at: Studio, id: string, action: 'book' | 'dismiss' | 'location', body: Record<string, unknown> = {}, staff = at.admin) {
    return harness.app.request(`/api/v1/portal/admin/classpass/review/${id}/${action}`, {
      method: 'POST',
      headers: { ...staff.headers, ...json },
      body: JSON.stringify(body),
    })
  }

  async function roster(at: Studio, classId: string): Promise<Record<string, any>[]> {
    const body = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: at.admin.headers }),
      200,
    )
    return body.attendees as Record<string, any>[]
  }

  async function setImport(at: Studio, enabled: boolean) {
    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass', {
        method: 'PATCH',
        headers: { ...at.admin.headers, ...json },
        body: JSON.stringify({ enabled }),
      }),
      200,
    )
  }

  async function resolution(id: string) {
    const [row] = await harness.db
      .select({ resolvedAt: schema.classpassInboundEmails.resolvedAt, by: schema.classpassInboundEmails.resolvedByStaffId })
      .from(schema.classpassInboundEmails)
      .where(eq(schema.classpassInboundEmails.id, id))
    return row!
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    receiveSvc = inTenantContext(await import('../services/classpass/receive'))
    restoreMail = (await import('../lib/mailer')).useTransport(recording)
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    restoreMail()
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const ourClasses = sql`SELECT id FROM classes WHERE created_by_staff_id IN (${staff})`
    const rooms = sql`SELECT id FROM locations WHERE name LIKE ${`${LOCATION}%`}`
    await harness.db.execute(sql`DELETE FROM classpass_inbound_emails WHERE member_email LIKE ${ours} OR client_id IN (${clients}) OR resolved_by_staff_id IN (${staff})`)
    for (const id of keptIds) await harness.db.execute(sql`DELETE FROM classpass_inbound_emails WHERE id = ${id}`)
    await harness.db.execute(sql`DELETE FROM classpass_location_mappings WHERE location_id IN (${rooms})`)
    await harness.db.execute(sql`UPDATE classpass_settings SET enabled = false WHERE tenant_id IN (${one.id}, ${two.id})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE class_id IN (${ourClasses})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${STRETCH}`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name LIKE ${`${LOCATION}%`}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM auth_events WHERE actor_user_id IN (SELECT id FROM staff_auth_users WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── tests ──────────────────────────────────────────────────────────── */

  test('CPS-60 each reason the importer could not place a booking email is an open review item with that reason, what was read, and the email itself', async () => {
    const startsAt = nextStart()
    await addClass(one, startsAt)
    const twins = nextStart()
    await addClass(one, twins)
    await addClass(one, twins)
    const cancelled = nextStart()
    await addClass(one, cancelled, { lifecycle: 'cancelled' })
    const gone = await member(one, 'gone')
    await harness.db.update(schema.clients).set({ deletedAt: new Date() }).where(eq(schema.clients.id, gone.clientId))
    const seated = await member(one, 'seated')
    const seatedClass = nextStart()
    const seatedClassId = await addClass(one, seatedClass)
    const first = await receive(one, bookingEmail(one, seatedClass, { memberName: seated.name, memberEmail: seated.email }))
    assert.equal(first.outcome, 'imported')

    const reservationId = newReservationId()
    const cases: [string, InboundEmail][] = [
      ['unmapped_location', bookingEmail(one, startsAt, { location: `Northwind - Nowhere ${run}`, reservationId })],
      ['no_class', bookingEmail(one, shifted(startsAt, 10 * MINUTE))],
      ['ambiguous_class', bookingEmail(one, twins, { className: 'Something Else' })],
      ['class_cancelled', bookingEmail(one, cancelled)],
      ['client_deleted', bookingEmail(one, startsAt, { memberName: gone.name, memberEmail: gone.email })],
      // A second reservation for a member already on the class.
      ['already_booked', bookingEmail(one, seatedClass, { memberName: seated.name, memberEmail: seated.email })],
      ['unparsed', bookingEmail(one, startsAt, { reservationId: '' })],
    ]
    const ids: Record<string, string> = {}
    for (const [reason, email] of cases) ids[reason] = (await receive(one, email)).id

    const list = await reviewList(one)
    for (const [reason, email] of cases) {
      const item = list.find(i => i.id === ids[reason])
      assert.ok(item, `${reason} is listed`)
      assert.equal(item.reason, reason)
      assert.equal(item.html, email.html, 'the email itself is there to read')
    }
    assert.equal(list.some(i => i.id === first.id), false, 'an imported booking is not for review')
    const unmapped = list.find(i => i.id === ids.unmapped_location)!
    assert.equal(unmapped.reservation_id, reservationId)
    assert.equal(unmapped.location_name, `Northwind - Nowhere ${run}`)
    assert.equal(unmapped.class_name, STRETCH)
    assert.equal(new Date(unmapped.starts_at).getTime(), startsAt.getTime())
    assert.equal(unmapped.member_name, 'Placeholder Member')
    assert.equal((await roster(one, seatedClassId)).length, 1)
  })

  test('CPS-61 an Admin books a review item into a class they pick: the member gets a ClassPass booking with the email\'s reservation ID, and the item closes, naming who and when', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const ada = await member(one, 'ada-review')
    const reservationId = newReservationId()
    // ClassPass's time is 15 minutes off the class the studio means.
    const item = await receive(one, bookingEmail(one, shifted(startsAt, 15 * MINUTE), { reservationId, memberName: ada.name, memberEmail: ada.email }))
    assert.equal(item.reason, 'no_class')

    const body = await expectStatus(await act(one, item.id, 'book', { class_id: classId }), 200)

    assert.equal(body.outcome, 'imported')
    const [a] = await roster(one, classId)
    assert.equal(a?.client.id, ada.clientId)
    assert.equal(a?.source, 'classpass')
    const [booking] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, a!.booking_id))
    assert.equal(booking!.classpassReservationId, reservationId)
    assert.equal(await itemOf(one, item.id), undefined, 'the item has left the list')
    const closed = await resolution(item.id)
    assert.equal(closed.by, one.admin.id)
    assert.ok(closed.resolvedAt)
  })

  test('CPS-62 booking a review item for a member the studio does not know creates them, with no phone and no invitation', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt, { locationId: one.otherLocationId })
    const email = emailFor('new-review')
    const item = await receive(one, bookingEmail(one, startsAt, { memberName: 'New Placeholder', memberEmail: email }))
    assert.equal(item.reason, 'no_class')
    const before = sent.length

    await expectStatus(await act(one, item.id, 'book', { class_id: classId }), 200)

    const [a] = await roster(one, classId)
    const [client] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, a!.client.id))
    assert.equal(client!.email, email)
    assert.equal(client!.name, 'New Placeholder')
    assert.equal(sent.slice(before).some(m => [m.to].flat().join(',').includes(email)), false, 'nobody is emailed')
  })

  test('CPS-63 an item whose reservation is already booked, or that is already resolved, is refused and books nothing more', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const otherClassId = await addClass(one, shifted(startsAt, HOUR))
    const reservationId = newReservationId()
    // The same reservation forwarded twice before either was placed.
    const a = await receive(one, bookingEmail(one, shifted(startsAt, 5 * MINUTE), { reservationId }))
    const b = await receive(one, bookingEmail(one, shifted(startsAt, 5 * MINUTE), { reservationId }))
    await expectStatus(await act(one, a.id, 'book', { class_id: classId }), 200)

    await expectStatus(await act(one, b.id, 'book', { class_id: otherClassId }), 409, 'classpass_reservation_taken')
    await expectStatus(await act(one, a.id, 'book', { class_id: otherClassId }), 409, 'classpass_review_resolved')

    assert.deepEqual(await roster(one, otherClassId), [])
    assert.ok(await itemOf(one, b.id), 'the refused item is still open')
  })

  test('CPS-64 booking a member into a class they already hold a seat on is refused already_booked, and the item stays open', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const hal = await member(one, 'hal-review')
    const first = await receive(one, bookingEmail(one, startsAt, { memberName: hal.name, memberEmail: hal.email }))
    assert.equal(first.outcome, 'imported')
    const item = await receive(one, bookingEmail(one, startsAt, { memberName: hal.name, memberEmail: hal.email }))
    assert.equal(item.reason, 'already_booked')

    await expectStatus(await act(one, item.id, 'book', { class_id: classId }), 409, 'already_booked')

    assert.equal((await roster(one, classId)).length, 1)
    assert.ok(await itemOf(one, item.id))
  })

  test('CPS-65 dismissing an item closes it without booking anyone, and it cannot be dismissed twice', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const email = emailFor('dismissed')
    const item = await receive(one, bookingEmail(one, shifted(startsAt, 5 * MINUTE), { memberEmail: email }))

    const body = await expectStatus(await act(one, item.id, 'dismiss'), 200)

    assert.equal(body.outcome, 'review')
    assert.equal(await itemOf(one, item.id), undefined)
    assert.equal((await resolution(item.id)).by, one.admin.id)
    assert.deepEqual(await roster(one, classId), [])
    const [made] = await harness.db.select().from(schema.clients).where(eq(schema.clients.email, email))
    assert.equal(made, undefined, 'no member is created')
    await expectStatus(await act(one, item.id, 'dismiss'), 409, 'classpass_review_resolved')
  })

  test('CPS-66 mapping a location from a review item imports every open item from that location that now matches, and leaves the rest open with their new reason', async () => {
    const name = `Northwind - Annex ${run}`
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt, { locationId: one.otherLocationId })
    const matching = await receive(one, bookingEmail(one, startsAt, { location: name }))
    // The same name as ClassPass spells it in another email.
    const respelled = await receive(one, bookingEmail(one, startsAt, { location: name.toUpperCase().replace(' - ', '-') }))
    const unmatched = await receive(one, bookingEmail(one, shifted(startsAt, 10 * MINUTE), { location: name }))
    const elsewhere = await receive(one, bookingEmail(one, startsAt, { location: `Northwind - Elsewhere ${run}` }))
    for (const r of [matching, respelled, unmatched, elsewhere]) assert.equal(r.reason, 'unmapped_location')

    const body = await expectStatus(await act(one, matching.id, 'location', { location_id: one.otherLocationId }), 200)

    assert.equal(body.mapping.location_id, one.otherLocationId)
    assert.equal((await roster(one, classId)).length, 2)
    assert.equal(await itemOf(one, matching.id), undefined)
    assert.equal(await itemOf(one, respelled.id), undefined)
    assert.equal((await resolution(matching.id)).by, one.admin.id)
    assert.equal((await itemOf(one, unmatched.id))?.reason, 'no_class')
    assert.equal((await itemOf(one, elsewhere.id))?.reason, 'unmapped_location')
    const mappings = await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass/locations', { headers: one.admin.headers }),
      200,
    )
    assert.ok((mappings.mappings as Record<string, any>[]).some(m => m.location_id === one.otherLocationId))
  })

  test('CPS-67 an item the importer could not read can be dismissed, but not booked', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const item = await receive(one, bookingEmail(one, startsAt, { memberEmail: '' }))
    assert.equal(item.reason, 'unparsed')

    await expectStatus(await act(one, item.id, 'book', { class_id: classId }), 400, 'classpass_review_incomplete')
    assert.deepEqual(await roster(one, classId), [])
    await expectStatus(await act(one, item.id, 'dismiss'), 200)
  })

  test('CPS-68 ClassPass review is for Admins: an Instructor is refused, and another studio\'s item is not found', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const item = await receive(one, bookingEmail(one, shifted(startsAt, 5 * MINUTE)))

    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass/review', { headers: one.instructor.headers }),
      403,
      'forbidden_role',
    )
    await expectStatus(await act(one, item.id, 'book', { class_id: classId }, one.instructor), 403, 'forbidden_role')
    assert.equal((await reviewList(two)).some(i => i.id === item.id), false)
    await expectStatus(await act(two, item.id, 'dismiss'), 404, 'classpass_review_not_found')
    await expectStatus(await act(two, item.id, 'book', { class_id: classId }), 404, 'classpass_review_not_found')
    assert.ok(await itemOf(one, item.id), 'still open at its own studio')
  })

  test('CPS-69 a class picked from another studio, or a cancelled one, is refused class_not_found', async () => {
    const startsAt = nextStart()
    const theirs = await addClass(two, startsAt)
    const cancelled = await addClass(one, startsAt, { lifecycle: 'cancelled' })
    const item = await receive(one, bookingEmail(one, shifted(startsAt, 5 * MINUTE)))

    await expectStatus(await act(one, item.id, 'book', { class_id: theirs }), 404, 'class_not_found')
    await expectStatus(await act(one, item.id, 'book', { class_id: cancelled }), 404, 'class_not_found')
    assert.deepEqual(await roster(two, theirs), [])
    assert.ok(await itemOf(one, item.id))
  })

  test('CPS-94 an item whose time or location could not be read is booked into the class the Admin picks, as it names the reservation and the member', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const lee = await member(one, 'lee-review')
    const reservationId = newReservationId()
    const noTime = await receive(one, bookingEmail(one, startsAt, { date: 'sometime', reservationId, memberName: lee.name, memberEmail: lee.email }))
    const noPlace = await receive(one, bookingEmail(one, startsAt, { location: '' }))
    assert.deepEqual([noTime.outcome, noPlace.outcome], ['unparsed', 'unparsed'])

    const booked = await expectStatus(await act(one, noTime.id, 'book', { class_id: classId }), 200)
    await expectStatus(await act(one, noPlace.id, 'book', { class_id: classId }), 200)

    assert.equal(booked.outcome, 'imported')
    assert.equal(new Date(booked.starts_at).getTime(), startsAt.getTime(), 'the item takes the class\'s start')
    const attendees = await roster(one, classId)
    assert.equal(attendees.length, 2)
    const ours = attendees.find(a => a.client.id === lee.clientId)
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, ours!.booking_id))
    assert.equal(row!.classpassReservationId, reservationId)
    assert.equal(await itemOf(one, noTime.id), undefined)
  })

  test('CPS-95 an item for a removed member, or a cancellation, cannot be booked: each is refused with its reason and books nothing', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const gone = await member(one, 'gone-review')
    await harness.db.update(schema.clients).set({ deletedAt: new Date() }).where(eq(schema.clients.id, gone.clientId))
    const removed = await receive(one, bookingEmail(one, startsAt, { memberName: gone.name, memberEmail: gone.email }))
    assert.equal(removed.reason, 'client_deleted')
    await setImport(one, false)
    let cancellation
    try {
      cancellation = await receive(one, classPassEmail({ kind: 'cancellation', memberEmail: emailFor('cancelled-review') }))
    } finally {
      await setImport(one, true)
    }
    assert.deepEqual([cancellation.outcome, cancellation.reason], ['review', 'import_off'])
    assert.equal((await itemOf(one, cancellation.id))?.kind, 'cancellation')

    await expectStatus(await act(one, removed.id, 'book', { class_id: classId }), 409, 'classpass_client_deleted')
    await expectStatus(await act(one, cancellation.id, 'book', { class_id: classId }), 400, 'classpass_review_not_booking')

    assert.deepEqual(await roster(one, classId), [])
    assert.ok(await itemOf(one, removed.id))
    await expectStatus(await act(one, cancellation.id, 'dismiss'), 200)
  })

  test('CPS-96 adding or changing a mapping on the Locations panel imports the open items from that ClassPass location that now match', async () => {
    const added = `Northwind - Panel ${run}`
    const changed = `Northwind - Moved ${run}`
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt, { locationId: one.otherLocationId })
    const first = await receive(one, bookingEmail(one, startsAt, { location: added }))
    const second = await receive(one, bookingEmail(one, startsAt, { location: changed }))

    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass/locations', {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ location_name: added, location_id: one.otherLocationId }),
      }),
      201,
    )
    assert.equal(await itemOf(one, first.id), undefined)
    assert.equal((await resolution(first.id)).by, one.admin.id)

    // Mapped to the wrong Location first: still no class there.
    const wrong = await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass/locations', {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ location_name: changed, location_id: one.locationId }),
      }),
      201,
    )
    assert.equal((await itemOf(one, second.id))?.reason, 'no_class')
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/classpass/locations/${wrong.id}`, {
        method: 'PATCH',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ location_id: one.otherLocationId }),
      }),
      200,
    )
    assert.equal(await itemOf(one, second.id), undefined)
    assert.equal((await roster(one, classId)).length, 2)
  })

  test('CPS-97 mapping from a review item a location already mapped to the same Location reuses that mapping and imports the item', async () => {
    const name = `Northwind - Already ${run}`
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt, { locationId: one.otherLocationId })
    const item = await receive(one, bookingEmail(one, startsAt, { location: name }))
    assert.equal(item.reason, 'unmapped_location')
    // Mapped since the item was read, behind the page's back.
    await harness.db
      .insert(schema.classpassLocationMappings)
      .values({ tenantId: one.id, locationName: `northwind - already ${run}`, locationId: one.otherLocationId })

    const body = await expectStatus(await act(one, item.id, 'location', { location_id: one.otherLocationId }), 200)

    assert.equal(body.mapping.location_id, one.otherLocationId)
    assert.equal(await itemOf(one, item.id), undefined)
    assert.equal((await roster(one, classId)).length, 1)
  })

  test('CPS-98 mapping a location does not place a booking kept while the import was off: the Admin decides on it', async () => {
    const name = `Northwind - Held ${run}`
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt, { locationId: one.otherLocationId })
    await setImport(one, false)
    let held
    try {
      held = await receive(one, bookingEmail(one, startsAt, { location: name }))
    } finally {
      await setImport(one, true)
    }
    const unmapped = await receive(one, bookingEmail(one, startsAt, { location: name }))

    await expectStatus(await act(one, unmapped.id, 'location', { location_id: one.otherLocationId }), 200)

    assert.equal((await itemOf(one, held.id))?.reason, 'import_off')
    assert.equal((await roster(one, classId)).length, 1)
  })
})
