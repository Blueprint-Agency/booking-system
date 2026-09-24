import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
const DOMAIN = `${run}.payroll.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Payroll class type ${run}`
const PACKAGE_NAME = `Payroll pass ${run}`
const MANUAL_LABEL = `Retreat bonus ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The period every completed-session fixture sits in: a random week in the far
 * past, so no other file's fixtures (which sit around "now") fall inside it, and
 * two runs of this file are unlikely to share it.
 */
const BASE = Date.UTC(2003, 0, 1) + Math.floor(Math.random() * 3000) * DAY
const at = (days: number, hours = 10) => new Date(BASE + days * DAY + hours * HOUR)
const PERIOD = { from: at(0, 0).toISOString(), to: at(10, 0).toISOString() }

/**
 * Payroll over real HTTP (#204): the instructor's own Teaching log
 * (`GET /portal/instructor/payroll`) and the admin's pay writes on Finance
 * (`PATCH /finance/pay/:kind/:id`, `POST`/`DELETE /finance/manual`), with
 * Finance's per-instructor totals where a PAYR row compares against them.
 */
describe('payroll over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type Studio = { id: string; slug: string; locationId: string; roomId: string; classTypeId: string }
  type Staff = { staffId: string; name: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio
  let adminAtOne!: Staff
  let tara!: Staff // the instructor whose Teaching log is under test
  let omar!: Staff // another instructor at the same studio
  let adminAtTwo!: Staff
  let teacherAtTwo!: Staff
  let memberHeaders!: Record<string, string>
  let memberClientId!: string

  // Fixture ids, filled in `before`.
  const ids = {} as {
    c1: string // Tara main, 60 min, 0.10
    c2: string // Tara main, 75 min, 0.20
    c3: string // Tara main, Unpriced
    c4: string // Omar main 50.00, Tara supporting 12.35
    c5: string // Tara main, outside the period, 99.00
    c6: string // Tara main, cancelled, 77.00
    c7: string // Omar main, 40.00
    future: string // Tara main, not held yet, 55.00
    p1: string // Tara PT, 45 min, 30.00
    target: string // Tara main, far outside the period — the one the pay writes aim at
    foreign: string // tenant two's class naming Tara as its instructor
    manual: string // Tara manual entry, 20.10
  }

  const emailFor = (name: string) => `${name.toLowerCase().replace(/\s+/g, '-')}@${DOMAIN}`

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
    return { ...tenant, locationId: location.id, roomId: room.id, classTypeId: classType.id }
  }

  async function staff(at: Studio, handle: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${handle}-${at.slug}`)
    const name = `${handle} ${run}`
    const headers = await harness.signInAs('staff', email, at)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    }
    return { staffId: row!.id, name, headers }
  }

  /** A class inserted directly — held (ended) when `startsAt` is in the past. */
  async function addClass(
    at: Studio,
    teacher: Staff,
    startsAt: Date,
    opts: { minutes?: number; pay?: string | null; lifecycle?: 'active' | 'cancelled'; createdBy?: Staff } = {},
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: teacher.staffId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + (opts.minutes ?? 60) * MINUTE),
        capacityOnline: 10,
        creditCost: 1,
        instructorPaySgd: opts.pay ?? null,
        lifecycle: opts.lifecycle ?? 'active',
        createdByStaffId: (opts.createdBy ?? teacher).staffId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  type Line = {
    kind: string
    id: string
    instructor_id: string
    label: string
    starts_at: string
    ends_at: string
    duration_minutes: number
    instructor_pay_sgd: number | null
  }
  type TeachingLog = { rows: Line[]; total_sgd: number; session_count: number; unpriced_count: number }

  async function teachingLog(who: Staff | Record<string, string>, query: Record<string, string> = {}) {
    const headers = 'headers' in who ? (who as Staff).headers : (who as Record<string, string>)
    const qs = new URLSearchParams(query).toString()
    const res = await harness.app.request(`/api/v1/portal/instructor/payroll${qs ? `?${qs}` : ''}`, { headers })
    return { status: res.status, body: (await res.json()) as any }
  }

  async function myLog(who: Staff, query: Record<string, string> = {}): Promise<TeachingLog> {
    const res = await teachingLog(who, query)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body as TeachingLog
  }

  async function finance(who: Staff, query: Record<string, string>) {
    const res = await harness.app.request(`/api/v1/portal/admin/finance?${new URLSearchParams(query)}`, {
      headers: who.headers,
    })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    return JSON.parse(text) as {
      rows: {
        kind: string
        id: string
        instructor_id: string | null
        pay_sgd: number | null
        unpriced: boolean
        duration_minutes: number | null
      }[]
      totals: { instructor_pay_sgd: number }
      instructor_totals: { instructor_id: string; total_sgd: number; session_count: number }[]
      unpriced_count: number
    }
  }

  async function patchPay(
    who: Staff | Record<string, string>,
    kind: string,
    id: string,
    body: { instructor_pay_sgd: number | null; instructor_id?: string },
  ) {
    const headers = 'headers' in who ? (who as Staff).headers : (who as Record<string, string>)
    const res = await harness.app.request(`/api/v1/portal/admin/finance/pay/${kind}/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as any }
  }

  async function postManual(
    who: Staff | Record<string, string>,
    body: { instructor_id: string; amount_sgd: number; label: string; entry_date?: string },
  ) {
    const headers = 'headers' in who ? (who as Staff).headers : (who as Record<string, string>)
    const res = await harness.app.request('/api/v1/portal/admin/finance/manual', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as any }
  }

  async function deleteManual(who: Staff | Record<string, string>, id: string) {
    const headers = 'headers' in who ? (who as Staff).headers : (who as Record<string, string>)
    const res = await harness.app.request(`/api/v1/portal/admin/finance/manual/${id}`, {
      method: 'DELETE',
      headers,
    })
    return { status: res.status, body: (await res.json()) as any }
  }

  const classPay = async (id: string) => {
    const [row] = await harness.db
      .select({ pay: schema.classes.instructorPaySgd })
      .from(schema.classes)
      .where(eq(schema.classes.id, id))
    assert.ok(row, 'the class is still there')
    return row.pay
  }

  const manualRow = async (id: string) => {
    const [row] = await harness.db
      .select()
      .from(schema.manualPayrollEntries)
      .where(eq(schema.manualPayrollEntries.id, id))
    return row
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    adminAtOne = await staff(one, 'Ada Admin', 'admin')
    tara = await staff(one, 'Tara Teacher', 'instructor')
    omar = await staff(one, 'Omar Other', 'instructor')
    adminAtTwo = await staff(two, 'Aki Admin', 'admin')
    teacherAtTwo = await staff(two, 'Tomo Teacher', 'instructor')

    // A member of studio one, signed in on its member app, with a purchase dated
    // inside the period — money in the Teaching log must never show.
    const memberEmail = emailFor(`member-${one.slug}`)
    memberHeaders = await harness.signInAs('client', memberEmail, one)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, memberEmail))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: one.id, email: memberEmail, name: `Mia Member ${run}`, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    memberClientId = client!.id
    const classPackage = await classPackagesSvc.createClassPackage(one.id, {
      name: PACKAGE_NAME,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    const { clientPackageId } = await purchaseSvc.grantPackage(one.id, {
      clientId: memberClientId,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: classPackage.id,
    })
    await harness.db
      .update(schema.clientPackages)
      .set({ purchasedAt: at(3, 9) })
      .where(eq(schema.clientPackages.id, clientPackageId))

    ids.c1 = await addClass(one, tara, at(1), { pay: '0.10' })
    ids.c2 = await addClass(one, tara, at(2), { minutes: 75, pay: '0.20' })
    ids.c3 = await addClass(one, tara, at(3), { pay: null })
    ids.c4 = await addClass(one, omar, at(4), { pay: '50.00' })
    await harness.db
      .insert(schema.classSupportingInstructors)
      .values({ tenantId: one.id, classId: ids.c4, instructorId: tara.staffId, paySgd: '12.35' })
    ids.c5 = await addClass(one, tara, at(20), { pay: '99.00' })
    ids.c6 = await addClass(one, tara, at(7), { pay: '77.00', lifecycle: 'cancelled' })
    ids.c7 = await addClass(one, omar, at(1, 14), { pay: '40.00' })
    ids.future = await addClass(one, tara, new Date(Date.now() + 2 * DAY), { pay: '55.00' })
    ids.target = await addClass(one, tara, at(40), { pay: '10.00' })

    // A PT session Tara taught, 45 minutes, 30.00.
    const [request] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: one.id,
        clientId: memberClientId,
        classTypeId: one.classTypeId,
        locationId: one.locationId,
        sessionType: '1on1',
        status: 'scheduled',
        expiresAt: at(5, 0),
      })
      .returning({ id: schema.ptRequests.id })
    const [pt] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: one.id,
        ptRequestId: request!.id,
        instructorId: tara.staffId,
        locationId: one.locationId,
        roomId: one.roomId,
        startsAt: at(5),
        endsAt: new Date(at(5).getTime() + 45 * MINUTE),
        sessionType: '1on1',
        instructorPaySgd: '30.00',
        capacityOnline: 1,
        scheduledAt: at(4, 0),
        scheduledByStaffId: adminAtOne.staffId,
      })
      .returning({ id: schema.ptSessions.id })
    ids.p1 = pt!.id

    // Studio two's own class, in the same period, taught by its own instructor —
    // and one mis-attributed row naming Tara, which a tenant-scoped read of
    // studio one must still never return.
    await addClass(two, teacherAtTwo, at(2, 12), { pay: '300.00' })
    ids.foreign = await addClass(two, tara, at(2, 16), { pay: '500.00', createdBy: teacherAtTwo })

    // Tara's Manual Entry, 20.10, added by the admin through the Finance route.
    // A fixture here, not a step of one test: most tests below read or write it,
    // and each must be runnable on its own.
    const manual = await postManual(adminAtOne, {
      instructor_id: tara.staffId,
      amount_sgd: 20.1,
      label: MANUAL_LABEL,
      entry_date: at(6).toISOString(),
    })
    assert.equal(manual.status, 201, JSON.stringify(manual.body))
    ids.manual = manual.body.id
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM manual_payroll_entries WHERE instructor_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM pt_sessions WHERE scheduled_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  // -- happy path: an admin adds a Manual Entry, and it lands on the log --------

  test('PAYR-10 a Manual Entry an admin added for an instructor is listed and totalled like session pay', async () => {
    const stored = await manualRow(ids.manual)
    assert.equal(stored?.amountSgd, '20.10')
    assert.equal(stored?.tenantId, one.id)

    const log = await myLog(tara, PERIOD)
    const line = log.rows.find(r => r.id === ids.manual)
    assert.ok(line, 'the Manual Entry is on the Teaching log')
    assert.equal(line.kind, 'manual')
    assert.equal(line.label, MANUAL_LABEL)
    assert.equal(line.instructor_pay_sgd, 20.1)
    // 0.10 + 0.20 + 12.35 (supporting) + 30.00 (PT) + 20.10 (manual)
    assert.equal(log.total_sgd, 62.75)

    // Finance counts it into the same instructor's pay.
    const fin = await finance(adminAtOne, { ...PERIOD, instructor_id: tara.staffId })
    assert.equal(fin.rows.find(r => r.kind === 'manual' && r.id === ids.manual)?.pay_sgd, 20.1)
    assert.equal(fin.instructor_totals.find(t => t.instructor_id === tara.staffId)?.total_sgd, 62.75)
  })

  // -- the Teaching log ---------------------------------------------------------

  test('PAYR-01 every held class and PT session an instructor taught is a row, with its pay or as Unpriced', async () => {
    const log = await myLog(tara, PERIOD)
    const byId = (id: string) => log.rows.filter(r => r.id === id)

    assert.equal(byId(ids.c1)[0]?.instructor_pay_sgd, 0.1)
    assert.equal(byId(ids.c2)[0]?.instructor_pay_sgd, 0.2)
    assert.equal(byId(ids.c3).length, 1, 'the Unpriced class is listed')
    assert.equal(byId(ids.c3)[0]?.instructor_pay_sgd, null, 'Unpriced is null, never zero')
    assert.equal(byId(ids.c4).length, 1, 'a class taught as supporting instructor is a row')
    assert.equal(byId(ids.c4)[0]?.instructor_pay_sgd, 12.35, "with the supporting instructor's own pay")
    assert.equal(byId(ids.p1)[0]?.kind, 'pt')
    assert.equal(byId(ids.p1)[0]?.instructor_pay_sgd, 30)

    assert.equal(byId(ids.c6).length, 0, 'a cancelled class is never held')
    const all = await myLog(tara)
    assert.ok(!all.rows.some(r => r.id === ids.future), 'a class that has not happened yet is not on the log')
    assert.ok(!all.rows.some(r => r.id === ids.c6))

    assert.deepEqual(
      log.rows.map(r => r.id).sort(),
      [ids.c1, ids.c2, ids.c3, ids.c4, ids.p1, ids.manual].sort(),
    )
    assert.equal(log.session_count, 6)
  })

  test('PAYR-02 an instructor passing another instructor’s id still reads only their own log', async () => {
    const own = await myLog(tara, PERIOD)
    const asked = await myLog(tara, { ...PERIOD, instructor_id: omar.staffId })

    assert.ok(asked.rows.length > 0)
    assert.ok(asked.rows.every(r => r.instructor_id === tara.staffId), JSON.stringify(asked.rows))
    assert.ok(!asked.rows.some(r => r.id === ids.c7), "Omar's own class never shows")
    assert.equal(asked.total_sgd, own.total_sgd)
    assert.equal(asked.session_count, own.session_count)

    // And Omar's log is his alone: his main pay on c4, not Tara's supporting pay.
    const omars = await myLog(omar, PERIOD)
    assert.ok(omars.rows.every(r => r.instructor_id === omar.staffId))
    assert.equal(omars.total_sgd, 90)
  })

  test('PAYR-03 the Teaching log carries no studio total, money-in row or other instructor', async () => {
    // The purchase and Omar's pay really are in the period — Finance shows both.
    const fin = await finance(adminAtOne, { ...PERIOD, q: run })
    assert.ok(fin.rows.some(r => r.kind === 'purchase'), 'the period has money in')
    assert.ok(fin.rows.some(r => r.instructor_id === omar.staffId), 'the period has another instructor')

    const log = await myLog(tara, PERIOD)
    assert.deepEqual(Object.keys(log).sort(), ['rows', 'session_count', 'total_sgd', 'unpriced_count'])
    for (const row of log.rows) {
      assert.equal(row.instructor_id, tara.staffId)
      assert.ok(['class', 'pt', 'workshop', 'manual'].includes(row.kind), `unexpected row kind ${row.kind}`)
    }
    const text = JSON.stringify(log)
    assert.ok(!text.includes(omar.staffId), "Omar's id appears nowhere")
    assert.ok(!text.includes(omar.name))
    assert.ok(!text.includes('Mia Member'), 'no member appears')
    assert.notEqual(log.total_sgd, fin.totals.instructor_pay_sgd, 'the studio total is not what Tara sees')
  })

  test('PAYR-04 filtering to a date range lists only sessions in it, and totals exactly those', async () => {
    const wide = await myLog(tara)
    assert.ok(wide.rows.some(r => r.id === ids.c5), 'the out-of-range class is on the unfiltered log')

    const log = await myLog(tara, PERIOD)
    assert.ok(!log.rows.some(r => r.id === ids.c5), 'a session outside the range is not listed')
    assert.ok(!log.rows.some(r => r.id === ids.target))
    for (const row of log.rows) {
      assert.ok(row.starts_at >= PERIOD.from && row.starts_at <= PERIOD.to, `${row.starts_at} is outside the range`)
    }
    const cents = log.rows.reduce((sum, r) => sum + Math.round((r.instructor_pay_sgd ?? 0) * 100), 0)
    assert.equal(log.total_sgd, cents / 100, 'the total covers exactly the rows listed')
    assert.equal(log.total_sgd, 62.75)

    // A narrower range: just days 1 and 2.
    const narrow = await myLog(tara, { from: at(1, 0).toISOString(), to: at(2, 23).toISOString() })
    assert.deepEqual(narrow.rows.map(r => r.id).sort(), [ids.c1, ids.c2].sort())
  })

  test('PAYR-05, PAYR-07 an Unpriced assignment is listed, counted apart, and excluded from the total', async () => {
    const log = await myLog(tara, PERIOD)
    const unpriced = log.rows.filter(r => r.instructor_pay_sgd == null)
    assert.deepEqual(unpriced.map(r => r.id), [ids.c3])
    assert.equal(log.unpriced_count, 1)
    const priced = log.rows.filter(r => r.instructor_pay_sgd != null)
    const cents = priced.reduce((sum, r) => sum + Math.round(r.instructor_pay_sgd! * 100), 0)
    assert.equal(log.total_sgd, cents / 100)

    // Finance, over the same period and instructor, agrees on both counts.
    const fin = await finance(adminAtOne, { ...PERIOD, instructor_id: tara.staffId })
    assert.equal(fin.unpriced_count, 1)
    assert.equal(fin.rows.find(r => r.id === ids.c3 && r.instructor_id === tara.staffId)?.unpriced, true)
    assert.equal(fin.instructor_totals.find(t => t.instructor_id === tara.staffId)?.total_sgd, 62.75)
  })

  test('PAYR-06 Finance’s per-instructor pay and the instructor’s own Teaching log show the same total', async () => {
    for (const who of [tara, omar]) {
      const log = await myLog(who, PERIOD)
      const fin = await finance(adminAtOne, PERIOD)
      const theirs = fin.instructor_totals.find(t => t.instructor_id === who.staffId)
      assert.ok(theirs, `${who.name} has a Finance total`)
      assert.equal(theirs.total_sgd, log.total_sgd, `${who.name}: Finance and the Teaching log disagree`)
    }
  })

  test('PAYR-08 each instructor gets their own sum and count, and the grand total is the sum of every priced row', async () => {
    // `q` narrows Finance to this run's people, so no other file's rows count.
    const fin = await finance(adminAtOne, { ...PERIOD, q: run })
    const taraTotal = fin.instructor_totals.find(t => t.instructor_id === tara.staffId)
    const omarTotal = fin.instructor_totals.find(t => t.instructor_id === omar.staffId)
    assert.equal(taraTotal?.total_sgd, 62.75)
    assert.equal(omarTotal?.total_sgd, 90)
    assert.equal(omarTotal?.session_count, 2)
    assert.equal(fin.instructor_totals.length, 2, 'only instructors with pay in the period')

    const pricedCents = fin.rows
      .filter(r => r.pay_sgd != null)
      .reduce((sum, r) => sum + Math.round(r.pay_sgd! * 100), 0)
    assert.equal(fin.totals.instructor_pay_sgd, pricedCents / 100)
    assert.equal(fin.totals.instructor_pay_sgd, 152.75)

    // Each instructor's own log carries their own count.
    assert.equal((await myLog(tara, PERIOD)).session_count, 6)
    assert.equal((await myLog(omar, PERIOD)).session_count, 2)
  })

  test('PAYR-09 cents that do not add exactly in floating point total to the exact cent sum', async () => {
    // 0.10 + 0.20 is 0.30000000000000004 in floating point.
    const narrow = await myLog(tara, { from: at(1, 0).toISOString(), to: at(2, 23).toISOString() })
    assert.equal(narrow.total_sgd, 0.3)
    const fin = await finance(adminAtOne, {
      from: at(1, 0).toISOString(),
      to: at(2, 23).toISOString(),
      instructor_id: tara.staffId,
    })
    assert.equal(fin.instructor_totals.find(t => t.instructor_id === tara.staffId)?.total_sgd, 0.3)
    assert.equal(fin.totals.instructor_pay_sgd, 0.3)
    // And the whole period: 0.10 + 0.20 + 12.35 + 30.00 + 20.10, exactly.
    assert.equal((await myLog(tara, PERIOD)).total_sgd, 62.75)
  })

  test('PAYR-11 duration is derived from start and end, the same on the Teaching log and on Finance', async () => {
    const log = await myLog(tara, PERIOD)
    const fin = await finance(adminAtOne, { ...PERIOD, instructor_id: tara.staffId })
    const expected: Record<string, number> = { [ids.c1]: 60, [ids.c2]: 75, [ids.p1]: 45 }
    for (const [id, minutes] of Object.entries(expected)) {
      const line = log.rows.find(r => r.id === id)
      assert.ok(line)
      assert.equal(line.duration_minutes, minutes)
      assert.equal(
        line.duration_minutes,
        Math.round((Date.parse(line.ends_at) - Date.parse(line.starts_at)) / 60000),
      )
      const finLine = fin.rows.find(r => r.id === id && r.instructor_id === tara.staffId)
      assert.equal(finLine?.duration_minutes, minutes, `Finance's duration for ${id}`)
    }
  })

  // -- admin pay writes ---------------------------------------------------------

  test('an admin prices a class and clears it back to Unpriced, and the Teaching log follows', async () => {
    const priced = await patchPay(adminAtOne, 'class', ids.target, { instructor_pay_sgd: 45.5 })
    assert.equal(priced.status, 200, JSON.stringify(priced.body))
    assert.equal(await classPay(ids.target), '45.50')
    assert.equal((await myLog(tara)).rows.find(r => r.id === ids.target)?.instructor_pay_sgd, 45.5)

    const cleared = await patchPay(adminAtOne, 'class', ids.target, { instructor_pay_sgd: null })
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body))
    assert.equal(await classPay(ids.target), null)
    assert.equal((await myLog(tara)).rows.find(r => r.id === ids.target)?.instructor_pay_sgd, null)

    const restored = await patchPay(adminAtOne, 'class', ids.target, {
      instructor_pay_sgd: 10,
      instructor_id: tara.staffId,
    })
    assert.equal(restored.status, 200, JSON.stringify(restored.body))
    assert.equal(await classPay(ids.target), '10.00')
  })

  test('an admin reprices a supporting instructor on their own row, leaving the main instructor’s pay alone', async () => {
    const res = await patchPay(adminAtOne, 'class', ids.c4, { instructor_pay_sgd: 12.35, instructor_id: tara.staffId })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(await classPay(ids.c4), '50.00')
  })

  test('PAYR-13 saving pay against a record the studio does not have fails 404 record_not_found', async () => {
    const nobody = randomUUID()
    for (const [kind, body] of [
      ['class', { instructor_pay_sgd: 10 }],
      ['pt', { instructor_pay_sgd: 10 }],
      ['workshop', { instructor_pay_sgd: 10, instructor_id: tara.staffId }],
      ['manual', { instructor_pay_sgd: 10 }],
    ] as const) {
      const res = await patchPay(adminAtOne, kind, nobody, body)
      assert.equal(res.status, 404, `${kind}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, 'record_not_found', kind)
      assert.ok(res.body.message)
      assert.notEqual(res.body.ok, true)
    }

    // A class that existed and was deleted.
    const gone = await addClass(one, tara, at(41), { pay: '10.00' })
    await harness.db.delete(schema.classes).where(eq(schema.classes.id, gone))
    const res = await patchPay(adminAtOne, 'class', gone, { instructor_pay_sgd: 25, instructor_id: tara.staffId })
    assert.equal(res.status, 404, JSON.stringify(res.body))
    assert.equal(res.body.error, 'record_not_found')

    // Deleting a Manual Entry that does not exist says the same.
    const del = await deleteManual(adminAtOne, nobody)
    assert.equal(del.status, 404, JSON.stringify(del.body))
    assert.equal(del.body.error, 'record_not_found')
  })

  test('PAYR-13 another studio’s admin cannot price, reprice or delete this studio’s pay — 404, and nothing changes', async () => {
    const before = await classPay(ids.target)
    const cls = await patchPay(adminAtTwo, 'class', ids.target, { instructor_pay_sgd: 999 })
    assert.equal(cls.status, 404, JSON.stringify(cls.body))
    assert.equal(cls.body.error, 'record_not_found')
    const named = await patchPay(adminAtTwo, 'class', ids.target, { instructor_pay_sgd: 999, instructor_id: tara.staffId })
    assert.equal(named.status, 404, JSON.stringify(named.body))
    assert.equal(named.body.error, 'record_not_found')
    assert.equal(await classPay(ids.target), before)

    const pt = await patchPay(adminAtTwo, 'pt', ids.p1, { instructor_pay_sgd: 999 })
    assert.equal(pt.status, 404, JSON.stringify(pt.body))
    assert.equal(pt.body.error, 'record_not_found')
    const [ptRow] = await harness.db
      .select({ pay: schema.ptSessions.instructorPaySgd })
      .from(schema.ptSessions)
      .where(eq(schema.ptSessions.id, ids.p1))
    assert.equal(ptRow?.pay, '30.00')

    const manual = await patchPay(adminAtTwo, 'manual', ids.manual, { instructor_pay_sgd: 999 })
    assert.equal(manual.status, 404, JSON.stringify(manual.body))
    assert.equal(manual.body.error, 'record_not_found')
    const del = await deleteManual(adminAtTwo, ids.manual)
    assert.equal(del.status, 404, JSON.stringify(del.body))
    assert.equal(del.body.error, 'record_not_found')
    assert.equal((await manualRow(ids.manual))?.amountSgd, '20.10', 'the Manual Entry is untouched')
  })

  test('PAYR-14 pricing an instructor who is not on the session fails instructor_not_assigned, not record_not_found', async () => {
    const before = await classPay(ids.target)
    const res = await patchPay(adminAtOne, 'class', ids.target, { instructor_pay_sgd: 15, instructor_id: omar.staffId })
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'instructor_not_assigned')
    assert.ok(res.body.message)
    assert.equal(await classPay(ids.target), before)
    const [supporting] = await harness.db
      .select()
      .from(schema.classSupportingInstructors)
      .where(eq(schema.classSupportingInstructors.classId, ids.target))
    assert.equal(supporting, undefined, 'no roster row was created for Omar')

    const pt = await patchPay(adminAtOne, 'pt', ids.p1, { instructor_pay_sgd: 15, instructor_id: omar.staffId })
    assert.equal(pt.status, 409, JSON.stringify(pt.body))
    assert.equal(pt.body.error, 'instructor_not_assigned')
  })

  test('PAYR-15 a negative amount is refused with invalid_amount and the stored pay is unchanged', async () => {
    const before = await classPay(ids.target)
    const res = await patchPay(adminAtOne, 'class', ids.target, { instructor_pay_sgd: -5 })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.error, 'invalid_amount', JSON.stringify(res.body))
    assert.equal(await classPay(ids.target), before)

    const supporting = await patchPay(adminAtOne, 'class', ids.c4, { instructor_pay_sgd: -1, instructor_id: tara.staffId })
    assert.equal(supporting.status, 400, JSON.stringify(supporting.body))
    assert.equal(supporting.body.error, 'invalid_amount')

    const manual = await patchPay(adminAtOne, 'manual', ids.manual, { instructor_pay_sgd: -20.1 })
    assert.equal(manual.status, 400, JSON.stringify(manual.body))
    assert.equal(manual.body.error, 'invalid_amount')
    assert.equal((await manualRow(ids.manual))?.amountSgd, '20.10')

    assert.equal((await myLog(tara, PERIOD)).total_sgd, 62.75, 'the Teaching log is unchanged')
  })

  // -- who may call what --------------------------------------------------------

  test('a member is refused both the Teaching log and the pay writes', async () => {
    assert.equal((await teachingLog(memberHeaders)).status, 401)
    const before = await classPay(ids.target)
    const patched = await patchPay(memberHeaders, 'class', ids.target, { instructor_pay_sgd: 1 })
    assert.equal(patched.status, 401, JSON.stringify(patched.body))
    const manual = await postManual(memberHeaders, { instructor_id: tara.staffId, amount_sgd: 1, label: `member ${run}` })
    assert.equal(manual.status, 401, JSON.stringify(manual.body))
    assert.equal((await deleteManual(memberHeaders, ids.manual)).status, 401)
    assert.equal(await classPay(ids.target), before)
    assert.ok(await manualRow(ids.manual))
  })

  test('an instructor is refused every admin Finance route, and nothing changes', async () => {
    const before = await classPay(ids.target)
    const read = await harness.app.request(`/api/v1/portal/admin/finance?${new URLSearchParams(PERIOD)}`, {
      headers: tara.headers,
    })
    assert.equal(read.status, 403)
    assert.equal(((await read.json()) as { error: string }).error, 'forbidden_role')

    const patched = await patchPay(tara, 'class', ids.target, { instructor_pay_sgd: 1000 })
    assert.equal(patched.status, 403, JSON.stringify(patched.body))
    assert.equal(patched.body.error, 'forbidden_role')
    const manual = await postManual(tara, { instructor_id: tara.staffId, amount_sgd: 1000, label: `self-paid ${run}` })
    assert.equal(manual.status, 403, JSON.stringify(manual.body))
    const del = await deleteManual(tara, ids.manual)
    assert.equal(del.status, 403, JSON.stringify(del.body))

    assert.equal(await classPay(ids.target), before)
    assert.ok(await manualRow(ids.manual))
    const [selfPaid] = await harness.db
      .select()
      .from(schema.manualPayrollEntries)
      .where(eq(schema.manualPayrollEntries.label, `self-paid ${run}`))
    assert.equal(selfPaid, undefined)
  })

  test('an admin on the Teaching log sees only their own teaching, never an instructor’s', async () => {
    const log = await myLog(adminAtOne, PERIOD)
    assert.deepEqual(log.rows, [])
    assert.equal(log.total_sgd, 0)
    assert.equal(log.unpriced_count, 0)
  })

  test('PAYR-02 the Teaching log never shows another studio’s rows', async () => {
    const all = await myLog(tara)
    assert.ok(!all.rows.some(r => r.id === ids.foreign), "studio two's row naming Tara is not on her log")
    assert.ok(all.rows.every(r => r.instructor_pay_sgd !== 500 && r.instructor_pay_sgd !== 300))

    // Studio two's own instructor sees studio two's class and nothing of studio one's.
    const theirs = await myLog(teacherAtTwo, PERIOD)
    assert.equal(theirs.rows.length, 1)
    assert.equal(theirs.total_sgd, 300)
    const oneIds = new Set(Object.values(ids))
    assert.ok(!theirs.rows.some(r => oneIds.has(r.id)))
  })

  test('the Manual Entry is deleted by its studio’s admin, and leaves both the log and Finance', async () => {
    const del = await deleteManual(adminAtOne, ids.manual)
    assert.equal(del.status, 200, JSON.stringify(del.body))
    assert.equal(await manualRow(ids.manual), undefined)
    const log = await myLog(tara, PERIOD)
    assert.ok(!log.rows.some(r => r.id === ids.manual))
    assert.equal(log.total_sgd, 42.65)
    const fin = await finance(adminAtOne, { ...PERIOD, instructor_id: tara.staffId })
    assert.equal(fin.instructor_totals.find(t => t.instructor_id === tara.staffId)?.total_sgd, 42.65)
  })
})
