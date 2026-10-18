import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { classPassEmail, classPassRoster, type ClassPassRosterOptions, type RosterClass } from './classpass-email'
import { withEnv } from './with-env'
import type { InboundEmail } from '../services/classpass/receive'

const run = Date.now().toString(36)
const DOMAIN = `${run}.classpass-roster.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const STRETCH = `Roster Stretch ${run}`
const LOCATION = `ClassPass roster room ${run}`
/** What ClassPass calls the Location in its booking emails, and (in capitals) its roster. */
const CLASSPASS_LOCATION = `Northwind-Roster ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The ClassPass Daily Roster check (#415): ClassPass's `ClassPass Daily
 * Roster` email lists, per listing, each class with the names of the members
 * coming. It is compared with the ClassPass bookings held on those classes at
 * the mapped Location, and every difference is shown on the ClassPass page:
 * a member ClassPass lists that the class roster lacks ("on ClassPass, not on
 * roster"), and a ClassPass booking ClassPass doesn't list ("on roster, not on
 * ClassPass"). A roster changes no booking.
 *
 * Bookings are made the way production makes them, by a booking email through
 * `receiveClassPassEmail`; rosters arrive through it too, and every check is
 * read from the ClassPass page's status route.
 */
describe('the ClassPass Daily Roster check', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ CLASSPASS_INBOUND_DOMAIN: 'classpass-roster-inbound.test' })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let receiveSvc!: typeof import('../services/classpass/receive')

  type Studio = {
    id: string
    slug: string
    timezone: string
    locationId: string
    typeId: string
    adminHeaders: Record<string, string>
    instructorId: string
  }
  let one!: Studio
  let two!: Studio
  const keptIds: string[] = []

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }
  let slot = 0
  /** A whole half hour about a week out, a few hours apart per call, so no two tests share a start. */
  const nextStart = () => new Date(Math.floor((Date.now() + 7 * DAY) / HOUR) * HOUR + slot++ * 3 * HOUR + 30 * MINUTE)

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as Record<string, any>) : {}
  }

  function parts(at: Date, timezone: string, options: Intl.DateTimeFormatOptions) {
    const out: Record<string, string> = {}
    for (const p of new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...options }).formatToParts(at)) out[p.type] = p.value
    return out
  }

  /** The booking email's `Sep 18, 2026` and `1:30 PM`, in the studio's timezone. */
  function bookingWhen(at: Date, timezone: string) {
    const p = parts(at, timezone, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    return { date: `${p.month} ${p.day}, ${p.year}`, time: `${p.hour}:${p.minute} ${p.dayPeriod}` }
  }

  /** The roster's `01:30pm` and `Fri, Sep 18`, in the studio's timezone. */
  function rosterWhen(at: Date, timezone: string) {
    const p = parts(at, timezone, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    return { time: `${p.hour}:${p.minute}${p.dayPeriod!.toLowerCase()}`, day: `${p.weekday}, ${p.month} ${p.day}` }
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

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

    const adminEmail = emailFor(`admin-${tenant.slug}`)
    const adminHeaders = await harness.signInAs('staff', adminEmail, tenant)
    const instructorEmail = emailFor(`instructor-${tenant.slug}`)
    await harness.signInAs('staff', instructorEmail, tenant)
    const staffIds: string[] = []
    for (const [email, role] of [[adminEmail, 'admin'], [instructorEmail, 'instructor']] as const) {
      const [user] = await harness.db
        .select({ id: schema.staffAuthUsers.id })
        .from(schema.staffAuthUsers)
        .where(eq(schema.staffAuthUsers.email, email))
      const [row] = await harness.db
        .insert(schema.staffUsers)
        .values({ tenantId: tenant.id, email, name: role, role, status: 'active', authUserId: user!.id })
        .returning({ id: schema.staffUsers.id })
      staffIds.push(row!.id)
    }
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: staffIds[1]! })

    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass/locations', {
        method: 'POST',
        headers: { ...adminHeaders, ...json },
        body: JSON.stringify({ location_name: CLASSPASS_LOCATION, location_id: location!.id }),
      }),
      201,
    )
    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass', {
        method: 'PATCH',
        headers: { ...adminHeaders, ...json },
        body: JSON.stringify({ enabled: true }),
      }),
      200,
    )
    return {
      ...tenant,
      timezone: t!.timezone,
      locationId: location!.id,
      typeId: type!.id,
      adminHeaders,
      instructorId: staffIds[1]!,
    }
  }

  async function addClass(at: Studio, startsAt: Date): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.typeId,
        mainInstructorId: at.instructorId,
        locationId: at.locationId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        capacityBuffer: 0,
        creditCost: 1,
        createdByStaffId: at.instructorId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  async function receive(at: Studio, email: InboundEmail) {
    const result = await receiveSvc.receiveClassPassEmail(at.id, email)
    keptIds.push(result.id)
    return result
  }

  /** A member booked onto the class at `startsAt` by a ClassPass booking email. */
  async function bookByClassPass(at: Studio, startsAt: Date, name: string) {
    const result = await receive(
      at,
      classPassEmail({
        className: STRETCH,
        location: CLASSPASS_LOCATION,
        ...bookingWhen(startsAt, at.timezone),
        memberName: name,
        memberEmail: emailFor(`${name.toLowerCase().replace(/\s+/g, '-')}-${randomUUID().slice(0, 6)}`),
      }),
    )
    assert.equal(result.outcome, 'imported')
    return result.bookingId!
  }

  /** One class on a roster, at `startsAt`, naming `members`. */
  function listed(at: Studio, startsAt: Date, members: string[]): RosterClass {
    return { className: STRETCH.toUpperCase(), ...rosterWhen(startsAt, at.timezone), members }
  }

  /**
   * A roster for the mapped listing. It arrives a minute from now unless told
   * otherwise, so it is certainly later than the bookings a test made first.
   */
  function roster(classes: RosterClass[], options: ClassPassRosterOptions = {}) {
    return classPassRoster({
      location: CLASSPASS_LOCATION.toUpperCase(),
      classes,
      receivedAt: new Date(Date.now() + MINUTE),
      ...options,
    })
  }

  async function bookedAt(bookingId: string): Promise<Date> {
    const [row] = await harness.db.select({ at: schema.bookings.bookedAt }).from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    return row!.at
  }

  /* ── reading ────────────────────────────────────────────────────────── */

  async function status(at: Studio) {
    return expectStatus(await harness.app.request('/api/v1/portal/admin/classpass', { headers: at.adminHeaders }), 200)
  }

  /** The roster check's differences on one class, as `[difference, member name]`, sorted. */
  async function differencesOn(at: Studio, classId: string) {
    const check = (await status(at)).roster_check
    return (check.differences as Record<string, any>[])
      .filter(d => d.class_id === classId)
      .map(d => [d.difference, d.member_name])
      .sort()
  }

  /** The class roster: who is booked, and who was cancelled off it. */
  async function classRoster(at: Studio, classId: string) {
    const body = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: at.adminHeaders }),
      200,
    )
    return {
      booked: (body.attendees as Record<string, any>[]).map(a => a.client.name as string).sort(),
      cancelled: (body.cancelled_bookings as Record<string, any>[]).length,
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    receiveSvc = inTenantContext(await import('../services/classpass/receive'))
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
    await harness.db.execute(sql`DELETE FROM classpass_inbound_emails WHERE member_email LIKE ${ours} OR client_id IN (${clients})`)
    for (const id of keptIds) await harness.db.execute(sql`DELETE FROM classpass_inbound_emails WHERE id = ${id}`)
    await harness.db.execute(sql`DELETE FROM classpass_location_mappings WHERE location_id IN (SELECT id FROM locations WHERE name = ${LOCATION})`)
    await harness.db.execute(sql`UPDATE classpass_settings SET enabled = false WHERE tenant_id IN (${one.id}, ${two.id})`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE class_id IN (${ourClasses})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${STRETCH}`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name = ${LOCATION}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM auth_events WHERE actor_user_id IN (SELECT id FROM staff_auth_users WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── tests ──────────────────────────────────────────────────────────── */

  test('CPS-80 a roster that lists exactly the ClassPass bookings imported on its class shows no differences', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    await bookByClassPass(one, startsAt, 'Ada Placeholder')
    await bookByClassPass(one, startsAt, 'Bo Placeholder')

    const result = await receive(one, roster([listed(one, startsAt, ['Ada Placeholder', 'Bo Placeholder'])]))

    assert.equal(result.kind, 'roster')
    assert.deepEqual(await differencesOn(one, classId), [])
  })

  test('CPS-81 a member the roster names who holds no ClassPass booking on that class shows "on ClassPass, not on roster"', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    await bookByClassPass(one, startsAt, 'Ada Placeholder')

    await receive(one, roster([listed(one, startsAt, ['Ada Placeholder', 'Cy Placeholder'])]))

    assert.deepEqual(await differencesOn(one, classId), [['on_classpass_not_on_roster', 'Cy Placeholder']])
    const [cy] = ((await status(one)).roster_check.differences as Record<string, any>[]).filter(d => d.class_id === classId)
    assert.equal(cy!.booking_id, null)
    assert.equal(new Date(cy!.starts_at).getTime(), startsAt.getTime())
  })

  test('CPS-82 a ClassPass booking held on a class whose roster leaves it out shows "on roster, not on ClassPass"', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    await bookByClassPass(one, startsAt, 'Ada Placeholder')
    const bo = await bookByClassPass(one, startsAt, 'Bo Placeholder')

    await receive(one, roster([listed(one, startsAt, ['Ada Placeholder'])]))

    assert.deepEqual(await differencesOn(one, classId), [['on_roster_not_on_classpass', 'Bo Placeholder']])
    const [row] = ((await status(one)).roster_check.differences as Record<string, any>[]).filter(d => d.class_id === classId)
    assert.equal(row!.booking_id, bo)
  })

  test('CPS-83 names are compared ignoring case, in an HTML roster as in a plain-text one', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    await bookByClassPass(one, startsAt, 'Ada Placeholder')
    await bookByClassPass(one, startsAt, 'Bo Placeholder')

    await receive(one, roster([listed(one, startsAt, ['ADA PLACEHOLDER', 'bo placeholder'])], { html: true }))

    assert.deepEqual(await differencesOn(one, classId), [])
  })

  test('CPS-84 a roster for a listing with no ClassPass location mapping shows that it could not be checked', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const listing = `NORTHWIND UNMAPPED ${run} -`

    await receive(one, roster([listed(one, startsAt, ['Cy Placeholder'])], { location: listing }))

    const check = (await status(one)).roster_check
    const unchecked = (check.unchecked as Record<string, any>[]).filter(u => u.location_name === listing)
    assert.equal(unchecked.length, 1)
    assert.deepEqual(await differencesOn(one, classId), [])
  })

  test('CPS-85 a roster creates and cancels no booking, and makes no member, whatever it differs on', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    await bookByClassPass(one, startsAt, 'Ada Placeholder')
    const before = await classRoster(one, classId)
    const stranger = `Stranger Placeholder ${run}`

    await receive(one, roster([listed(one, startsAt, [stranger])]))

    assert.deepEqual(await classRoster(one, classId), before)
    assert.deepEqual(before, { booked: ['Ada Placeholder'], cancelled: 0 })
    const made = await harness.db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.name, stranger))
    assert.deepEqual(made, [])
    assert.deepEqual(await differencesOn(one, classId), [
      ['on_classpass_not_on_roster', stranger],
      ['on_roster_not_on_classpass', 'Ada Placeholder'],
    ])
  })

  test("CPS-86 the roster's day has no year: a roster sent on 31 December about 1 January means the next year's class", async () => {
    const { zonedInstant } = await import('../services/schedule/series-dates')
    const year = new Date().getUTCFullYear() + 1
    const startsAt = zonedInstant(`${year + 1}-01-01`, '10:30', one.timezone)
    const receivedAt = zonedInstant(`${year}-12-31`, '20:00', one.timezone)
    const classId = await addClass(one, startsAt)
    // A class on the same day a year earlier, which a roster read as this year's would mean.
    const earlier = await addClass(one, zonedInstant(`${year}-01-01`, '10:30', one.timezone))
    await bookByClassPass(one, startsAt, 'Ada Placeholder')
    harness.clock.set(receivedAt)
    try {
      await receive(one, roster([listed(one, startsAt, ['Ada Placeholder', 'Cy Placeholder'])], { receivedAt }))

      assert.deepEqual(await differencesOn(one, classId), [['on_classpass_not_on_roster', 'Cy Placeholder']])
      assert.deepEqual(await differencesOn(one, earlier), [])
    } finally {
      harness.clock.reset()
    }
  })

  test('CPS-87 a booking email that arrives after the roster settles its "on ClassPass, not on roster"', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    await receive(one, roster([listed(one, startsAt, ['Dee Placeholder'])]))
    assert.deepEqual(await differencesOn(one, classId), [['on_classpass_not_on_roster', 'Dee Placeholder']])

    await bookByClassPass(one, startsAt, 'Dee Placeholder')

    assert.deepEqual(await differencesOn(one, classId), [])
  })

  test('CPS-88 a ClassPass booking made after the roster was sent is not shown as missing from it', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const ada = await bookByClassPass(one, startsAt, 'Ada Placeholder')
    // Sent the moment after Ada was booked, by the database's own clock.
    await receive(one, roster([listed(one, startsAt, ['Ada Placeholder'])], { receivedAt: new Date((await bookedAt(ada)).getTime() + 1) }))

    const bo = await bookByClassPass(one, startsAt, 'Bo Placeholder')

    assert.ok((await bookedAt(bo)) > (await bookedAt(ada)))
    assert.deepEqual(await differencesOn(one, classId), [])
  })

  test("CPS-89 a roster that fails DKIM is not checked, and one studio's roster is not checked against another's classes", async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const theirs = await addClass(two, startsAt)
    await bookByClassPass(one, startsAt, 'Ada Placeholder')
    const elsewhere = `Elsewhere Placeholder ${run}`

    const forged = await receive(one, roster([listed(one, startsAt, ['Ada Placeholder', 'Forged Placeholder'])], { dkim: 'fail' }))
    await receive(two, roster([listed(two, startsAt, [elsewhere])]))

    assert.equal(forged.outcome, 'refused')
    // No trusted roster of this studio's own lists the class, so nothing is checked on it.
    assert.deepEqual(await differencesOn(one, classId), [])
    const ours = (await status(one)).roster_check.differences as Record<string, any>[]
    assert.equal(ours.some(d => d.member_name === elsewhere), false)
    assert.deepEqual(await differencesOn(two, theirs), [['on_classpass_not_on_roster', elsewhere]])
  })
})
