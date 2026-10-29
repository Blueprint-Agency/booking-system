import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { classPassEmail, GMAIL_CONFIRMATION_LINK, gmailForwardingConfirmation } from './classpass-email'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `${run}.classpass-setup.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE = `Setup Stretch ${run}`
const LOCATION = `ClassPass setup room ${run}`
/** What ClassPass calls the Location in its emails, before and after it is mapped. */
const CLASSPASS_LOCATION = `Northwind-Setup ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The ClassPass setup guide: the ClassPass page's status carries the
 * facts each step of the guide ticks on, worked out from what the studio has
 * done and what has arrived at its ClassPass address. Every fact is read
 * through the admin ClassPass route; mail arrives through the one entry
 * point, `receiveClassPassEmail`.
 */
describe('the ClassPass setup guide', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ CLASSPASS_INBOUND_DOMAIN: 'classpass-setup-inbound.test' })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let receive!: typeof import('../services/classpass/receive')

  type Studio = { id: string; slug: string; timezone: string; admin: Record<string, string>; adminId: string }
  let one!: Studio
  let two!: Studio
  let locationId!: string
  let classTypeId!: string

  const json = { 'Content-Type': 'application/json' }
  const emailFor = (name: string) => `${name}@${DOMAIN}`

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as Record<string, any>) : {}
  }

  async function adminAt(tenant: { id: string; slug: string }): Promise<Studio> {
    const email = emailFor(`admin-${tenant.slug}`)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: 'Setup Admin', role: 'admin', status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    // An Admin who teaches too, so the guide's test class has an instructor.
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    const [t] = await harness.db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, tenant.id))
    return { ...tenant, timezone: t!.timezone, admin: headers, adminId: row!.id }
  }

  const call = (at: Studio, method: string, path: string, body?: unknown) =>
    harness.app.request(`/api/v1/portal/admin/classpass${path}`, {
      method,
      headers: { ...at.admin, ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  async function setup(at: Studio): Promise<Record<string, any>> {
    return (await expectStatus(await call(at, 'GET', ''), 200)).setup
  }

  /** The date and time as ClassPass writes them, in the studio's own timezone. */
  function classPassWhen(at: Date, timezone: string): { date: string; time: string } {
    const plain = (s: string) => s.replace(/\s/g, ' ')
    const date = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(at)
    const time = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(at)
    return { date: plain(date), time: plain(time) }
  }

  /** A clean start for the studio's ClassPass import: what an earlier file kept is not this file's. */
  async function forgetClassPass(tenantId: string) {
    await harness.db.execute(sql`DELETE FROM classpass_inbound_emails WHERE tenant_id = ${tenantId}`)
    await harness.db.execute(sql`DELETE FROM classpass_location_mappings WHERE tenant_id = ${tenantId}`)
    await harness.db.execute(sql`DELETE FROM classpass_settings WHERE tenant_id = ${tenantId}`)
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    receive = inTenantContext(await import('../services/classpass/receive'))
    for (const tenant of [harness.tenants.one, harness.tenants.two]) await forgetClassPass(tenant.id)
    one = await adminAt(harness.tenants.one)
    two = await adminAt(harness.tenants.two)
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: one.id, name: LOCATION })
      .returning({ id: schema.locations.id })
    locationId = location!.id
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: one.id, name: CLASS_TYPE })
      .returning({ id: schema.classTypes.id })
    classTypeId = type!.id
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const ourClasses = sql`SELECT id FROM classes WHERE created_by_staff_id IN (${staff})`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    for (const tenant of [harness.tenants.one, harness.tenants.two]) await forgetClassPass(tenant.id)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE class_id IN (${ourClasses})`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE}`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name = ${LOCATION}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM auth_events WHERE actor_user_id IN (SELECT id FROM staff_auth_users WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('CPS-103 a studio that has done nothing yet reads every setup step as not done, and switching the import on is the first', async () => {
    assert.deepEqual(await setup(one), {
      enabled: false,
      gmail_confirmation_received: false,
      gmail_confirmation_at: null,
      first_classpass_email_at: null,
      location_mappings: 0,
      unmapped_location_reviews: 0,
      first_classpass_booking_at: null,
    })

    const switched = await expectStatus(await call(one, 'PATCH', '', { enabled: true }), 200)
    assert.equal(switched.setup.enabled, true)
    assert.equal((await setup(one)).enabled, true)
  })

  test("CPS-104 Gmail's forwarding confirmation marks its code as received, at the time it arrived", async () => {
    const forged = gmailForwardingConfirmation({ code: '111222333', dkim: 'fail' })
    await receive.receiveClassPassEmail(one.id, forged)
    assert.equal((await setup(one)).gmail_confirmation_received, false)

    const real = gmailForwardingConfirmation({ code: '493017286' })
    await receive.receiveClassPassEmail(one.id, real)
    const read = await setup(one)
    assert.equal(read.gmail_confirmation_received, true)
    assert.equal(read.gmail_confirmation_at, real.receivedAt.toISOString())
    // Gmail's own email is not ClassPass's: the filter isn't proven by it.
    assert.equal(read.first_classpass_email_at, null)
  })

  test('CPS-105 the first trusted ClassPass email of any kind, a Daily Roster included, marks the filter as working; an untrusted one does not', async () => {
    await receive.receiveClassPassEmail(one.id, classPassEmail({ kind: 'roster', dkim: 'fail' }))
    await receive.receiveClassPassEmail(one.id, classPassEmail({ kind: 'marketing', from: 'ClassPass <noreply@info-classpass.example>' }))
    assert.equal((await setup(one)).first_classpass_email_at, null)

    const roster = classPassEmail({ kind: 'roster', receivedAt: new Date(Date.now() - HOUR) })
    await receive.receiveClassPassEmail(one.id, roster)
    assert.equal((await setup(one)).first_classpass_email_at, roster.receivedAt.toISOString())

    // A later one doesn't move it.
    await receive.receiveClassPassEmail(one.id, classPassEmail({ kind: 'marketing' }))
    assert.equal((await setup(one)).first_classpass_email_at, roster.receivedAt.toISOString())
  })

  test('CPS-106 a booking at a location ClassPass names but nobody has mapped is counted until it is mapped, and the mapping is counted', async () => {
    const startsAt = new Date(Math.floor((Date.now() + 7 * DAY) / HOUR) * HOUR + 30 * MINUTE)
    const email = classPassEmail({
      kind: 'booking',
      className: CLASS_TYPE,
      location: CLASSPASS_LOCATION,
      ...classPassWhen(startsAt, one.timezone),
      memberEmail: emailFor('unmapped-member'),
    })
    await expectStatus(await call(one, 'PATCH', '', { enabled: true }), 200)
    const kept = await receive.receiveClassPassEmail(one.id, email)
    assert.equal(kept.reason, 'unmapped_location')
    let read = await setup(one)
    assert.deepEqual([read.location_mappings, read.unmapped_location_reviews], [0, 1])

    await expectStatus(await call(one, 'POST', `/review/${kept.id}/location`, { location_id: locationId }), 200)
    read = await setup(one)
    assert.deepEqual([read.location_mappings, read.unmapped_location_reviews], [1, 0])
    // No class at that time: nothing was booked.
    assert.equal(read.first_classpass_booking_at, null)
  })

  test('CPS-107 the first ClassPass booking imported onto a class marks the test booking as done', async () => {
    const startsAt = new Date(Math.floor((Date.now() + 8 * DAY) / HOUR) * HOUR + 30 * MINUTE)
    await harness.db.insert(schema.classes).values({
      tenantId: one.id,
      classTypeId,
      mainInstructorId: one.adminId,
      locationId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      capacityOnline: 10,
      capacityBuffer: 0,
      creditCost: 1,
      createdByStaffId: one.adminId,
      lifecycle: 'active',
    })

    const placed = await receive.receiveClassPassEmail(
      one.id,
      classPassEmail({
        kind: 'booking',
        className: CLASS_TYPE,
        location: CLASSPASS_LOCATION,
        ...classPassWhen(startsAt, one.timezone),
        memberName: 'Placeholder Member',
        memberEmail: emailFor(`member-${randomUUID().slice(0, 8)}`),
      }),
    )
    assert.equal(placed.outcome, 'imported')
    const [booking] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, placed.bookingId!))

    const read = await setup(one)
    assert.equal(read.first_classpass_booking_at, booking!.bookedAt.toISOString())
  })

  test("CPS-108 one studio's setup never counts another's: the other studio still reads every step as not done", async () => {
    assert.deepEqual(await setup(two), {
      enabled: false,
      gmail_confirmation_received: false,
      gmail_confirmation_at: null,
      first_classpass_email_at: null,
      location_mappings: 0,
      unmapped_location_reviews: 0,
      first_classpass_booking_at: null,
    })
  })

  test("CPS-113 Gmail's link-only forwarding confirmation also marks the confirmation as received, and the page gets its link", async () => {
    const real = gmailForwardingConfirmation({ format: 'link' })
    await receive.receiveClassPassEmail(two.id, real)
    const page = await expectStatus(await call(two, 'GET', ''), 200)
    assert.equal(page.gmail_confirmation_link, GMAIL_CONFIRMATION_LINK)
    assert.equal(page.gmail_confirmation_code, null)
    assert.equal(page.setup.gmail_confirmation_received, true)
    assert.equal(page.setup.gmail_confirmation_at, real.receivedAt.toISOString())
  })
})
