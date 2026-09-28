import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures } from './member-fixtures'

const run = Date.now().toString(36)
const DOMAIN = `${run}.practice.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const TYPE = (name: string) => `${name} practice ${run}`
const PACKAGE_NAME = `Practice pass ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/**
 * The member's practice summary (#317, "My practice" #340):
 * `GET /me/bookings/attendance`, over real HTTP against both fixture Tenants.
 *
 * Studio two keeps `Australia/Sydney`, which is UTC+10 in August and September,
 * so a class half an hour either side of its midnight on 1 September falls on
 * 31 August in both UTC and Singapore. Grouping by anything but the Tenant's
 * own zone puts both classes in the same month.
 *
 * History arrives as rows written straight into `bookings` — the shape a
 * studio's import leaves (no check-in row, no package) — beside one class
 * booked and ticked through the real routes. Private sessions are written the
 * same way, a `pt` booking on its own `pt_sessions` row.
 */
describe('member practice summary over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fixtures!: ReturnType<typeof memberFixtures>
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type Studio = { id: string; slug: string; locationId: string; roomId: string; teacherId: string }
  type Member = { clientId: string; headers: Record<string, string> }
  type Summary = {
    period: string
    from: string
    to: string
    attended: number
    attended_classes: number
    attended_pt: number
    attended_workshops: number
    previous_attended: number | null
    buckets: { starts_on: string; attended: number; booked: number }[]
    minutes: number
    streak_weeks: number
    usual_slot: { weekday: number; hour: number } | null
    top_class_types: { name: string; attended: number }[]
    lifetime: { attended: number; since: string | null }
    last_attended_at: string | null
  }
  type Outcome = {
    type?: string
    minutes?: number
    checkIn?: 'attended' | 'no_show' | 'pending'
    state?: 'confirmed' | 'cancelled' | 'no_show'
    lifecycle?: 'active' | 'cancelled'
  }

  let one!: Studio
  let two!: Studio
  const types = new Map<string, string>()

  // The instant every test stands at: 15 September 2026, in both studios' zones.
  const NOW = new Date('2026-09-15T04:00:00Z')

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location.id)).limit(1)
    assert.ok(room, `expected a seeded room for ${tenant.slug}`)
    const teacher = await staff(tenant, 'teacher', 'instructor')
    return { ...tenant, locationId: location.id, roomId: room.id, teacherId: teacher.staffId }
  }

  async function staff(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor') {
    const email = fixtures.at(`${name}-${tenant.slug}`)
    const { row, headers } = await fixtures.staffAt(tenant, email, role)
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row.id })
    return { staffId: row.id, headers }
  }

  async function member(at: Studio, name: string): Promise<Member> {
    const email = fixtures.at(`${name.toLowerCase().replace(/\s+/g, '-')}-${at.slug}`)
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

  /** The studio's class type called `name`, made on first use. */
  async function classType(at: Studio, name: string): Promise<string> {
    const key = `${at.id}:${name}`
    if (!types.has(key)) types.set(key, (await classTypesSvc.createClassType(at.id, { name: TYPE(name) })).id)
    return types.get(key)!
  }

  async function addClass(
    at: Studio,
    startsAt: Date,
    type = 'Flow',
    opts: { minutes?: number; lifecycle?: 'active' | 'cancelled' } = {},
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: await classType(at, type),
        mainInstructorId: at.teacherId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + (opts.minutes ?? 60) * MINUTE),
        lifecycle: opts.lifecycle ?? 'active',
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: at.teacherId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /**
   * A class booking as an import writes it: straight into `bookings`, with the
   * outcome already set, no package and no check-in row.
   */
  async function history(at: Studio, who: Member, startsAt: string, opts: Outcome = {}) {
    const classId = await addClass(at, new Date(startsAt), opts.type, opts)
    await harness.db.insert(schema.bookings).values({
      tenantId: at.id,
      clientId: who.clientId,
      kind: 'class',
      classId,
      state: opts.state ?? 'confirmed',
      checkInState: opts.checkIn ?? 'attended',
      qrToken: `practice-${crypto.randomUUID()}`,
      code: crypto.randomUUID().slice(0, 12),
    })
  }

  /** A private session the member holds, written as the history above is. */
  async function privateSession(at: Studio, who: Member, startsAt: string, opts: Outcome = {}) {
    const starts = new Date(startsAt)
    const pt = await fixtures.insertRow('pt_sessions', at.id, {
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + (opts.minutes ?? 60) * MINUTE).toISOString(),
      lifecycle: opts.lifecycle ?? 'active',
    })
    await fixtures.insertRow('bookings', at.id, {
      kind: 'pt',
      class_id: null,
      pt_session_id: pt.id,
      client_id: who.clientId,
      state: opts.state ?? 'confirmed',
      check_in_state: opts.checkIn ?? 'attended',
    })
  }

  /** A workshop whose first day starts at `startsAt`, and the member's booking of it. */
  async function workshop(at: Studio, who: Member, startsAt: string, checkIn: 'attended' | 'no_show' | 'pending') {
    const starts = new Date(startsAt)
    const row = await fixtures.insertRow('workshops', at.id)
    await fixtures.insertRow('workshop_days', at.id, {
      workshop_id: row.id,
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 3 * HOUR).toISOString(),
    })
    const tier = await fixtures.insertRow('workshop_tiers', at.id, { workshop_id: row.id })
    await fixtures.insertRow('bookings', at.id, {
      kind: 'workshop',
      class_id: null,
      workshop_id: row.id,
      workshop_tier_id: tier.id,
      list_price_sgd: '10.00',
      amount_paid_sgd: '10.00',
      client_id: who.clientId,
      check_in_state: checkIn,
    })
  }

  async function summary(who: Member, period?: string): Promise<{ status: number; body: Summary }> {
    const res = await harness.app.request(`/api/v1/me/bookings/attendance${period ? `?period=${period}` : ''}`, {
      headers: who.headers,
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  async function summaryOk(who: Member, period?: string): Promise<Summary> {
    const res = await summary(who, period)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    fixtures = memberFixtures(harness, schema, DOMAIN)
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    const [tz] = await harness.db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, two.id))
    assert.equal(tz!.timezone, 'Australia/Sydney', 'the boundary scenario is written for studio two on Sydney time')
  })

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM check_ins WHERE booking_id IN (SELECT id FROM bookings WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE ${`% practice ${run}`}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await fixtures.cleanup()
    await harness.close()
  })

  test('ACC-15 "this month" is the month on the studio’s own clock: a class either side of its midnight on the 1st lands either side, the second on the 1st', async () => {
    harness.clock.set(NOW)
    const ana = await member(two, 'Ana Midnight')
    // 23:30 on 31 August and 00:30 on 1 September in Sydney — both 31 August in UTC and in Singapore.
    await history(two, ana, '2026-08-31T13:30:00Z')
    await history(two, ana, '2026-08-31T14:30:00Z')

    const month = await summaryOk(ana, 'month')
    assert.equal(month.period, 'month')
    assert.equal(month.from, '2026-09-01')
    assert.equal(month.to, '2026-09-30')
    assert.equal(month.attended, 1)
    assert.equal(month.previous_attended, 1)
    // A bucket per day of September; the class lands on the 1st and nowhere else.
    assert.equal(month.buckets.length, 30)
    assert.deepEqual(month.buckets[0], { starts_on: '2026-09-01', attended: 1, booked: 0 })
    assert.equal(month.buckets[29]!.starts_on, '2026-09-30')
    assert.equal(month.buckets.reduce((n, b) => n + b.attended, 0), 1)
    assert.equal(month.last_attended_at, '2026-08-31T14:30:00.000Z')

    // With no period named, the summary is this month's.
    assert.deepEqual(await summaryOk(ana), month)
  })

  test('ACC-16 imported attended classes count beside one booked and ticked here, each on the day it fell on, with the most-practised types and the last class', async () => {
    harness.clock.set(NOW)
    const bo = await member(one, 'Bo Imported')
    // Imported: Alpha ×3, Bravo ×2, Charlie ×1, Delta ×1 — all this month.
    for (const day of ['02', '03', '04']) await history(one, bo, `2026-09-${day}T01:00:00Z`, { type: 'Alpha' })
    for (const day of ['05', '08']) await history(one, bo, `2026-09-${day}T01:00:00Z`, { type: 'Bravo' })
    await history(one, bo, '2026-09-09T01:00:00Z', { type: 'Delta' })

    // Booked through the member's route and ticked at the desk: Charlie, on the 10th.
    const classPackage = await classPackagesSvc.createClassPackage(one.id, {
      name: PACKAGE_NAME,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    await purchaseSvc.grantPackage(one.id, {
      clientId: bo.clientId,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: classPackage.id,
    })
    const charlieAt = new Date('2026-09-10T01:00:00Z')
    const charlie = await addClass(one, charlieAt, 'Charlie')
    harness.clock.set(new Date(charlieAt.getTime() - 24 * HOUR))
    const booked = await harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...bo.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_id: charlie }),
    })
    const bookedBody = (await booked.json()) as { booking_id: string }
    assert.equal(booked.status, 201, JSON.stringify(bookedBody))
    harness.clock.set(new Date(charlieAt.getTime() + 10 * 60 * 1000))
    const desk = await staff(one, 'desk', 'admin')
    const ticked = await harness.app.request('/api/v1/portal/admin/check-in/manual', {
      method: 'POST',
      headers: { ...desk.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookedBody.booking_id, attended: true }),
    })
    assert.equal(ticked.status, 200, await ticked.text())

    harness.clock.set(NOW)
    const month = await summaryOk(bo, 'month')
    assert.equal(month.attended, 7)
    assert.equal(month.attended_classes, 7)
    const onDay = Object.fromEntries(month.buckets.filter(b => b.attended > 0).map(b => [b.starts_on, b.attended]))
    assert.deepEqual(
      onDay,
      {
        '2026-09-02': 1,
        '2026-09-03': 1,
        '2026-09-04': 1,
        '2026-09-05': 1,
        '2026-09-08': 1,
        '2026-09-09': 1,
        '2026-09-10': 1,
      },
      'three Alphas on the 2nd–4th, Bravos on the 5th and 8th, the Delta on the 9th and the Charlie on the 10th',
    )
    // Charlie and Delta tie on one; the name decides, and only three are listed.
    assert.deepEqual(month.top_class_types, [
      { name: TYPE('Alpha'), attended: 3 },
      { name: TYPE('Bravo'), attended: 2 },
      { name: TYPE('Charlie'), attended: 1 },
    ])
    assert.equal(month.last_attended_at, charlieAt.toISOString())
  })

  test('ACC-17 attended group classes and private sessions count, workshops only on their own line; no-shows, cancellations and sessions not yet ticked never', async () => {
    harness.clock.set(NOW)
    const cy = await member(one, 'Cy Kinds')
    await history(one, cy, '2026-09-02T01:00:00Z')
    await history(one, cy, '2026-09-03T01:00:00Z', { checkIn: 'no_show', state: 'no_show' })
    await history(one, cy, '2026-09-04T01:00:00Z', { checkIn: 'pending', state: 'cancelled' })
    await history(one, cy, '2026-09-05T01:00:00Z', { checkIn: 'pending' })

    // Private sessions: one attended, one a no-show, one never ticked.
    await privateSession(one, cy, '2026-09-06T01:00:00Z')
    await privateSession(one, cy, '2026-09-07T01:00:00Z', { checkIn: 'no_show', state: 'no_show' })
    await privateSession(one, cy, '2026-09-08T01:00:00Z', { checkIn: 'pending' })
    // Workshops this month: one attended, one a no-show.
    await workshop(one, cy, '2026-09-09T01:00:00Z', 'attended')
    await workshop(one, cy, '2026-09-10T01:00:00Z', 'no_show')

    const month = await summaryOk(cy, 'month')
    assert.equal(month.attended, 2)
    assert.equal(month.attended_classes, 1)
    assert.equal(month.attended_pt, 1)
    assert.equal(month.attended_workshops, 1)
    const onDay = Object.fromEntries(month.buckets.filter(b => b.attended > 0).map(b => [b.starts_on, b.attended]))
    assert.deepEqual(onDay, { '2026-09-02': 1, '2026-09-06': 1 }, 'the class and the private session, not the workshop')
    // Class types are classes alone: the private session is `attended_pt`.
    assert.deepEqual(month.top_class_types, [{ name: TYPE('Flow'), attended: 1 }])
    assert.equal(month.last_attended_at, '2026-09-06T01:00:00.000Z')
  })

  test('ACC-18 each timeframe is compared with the equal-length one before it, and all time with nothing', async () => {
    harness.clock.set(NOW)
    const di = await member(one, 'Di Periods')
    await history(one, di, '2024-11-20T01:00:00Z') // all time only
    await history(one, di, '2025-05-10T01:00:00Z') // last year
    await history(one, di, '2025-12-31T16:30:00Z') // 00:30 on 1 January in Singapore, still 2025 in UTC: this year
    await history(one, di, '2026-05-05T01:00:00Z') // the three months before the quarter
    await history(one, di, '2026-07-01T01:00:00Z') // this quarter
    await history(one, di, '2026-08-12T01:00:00Z') // last month
    await history(one, di, '2026-09-01T01:00:00Z') // this month
    await history(one, di, '2026-09-14T01:00:00Z') // this month
    await history(one, di, '2026-10-01T01:00:00Z', { checkIn: 'pending' }) // not yet

    const month = await summaryOk(di, 'month')
    assert.deepEqual([month.attended, month.previous_attended], [2, 1])

    const quarter = await summaryOk(di, 'quarter')
    assert.deepEqual([quarter.from, quarter.to], ['2026-07-01', '2026-09-30'])
    assert.deepEqual([quarter.attended, quarter.previous_attended], [4, 1])
    assert.equal(quarter.buckets[0]!.starts_on, '2026-07-01')
    assert.equal(quarter.buckets[0]!.attended, 1)

    const year = await summaryOk(di, 'year')
    assert.deepEqual([year.from, year.to], ['2026-01-01', '2026-12-31'])
    assert.deepEqual([year.attended, year.previous_attended], [6, 1])
    assert.deepEqual(
      year.buckets.map(b => b.attended),
      [1, 0, 0, 0, 1, 0, 1, 1, 2, 0, 0, 0],
    )

    const all = await summaryOk(di, 'all')
    assert.equal(all.previous_attended, null)
    assert.equal(all.from, '2024-11-20')
    assert.deepEqual(all.buckets, [
      { starts_on: '2024-11-20', attended: 1, booked: 0 },
      { starts_on: '2025-01-01', attended: 1, booked: 0 },
      // The class on 1 October is still to come: booked, not attended.
      { starts_on: '2026-01-01', attended: 6, booked: 1 },
    ])
    assert.equal(all.attended, 8)

    const refused = await summary(di, 'week')
    assert.equal(refused.status, 400)
  })

  test('TEN-28, ACC-19 a member sees only their own attendance and bookings, classes and private sessions: never another member’s, nor another studio’s', async () => {
    harness.clock.set(NOW)
    const ed = await member(one, 'Ed Alone')
    const fay = await member(one, 'Fay Neighbour')
    const gus = await member(two, 'Gus Elsewhere')
    for (const [at, who] of [
      [one, fay],
      [two, gus],
    ] as const) {
      await history(at, who, '2026-09-02T01:00:00Z')
      await privateSession(at, who, '2026-09-03T01:00:00Z')
      await workshop(at, who, '2026-09-04T01:00:00Z', 'attended')
      await history(at, who, '2026-09-20T01:00:00Z', { checkIn: 'pending' })
      await privateSession(at, who, '2026-09-21T01:00:00Z', { checkIn: 'pending' })
    }

    for (const period of ['month', 'quarter', 'year', 'all']) {
      const s = await summaryOk(ed, period)
      assert.equal(s.attended, 0, period)
      assert.equal(s.attended_pt, 0, period)
      assert.equal(s.attended_workshops, 0, period)
      assert.ok(s.buckets.every(b => b.attended === 0 && b.booked === 0), period)
      assert.equal(s.minutes, 0, period)
      assert.equal(s.streak_weeks, 0, period)
      assert.deepEqual(s.top_class_types, [], period)
      assert.deepEqual(s.lifetime, { attended: 0, since: null }, period)
      assert.equal(s.last_attended_at, null, period)
    }
    for (const who of [fay, gus]) {
      const s = await summaryOk(who, 'month')
      assert.deepEqual([s.attended, s.attended_classes, s.attended_pt, s.attended_workshops], [2, 1, 1, 1])
      assert.equal(s.buckets.reduce((n, b) => n + b.booked, 0), 2)
      assert.equal(s.lifetime.attended, 2)
    }

    // Gus's session, sent to studio one's hostname, reads nothing there.
    const crossed = await harness.app.request('/api/v1/me/bookings/attendance?period=month', {
      headers: { ...gus.headers, 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('client', one) },
    })
    assert.equal(crossed.status, 401)
  })

  test('ACC-21 sessions the member holds later this month show as booked on their day: a confirmed class and a scheduled private session, not a cancelled one', async () => {
    harness.clock.set(NOW)
    const hal = await member(one, 'Hal Ahead')
    // Earlier today and still to come, both on the 15th in Singapore (NOW is 12:00 there).
    await history(one, hal, '2026-09-15T01:00:00Z')
    await history(one, hal, '2026-09-15T10:00:00Z', { checkIn: 'pending' })
    await privateSession(one, hal, '2026-09-22T01:00:00Z', { checkIn: 'pending' })
    // Not booked: a class the member cancelled, a class the studio cancelled, a
    // private session the studio cancelled, and one this morning never ticked.
    await history(one, hal, '2026-09-23T01:00:00Z', { checkIn: 'pending', state: 'cancelled' })
    await history(one, hal, '2026-09-24T01:00:00Z', { checkIn: 'pending', lifecycle: 'cancelled' })
    await privateSession(one, hal, '2026-09-25T01:00:00Z', { checkIn: 'pending', lifecycle: 'cancelled' })
    await history(one, hal, '2026-09-15T00:00:00Z', { checkIn: 'pending' })

    const month = await summaryOk(hal, 'month')
    const day = (d: string) => month.buckets.find(b => b.starts_on === d)!
    assert.deepEqual(day('2026-09-15'), { starts_on: '2026-09-15', attended: 1, booked: 1 })
    assert.deepEqual(day('2026-09-22'), { starts_on: '2026-09-22', attended: 0, booked: 1 })
    assert.equal(month.buckets.reduce((n, b) => n + b.booked, 0), 2)
    assert.equal(month.attended, 1, 'a booking still to come is not attended')

    // The year's September carries the same two.
    const year = await summaryOk(hal, 'year')
    assert.equal(year.buckets[8]!.booked, 2)
    assert.equal(year.buckets.reduce((n, b) => n + b.booked, 0), 2)
  })

  test('ACC-22 time on the mat sums the attended classes and private sessions of the period, nothing else', async () => {
    harness.clock.set(NOW)
    const ida = await member(one, 'Ida Minutes')
    await history(one, ida, '2026-09-01T01:00:00Z', { minutes: 60 })
    await history(one, ida, '2026-09-02T01:00:00Z', { minutes: 75 })
    await privateSession(one, ida, '2026-09-03T01:00:00Z', { minutes: 90 })
    await history(one, ida, '2026-09-04T01:00:00Z', { minutes: 60, checkIn: 'no_show', state: 'no_show' })
    await history(one, ida, '2026-08-20T01:00:00Z', { minutes: 60 }) // last month
    await workshop(one, ida, '2026-09-05T01:00:00Z', 'attended')

    assert.equal((await summaryOk(ida, 'month')).minutes, 225)
    assert.equal((await summaryOk(ida, 'year')).minutes, 285)
  })

  test('ACC-23 weeks in a row run back from this week, or from last week while this one is still empty, and an empty week ends them', async () => {
    // Tuesday 15 September: nothing yet this week (from Monday the 14th).
    harness.clock.set(NOW)
    const jo = await member(one, 'Jo Streak')
    await history(one, jo, '2026-08-12T01:00:00Z') // week of 10 Aug
    // Week of 17 Aug is empty.
    await history(one, jo, '2026-08-26T01:00:00Z') // week of 24 Aug
    await privateSession(one, jo, '2026-09-03T01:00:00Z') // week of 31 Aug
    await history(one, jo, '2026-09-07T01:00:00Z') // week of 7 Sep
    await history(one, jo, '2026-09-08T01:00:00Z') // week of 7 Sep again
    await history(one, jo, '2026-09-14T01:00:00Z', { checkIn: 'no_show', state: 'no_show' }) // not attended

    assert.equal((await summaryOk(jo, 'month')).streak_weeks, 3)

    // Once this week has one, it counts too.
    await history(one, jo, '2026-09-15T01:00:00Z')
    assert.equal((await summaryOk(jo, 'month')).streak_weeks, 4)

    // A member whose last week and this week are both empty has none.
    const kai = await member(one, 'Kai Lapsed')
    await history(one, kai, '2026-09-01T01:00:00Z')
    assert.equal((await summaryOk(kai, 'month')).streak_weeks, 0)
  })

  test('ACC-24 the usual slot is the most attended weekday and start hour on the studio’s clock, none under three sessions, the earliest on a tie', async () => {
    harness.clock.set(NOW)
    const lu = await member(one, 'Lu Usual')
    // Tuesdays 1 and 8 September at 07:00 in Singapore — still Monday in UTC — and a Thursday evening.
    await history(one, lu, '2026-08-31T23:00:00Z')
    await history(one, lu, '2026-09-07T23:00:00Z')
    await privateSession(one, lu, '2026-09-03T11:00:00Z')
    assert.deepEqual((await summaryOk(lu, 'month')).usual_slot, { weekday: 2, hour: 7 })

    const mo = await member(one, 'Mo Few')
    await history(one, mo, '2026-09-01T01:00:00Z')
    await history(one, mo, '2026-09-08T01:00:00Z')
    assert.equal((await summaryOk(mo, 'month')).usual_slot, null)

    // Thursday 19:00, Tuesday 18:00 and Tuesday 07:00, once each: Tuesday at 7.
    const ned = await member(one, 'Ned Tie')
    await history(one, ned, '2026-09-03T11:00:00Z')
    await history(one, ned, '2026-09-01T10:00:00Z')
    await history(one, ned, '2026-09-07T23:00:00Z')
    assert.deepEqual((await summaryOk(ned, 'month')).usual_slot, { weekday: 2, hour: 7 })
  })

  test('ACC-25 the lifetime total counts every attended class and private session ever, imported history included, from the day of the first', async () => {
    harness.clock.set(NOW)
    const ola = await member(two, 'Ola Lifetime')
    // 00:30 on 1 March 2025 in Sydney: still February in UTC.
    await history(two, ola, '2025-02-28T13:30:00Z')
    await privateSession(two, ola, '2025-11-10T01:00:00Z')
    await history(two, ola, '2026-09-02T01:00:00Z')
    await history(two, ola, '2026-09-03T01:00:00Z', { checkIn: 'no_show', state: 'no_show' })
    await workshop(two, ola, '2026-09-04T01:00:00Z', 'attended')

    for (const period of ['month', 'year', 'all']) {
      assert.deepEqual((await summaryOk(ola, period)).lifetime, { attended: 3, since: '2025-03-01' }, period)
    }
  })
})
