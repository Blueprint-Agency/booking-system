import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.leave-submit.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Leave submission class type ${run}`
const CORPORATE_PACKAGE_NAME = `Leave submission corporate ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The Leave Year every future-dated request in this file counts against: one
 * picked at random per run, centuries out, so no other file's leave, classes or
 * declared pairs can land on the same dates in the shared database. A future
 * Leave Year's Pool is computed, never stored (services/leave/requests.ts), so
 * each instructor here starts that year on exactly their Assigned Days.
 */
const YEAR = 2300 + Math.floor(Math.random() * 600)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Day `n` (1-based) of YEAR, as a plain date. Each test takes its own days. */
const dayOf = (n: number): string => new Date(Date.UTC(YEAR, 0, n)).toISOString().slice(0, 10)
/** "18 Aug 2026" — how a Leave Cap / Leave Conflict refusal writes a date. */
const leaveDateLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
/** An instant on a Singapore calendar date. */
const sgAt = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`)
/** Today's date in Singapore, `offsetDays` either side. */
const sgDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY + 8 * HOUR).toISOString().slice(0, 10)

/**
 * Instructor leave SUBMISSION over real HTTP (#204): the instructor's own
 * `POST /portal/instructor/leave`, against real Postgres and a real sign-in.
 *
 * What is proven here is every rule that can refuse a request at the moment it
 * is filed — the Pool (pending counts), the clash with his own assignments, a
 * declared Leave Conflict and the study Leave Cap — plus the concurrency the
 * submission transaction exists for: whichever of two simultaneous requests
 * gets there second is measured against the first.
 */
describe('instructor leave submission over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')

  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
  }
  type Staff = { staffId: string; name: string; headers: Record<string, string> }
  type Res = { status: number; body: any }

  let one!: Studio
  let two!: Studio
  let adminAtOne!: Staff
  let adminAtTwo!: Staff

  /** Every policy value this file touches, as it was before the file ran. */
  type PolicySnapshot = {
    tenantId: string
    studyLeaveCap: number
    updatedAt: Date
    updatedByStaffId: string | null
    pairs: { instructorAId: string; instructorBId: string }[]
  }
  const originalPolicy = new Map<string, PolicySnapshot>()

  let staffCount = 0
  const emailFor = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++staffCount}@${DOMAIN}`

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

  async function staff(
    at: Studio,
    first: string,
    role: 'admin' | 'instructor',
    assigned?: { annual?: number; medical?: number; study?: number },
  ): Promise<Staff> {
    const name = `${first} ${run}`
    const email = emailFor(first)
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
      await harness.db.insert(schema.instructors).values({
        tenantId: at.id,
        staffUserId: row!.id,
        ...(assigned?.annual !== undefined ? { annualLeaveDays: assigned.annual } : {}),
        ...(assigned?.medical !== undefined ? { medicalLeaveDays: assigned.medical } : {}),
        ...(assigned?.study !== undefined ? { studyLeaveDays: assigned.study } : {}),
      })
    }
    return { staffId: row!.id, name, headers }
  }

  const instructor = (at: Studio, first: string, assigned?: { annual?: number; medical?: number; study?: number }) =>
    staff(at, first, 'instructor', assigned)

  async function call(who: { headers: Record<string, string> }, method: string, path: string, body?: unknown): Promise<Res> {
    const res = await harness.app.request(path, {
      method,
      headers: { ...who.headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // not JSON — keep the text for the assertion message
    }
    return { status: res.status, body: parsed }
  }

  type LeaveBody = {
    type: 'annual' | 'medical' | 'study'
    start_date: string
    end_date?: string
    half_day?: 'none' | 'morning' | 'afternoon'
  }
  const submit = (who: Staff, leave: LeaveBody) =>
    call(who, 'POST', '/api/v1/portal/instructor/leave', {
      end_date: leave.start_date,
      reason: `leave submission test ${run}`,
      ...leave,
    })

  const leaveRowsOf = (s: Staff) =>
    harness.db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.instructorId, s.staffId))

  async function setPolicy(body: Record<string, unknown>): Promise<void> {
    const res = await call(adminAtOne, 'PATCH', '/api/v1/portal/admin/policy/global', body)
    assert.equal(res.status, 200, JSON.stringify(res.body))
  }

  const originalPairsBody = () =>
    originalPolicy.get(one.id)!.pairs.map(p => ({ instructor_a_id: p.instructorAId, instructor_b_id: p.instructorBId }))

  /** Declare these pairs ON TOP of whatever the studio already had declared. */
  const declarePairs = (pairs: [Staff, Staff][]) =>
    setPolicy({
      leave_conflicts: [
        ...originalPairsBody(),
        ...pairs.map(([a, b]) => ({ instructor_a_id: a.staffId, instructor_b_id: b.staffId })),
      ],
    })

  async function snapshotPolicy(tenantId: string): Promise<PolicySnapshot> {
    const [row] = await harness.db
      .select()
      .from(schema.globalPolicy)
      .where(eq(schema.globalPolicy.tenantId, tenantId))
    assert.ok(row, 'expected a seeded policy row')
    const pairs = await harness.db
      .select({ instructorAId: schema.leaveConflicts.instructorAId, instructorBId: schema.leaveConflicts.instructorBId })
      .from(schema.leaveConflicts)
      .where(eq(schema.leaveConflicts.tenantId, tenantId))
    return {
      tenantId,
      studyLeaveCap: row.studyLeaveCap,
      updatedAt: row.updatedAt,
      updatedByStaffId: row.updatedByStaffId,
      pairs,
    }
  }

  /**
   * Put the studio's policy back exactly as it was — the values, the declared
   * pairs, and who last saved it (a save by this file's admin would otherwise
   * pin that admin's row in place and outlive the file). Straight to the rows:
   * this is fixture teardown, not behaviour under test.
   */
  async function restorePolicy(): Promise<void> {
    for (const snap of originalPolicy.values()) {
      await harness.db
        .update(schema.globalPolicy)
        .set({ studyLeaveCap: snap.studyLeaveCap, updatedAt: snap.updatedAt, updatedByStaffId: snap.updatedByStaffId })
        .where(eq(schema.globalPolicy.tenantId, snap.tenantId))
      await harness.db.delete(schema.leaveConflicts).where(eq(schema.leaveConflicts.tenantId, snap.tenantId))
      if (snap.pairs.length > 0) {
        await harness.db.insert(schema.leaveConflicts).values(snap.pairs.map(p => ({ ...p, tenantId: snap.tenantId })))
      }
    }
  }

  async function addClass(at: Studio, teacher: Staff, startsAt: Date, lifecycle: 'active' | 'cancelled' = 'active') {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: teacher.staffId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        instructorPaySgd: '55.00',
        lifecycle,
        ...(lifecycle === 'cancelled' ? { cancelledAt: new Date(), cancelledByStaffId: teacher.staffId } : {}),
        createdByStaffId: teacher.staffId,
      })
      .returning()
    return row!
  }

  async function addPtSession(at: Studio, teacher: Staff, startsAt: Date) {
    const [row] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: at.id,
        instructorId: teacher.staffId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        sessionType: '1on1',
        capacityOnline: 1,
        scheduledAt: new Date(),
        scheduledByStaffId: teacher.staffId,
      })
      .returning()
    return row!
  }

  async function addCorporateSession(at: Studio, teacher: Staff, startsAt: Date) {
    const [pkg] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: at.id, name: CORPORATE_PACKAGE_NAME, priceSgd: '1000.00', createdByStaffId: teacher.staffId })
      .returning({ id: schema.corporatePackages.id })
    const [row] = await harness.db
      .insert(schema.corporateSessions)
      .values({
        tenantId: at.id,
        corporatePackageId: pkg!.id,
        clientName: `Corporate client ${run}`,
        mainInstructorId: teacher.staffId,
        locationText: 'Off-site',
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        createdByStaffId: teacher.staffId,
      })
      .returning()
    return row!
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    originalPolicy.set(one.id, await snapshotPolicy(one.id))
    originalPolicy.set(two.id, await snapshotPolicy(two.id))
    adminAtOne = await staff(one, 'Admin One', 'admin')
    adminAtTwo = await staff(two, 'Admin Two', 'admin')
  })

  after(async () => {
    if (!harness) return
    try {
      await restorePolicy()
    } finally {
      const ours = `%@${DOMAIN}`
      const tag = `%${run}%`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const classIds = sql`SELECT id FROM classes WHERE created_by_staff_id IN (${staffIds})`
      await harness.db.execute(sql`DELETE FROM leave_requests WHERE instructor_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM leave_pools WHERE instructor_id IN (${staffIds})`)
      await harness.db.execute(
        sql`DELETE FROM leave_conflicts WHERE instructor_a_id IN (${staffIds}) OR instructor_b_id IN (${staffIds})`,
      )
      await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'classId' IN (SELECT id::text FROM (${classIds}) c)`)
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM check_ins WHERE booking_id IN (SELECT id FROM bookings WHERE client_id IN (${clients}))`)
      await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM pt_sessions WHERE scheduled_by_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM corporate_sessions WHERE created_by_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM corporate_packages WHERE created_by_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      // Submissions email every admin of the studio, seeded ones included; each
      // of those carries this run's tag in the reason or the instructor's name.
      await harness.db.execute(
        sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}
            OR (tenant_id IN (${one.id}, ${two.id}) AND (body_rendered LIKE ${tag} OR subject_rendered LIKE ${tag}))`,
      )
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
      await harness.close()
    }
  })

  // ── the happy path ──────────────────────────────────────────────────────

  test('LEV-26 a free instructor files annual leave: a pending request recording the Leave Year it counts against', async () => {
    const ivy = await instructor(one, 'Ivy Happy')
    const start = dayOf(40)
    const end = dayOf(42)

    const res = await submit(ivy, { type: 'annual', start_date: start, end_date: end })

    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.status, 'pending')
    assert.equal(res.body.type, 'annual')
    assert.equal(res.body.start_date, start)
    assert.equal(res.body.end_date, end)
    assert.equal(res.body.days, 3)
    assert.equal(res.body.leave_year, YEAR)

    const [row] = await leaveRowsOf(ivy)
    assert.equal(row?.id, res.body.id)
    assert.equal(row?.status, 'pending')
    assert.equal(row?.leaveYear, YEAR)
    assert.equal(row?.tenantId, one.id)

    // A range over new year counts wholly against the year it STARTS in.
    const overNewYear = await submit(ivy, { type: 'annual', start_date: `${YEAR}-12-30`, end_date: `${YEAR + 1}-01-02` })
    assert.equal(overNewYear.status, 201, JSON.stringify(overNewYear.body))
    assert.equal(overNewYear.body.leave_year, YEAR)
    assert.equal(overNewYear.body.days, 4)

    // His own page counts both against that year's annual Pool, as pending.
    const own = await call(ivy, 'GET', `/api/v1/portal/instructor/leave?year=${YEAR}`)
    assert.equal(own.status, 200, JSON.stringify(own.body))
    const annual = own.body.balances.find((b: { type: string }) => b.type === 'annual')
    assert.equal(annual.pool_days, 14)
    assert.equal(annual.pending_days, 7)
    assert.equal(annual.remaining_days, 7)
    const nextYear = await call(ivy, 'GET', `/api/v1/portal/instructor/leave?year=${YEAR + 1}`)
    const nextAnnual = nextYear.body.balances.find((b: { type: string }) => b.type === 'annual')
    assert.equal(nextAnnual.pending_days, 0, 'the request spilling into next year does not draw on next year')
  })

  // ── who may file ────────────────────────────────────────────────────────

  test('a member cannot reach the instructor leave route at all', async () => {
    const email = emailFor('Member Mo')
    const headers = await harness.signInAs('client', email, one)
    const res = await call({ headers }, 'POST', '/api/v1/portal/instructor/leave', {
      type: 'annual',
      start_date: dayOf(50),
      end_date: dayOf(50),
      reason: `member ${run}`,
    })
    assert.equal(res.status, 401, JSON.stringify(res.body))
    const filed = await harness.db
      .select()
      .from(schema.leaveRequests)
      .where(and(eq(schema.leaveRequests.tenantId, one.id), eq(schema.leaveRequests.startDate, dayOf(50))))
    assert.equal(filed.length, 0)
  })

  test('an admin with no instructor row passes the role gate but is refused leave: admins have no leave', async () => {
    const res = await submit(adminAtOne, { type: 'annual', start_date: dayOf(51) })
    assert.equal(res.status, 403, JSON.stringify(res.body))
    assert.equal(res.body.error, 'not_an_instructor')
    assert.equal((await leaveRowsOf(adminAtOne)).length, 0)

    const own = await call(adminAtOne, 'GET', '/api/v1/portal/instructor/leave')
    assert.equal(own.status, 403, JSON.stringify(own.body))
  })

  // ── the Pool ────────────────────────────────────────────────────────────

  test('LEV-42, LEV-41, LEV-40 a second request that fits the Pool alone but not beside the pending one is refused; exactly the Remaining is accepted', async () => {
    const pat = await instructor(one, 'Pat Pending', { annual: 5 })

    const firstRes = await submit(pat, { type: 'annual', start_date: dayOf(60), end_date: dayOf(62) })
    assert.equal(firstRes.status, 201, JSON.stringify(firstRes.body))

    // 3 days fits a 5-day Pool on its own; with 3 already pending, 2 remain.
    const second = await submit(pat, { type: 'annual', start_date: dayOf(70), end_date: dayOf(72) })
    assert.equal(second.status, 400, JSON.stringify(second.body))
    assert.equal(second.body.error, 'insufficient_leave_balance')
    assert.match(second.body.message, /2 remaining/)
    assert.match(second.body.message, /5 days/)
    assert.match(second.body.message, /pending requests both count/)
    assert.equal((await leaveRowsOf(pat)).length, 1)

    // Exactly the Remaining is fine.
    const exact = await submit(pat, { type: 'annual', start_date: dayOf(70), end_date: dayOf(71) })
    assert.equal(exact.status, 201, JSON.stringify(exact.body))
    const own = await call(pat, 'GET', `/api/v1/portal/instructor/leave?year=${YEAR}`)
    const annual = own.body.balances.find((b: { type: string }) => b.type === 'annual')
    assert.equal(annual.remaining_days, 0)
  })

  test('LEV-44 two requests that each fit but not together, sent at once: exactly one is accepted and Committed stays within the Pool', async () => {
    const quinn = await instructor(one, 'Quinn Race', { annual: 3 })

    const results = await Promise.all([
      submit(quinn, { type: 'annual', start_date: dayOf(80), end_date: dayOf(81) }),
      submit(quinn, { type: 'annual', start_date: dayOf(90), end_date: dayOf(91) }),
    ])

    const accepted = results.filter(r => r.status === 201)
    const refused = results.filter(r => r.status !== 201)
    assert.equal(accepted.length, 1, JSON.stringify(results))
    assert.equal(refused.length, 1, JSON.stringify(results))
    assert.equal(refused[0]!.status, 400, JSON.stringify(refused[0]!.body))
    assert.equal(refused[0]!.body.error, 'insufficient_leave_balance')

    const rows = await leaveRowsOf(quinn)
    assert.equal(rows.length, 1)
    const committed = rows
      .filter(r => r.status === 'pending' || r.status === 'approved')
      .reduce((sum, r) => sum + Number(r.days), 0)
    assert.ok(committed <= 3, `Committed ${committed} exceeds the 3-day Pool`)
  })

  test('LEV-45 two different instructors filing at the same moment are both accepted', async () => {
    const rae = await instructor(one, 'Rae Parallel')
    const sol = await instructor(one, 'Sol Parallel')

    const [a, b] = await Promise.all([
      submit(rae, { type: 'annual', start_date: dayOf(100), end_date: dayOf(104) }),
      submit(sol, { type: 'annual', start_date: dayOf(100), end_date: dayOf(104) }),
    ])

    assert.equal(a.status, 201, JSON.stringify(a.body))
    assert.equal(b.status, 201, JSON.stringify(b.body))
    assert.equal((await leaveRowsOf(rae)).length, 1)
    assert.equal((await leaveRowsOf(sol)).length, 1)
    for (const s of [rae, sol]) {
      const own = await call(s, 'GET', `/api/v1/portal/instructor/leave?year=${YEAR}`)
      const annual = own.body.balances.find((x: { type: string }) => x.type === 'annual')
      assert.equal(annual.pending_days, 5, "one instructor's request does not count against the other")
    }
  })

  // ── the clash rule ──────────────────────────────────────────────────────

  test('LEV-46 a submission refused for a clash after its balance was read leaves no leave row and no Pool behind', async () => {
    const tam = await instructor(one, 'Tam Rollback')
    // It must be THIS Leave Year: only its Pool is stored when first read (a
    // future year's is computed), so only its Pool can be left behind. Medical
    // leave may start today, and today is in this Leave Year on every day of
    // the year — any later date is next year's on 31 December. A class tonight
    // has yet to finish, so it clashes.
    const date = sgDate(0)
    const year = Number(date.slice(0, 4))
    await addClass(one, tam, sgAt(date, '23:00'))
    const pools = () =>
      harness.db
        .select()
        .from(schema.leavePools)
        .where(and(eq(schema.leavePools.instructorId, tam.staffId), eq(schema.leavePools.leaveYear, year)))
    assert.equal((await pools()).length, 0, 'no Pool before the submission')

    const res = await submit(tam, { type: 'medical', start_date: date })

    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'leave_clash')
    assert.equal((await leaveRowsOf(tam)).length, 0)
    assert.equal((await pools()).length, 0, 'the Pool read inside the refused transaction was rolled back with it')

    // The premise: the balance read for this year does store a Pool, so the
    // absence above is the rollback's doing and not a year that never stores one.
    const read = await call(tam, 'GET', `/api/v1/portal/instructor/leave?year=${year}`)
    assert.equal(read.status, 200, JSON.stringify(read.body))
    assert.equal((await pools()).length, 3, "a read outside a refused submission stores this year's Pool")
  })

  test('LEV-47 a future class, private session or corporate session on the dates refuses the leave as a clash', async () => {
    const uma = await instructor(one, 'Uma Busy')
    const cls = await addClass(one, uma, sgAt(dayOf(110), '10:00'))
    const pt = await addPtSession(one, uma, sgAt(dayOf(111), '10:00'))
    const corp = await addCorporateSession(one, uma, sgAt(dayOf(112), '10:00'))

    for (const [day, event, kind] of [
      [110, cls, 'class'],
      [111, pt, 'pt_session'],
      [112, corp, 'corporate_session'],
    ] as const) {
      const res = await submit(uma, { type: 'annual', start_date: dayOf(day) })
      assert.equal(res.status, 409, `${kind}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, 'leave_clash')
      assert.deepEqual(
        res.body.conflicts.map((c: { kind: string; id: string }) => [c.kind, c.id]),
        [[kind, event.id]],
      )
    }
    assert.equal((await leaveRowsOf(uma)).length, 0)
  })

  test('LEV-48 a clash refusal names each clashing event and its date', async () => {
    const vic = await instructor(one, 'Vic Named')
    const cls = await addClass(one, vic, sgAt(dayOf(120), '09:30'))
    const pt = await addPtSession(one, vic, sgAt(dayOf(121), '14:00'))
    const corp = await addCorporateSession(one, vic, sgAt(dayOf(122), '18:00'))

    const res = await submit(vic, { type: 'annual', start_date: dayOf(120), end_date: dayOf(123) })

    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.error, 'leave_clash')
    // Every event in the way, each with when it is.
    const named = new Map(
      res.body.conflicts.map((c: { kind: string; id: string; starts_at: string }) => [c.id, c]),
    ) as Map<string, { kind: string; starts_at: string }>
    assert.equal(named.size, 3)
    for (const [event, kind] of [
      [cls, 'class'],
      [pt, 'pt_session'],
      [corp, 'corporate_session'],
    ] as const) {
      const c = named.get(event.id)
      assert.ok(c, `the refusal names the ${kind}`)
      assert.equal(c.kind, kind)
      assert.equal(c.starts_at, event.startsAt.toISOString())
    }
    // And the sentence says what the first one is and when.
    const firstDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' }).format(
      cls.startsAt,
    )
    assert.match(res.body.message, new RegExp(`a class on ${firstDay}, 09:30`))
    assert.match(res.body.message, /\(and 2 more\)/)
    assert.match(res.body.message, /Cancel it before requesting leave\./)
  })

  test('LEV-49 a cancelled class on the dates does not block the leave', async () => {
    const wes = await instructor(one, 'Wes Cancelled')
    await addClass(one, wes, sgAt(dayOf(130), '10:00'), 'cancelled')

    const res = await submit(wes, { type: 'annual', start_date: dayOf(130) })

    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal((await leaveRowsOf(wes)).length, 1)
  })

  test('LEV-38 medical leave starting seven days back is accepted; eight days back is refused', async () => {
    const zoe = await instructor(one, 'Zoe Backdate')

    const tooFar = await submit(zoe, { type: 'medical', start_date: sgDate(-8) })
    assert.equal(tooFar.status, 400, JSON.stringify(tooFar.body))
    assert.equal(tooFar.body.error, 'medical_leave_backdated_too_far')
    assert.equal((await leaveRowsOf(zoe)).length, 0)

    const edge = await submit(zoe, { type: 'medical', start_date: sgDate(-7) })
    assert.equal(edge.status, 201, JSON.stringify(edge.body))
    assert.equal(edge.body.start_date, sgDate(-7))
    assert.equal(edge.body.status, 'pending')
  })

  test('LEV-50 backdated medical leave over a class he already taught is accepted, and the class, attendance, check-in and pay stand', async () => {
    const xia = await instructor(one, 'Xia Backdated')
    const date = sgDate(-2)
    const cls = await addClass(one, xia, sgAt(date, '10:00'))

    // One member who came, and was checked in.
    const email = emailFor('Member Attended')
    await harness.signInAs('client', email, one)
    const [authUser] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: one.id, email, name: `Member ${run}`, phone: '+6580000000', authUserId: authUser!.id })
      .returning({ id: schema.clients.id })
    const [booking] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: one.id,
        clientId: client!.id,
        kind: 'class',
        classId: cls.id,
        creditsOrSessionsUsed: 1,
        checkInState: 'attended',
        qrToken: randomUUID(),
        code: run.slice(-6).toUpperCase(),
      })
      .returning()
    const [checkIn] = await harness.db
      .insert(schema.checkIns)
      .values({ tenantId: one.id, bookingId: booking!.id, checkedInByStaffId: xia.staffId, method: 'manual' })
      .returning()

    const res = await submit(xia, { type: 'medical', start_date: date })

    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.type, 'medical')
    assert.equal(res.body.status, 'pending')

    const [classAfter] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, cls.id))
    assert.deepEqual(classAfter, cls, 'the class, including its lifecycle and pay, is untouched')
    const [bookingAfter] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, booking!.id))
    assert.deepEqual(bookingAfter, booking, 'the attendance is untouched')
    const checkInsAfter = await harness.db
      .select()
      .from(schema.checkIns)
      .where(eq(schema.checkIns.bookingId, booking!.id))
    assert.deepEqual(checkInsAfter, [checkIn], 'the check-in is untouched')
  })

  test('LEV-51 refused for his own class, he cancels it and the same dates are then accepted', async () => {
    const yan = await instructor(one, 'Yan Clears')
    const cls = await addClass(one, yan, sgAt(dayOf(140), '10:00'))
    const leave = { type: 'annual', start_date: dayOf(140) } as const

    const refused = await submit(yan, leave)
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.error, 'leave_clash')

    const cancelled = await call(yan, 'POST', `/api/v1/portal/instructor/schedule/classes/${cls.id}/cancel`, {
      reason: `clearing for leave ${run}`,
    })
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))

    const accepted = await submit(yan, leave)
    assert.equal(accepted.status, 201, JSON.stringify(accepted.body))
    assert.equal((await leaveRowsOf(yan)).length, 1)
  })

  // ── Leave Conflicts ─────────────────────────────────────────────────────

  test('LEV-52 with a declared partner away, annual and study leave on that full day, or on the same half of it, are refused naming the partner verbatim', async () => {
    const eve = await instructor(one, 'Eve Applicant')
    const fin = await instructor(one, 'Fin Away')
    try {
      await declarePairs([[eve, fin]])
      // Fin is away all of one day, and the morning of the next.
      const fullDay = dayOf(155)
      const halfDay = dayOf(156)
      assert.equal((await submit(fin, { type: 'annual', start_date: fullDay })).status, 201)
      const finMorning = await submit(fin, { type: 'annual', start_date: halfDay, half_day: 'morning' })
      assert.equal(finMorning.status, 201, JSON.stringify(finMorning.body))

      for (const type of ['annual', 'study'] as const) {
        for (const [label, leave] of [
          ['the same full day', { type, start_date: fullDay }],
          ['the same half day', { type, start_date: halfDay, half_day: 'morning' }],
        ] as const) {
          const res = await submit(eve, leave)
          assert.equal(res.status, 409, `${type} on ${label}: ${JSON.stringify(res.body)}`)
          assert.equal(res.body.error, 'leave_conflict', `${type} on ${label}`)
          assert.equal(
            res.body.message,
            `${fin.name} is already on leave on ${leaveDateLabel(leave.start_date)}. ` +
              `You and ${fin.name} cannot be away at the same time.`,
            `${type} on ${label}`,
          )
        }
      }
      assert.equal((await leaveRowsOf(eve)).length, 0)
    } finally {
      await restorePolicy()
    }
  })

  test('LEV-55 a pair declared either way round is one row and refuses identically, from either side', async () => {
    const ada = await instructor(one, 'Ada Pair')
    const ben = await instructor(one, 'Ben Pair')
    const [lower, higher] = ada.staffId < ben.staffId ? [ada, ben] : [ben, ada]
    try {
      // Ben is away on day 150.
      const away = await submit(ben, { type: 'annual', start_date: dayOf(150) })
      assert.equal(away.status, 201, JSON.stringify(away.body))

      const refusals: string[] = []
      for (const order of [
        [higher, lower],
        [lower, higher],
      ] as [Staff, Staff][]) {
        await declarePairs([order])
        const stored = await harness.db
          .select()
          .from(schema.leaveConflicts)
          .where(
            and(
              eq(schema.leaveConflicts.tenantId, one.id),
              inArray(schema.leaveConflicts.instructorAId, [ada.staffId, ben.staffId]),
            ),
          )
        assert.equal(stored.length, 1, 'one row for the pair')
        assert.equal(stored[0]!.instructorAId, lower.staffId, 'lower id first, whichever way it was picked')
        assert.equal(stored[0]!.instructorBId, higher.staffId)

        const res = await submit(ada, { type: 'annual', start_date: dayOf(150) })
        assert.equal(res.status, 409, JSON.stringify(res.body))
        assert.equal(res.body.error, 'leave_conflict')
        refusals.push(res.body.message)
      }
      assert.equal(refusals[0], refusals[1], 'the declared order changes nothing about the refusal')
      assert.equal(
        refusals[0],
        `${ben.name} is already on leave on ${leaveDateLabel(dayOf(150))}. ` +
          `You and ${ben.name} cannot be away at the same time.`,
      )
      assert.equal((await leaveRowsOf(ada)).length, 0)

      // From the other side: Ada away on day 151, Ben asking for it.
      const adaAway = await submit(ada, { type: 'annual', start_date: dayOf(151) })
      assert.equal(adaAway.status, 201, JSON.stringify(adaAway.body))
      const fromBen = await submit(ben, { type: 'annual', start_date: dayOf(151) })
      assert.equal(fromBen.status, 409, JSON.stringify(fromBen.body))
      assert.equal(
        fromBen.body.message,
        `${ada.name} is already on leave on ${leaveDateLabel(dayOf(151))}. ` +
          `You and ${ada.name} cannot be away at the same time.`,
      )

      // Both orders at once are the same pair twice — refused, nothing changes.
      const twice = await call(adminAtOne, 'PATCH', '/api/v1/portal/admin/policy/global', {
        leave_conflicts: [
          ...originalPairsBody(),
          { instructor_a_id: ada.staffId, instructor_b_id: ben.staffId },
          { instructor_a_id: ben.staffId, instructor_b_id: ada.staffId },
        ],
      })
      assert.equal(twice.status, 400, JSON.stringify(twice.body))
      assert.equal(twice.body.error, 'duplicate_leave_conflict')

      // And the table itself will not hold the reversed row beside it.
      await assert.rejects(
        harness.db
          .insert(schema.leaveConflicts)
          .values({ tenantId: one.id, instructorAId: higher.staffId, instructorBId: lower.staffId }),
      )
      await assert.rejects(
        harness.db
          .insert(schema.leaveConflicts)
          .values({ tenantId: one.id, instructorAId: lower.staffId, instructorBId: higher.staffId }),
      )
    } finally {
      await restorePolicy()
    }
  })

  test("LEV-56 an archived partner's declaration refuses nothing", async () => {
    const cy = await instructor(one, 'Cy Applicant')
    const dee = await instructor(one, 'Dee Archived')
    try {
      await declarePairs([[cy, dee]])
      const away = await submit(dee, { type: 'annual', start_date: dayOf(160) })
      assert.equal(away.status, 201, JSON.stringify(away.body))

      // While Dee is active, the pair holds.
      const before = await submit(cy, { type: 'annual', start_date: dayOf(160) })
      assert.equal(before.status, 409, JSON.stringify(before.body))
      assert.equal(before.body.error, 'leave_conflict')

      await harness.db
        .update(schema.staffUsers)
        .set({ status: 'archived', archivedAt: new Date(), archivedByStaffId: adminAtOne.staffId })
        .where(eq(schema.staffUsers.id, dee.staffId))

      const afterArchive = await submit(cy, { type: 'annual', start_date: dayOf(160) })
      assert.equal(afterArchive.status, 201, JSON.stringify(afterArchive.body))
    } finally {
      await restorePolicy()
    }
  })

  test('LEV-64 a declared pair filing overlapping leave at the same moment: exactly one is accepted, the other refused as a Leave Conflict', async () => {
    const eli = await instructor(one, 'Eli Racer')
    const fay = await instructor(one, 'Fay Racer')
    try {
      await declarePairs([[eli, fay]])

      const results = await Promise.all([
        submit(eli, { type: 'annual', start_date: dayOf(170), end_date: dayOf(171) }),
        submit(fay, { type: 'annual', start_date: dayOf(171), end_date: dayOf(172) }),
      ])

      const accepted = results.filter(r => r.status === 201)
      const refused = results.filter(r => r.status !== 201)
      assert.equal(accepted.length, 1, JSON.stringify(results))
      assert.equal(refused.length, 1, JSON.stringify(results))
      assert.equal(refused[0]!.status, 409, JSON.stringify(refused[0]!.body))
      assert.equal(refused[0]!.body.error, 'leave_conflict')

      const rows = [...(await leaveRowsOf(eli)), ...(await leaveRowsOf(fay))]
      assert.equal(rows.length, 1, 'only the accepted request exists')
      assert.equal(rows[0]!.id, accepted[0]!.body.id)
    } finally {
      await restorePolicy()
    }
  })

  // ── the study Leave Cap ─────────────────────────────────────────────────

  test('LEV-120, LEV-57 one study place left and two unpaired instructors racing for it: exactly one is accepted, the other refused naming nobody', async () => {
    const gus = await instructor(one, 'Gus Studying')
    const hal = await instructor(one, 'Hal Racer')
    const ina = await instructor(one, 'Ina Racer')
    try {
      await setPolicy({ study_leave_cap: 2 })
      const first = await submit(gus, { type: 'study', start_date: dayOf(180) })
      assert.equal(first.status, 201, JSON.stringify(first.body))

      const results = await Promise.all([
        submit(hal, { type: 'study', start_date: dayOf(180) }),
        submit(ina, { type: 'study', start_date: dayOf(179), end_date: dayOf(180) }),
      ])

      const accepted = results.filter(r => r.status === 201)
      const refused = results.filter(r => r.status !== 201)
      assert.equal(accepted.length, 1, JSON.stringify(results))
      assert.equal(refused.length, 1, JSON.stringify(results))
      assert.equal(refused[0]!.status, 409, JSON.stringify(refused[0]!.body))
      assert.equal(refused[0]!.body.error, 'leave_cap_reached')
      assert.equal(
        refused[0]!.body.message,
        `The most instructors who can be on study leave at once is already reached on ${leaveDateLabel(dayOf(180))}.`,
      )
      for (const s of [gus, hal, ina]) assert.ok(!refused[0]!.body.message.includes(s.name))

      const onStudy = await harness.db
        .select()
        .from(schema.leaveRequests)
        .where(
          and(
            eq(schema.leaveRequests.tenantId, one.id),
            eq(schema.leaveRequests.type, 'study'),
            inArray(schema.leaveRequests.instructorId, [gus.staffId, hal.staffId, ina.staffId]),
          ),
        )
      assert.equal(onStudy.length, 2, 'the cap of 2 is never exceeded')
    } finally {
      await restorePolicy()
    }
  })

  // ── another studio ──────────────────────────────────────────────────────

  test("another studio's leave, assignments and declared pairs never block or count against this studio's instructor", async () => {
    const jo = await instructor(one, 'Jo Home')
    const kit = await instructor(two, 'Kit Elsewhere')
    const lou = await instructor(two, 'Lou Elsewhere')
    try {
      // Studio two: study cap 1, Kit already on study leave on day 190 and
      // teaching a class there, and a pair Kit–Lou declared.
      await harness.db
        .update(schema.globalPolicy)
        .set({ studyLeaveCap: 1 })
        .where(eq(schema.globalPolicy.tenantId, two.id))
      const declaredAtTwo = await call(adminAtTwo, 'PATCH', '/api/v1/portal/admin/policy/global', {
        leave_conflicts: [
          ...originalPolicy.get(two.id)!.pairs.map(p => ({ instructor_a_id: p.instructorAId, instructor_b_id: p.instructorBId })),
          { instructor_a_id: kit.staffId, instructor_b_id: lou.staffId },
        ],
      })
      assert.equal(declaredAtTwo.status, 200, JSON.stringify(declaredAtTwo.body))
      const kitAway = await submit(kit, { type: 'study', start_date: dayOf(190) })
      assert.equal(kitAway.status, 201, JSON.stringify(kitAway.body))
      await addClass(two, kit, sgAt(dayOf(191), '10:00'))
      // A row studio two holds that names studio one's instructor — the kind of
      // stray a missing tenant filter would read as a real declaration.
      await harness.db.insert(schema.leaveConflicts).values(
        jo.staffId < kit.staffId
          ? { tenantId: two.id, instructorAId: jo.staffId, instructorBId: kit.staffId }
          : { tenantId: two.id, instructorAId: kit.staffId, instructorBId: jo.staffId },
      )

      // Studio one: study cap 1 too.
      await setPolicy({ study_leave_cap: 1 })

      const res = await submit(jo, { type: 'study', start_date: dayOf(190), end_date: dayOf(191) })
      assert.equal(res.status, 201, JSON.stringify(res.body))

      const own = await call(jo, 'GET', `/api/v1/portal/instructor/leave?year=${YEAR}`)
      const study = own.body.balances.find((b: { type: string }) => b.type === 'study')
      assert.equal(study.pending_days, 2, "only Jo's own request counts against Jo's Pool")
      assert.ok(!own.body.requests.some((r: { id: string }) => r.id === kitAway.body.id))

      // And studio two's request id is nothing to him.
      for (const action of ['withdraw', 'cancel']) {
        const acted = await call(jo, 'POST', `/api/v1/portal/instructor/leave/${kitAway.body.id}/${action}`)
        assert.equal(acted.status, 404, `${action}: ${JSON.stringify(acted.body)}`)
      }
      const [kitRow] = await harness.db
        .select()
        .from(schema.leaveRequests)
        .where(eq(schema.leaveRequests.id, kitAway.body.id))
      assert.equal(kitRow?.status, 'pending', "studio two's request is untouched")
    } finally {
      await restorePolicy()
    }
  })
})
