import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, getTableName, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  inTenantContext,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.impossible-dates.test`
const TAG = `impdate-${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * A date that does not exist, over real HTTP.
 *
 * Every form and filter that takes a date or a moment in time is sent values
 * that are not on the calendar. Each must answer `400`, write nothing, and leave
 * no `error` log line: never a `500`, and never a record on another day (the
 * JavaScript date parser rolls `2026-02-30` forward to 2 March). Each surface
 * is also sent the same request with a valid date, so the date, and nothing
 * else in the request, is what the refusal is for.
 *
 * What is asserted is what the caller gets back and what the database holds
 * afterwards: not which validator ran, nor what zod's issue list looks like.
 * Where a route explains its refusals (`explainInvalid`), the body is
 * `400 invalid_request` with a sentence naming the field.
 */

/** A calendar date that does not exist. */
const IMPOSSIBLE_DATES = ['2026-02-30', '2026-13-01', '0000-01-01'] as const
/** A moment in time that does not exist, or is written in a form the API does not take. */
const IMPOSSIBLE_MOMENTS = [
  '2026-02-30T10:00:00Z',
  '2026-13-01T10:00:00Z',
  '0000-01-01T00:00:00Z',
  '20260-01-01',
  '12/31/99999',
  // An offset the clock never has: the string reads as a moment and `new Date` turns it into Invalid Date.
  '2026-01-31T09:00:00+24:00',
  '2026-01-31T09:00:00+99:99',
  '2026-01-31T09:00:00-25:00',
  // A year that is 1 to 9999 as written and 10000 or 0 once the offset is applied.
  '9999-12-31T23:00:00-08:00',
  '0001-01-01T00:00:00+08:00',
] as const

type Who = 'member' | 'admin' | 'instructor' | 'visitor'
type Req = { method: 'GET' | 'POST' | 'PATCH' | 'PUT'; path: string; body?: unknown }

/**
 * One form or filter. `send` builds the request with `value` in the one field
 * under test. `says` is the sentence a route that explains its refusals gives.
 * The control is the request with `valid`: it `succeeds` (a 2xx) unless it can
 * only `passes` the date check, because no fixture here makes the rest of the
 * request succeed (the answer is then anything but a `400`).
 */
type Surface = {
  label: string
  as: Who
  send: (value: string) => Req
  valid: string
  says?: RegExp
  control?: 'succeeds' | 'passes'
}

describe('impossible dates and times are refused', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let one!: { id: string; slug: string }

  type Staff = { staffId: string; headers: Record<string, string> }
  let admin!: Staff
  let teacher!: Staff
  let member!: { clientId: string; headers: Record<string, string> }

  let locationId!: string
  let roomId!: string
  let classTypeId!: string
  let classPackageId!: string
  let ptPackageId!: string
  let memberPtPackageId!: string

  // Rows the controls change and the refusals must leave alone.
  let classId!: string
  let ptSessionId!: string
  let corporateSessionId!: string
  let promoCodeId!: string
  let expiryPackageId!: string
  let workshopId!: string
  let workshopDayId!: string
  let seriesId!: string
  let endableSeriesId!: string
  const pendingRequests: string[] = []

  const emailFor = (name: string) => `${name}@${DOMAIN}`

  // ── time ─────────────────────────────────────────────────────────────────

  /** A start no other row of this file shares: three hours further on each call, 900 days out. */
  let slots = 0
  const slot = (): Date => {
    const base = new Date(Date.now() + 900 * DAY)
    base.setUTCHours(0, 0, 0, 0)
    return new Date(base.getTime() + slots++ * 3 * HOUR)
  }
  /**
   * A start for a private session: three weeks out, inside any package's validity
   * (a session cannot be set past the end of the package paying for it), and as
   * far from every other row as `slot` keeps its own.
   */
  let ptSlots = 0
  const ptSlot = (): Date => {
    const base = new Date(Date.now() + 21 * DAY)
    base.setUTCHours(0, 0, 0, 0)
    return new Date(base.getTime() + ptSlots++ * 3 * HOUR)
  }
  const span = (start: Date, hours = 1) => ({
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + hours * HOUR).toISOString(),
  })
  const moment = (): string => slot().toISOString()
  /** Mondays, far enough out that no other row of this file is on them. */
  const monday = (week: number): string => {
    const d = new Date(Date.now() + 1000 * DAY)
    d.setUTCHours(0, 0, 0, 0)
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7) + week * 7)
    return d.toISOString().slice(0, 10)
  }
  /** A future Leave Year of its own per run, so no other file's leave is on its days. */
  const YEAR = 2300 + Math.floor(Math.random() * 600)
  const leaveDay = (n: number): string => new Date(Date.UTC(YEAR, 0, n)).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function staffAt(name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(name)
    const headers = await harness.signInAs('staff', email, one)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: one.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: row!.id })
    }
    return { staffId: row!.id, headers }
  }

  async function memberAt(name: string) {
    const email = emailFor(name)
    const headers = await harness.signInAs('client', email, one)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: one.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  /** The caller's headers, from a client address no earlier request used (the limiters count per address). */
  const headersOf = (who: Who): Record<string, string> => {
    const fresh = { 'X-Forwarded-For': harnessAddress() }
    if (who === 'visitor') return { 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('client', one), ...fresh }
    const signedIn = who === 'member' ? member.headers : who === 'admin' ? admin.headers : teacher.headers
    return { ...signedIn, ...fresh }
  }

  async function send(who: Who, req: Req): Promise<{ status: number; body: any }> {
    const res = await harness.app.request(req.path, {
      method: req.method,
      headers: { ...headersOf(who), ...(req.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
    })
    const text = await res.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // not JSON (a CSV): keep the text for the assertion message
    }
    return { status: res.status, body }
  }

  async function ok(who: Who, req: Req, status: number): Promise<any> {
    const res = await send(who, req)
    assert.equal(res.status, status, `${req.method} ${req.path}: ${JSON.stringify(res.body)}`)
    return res.body
  }

  const portal = (path: string) => `/api/v1/portal${path}`
  const query = (path: string, params: Record<string, string>) =>
    `${path}?${new URLSearchParams(params).toString()}`

  /** A pending private session request from the member, for a staff schedule route to act on. */
  async function pendingRequest(): Promise<string> {
    const body = await ok(
      'member',
      {
        method: 'POST',
        path: '/api/v1/me/pt-sessions/request',
        body: {
          classTypeId,
          locationId,
          sessionType: '1on1',
          clientPackageId: memberPtPackageId,
          slots: [{ proposedDate: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10), startTime: '09:00' }],
        },
      },
      201,
    )
    return body.pt_request_id as string
  }

  const seriesBody = (over: Record<string, unknown> = {}) => ({
    class_type_id: classTypeId,
    main_instructor_id: teacher.staffId,
    instructor_pay_sgd: 60,
    location_id: locationId,
    room_id: roomId,
    weekday: 1,
    start_time: '19:00',
    end_time: '20:00',
    capacity_online: 20,
    capacity_waitlist: 0,
    capacity_buffer: 0,
    credit_cost: 1,
    first_date: monday(0),
    last_date: monday(0),
    excluded_dates: [] as string[],
    ...over,
  })

  const classBody = (over: Record<string, unknown> = {}) => ({
    class_type_id: classTypeId,
    main_instructor_id: teacher.staffId,
    location_id: locationId,
    room_id: roomId,
    ...span(slot()),
    capacity_online: 10,
    credit_cost: 1,
    instructor_pay_sgd: 50,
    ...over,
  })

  // ── what a refusal leaves behind ─────────────────────────────────────────

  /**
   * Every table a form above writes to, as one checksum of the studio's rows:
   * a row created, moved or changed shows as a different value.
   */
  const WRITTEN_TABLES = () => [
    schema.leaveRequests,
    schema.classSeries,
    schema.classes,
    schema.ptRequests,
    schema.ptSessions,
    schema.corporateSessions,
    schema.corporateRequests,
    schema.promoCodes,
    schema.promotions,
    schema.classPackages,
    schema.clientPackages,
    schema.workshops,
    schema.workshopDays,
    schema.workshopTiers,
    schema.manualPayrollEntries,
  ]
  async function fingerprint(): Promise<string> {
    const parts: string[] = []
    for (const table of WRITTEN_TABLES()) {
      const name = getTableName(table)
      const rows = await harness.db.execute<{ sum: string }>(
        sql`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS sum FROM ${sql.identifier(name)} t WHERE tenant_id = ${one.id}`,
      )
      parts.push(`${name}:${rows[0]!.sum}`)
    }
    return parts.join(' ')
  }

  const errorLines = () => harness.logs.lines().filter(l => l.level === 'error' || l.level === 'fatal')

  /**
   * Every impossible `bad` value is refused 400 and leaves nothing behind; then
   * the control goes through. Every surface is tried before the test judges, so
   * a failure lists all the forms that answer wrongly, not the first.
   */
  async function check(surfaces: Surface[], bad: readonly string[]) {
    const wrong: string[] = []
    for (const s of surfaces) {
      for (const value of bad) {
        const where = `${s.label} = ${value}`
        const req = s.send(value)
        const before = req.method === 'GET' ? null : await fingerprint()
        harness.logs.clear()
        const res = await send(s.as, req)
        const answer = `${res.status} ${JSON.stringify(res.body).slice(0, 160)}`
        if (res.status !== 400) wrong.push(`${where}: answered ${answer}`)
        else if (s.says && res.body.error !== 'invalid_request') wrong.push(`${where}: answered ${answer}`)
        else if (s.says && !s.says.test(String(res.body.message))) wrong.push(`${where}: the sentence is ${answer}`)
        if (errorLines().length > 0) wrong.push(`${where}: logged an error line`)
        if (before !== null && (await fingerprint()) !== before) wrong.push(`${where}: a refused request wrote`)
      }
      const control = await send(s.as, s.send(s.valid))
      const answer = `${control.status} ${JSON.stringify(control.body).slice(0, 160)}`
      const passed = s.control === 'passes' ? control.status !== 400 : control.status >= 200 && control.status < 300
      if (!passed) wrong.push(`${s.label} = ${s.valid}: the control answered ${answer}`)
    }
    assert.deepEqual(wrong, [])
  }

  const DATE_SENTENCE = /date like/i

  // ── setup ────────────────────────────────────────────────────────────────

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    const classTypes = inTenantContext(await import('../services/catalog/class-types'))
    const classPackages = inTenantContext(await import('../services/packages/class-packages'))
    const ptPackages = inTenantContext(await import('../services/packages/pt-packages'))
    const purchases = inTenantContext(await import('../services/packages/purchase'))
    one = harness.tenants.one

    admin = await staffAt('admin', 'admin')
    teacher = await staffAt('teacher', 'instructor')
    member = await memberAt('member')

    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, one.id))
      .limit(1)
    locationId = location!.id
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: one.id, locationId, name: `${TAG} room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    roomId = room!.id
    classTypeId = (await classTypes.createClassType(one.id, { name: `${TAG} type` })).id
    classPackageId = (
      await classPackages.createClassPackage(one.id, {
        name: `${TAG} pass`,
        kind: 'credit_bundle',
        credits: 10,
        validityDays: 90,
        priceSgd: '100.00',
      })
    ).id
    ptPackageId = (
      await ptPackages.createPtPackage(one.id, {
        name: `${TAG} sessions`,
        sessionType: '1on1',
        numSessions: 10,
        validityDays: 90,
        priceSgd: '900.00',
      })
    ).id
    const grant = (kind: 'class' | 'pt', packageId: string) =>
      purchases.grantPackage(one.id, {
        clientId: member.clientId,
        purchaseId: null,
        amountSgd: '100.00',
        packageKind: kind,
        packageId,
      })
    memberPtPackageId = (await grant('pt', ptPackageId)).clientPackageId
    expiryPackageId = (await grant('class', classPackageId)).clientPackageId

    // A class, a private session and a corporate session for the edit routes to move.
    const classStart = slot()
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: one.id,
        classTypeId,
        mainInstructorId: teacher.staffId,
        locationId,
        roomId,
        startsAt: classStart,
        endsAt: new Date(classStart.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        instructorPaySgd: '55.00',
        createdByStaffId: admin.staffId,
      })
      .returning({ id: schema.classes.id })
    classId = cls!.id
    const ptStart = ptSlot()
    const [pt] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: one.id,
        instructorId: teacher.staffId,
        locationId,
        roomId,
        startsAt: ptStart,
        endsAt: new Date(ptStart.getTime() + HOUR),
        sessionType: '1on1',
        capacityOnline: 1,
        scheduledAt: new Date(),
        scheduledByStaffId: admin.staffId,
      })
      .returning({ id: schema.ptSessions.id })
    ptSessionId = pt!.id
    const [corporatePackage] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: one.id, name: `${TAG} corporate`, priceSgd: '1000.00', createdByStaffId: admin.staffId })
      .returning({ id: schema.corporatePackages.id })
    const corporateStart = slot()
    const [corporate] = await harness.db
      .insert(schema.corporateSessions)
      .values({
        tenantId: one.id,
        corporatePackageId: corporatePackage!.id,
        clientName: `${TAG} company`,
        mainInstructorId: teacher.staffId,
        locationText: 'Off-site',
        startsAt: corporateStart,
        endsAt: new Date(corporateStart.getTime() + HOUR),
        createdByStaffId: admin.staffId,
      })
      .returning({ id: schema.corporateSessions.id })
    corporateSessionId = corporate!.id

    // Through the portal's own routes: a promo code, a workshop with a day, two series.
    promoCodeId = (
      await ok(
        'admin',
        {
          method: 'POST',
          path: portal('/admin/promo-codes'),
          body: { label: `${TAG} code`, kind: 'percent', percent_off: 10, applies_to_all: true },
        },
        201,
      )
    ).id
    workshopId = (
      await ok(
        'admin',
        {
          method: 'POST',
          path: portal('/admin/workshops'),
          body: { name: `${TAG} workshop`, location_id: locationId, main_instructor_id: teacher.staffId },
        },
        201,
      )
    ).id
    workshopDayId = (
      await ok(
        'admin',
        {
          method: 'POST',
          path: portal(`/admin/workshops/${workshopId}/days`),
          body: { ord: 1, room_id: roomId, ...span(slot(), 2), capacity_online: 5 },
        },
        201,
      )
    ).id
    seriesId = (
      await ok(
        'admin',
        {
          method: 'POST',
          path: portal('/admin/schedule/series'),
          body: seriesBody({ first_date: monday(20), last_date: monday(20) }),
        },
        201,
      )
    ).series?.id
    endableSeriesId = (
      await ok(
        'admin',
        {
          method: 'POST',
          path: portal('/admin/schedule/series'),
          body: seriesBody({ first_date: monday(30), last_date: monday(31) }),
        },
        201,
      )
    ).series?.id

    // Four pending private session requests: one for each staff schedule route and field.
    for (let i = 0; i < 4; i++) pendingRequests.push(await pendingRequest())
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const exec = (q: ReturnType<typeof sql>) => harness.db.execute(q)
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
    const sessions = sql`SELECT id FROM pt_sessions WHERE room_id = ${roomId}`
    const ourClasses = sql`SELECT id FROM classes WHERE room_id = ${roomId}`
    const workshops = sql`SELECT id FROM workshops WHERE name LIKE ${`${TAG}%`}`
    const bookings = sql`SELECT id FROM bookings WHERE client_id IN (${clients})`
    await exec(sql`DELETE FROM inbox_items WHERE true AND tenant_id = ${one.id} AND payload::text LIKE ${`%${TAG}%`}`).catch(() => {})
    await exec(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await exec(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await exec(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await exec(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${requests})`)
    await exec(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await exec(sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${sessions})`)
    await exec(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (${sessions})`)
    await exec(sql`DELETE FROM pt_sessions WHERE id IN (${sessions})`)
    await exec(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
    await exec(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await exec(sql`DELETE FROM class_supporting_instructors WHERE class_id IN (${ourClasses})`)
    await exec(sql`DELETE FROM classes WHERE room_id = ${roomId}`)
    await exec(sql`DELETE FROM class_series WHERE class_type_id = ${classTypeId}`)
    await exec(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${workshops}))`)
    await exec(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
    await exec(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshops})`)
    await exec(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshops})`)
    await exec(sql`DELETE FROM workshops WHERE name LIKE ${`${TAG}%`}`)
    await exec(sql`DELETE FROM corporate_sessions WHERE client_name LIKE ${`${TAG}%`}`)
    await exec(sql`DELETE FROM corporate_packages WHERE name LIKE ${`${TAG}%`}`)
    await exec(sql`DELETE FROM manual_payroll_entries WHERE label LIKE ${`${TAG}%`}`)
    await exec(sql`DELETE FROM leave_requests WHERE staff_user_id IN (${staffIds})`)
    await exec(sql`DELETE FROM promo_code_products WHERE promo_code_id IN (SELECT id FROM promo_codes WHERE label LIKE ${`${TAG}%`})`)
    await exec(sql`DELETE FROM promo_codes WHERE label LIKE ${`${TAG}%`}`)
    await exec(sql`DELETE FROM promotions WHERE label LIKE ${`${TAG}%`}`)
    await exec(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await exec(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await exec(sql`DELETE FROM class_packages WHERE name LIKE ${`${TAG}%`}`)
    await exec(sql`DELETE FROM pt_packages WHERE name LIKE ${`${TAG}%`}`)
    await exec(sql`DELETE FROM class_types WHERE id = ${classTypeId}`)
    await exec(sql`DELETE FROM rooms WHERE id = ${roomId}`)
    await exec(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await exec(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await exec(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await exec(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await exec(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await exec(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  // ── the tests ────────────────────────────────────────────────────────────

  /** A request's start and end; each control gets a window of its own, so one cannot clash with another. */
  type Window = { starts_at: string; ends_at: string }
  /**
   * The two ends of a start/end pair, one surface each. `build` is given a fresh
   * window and which of the two it is for (0 starts, 1 ends), for the routes
   * whose control uses up a row of its own.
   */
  const ends = (
    label: string,
    as: Who,
    build: (w: Window, n: 0 | 1) => Req,
    extra: Pick<Surface, 'says' | 'control'> = {},
    at: () => Date = slot,
  ): Surface[] => {
    const starts = span(at())
    const finishes = span(at())
    return [
      { label: `${label} starts_at`, as, send: v => build({ ...starts, starts_at: v }, 0), valid: starts.starts_at, ...extra },
      { label: `${label} ends_at`, as, send: v => build({ ...finishes, ends_at: v }, 1), valid: finishes.ends_at, ...extra },
    ]
  }
  /** `from` and `to`, one surface each, for a filter that takes a moment. */
  const range = (path: string, as: Who, label: string): Surface[] =>
    (['from', 'to'] as const).map(field => ({
      label: `GET ${label} ${field}`,
      as,
      send: v => ({ method: 'GET', path: query(path, { [field]: v }) }),
      valid: moment(),
    }))

  test('LEV-147 a leave request or leave calendar range with a date that does not exist is refused 400 invalid_request with a sentence naming the date, and nothing is filed', async () => {
    const submit = (over: Record<string, string>): Req => ({
      method: 'POST',
      path: portal('/leave'),
      body: { type: 'annual', start_date: leaveDay(1), end_date: leaveDay(1), reason: `${TAG} leave`, ...over },
    })
    await check(
      [
        { label: 'POST /portal/leave start_date', as: 'instructor', send: v => submit({ start_date: v }), valid: leaveDay(1), says: DATE_SENTENCE },
        {
          label: 'POST /portal/leave end_date',
          as: 'instructor',
          send: v => submit({ start_date: leaveDay(3), end_date: v }),
          valid: leaveDay(3),
          says: DATE_SENTENCE,
        },
        {
          label: 'GET /portal/leave-calendar from',
          as: 'admin',
          send: v => ({ method: 'GET', path: query(portal('/leave-calendar'), { from: v, to: leaveDay(30) }) }),
          valid: leaveDay(1),
          says: DATE_SENTENCE,
        },
        {
          label: 'GET /portal/leave-calendar to',
          as: 'admin',
          send: v => ({ method: 'GET', path: query(portal('/leave-calendar'), { from: leaveDay(1), to: v }) }),
          valid: leaveDay(30),
          says: DATE_SENTENCE,
        },
      ],
      IMPOSSIBLE_DATES,
    )
  })

  test('INV-113 the member and admin Receipts filters and the CSV export refuse a date that does not exist, 400 invalid_request with a sentence', async () => {
    const receipts = (path: string, as: Who, label: string): Surface[] =>
      (['from', 'to'] as const).map(field => ({
        label: `GET ${label} ${field}`,
        as,
        send: v => ({ method: 'GET', path: query(path, { [field]: v }) }),
        valid: '2026-01-31',
        says: DATE_SENTENCE,
      }))
    await check(
      [
        ...receipts('/api/v1/me/receipts', 'member', '/me/receipts'),
        ...receipts(portal('/admin/receipts'), 'admin', '/portal/admin/receipts'),
        ...receipts(portal('/admin/receipts/export.csv'), 'admin', '/portal/admin/receipts/export.csv'),
      ],
      IMPOSSIBLE_DATES,
    )
  })

  test('SCH-44 a Class Series date or a class time that does not exist, and a timetable filter that does not, is refused 400, and no class is created, moved, extended or cancelled', async () => {
    // Dates: the series forms. `weeks` keeps each form's control on Mondays of its own.
    const series = (path: string, as: Who, label: string, weeks: number): Surface[] => [
      {
        label: `POST ${label} first_date`,
        as,
        send: v => ({ method: 'POST', path, body: seriesBody({ first_date: v, last_date: monday(weeks + 1) }) }),
        valid: monday(weeks + 1),
        says: DATE_SENTENCE,
      },
      {
        label: `POST ${label} last_date`,
        as,
        send: v => ({ method: 'POST', path, body: seriesBody({ first_date: monday(weeks + 2), last_date: v }) }),
        valid: monday(weeks + 2),
        says: DATE_SENTENCE,
      },
      {
        label: `POST ${label} excluded_dates`,
        as,
        send: v => ({
          method: 'POST',
          path,
          body: seriesBody({ first_date: monday(weeks + 3), last_date: monday(weeks + 5), excluded_dates: [v] }),
        }),
        valid: monday(weeks + 4),
        says: DATE_SENTENCE,
      },
    ]
    const admins = portal('/admin/schedule')
    const instructors = portal('/instructor/schedule')
    await check(
      [
        ...series(`${admins}/series/preview`, 'admin', 'admin series/preview', 100),
        ...series(`${admins}/series`, 'admin', 'admin series', 40),
        ...series(`${instructors}/series/preview`, 'instructor', 'instructor series/preview', 100),
        ...series(`${instructors}/series`, 'instructor', 'instructor series', 50),
        ...(['extend/preview', 'extend'] as const).flatMap((step): Surface[] => [
          {
            label: `POST admin series/:id/${step} last_date`,
            as: 'admin',
            send: v => ({ method: 'POST', path: `${admins}/series/${seriesId}/${step}`, body: { last_date: v } }),
            valid: monday(21),
            says: DATE_SENTENCE,
          },
          {
            label: `POST admin series/:id/${step} excluded_dates`,
            as: 'admin',
            send: v => ({
              method: 'POST',
              path: `${admins}/series/${seriesId}/${step}`,
              body: { last_date: monday(23), excluded_dates: [v] },
            }),
            valid: monday(22),
            says: DATE_SENTENCE,
          },
        ]),
        {
          label: 'POST admin series/:id/end from_date',
          as: 'admin',
          send: v => ({ method: 'POST', path: `${admins}/series/${endableSeriesId}/end`, body: { from_date: v } }),
          valid: monday(31),
          says: DATE_SENTENCE,
        },
      ],
      IMPOSSIBLE_DATES,
    )

    // Moments: the timetable filters, and a class made or edited.
    await check(
      [
        ...range(admins, 'admin', '/portal/admin/schedule'),
        ...range(instructors, 'instructor', '/portal/instructor/schedule'),
        ...ends('POST /portal/admin/schedule/classes', 'admin', w => ({
          method: 'POST',
          path: `${admins}/classes`,
          body: classBody(w),
        })),
        ...ends('POST /portal/instructor/schedule/classes', 'instructor', w => ({
          method: 'POST',
          path: `${instructors}/classes`,
          body: classBody(w),
        })),
        ...ends('PATCH /portal/admin/schedule/classes/:id', 'admin', w => ({
          method: 'PATCH',
          path: `${admins}/classes/${classId}`,
          body: w,
        })),
      ],
      IMPOSSIBLE_MOMENTS,
    )
  })

  test('FIN-57 the Finance list, overview and CSV filters and a Manual Entry date that do not exist are refused 400, and no entry is recorded', async () => {
    const finance = portal('/admin/finance')
    await check(
      [
        ...range(finance, 'admin', '/portal/admin/finance'),
        ...range(`${finance}/overview`, 'admin', '/portal/admin/finance/overview'),
        ...range(`${finance}/export`, 'admin', '/portal/admin/finance/export'),
        {
          label: 'POST /portal/admin/finance/manual entry_date',
          as: 'admin',
          send: v => ({
            method: 'POST',
            path: `${finance}/manual`,
            body: { instructor_id: teacher.staffId, amount_sgd: 10, label: `${TAG} entry`, entry_date: v },
          }),
          valid: moment(),
        },
      ],
      IMPOSSIBLE_MOMENTS,
    )
  })

  test('PAYR-18 the instructor teaching log refuses a from or to that does not exist, 400', async () => {
    await check(range(portal('/instructor/payroll'), 'instructor', '/portal/instructor/payroll'), IMPOSSIBLE_MOMENTS)
  })

  test('PT-171 a private session proposed, scheduled, moved or created on a day or time that does not exist is refused 400, and no session is made or moved', async () => {
    const admins = portal('/admin/pt-sessions')
    const instructors = portal('/instructor/pt-requests')
    // The member's proposed date.
    const proposed = (v: string): Req => ({
      method: 'POST',
      path: '/api/v1/me/pt-sessions/request',
      body: {
        classTypeId,
        locationId,
        sessionType: '1on1',
        clientPackageId: memberPtPackageId,
        slots: [{ proposedDate: v, startTime: '09:00' }],
      },
    })
    await check(
      [{ label: 'POST /me/pt-sessions/request proposedDate', as: 'member', send: proposed, valid: new Date(Date.now() + 6 * DAY).toISOString().slice(0, 10) }],
      IMPOSSIBLE_DATES,
    )

    // Staff: schedule a request (each end of the pair has a pending request of its own), move a session, create one.
    const place = { location_id: locationId, room_id: roomId }
    const manual = { session_type: '1on1', ...place, members: [{ client_id: member.clientId }] }
    const seats = { client_id: member.clientId, session_type: '1on1' }
    const ptEnds = (label: string, as: Who, build: (w: Window, n: 0 | 1) => Req) => ends(label, as, build, {}, ptSlot)
    await check(
      [
        ...ptEnds('POST /portal/admin/pt-sessions/:id/schedule', 'admin', (w, n) => ({
          method: 'POST',
          path: `${admins}/${pendingRequests[n]}/schedule`,
          body: { instructor_id: teacher.staffId, ...place, ...w, instructor_pay_sgd: 60 },
        })),
        ...ptEnds('POST /portal/instructor/pt-requests/:id/schedule', 'instructor', (w, n) => ({
          method: 'POST',
          path: `${instructors}/${pendingRequests[n + 2]}/schedule`,
          body: { ...place, ...w },
        })),
        ...ptEnds('PATCH /portal/admin/pt-sessions/sessions/:id', 'admin', w => ({
          method: 'PATCH',
          path: `${admins}/sessions/${ptSessionId}`,
          body: w,
        })),
        ...ptEnds('POST /portal/admin/pt-sessions/manual', 'admin', w => ({
          method: 'POST',
          path: `${admins}/manual`,
          body: { instructor_id: teacher.staffId, ...manual, ...w },
        })),
        ...ptEnds('POST /portal/instructor/pt-requests/manual', 'instructor', w => ({
          method: 'POST',
          path: `${instructors}/manual`,
          body: { ...manual, ...w },
        })),
        {
          label: 'GET /portal/admin/pt-sessions/seat-candidates starts_at',
          as: 'admin',
          send: v => ({ method: 'GET', path: query(`${admins}/seat-candidates`, { ...seats, instructor_id: teacher.staffId, starts_at: v }) }),
          valid: moment(),
        },
        {
          label: 'GET /portal/instructor/pt-requests/seat-candidates starts_at',
          as: 'instructor',
          send: v => ({ method: 'GET', path: query(`${instructors}/seat-candidates`, { ...seats, starts_at: v }) }),
          valid: moment(),
        },
      ],
      IMPOSSIBLE_MOMENTS,
    )
  })

  test('CORP-21 a Corporate Request scheduled or a corporate session edited or listed with a time that does not exist is refused 400, and no corporate session is made or moved', async () => {
    const requests = portal('/admin/corporate-requests')
    const sessions = portal('/admin/corporate-sessions')
    await check(
      [
        // No fixture here carries a Corporate Request through scheduling, so its control
        // reaches the service (which answers 404 for an id nobody holds) instead of succeeding.
        ...ends(
          'POST /portal/admin/corporate-requests/:id/schedule',
          'admin',
          w => ({
            method: 'POST',
            path: `${requests}/${randomUUID()}/schedule`,
            body: { main_instructor_id: teacher.staffId, location_text: 'Off-site', ...w },
          }),
          { control: 'passes' },
        ),
        ...range(sessions, 'admin', '/portal/admin/corporate-sessions'),
        ...ends('PATCH /portal/admin/corporate-sessions/:id', 'admin', w => ({
          method: 'PATCH',
          path: `${sessions}/${corporateSessionId}`,
          body: w,
        })),
      ],
      IMPOSSIBLE_MOMENTS,
    )
  })

  test('CHK-30 the check-in desk refuses a date that does not exist, including year 0000, 400', async () => {
    await check(
      (['admin', 'instructor'] as const).map(as => ({
        label: `GET /portal/${as}/check-in date`,
        as,
        send: v => ({ method: 'GET', path: query(portal(`/${as}/check-in`), { date: v }) }),
        valid: today,
      })),
      IMPOSSIBLE_DATES,
    )
  })

  test('PRM-22 a Promo Code expiry that does not exist is refused 400, and no code is made or changed', async () => {
    let made = 0
    await check(
      [
        {
          label: 'POST /portal/admin/promo-codes expires_at',
          as: 'admin',
          send: v => ({
            method: 'POST',
            path: portal('/admin/promo-codes'),
            body: { label: `${TAG} code ${made++}`, kind: 'percent', percent_off: 10, applies_to_all: true, expires_at: v },
          }),
          valid: moment(),
        },
        {
          label: 'PATCH /portal/admin/promo-codes/:id expires_at',
          as: 'admin',
          send: v => ({ method: 'PATCH', path: portal(`/admin/promo-codes/${promoCodeId}`), body: { expires_at: v } }),
          valid: moment(),
        },
      ],
      IMPOSSIBLE_MOMENTS,
    )
  })

  test('PKG-52 a Promotion start or end that does not exist is refused 400 invalid_request with a sentence, and no package or promotion is saved', async () => {
    let made = 0
    const promotion = (w: Window) => ({ label: `${TAG} promotion`, kind: 'percent', percent_off: 25, ...w })
    await check(
      [
        ...ends(
          'POST /portal/admin/class-packages promotions',
          'admin',
          w => ({
            method: 'POST',
            path: portal('/admin/class-packages'),
            body: {
              name: `${TAG} promoted pass ${made++}`,
              kind: 'credit_bundle',
              credits: 5,
              validity_days: 60,
              price_sgd: '100.00',
              promotions: [promotion(w)],
            },
          }),
          { says: /date and time/i },
        ),
        ...ends(
          'POST /portal/admin/pt-packages promotions',
          'admin',
          w => ({
            method: 'POST',
            path: portal('/admin/pt-packages'),
            body: {
              name: `${TAG} promoted sessions ${made++}`,
              session_type: '1on1',
              num_sessions: 5,
              validity_days: 90,
              price_sgd: '400.00',
              promotions: [promotion(w)],
            },
          }),
          { says: /date and time/i },
        ),
      ],
      IMPOSSIBLE_MOMENTS,
    )
  })

  test('PKG-53 a package whose Promotions cannot be saved is not saved either, however the Promotions fail', async () => {
    // A Promotion the database refuses after the package row is in, however it comes to be refused.
    const endsBeforeStart = {
      label: `${TAG} backwards promotion`,
      kind: 'percent',
      percent_off: 25,
      starts_at: new Date(Date.now() + 10 * DAY).toISOString(),
      ends_at: new Date(Date.now() + 5 * DAY).toISOString(),
    }
    // A percent Promotion with no percent is a second way the database refuses one, once the request has taken it.
    const noPercent = {
      label: `${TAG} percent with no percent`,
      kind: 'percent',
      starts_at: new Date(Date.now() + 5 * DAY).toISOString(),
      ends_at: new Date(Date.now() + 10 * DAY).toISOString(),
    }
    const wrong: string[] = []
    for (const [path, body, promotion] of [
      [
        '/admin/class-packages',
        { name: `${TAG} half-saved pass`, kind: 'credit_bundle', credits: 5, validity_days: 60, price_sgd: '100.00' },
        endsBeforeStart,
      ],
      [
        '/admin/pt-packages',
        { name: `${TAG} half-saved sessions`, session_type: '1on1', num_sessions: 5, validity_days: 90, price_sgd: '400.00' },
        endsBeforeStart,
      ],
      [
        '/admin/class-packages',
        { name: `${TAG} half-saved pass`, kind: 'credit_bundle', credits: 5, validity_days: 60, price_sgd: '100.00' },
        noPercent,
      ],
      [
        '/admin/pt-packages',
        { name: `${TAG} half-saved sessions`, session_type: '1on1', num_sessions: 5, validity_days: 90, price_sgd: '400.00' },
        noPercent,
      ],
    ] as const) {
      const before = await fingerprint()
      const res = await send('admin', { method: 'POST', path: portal(path), body: { ...body, promotions: [promotion] } })
      if (res.status < 400) wrong.push(`${path}: answered ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`)
      if ((await fingerprint()) !== before) wrong.push(`${path}: a refused request wrote`)
      const saved = await harness.db.execute<{ n: number }>(
        sql`SELECT (SELECT count(*) FROM class_packages WHERE name = ${body.name})::int + (SELECT count(*) FROM pt_packages WHERE name = ${body.name})::int AS n`,
      )
      if (saved[0]!.n !== 0) wrong.push(`${path}: the package was saved without its Promotion`)
    }
    assert.deepEqual(wrong, [])
  })

  test('PKG-54 an edit whose Promotions cannot be saved changes neither the package nor its Promotions', async () => {
    // A percent Promotion with no percent passes the request's checks and is refused by the database.
    const noPercent = {
      label: `${TAG} percent with no percent`,
      kind: 'percent',
      starts_at: new Date(Date.now() + 5 * DAY).toISOString(),
      ends_at: new Date(Date.now() + 10 * DAY).toISOString(),
    }
    const original = {
      label: `${TAG} original promotion`,
      kind: 'percent',
      percent_off: 20,
      starts_at: new Date(Date.now() + 5 * DAY).toISOString(),
      ends_at: new Date(Date.now() + 10 * DAY).toISOString(),
    }
    const wrong: string[] = []
    for (const [path, table, body] of [
      [
        '/admin/class-packages',
        'class_packages',
        { name: `${TAG} edited pass`, kind: 'credit_bundle', credits: 5, validity_days: 60, price_sgd: '100.00' },
      ],
      [
        '/admin/pt-packages',
        'pt_packages',
        { name: `${TAG} edited sessions`, session_type: '1on1', num_sessions: 5, validity_days: 90, price_sgd: '400.00' },
      ],
    ] as const) {
      const made = await ok('admin', { method: 'POST', path: portal(path), body: { ...body, promotions: [original] } }, 201)
      const id = made.id as string
      const state = async () => {
        const rows = await harness.db.execute<{ state: string }>(
          sql`SELECT (SELECT row_to_json(p)::text FROM ${sql.identifier(table)} p WHERE p.id = ${id})
              || (SELECT coalesce(string_agg(row_to_json(r)::text, '|' ORDER BY r.sort_id), '') FROM promotions r WHERE r.parent_id = ${id}) AS state`,
        )
        return rows[0]!.state
      }
      const before = await state()
      const res = await send('admin', {
        method: 'PATCH',
        path: portal(`${path}/${id}`),
        body: { name: `${body.name} renamed`, price_sgd: '55.00', promotions: [original, noPercent] },
      })
      if (res.status < 400) wrong.push(`${path}: answered ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`)
      if ((await state()) !== before) wrong.push(`${path}: a refused edit changed the package or its Promotions`)

      // The same edit with Promotions the database takes goes through whole.
      const control = await send('admin', {
        method: 'PATCH',
        path: portal(`${path}/${id}`),
        body: { name: `${body.name} renamed`, price_sgd: '55.00', promotions: [{ ...original, id: made.promotions[0].id, percent_off: 30 }] },
      })
      if (control.status !== 200 || control.body.name !== `${body.name} renamed` || control.body.promotions[0]?.percent_off !== 30) {
        wrong.push(`${path}: the control answered ${control.status} ${JSON.stringify(control.body).slice(0, 160)}`)
      }
    }
    assert.deepEqual(wrong, [])
  })

  test('PKG-55 a Promotion that ends before it starts, or as it starts, is refused 400 invalid_request naming its end, on create and on edit of both package kinds, and nothing is saved', async () => {
    const starts = new Date(Date.now() + 8 * DAY)
    const after = new Date(starts.getTime() + DAY).toISOString()
    const backwards = [new Date(starts.getTime() - DAY).toISOString(), starts.toISOString()]
    const promotion = (endsAt: string) => ({
      label: `${TAG} backwards promotion`,
      kind: 'percent',
      percent_off: 25,
      starts_at: starts.toISOString(),
      ends_at: endsAt,
    })
    let made = 0
    await check(
      [
        {
          label: 'POST /portal/admin/class-packages promotions ends_at',
          as: 'admin',
          send: v => ({
            method: 'POST',
            path: portal('/admin/class-packages'),
            body: { name: `${TAG} ordered pass ${made++}`, kind: 'credit_bundle', credits: 5, validity_days: 60, price_sgd: '100.00', promotions: [promotion(v)] },
          }),
          valid: after,
          says: /end after it starts/i,
        },
        {
          label: 'PATCH /portal/admin/class-packages/:id promotions ends_at',
          as: 'admin',
          send: v => ({ method: 'PATCH', path: portal(`/admin/class-packages/${classPackageId}`), body: { promotions: [promotion(v)] } }),
          valid: after,
          says: /end after it starts/i,
        },
        {
          label: 'POST /portal/admin/pt-packages promotions ends_at',
          as: 'admin',
          send: v => ({
            method: 'POST',
            path: portal('/admin/pt-packages'),
            body: { name: `${TAG} ordered sessions ${made++}`, session_type: '1on1', num_sessions: 5, validity_days: 90, price_sgd: '400.00', promotions: [promotion(v)] },
          }),
          valid: after,
          says: /end after it starts/i,
        },
        {
          label: 'PATCH /portal/admin/pt-packages/:id promotions ends_at',
          as: 'admin',
          send: v => ({ method: 'PATCH', path: portal(`/admin/pt-packages/${ptPackageId}`), body: { promotions: [promotion(v)] } }),
          valid: after,
          says: /end after it starts/i,
        },
      ],
      backwards,
    )
  })

  test('ATN-204 the Updates tab refuses a cursor whose time does not exist, 400, instead of a 500', async () => {
    const id = randomUUID()
    await check(
      [
        {
          label: 'GET /portal/attention updates_before',
          as: 'admin',
          send: v => ({ method: 'GET', path: query(portal('/attention'), { updates_before: `${v}_${id}` }) }),
          valid: moment(),
        },
      ],
      IMPOSSIBLE_MOMENTS,
    )
  })

  test('CUS-30 a member package expiry that does not exist is refused 400 invalid_request with a sentence, and the expiry is unchanged', async () => {
    await check(
      [
        {
          label: 'POST /portal/admin/clients/:id/packages/:pid/expiry expires_at',
          as: 'admin',
          send: v => ({
            method: 'POST',
            path: portal(`/admin/clients/${member.clientId}/packages/${expiryPackageId}/expiry`),
            body: { expires_at: v, reason: `${TAG} expiry` },
          }),
          valid: moment(),
          says: /expiry.*date/i,
        },
      ],
      IMPOSSIBLE_MOMENTS,
    )
  })

  test('WSP-39 a workshop day or early-bird cutoff that does not exist is refused 400, and no day or tier is saved', async () => {
    const workshop = portal(`/admin/workshops/${workshopId}`)
    const day = (w: Window) => ({ id: workshopDayId, ref: 'd1', room_id: roomId, ...w, capacity_online: 5 })
    let ord = 2
    await check(
      [
        ...ends('POST /portal/admin/workshops/:id/days', 'admin', w => ({
          method: 'POST',
          path: `${workshop}/days`,
          body: { ord: ord++, room_id: roomId, ...w, capacity_online: 5 },
        })),
        ...ends('PATCH /portal/admin/workshops/:id/days/:day_id', 'admin', w => ({
          method: 'PATCH',
          path: `${workshop}/days/${workshopDayId}`,
          body: w,
        })),
        ...ends('PUT /portal/admin/workshops/:id/schedule days', 'admin', w => ({
          method: 'PUT',
          path: `${workshop}/schedule`,
          body: { days: [day(w)], tiers: [] },
        })),
        (() => {
          const w = span(slot())
          return {
            label: 'PUT /portal/admin/workshops/:id/schedule early_bird_cutoff_at',
            as: 'admin',
            send: v => ({
              method: 'PUT',
              path: `${workshop}/schedule`,
              body: {
                days: [day(w)],
                tiers: [
                  {
                    name: `${TAG} tier`,
                    regular_price_sgd: '50.00',
                    early_bird_price_sgd: '40.00',
                    early_bird_quota: 5,
                    early_bird_cutoff_at: v,
                    day_refs: ['d1'],
                  },
                ],
              },
            }),
            valid: new Date(Date.parse(w.starts_at) - DAY).toISOString(),
          } satisfies Surface
        })(),
      ],
      IMPOSSIBLE_MOMENTS,
    )
  })

  test('CAT-13 the member and public timetable refuse a from or to that does not exist, 400', async () => {
    await check(
      [
        ...range('/api/v1/me/classes', 'member', '/me/classes'),
        ...range('/api/v1/public/classes', 'visitor', '/public/classes'),
      ],
      IMPOSSIBLE_MOMENTS,
    )
  })

  test('CAT-13 a from or to written as a bare calendar date is read as that day at midnight UTC, and one that is not a real day is refused 400', async () => {
    // The Mindbody import's tests send a bare date, `from=2089-12-01`.
    const dateOnly = (path: string, as: Who, label: string): Surface[] =>
      (['from', 'to'] as const).map(field => ({
        label: `GET ${label} ${field}`,
        as,
        send: v => ({ method: 'GET', path: query(path, { [field]: v }) }),
        valid: '2026-01-31',
      }))
    await check(
      [
        ...dateOnly('/api/v1/me/classes', 'member', '/me/classes'),
        ...dateOnly('/api/v1/public/classes', 'visitor', '/public/classes'),
        ...dateOnly(portal('/admin/schedule'), 'admin', '/portal/admin/schedule'),
        ...dateOnly(portal('/instructor/schedule'), 'instructor', '/portal/instructor/schedule'),
        ...dateOnly(portal('/admin/finance'), 'admin', '/portal/admin/finance'),
        ...dateOnly(portal('/admin/finance/overview'), 'admin', '/portal/admin/finance/overview'),
      ],
      IMPOSSIBLE_DATES,
    )
  })
})
