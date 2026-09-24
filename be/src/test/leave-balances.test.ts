import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.leavebal.test`

const LEAVE_TYPES = ['annual', 'medical', 'study'] as const
type LeaveType = (typeof LEAVE_TYPES)[number]

/**
 * Leave Pools, balances, Assigned Days, the carry-over cap and the Global Policy
 * leave settings, over real HTTP against a real Postgres (#204).
 *
 * The routes: the instructor's own `GET /portal/instructor/leave`, the admin
 * staff profile (`/portal/admin/staff`, which carries Assigned Days and this
 * Leave Year's figures), and the admin Global Policy (`/portal/admin/policy`).
 *
 * The leave service reads the wall clock (`new Date()`), not `lib/clock`, so a
 * year boundary cannot be staged here. Year-boundary rules are proved with
 * fixture data instead: a Pool stored for LAST Leave Year, and the current year
 * left unopened, is exactly "a new Leave Year has begun and no Pool exists".
 *
 * Global Policy is one row per studio and other files read it, so every test
 * that changes it snapshots it first and puts it back in a `finally`.
 */
describe('leave balances and pools over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  type Studio = { id: string; slug: string }
  type Staff = { staffId: string; email: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio
  let adminAtOne!: Staff
  let officeAtOne!: Staff // a second admin: a staff member with no leave concept
  let adminAtTwo!: Staff
  let memberAtOne!: { headers: Record<string, string> }
  /** The Leave Year Singapore is in right now. */
  let Y!: number

  let seq = 0
  const emailFor = (name: string, at: Studio) =>
    `${name.toLowerCase().replace(/\s+/g, '-')}-${at.slug}-${++seq}@${DOMAIN}`

  async function staff(
    at: Studio,
    name: string,
    role: 'admin' | 'instructor',
    status: 'active' | 'archived' = 'active',
  ): Promise<Staff> {
    const email = emailFor(name, at)
    const headers = await harness.signInAs('staff', email, at)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status, authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    // Column defaults only: an instructor as onboarding leaves them, no leave edits.
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    }
    return { staffId: row!.id, email, headers }
  }

  const instructor = (name: string, at: Studio = one) => staff(at, name, 'instructor')

  async function member(at: Studio, name: string) {
    const email = emailFor(name, at)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
    return { headers }
  }

  // ── Fixtures written straight to the database ─────────────────────────────

  /** A stored Pool — how a Leave Year that was opened before looks. */
  async function storePool(at: Studio, who: Staff, year: number, days: Record<LeaveType, number>, carried = 0) {
    await harness.db.insert(schema.leavePools).values(
      LEAVE_TYPES.map(type => ({
        tenantId: at.id,
        instructorId: who.staffId,
        type,
        leaveYear: year,
        days: days[type].toFixed(1),
        carriedDays: (type === 'annual' ? carried : 0).toFixed(1),
      })),
    )
  }

  /** A Leave Request row, as the submission and decision paths would have left it. */
  async function storeRequest(
    at: Studio,
    who: Staff,
    r: {
      type: LeaveType
      start: string
      end?: string
      days: number
      status: 'pending' | 'approved'
      halfDay?: 'none' | 'morning' | 'afternoon'
    },
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.leaveRequests)
      .values({
        tenantId: at.id,
        instructorId: who.staffId,
        type: r.type,
        startDate: r.start,
        endDate: r.end ?? r.start,
        halfDay: r.halfDay ?? 'none',
        days: r.days.toFixed(1),
        leaveYear: Number(r.start.slice(0, 4)),
        status: r.status,
        reason: `fixture ${run}`,
        ...(r.status === 'approved'
          ? { decidedByStaffId: at.id === one.id ? adminAtOne.staffId : adminAtTwo.staffId, decidedAt: new Date() }
          : {}),
      })
      .returning({ id: schema.leaveRequests.id })
    return row!.id
  }

  const poolRows = (who: Staff, year: number) =>
    harness.db
      .select()
      .from(schema.leavePools)
      .where(and(eq(schema.leavePools.instructorId, who.staffId), eq(schema.leavePools.leaveYear, year)))

  async function storedPools(who: Staff, year: number): Promise<Record<string, { days: number; carried: number }>> {
    const out: Record<string, { days: number; carried: number }> = {}
    for (const r of await poolRows(who, year)) out[r.type] = { days: Number(r.days), carried: Number(r.carriedDays) }
    return out
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  type Balance = {
    type: LeaveType
    assigned_days: number
    carried_days: number
    pool_days: number
    taken_days: number
    pending_days: number
    remaining_days: number
  }
  type OwnLeave = { leave_year: number; balances: Balance[]; requests: { id: string; leave_year: number }[] }

  async function call(headers: Record<string, string>, method: string, path: string, body?: unknown) {
    const res = await harness.app.request(path, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let parsed: any = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    return { status: res.status, body: parsed }
  }

  async function ownLeave(who: Staff, year?: number): Promise<OwnLeave> {
    const res = await call(who.headers, 'GET', `/api/v1/portal/instructor/leave${year === undefined ? '' : `?year=${year}`}`)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body as OwnLeave
  }

  const balanceOf = (leave: OwnLeave, type: LeaveType): Balance => {
    const b = leave.balances.find(x => x.type === type)
    assert.ok(b, `a ${type} balance`)
    return b
  }

  async function staffList(admin: Staff): Promise<any[]> {
    const res = await call(admin.headers, 'GET', '/api/v1/portal/admin/staff')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body.staff as any[]
  }

  async function profileOf(admin: Staff, target: Staff): Promise<any> {
    const row = (await staffList(admin)).find(s => s.id === target.staffId)
    assert.ok(row, `the staff list carries ${target.email}`)
    return row
  }

  const patchStaff = (admin: Staff, target: Staff, body: Record<string, unknown>) =>
    call(admin.headers, 'PATCH', `/api/v1/portal/admin/staff/${target.staffId}`, body)

  const readPolicy = (who: { headers: Record<string, string> }) => call(who.headers, 'GET', '/api/v1/portal/admin/policy')
  const patchPolicy = (who: { headers: Record<string, string> }, body: Record<string, unknown>) =>
    call(who.headers, 'PATCH', '/api/v1/portal/admin/policy/global', body)

  async function assigned(who: Staff) {
    const [row] = await harness.db
      .select()
      .from(schema.instructors)
      .where(eq(schema.instructors.staffUserId, who.staffId))
    assert.ok(row)
    return { annual: row.annualLeaveDays, medical: row.medicalLeaveDays, study: row.studyLeaveDays }
  }

  // ── Global Policy snapshot / restore ──────────────────────────────────────

  type PolicySnapshot = {
    row: typeof import('../db/schema').globalPolicy.$inferSelect
    conflicts: { instructorAId: string; instructorBId: string }[]
  }

  async function snapshotPolicy(at: Studio): Promise<PolicySnapshot> {
    const [row] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, at.id))
    assert.ok(row, `a seeded policy for ${at.slug}`)
    const conflicts = await harness.db
      .select({ instructorAId: schema.leaveConflicts.instructorAId, instructorBId: schema.leaveConflicts.instructorBId })
      .from(schema.leaveConflicts)
      .where(eq(schema.leaveConflicts.tenantId, at.id))
    return { row, conflicts }
  }

  async function restorePolicy(at: Studio, snap: PolicySnapshot) {
    await harness.db
      .update(schema.globalPolicy)
      .set({
        leaveCarryOverCapDays: snap.row.leaveCarryOverCapDays,
        studyLeaveCap: snap.row.studyLeaveCap,
        updatedAt: snap.row.updatedAt,
        updatedByStaffId: snap.row.updatedByStaffId,
      })
      .where(eq(schema.globalPolicy.tenantId, at.id))
    const key = (p: { instructorAId: string; instructorBId: string }) => `${p.instructorAId}:${p.instructorBId}`
    const now = (await snapshotPolicy(at)).conflicts.map(key).sort().join(',')
    if (now !== snap.conflicts.map(key).sort().join(',')) {
      await harness.db.delete(schema.leaveConflicts).where(eq(schema.leaveConflicts.tenantId, at.id))
      if (snap.conflicts.length > 0)
        await harness.db.insert(schema.leaveConflicts).values(snap.conflicts.map(p => ({ ...p, tenantId: at.id })))
    }
  }

  /** Run `fn` with this studio's Global Policy put back afterwards, pass or fail. */
  async function withPolicyRestored<T>(at: Studio, fn: (snap: PolicySnapshot) => Promise<T>): Promise<T> {
    const snap = await snapshotPolicy(at)
    try {
      return await fn(snap)
    } finally {
      await restorePolicy(at, snap)
    }
  }

  const setCap = async (days: number) => {
    const res = await patchPolicy(adminAtOne, { leave_carry_over_cap_days: days })
    assert.equal(res.status, 200, JSON.stringify(res.body))
  }

  let originalPolicyOne!: PolicySnapshot
  let originalPolicyTwo!: PolicySnapshot

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    const { sgToday } = await import('../lib/time')
    Y = Number(sgToday(new Date()).slice(0, 4))

    one = harness.tenants.one
    two = harness.tenants.two
    adminAtOne = await staff(one, 'lead', 'admin')
    officeAtOne = await staff(one, 'office', 'admin')
    adminAtTwo = await staff(two, 'lead', 'admin')
    memberAtOne = await member(one, 'Mia Member')
    originalPolicyOne = await snapshotPolicy(one)
    originalPolicyTwo = await snapshotPolicy(two)
  })

  after(async () => {
    if (!harness) return
    // Belt and braces: the policy exactly as this file found it, in both studios.
    if (originalPolicyOne) await restorePolicy(one, originalPolicyOne)
    if (originalPolicyTwo) await restorePolicy(two, originalPolicyTwo)
    const ours = `%@${DOMAIN}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`UPDATE global_policy SET updated_by_staff_id = NULL WHERE updated_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM leave_requests WHERE instructor_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM leave_pools WHERE instructor_id IN (${staffIds})`)
    await harness.db.execute(
      sql`DELETE FROM leave_conflicts WHERE instructor_a_id IN (${staffIds}) OR instructor_b_id IN (${staffIds})`,
    )
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  // ── Instructor: own balances ──────────────────────────────────────────────

  test('LEV-13, LEV-03 an instructor reads their own balances: Assigned, Carried, Pool, Taken, pending, Remaining per type, no allowance', async () => {
    const ivy = await instructor('Ivy Fresh')

    const leave = await ownLeave(ivy)

    assert.equal(leave.leave_year, Y)
    assert.deepEqual(
      leave.balances.map(b => b.type).sort(),
      [...LEAVE_TYPES].sort(),
    )
    for (const b of leave.balances) {
      assert.deepEqual(
        Object.keys(b).sort(),
        ['assigned_days', 'carried_days', 'pending_days', 'pool_days', 'remaining_days', 'taken_days', 'type'],
      )
    }
    assert.ok(!JSON.stringify(leave).includes('allowance'), 'no allowance field anywhere in the response')
    // No previous-year Pool: the Pool is Assigned alone — no carry, no pro-rating
    // for someone who joined mid-year.
    assert.deepEqual(balanceOf(leave, 'annual'), {
      type: 'annual', assigned_days: 14, carried_days: 0, pool_days: 14, taken_days: 0, pending_days: 0, remaining_days: 14,
    })
    assert.deepEqual(balanceOf(leave, 'medical'), {
      type: 'medical', assigned_days: 14, carried_days: 0, pool_days: 14, taken_days: 0, pending_days: 0, remaining_days: 14,
    })
    assert.deepEqual(balanceOf(leave, 'study'), {
      type: 'study', assigned_days: 7, carried_days: 0, pool_days: 7, taken_days: 0, pending_days: 0, remaining_days: 7,
    })
  })

  test('LEV-03 a mid-year joiner with non-default Assigned Days gets their full Assigned figure as the Pool', async () => {
    const jo = await instructor('Jo Joiner')
    await harness.db
      .update(schema.instructors)
      .set({ annualLeaveDays: 9, medicalLeaveDays: 5, studyLeaveDays: 3 })
      .where(eq(schema.instructors.staffUserId, jo.staffId))

    const leave = await ownLeave(jo)

    assert.equal(balanceOf(leave, 'annual').pool_days, 9)
    assert.equal(balanceOf(leave, 'medical').pool_days, 5)
    assert.equal(balanceOf(leave, 'study').pool_days, 3)
    assert.deepEqual(await storedPools(jo, Y), {
      annual: { days: 9, carried: 0 },
      medical: { days: 5, carried: 0 },
      study: { days: 3, carried: 0 },
    })
  })

  test('LEV-10, LEV-11 Remaining is Pool minus pending and approved; Taken counts approved only and pending is reported apart', async () => {
    const kai = await instructor('Kai Committed')
    await storeRequest(one, kai, { type: 'annual', start: `${Y}-01-05`, end: `${Y}-01-06`, days: 2, status: 'approved' })
    await storeRequest(one, kai, { type: 'annual', start: `${Y}-01-12`, days: 0.5, status: 'pending', halfDay: 'morning' })
    await storeRequest(one, kai, { type: 'annual', start: `${Y}-01-20`, days: 1, status: 'pending' })
    await storeRequest(one, kai, { type: 'medical', start: `${Y}-01-07`, days: 1, status: 'approved' })

    const leave = await ownLeave(kai)

    const annual = balanceOf(leave, 'annual')
    assert.equal(annual.taken_days, 2)
    assert.equal(annual.pending_days, 1.5)
    assert.equal(annual.remaining_days, 10.5)
    // Types kept apart: being ill does not eat into holiday.
    const medical = balanceOf(leave, 'medical')
    assert.equal(medical.taken_days, 1)
    assert.equal(medical.pending_days, 0)
    assert.equal(medical.remaining_days, 13)
  })

  test('LEV-12 an instructor Committed beyond their Pool sees a negative Remaining, not zero', async () => {
    const lee = await instructor('Lee Over')
    await storeRequest(one, lee, { type: 'annual', start: `${Y}-02-01`, end: `${Y}-02-15`, days: 15, status: 'approved' })

    const annual = balanceOf(await ownLeave(lee), 'annual')

    assert.equal(annual.pool_days, 14)
    assert.equal(annual.remaining_days, -1)
  })

  // ── Pool materialisation ──────────────────────────────────────────────────

  test('LEV-04, LEV-07, LEV-09 a new Leave Year with no Pool is opened on first read from Assigned plus capped Carried; medical and study never carry', async () => {
    await withPolicyRestored(one, async () => {
      await setCap(6)
      const max = await instructor('Max Rollover')
      // Last year, opened and part-spent: 20 annual Remaining (above the cap), and
      // untouched medical and study.
      await storePool(one, max, Y - 1, { annual: 22, medical: 14, study: 7 })
      await storeRequest(one, max, { type: 'annual', start: `${Y - 1}-03-02`, end: `${Y - 1}-03-03`, days: 2, status: 'approved' })
      assert.equal((await poolRows(max, Y)).length, 0, 'no Pool exists yet for this Leave Year')

      const leave = await ownLeave(max)

      assert.equal(leave.leave_year, Y)
      assert.deepEqual(
        { carried: balanceOf(leave, 'annual').carried_days, pool: balanceOf(leave, 'annual').pool_days },
        { carried: 6, pool: 20 },
      )
      assert.deepEqual(
        { carried: balanceOf(leave, 'medical').carried_days, pool: balanceOf(leave, 'medical').pool_days },
        { carried: 0, pool: 14 },
      )
      assert.deepEqual(
        { carried: balanceOf(leave, 'study').carried_days, pool: balanceOf(leave, 'study').pool_days },
        { carried: 0, pool: 7 },
      )
      // Written by the read itself — no scheduled job involved.
      assert.deepEqual(await storedPools(max, Y), {
        annual: { days: 20, carried: 6 },
        medical: { days: 14, carried: 0 },
        study: { days: 7, carried: 0 },
      })
    })
  })

  test('LEV-06 a previous-year annual Remaining below the cap carries in full', async () => {
    await withPolicyRestored(one, async () => {
      await setCap(10)
      const ned = await instructor('Ned Under')
      await storePool(one, ned, Y - 1, { annual: 5, medical: 14, study: 7 })
      await storeRequest(one, ned, { type: 'annual', start: `${Y - 1}-05-04`, end: `${Y - 1}-05-05`, days: 2, status: 'approved' })
      await storeRequest(one, ned, { type: 'annual', start: `${Y - 1}-06-01`, days: 0.5, status: 'pending', halfDay: 'afternoon' })

      const annual = balanceOf(await ownLeave(ned), 'annual')

      assert.equal(annual.carried_days, 2.5)
      assert.equal(annual.pool_days, 16.5)
    })
  })

  test('LEV-08 a previous-year annual Remaining below zero carries nothing, and no debt', async () => {
    await withPolicyRestored(one, async () => {
      await setCap(10)
      const ola = await instructor('Ola Debt')
      await storePool(one, ola, Y - 1, { annual: 2, medical: 14, study: 7 })
      await storeRequest(one, ola, { type: 'annual', start: `${Y - 1}-07-06`, end: `${Y - 1}-07-10`, days: 5, status: 'approved' })

      const annual = balanceOf(await ownLeave(ola), 'annual')

      assert.equal(annual.carried_days, 0)
      assert.equal(annual.pool_days, 14)
    })
  })

  test('LEV-05 two concurrent first reads create exactly one Pool per Leave Type and year, and agree', async () => {
    // A few instructors, so the race is run more than once.
    for (const name of ['Pia Race', 'Quin Race', 'Rex Race']) {
      const who = await instructor(name)
      assert.equal((await poolRows(who, Y)).length, 0)

      const [a, b] = await Promise.all([ownLeave(who), ownLeave(who)])

      assert.deepEqual(a.balances, b.balances)
      const rows = await poolRows(who, Y)
      assert.equal(rows.length, 3, `one row per Leave Type for ${name}`)
      assert.deepEqual(rows.map(r => r.type).sort(), [...LEAVE_TYPES].sort())
    }
  })

  // ── Admin: the staff profile ──────────────────────────────────────────────

  test('LEV-01 a newly onboarded instructor reads as 14 annual, 14 medical and 7 study Assigned Days on their staff profile', async () => {
    const sam = await instructor('Sam New')

    const profile = await profileOf(adminAtOne, sam)

    assert.equal(profile.annual_leave_days, 14)
    assert.equal(profile.medical_leave_days, 14)
    assert.equal(profile.study_leave_days, 7)
  })

  test('LEV-23 the staff profile carries Assigned, Carried, Pool and Remaining for an instructor, and no leave fields at all for anyone else', async () => {
    const tia = await instructor('Tia Figures')
    await storeRequest(one, tia, { type: 'study', start: `${Y}-03-03`, days: 1, status: 'approved' })

    const list = await staffList(adminAtOne)
    const teacher = list.find(s => s.id === tia.staffId)
    const office = list.find(s => s.id === officeAtOne.staffId)
    assert.ok(teacher && office)

    for (const type of LEAVE_TYPES) {
      for (const field of ['leave_days', 'carried_days', 'pool_days', 'remaining_days']) {
        assert.equal(typeof teacher[`${type}_${field}`], 'number', `${type}_${field} on the instructor`)
      }
    }
    assert.equal(teacher.study_pool_days, 7)
    assert.equal(teacher.study_remaining_days, 6)
    assert.equal(teacher.annual_carried_days, 0)
    const leaveKeys = Object.keys(office).filter(k => /leave|carried|pool|remaining/.test(k))
    assert.deepEqual(leaveKeys, [], 'a non-instructor has no leave keys — not even nulls')
  })

  test('LEV-02 an Assigned Days figure below 0 or above 365 is refused and nothing changes; 0 and 365 are accepted', async () => {
    const uma = await instructor('Uma Bounds')

    for (const body of [
      { annual_leave_days: -1 },
      { annual_leave_days: 366 },
      { medical_leave_days: -1 },
      { medical_leave_days: 366 },
      { study_leave_days: -1 },
      { study_leave_days: 366 },
      { annual_leave_days: 1.5 },
    ]) {
      const res = await patchStaff(adminAtOne, uma, body)
      assert.equal(res.status, 400, `${JSON.stringify(body)} → ${JSON.stringify(res.body)}`)
    }
    assert.deepEqual(await assigned(uma), { annual: 14, medical: 14, study: 7 })

    const ok = await patchStaff(adminAtOne, uma, { annual_leave_days: 0, medical_leave_days: 365, study_leave_days: 365 })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(ok.body.annual_leave_days, 0)
    assert.equal(ok.body.medical_leave_days, 365)
    assert.deepEqual(await assigned(uma), { annual: 0, medical: 365, study: 365 })
  })

  test('LEV-17 changing Assigned Days moves no opened Pool, current or past; the new figure first applies next Leave Year', async () => {
    await withPolicyRestored(one, async () => {
      await setCap(5)
      const vic = await instructor('Vic Assigned')
      // Open last year's Pool, then this year's (which carries min(5, 14) = 5).
      assert.equal(balanceOf(await ownLeave(vic, Y - 1), 'annual').pool_days, 14)
      assert.equal(balanceOf(await ownLeave(vic), 'annual').pool_days, 19)
      const pastBefore = await storedPools(vic, Y - 1)
      const currentBefore = await storedPools(vic, Y)

      const res = await patchStaff(adminAtOne, vic, { annual_leave_days: 20, medical_leave_days: 10, study_leave_days: 2 })
      assert.equal(res.status, 200, JSON.stringify(res.body))

      assert.deepEqual(await storedPools(vic, Y - 1), pastBefore)
      assert.deepEqual(await storedPools(vic, Y), currentBefore)
      const current = await ownLeave(vic)
      assert.equal(balanceOf(current, 'annual').pool_days, 19)
      assert.equal(balanceOf(current, 'annual').remaining_days, 19)
      assert.equal(balanceOf(current, 'medical').pool_days, 14)
      assert.equal(balanceOf(current, 'study').pool_days, 7)
      assert.equal(balanceOf(await ownLeave(vic, Y - 1), 'annual').pool_days, 14)
      assert.equal(res.body.annual_pool_days, 19, "the admin's own view of this year agrees")

      // Next Leave Year: the new Assigned figures, plus a capped carry of this
      // year's 19 Remaining. A future year is computed, not stored.
      const next = await ownLeave(vic, Y + 1)
      assert.equal(balanceOf(next, 'annual').pool_days, 25)
      assert.equal(balanceOf(next, 'annual').carried_days, 5)
      assert.equal(balanceOf(next, 'medical').pool_days, 10)
      assert.equal(balanceOf(next, 'study').pool_days, 2)
      assert.equal((await poolRows(vic, Y + 1)).length, 0)
    })
  })

  test('LEV-19, LEV-20 an admin sets Remaining within the Pool: the Pool is back-solved, half days kept exact, and the instructor then sees exactly that Remaining', async () => {
    const wes = await instructor('Wes Adjust')
    await storeRequest(one, wes, { type: 'annual', start: `${Y}-01-08`, end: `${Y}-01-09`, days: 2, status: 'approved' })
    await storeRequest(one, wes, { type: 'annual', start: `${Y}-01-15`, days: 0.5, status: 'pending', halfDay: 'morning' })

    const res = await patchStaff(adminAtOne, wes, { annual_remaining_days: 5 })

    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.annual_remaining_days, 5)
    assert.equal(res.body.annual_pool_days, 7.5)
    assert.equal((await storedPools(wes, Y)).annual!.days, 7.5)
    const annual = balanceOf(await ownLeave(wes), 'annual')
    assert.equal(annual.remaining_days, 5)
    assert.equal(annual.pool_days, 7.5)
    assert.equal(annual.taken_days, 2)
    assert.equal(annual.pending_days, 0.5)
    // Assigned is untouched by an adjustment.
    assert.equal(annual.assigned_days, 14)
  })

  test('LEV-21 after an adjustment down, Remaining above Assigned plus Carried or below zero is refused; exactly Assigned plus Carried, or zero, is accepted', async () => {
    const xan = await instructor('Xan Ceiling')
    await storeRequest(one, xan, { type: 'annual', start: `${Y}-01-08`, end: `${Y}-01-10`, days: 3, status: 'approved' })
    const down = await patchStaff(adminAtOne, xan, { annual_remaining_days: 4 })
    assert.equal(down.status, 200, JSON.stringify(down.body))
    assert.equal(down.body.annual_pool_days, 7)

    const above = await patchStaff(adminAtOne, xan, { annual_remaining_days: 14.5 })
    assert.equal(above.status, 400, JSON.stringify(above.body))
    assert.equal(above.body.error, 'remaining_above_pool')
    const below = await patchStaff(adminAtOne, xan, { annual_remaining_days: -0.5 })
    assert.equal(below.status, 400, JSON.stringify(below.body))
    assert.equal(below.body.error, 'remaining_below_zero')
    assert.equal((await storedPools(xan, Y)).annual!.days, 7, 'a refused adjustment writes nothing')
    assert.equal(balanceOf(await ownLeave(xan), 'annual').remaining_days, 4)

    // Assigned + Carried = 14, above the lowered stored Pool of 7.
    const ceiling = await patchStaff(adminAtOne, xan, { annual_remaining_days: 14 })
    assert.equal(ceiling.status, 200, JSON.stringify(ceiling.body))
    assert.equal(ceiling.body.annual_remaining_days, 14)
    assert.equal(ceiling.body.annual_pool_days, 17)

    const zero = await patchStaff(adminAtOne, xan, { annual_remaining_days: 0 })
    assert.equal(zero.status, 200, JSON.stringify(zero.body))
    assert.equal(zero.body.annual_remaining_days, 0)
    assert.equal(balanceOf(await ownLeave(xan), 'annual').remaining_days, 0)
  })

  test('LEV-22 Assigned or Remaining figures sent for a non-instructor staff member are refused', async () => {
    for (const body of [{ annual_leave_days: 10 }, { study_leave_days: 3 }, { annual_remaining_days: 3 }, { medical_remaining_days: 1 }]) {
      const res = await patchStaff(adminAtOne, officeAtOne, body)
      assert.equal(res.status, 400, `${JSON.stringify(body)} → ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, 'leave_days_instructor_only')
    }
    const rows = await harness.db.select().from(schema.instructors).where(eq(schema.instructors.staffUserId, officeAtOne.staffId))
    assert.equal(rows.length, 0, 'no instructor row was made for them')
  })

  test('LEV-27 a stored Leave Request stays on its original Leave Year when Assigned Days change later', async () => {
    const yan = await instructor('Yan History')
    await storePool(one, yan, Y - 1, { annual: 14, medical: 14, study: 7 })
    const pastId = await storeRequest(one, yan, {
      type: 'annual', start: `${Y - 1}-12-29`, end: `${Y - 1}-12-31`, days: 3, status: 'approved',
    })
    const currentId = await storeRequest(one, yan, { type: 'annual', start: `${Y}-02-02`, days: 1, status: 'approved' })
    assert.equal(balanceOf(await ownLeave(yan, Y - 1), 'annual').taken_days, 3)

    const res = await patchStaff(adminAtOne, yan, { annual_leave_days: 30 })
    assert.equal(res.status, 200, JSON.stringify(res.body))

    const leave = await ownLeave(yan)
    assert.equal(leave.requests.find(r => r.id === pastId)?.leave_year, Y - 1)
    assert.equal(leave.requests.find(r => r.id === currentId)?.leave_year, Y)
    assert.equal(balanceOf(leave, 'annual').taken_days, 1, 'last year’s request does not move into this year')
    const past = await ownLeave(yan, Y - 1)
    assert.equal(balanceOf(past, 'annual').taken_days, 3)
    assert.equal(balanceOf(past, 'annual').pool_days, 14)
  })

  // ── Admin: Global Policy ──────────────────────────────────────────────────

  test('LEV-16 an admin reads and sets the carry-over cap: default 14, persists, and the policy has no allowance keys', async () => {
    const [column] = (await harness.db.execute(sql`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'global_policy' AND column_name = 'leave_carry_over_cap_days'
    `)) as unknown as { column_default: string }[]
    assert.equal(column?.column_default, '14')

    await withPolicyRestored(one, async snap => {
      const read = await readPolicy(adminAtOne)
      assert.equal(read.status, 200, JSON.stringify(read.body))
      assert.equal(read.body.global_policy.leave_carry_over_cap_days, snap.row.leaveCarryOverCapDays)
      for (const key of Object.keys(read.body.global_policy)) {
        assert.ok(!/annual|medical|allowance/.test(key), `no allowance key on the policy (${key})`)
      }

      const target = snap.row.leaveCarryOverCapDays === 9 ? 8 : 9
      const set = await patchPolicy(adminAtOne, { leave_carry_over_cap_days: target })
      assert.equal(set.status, 200, JSON.stringify(set.body))
      assert.equal(set.body.leave_carry_over_cap_days, target)
      assert.equal((await readPolicy(adminAtOne)).body.global_policy.leave_carry_over_cap_days, target)

      for (const bad of [-1, 366, 2.5]) {
        const res = await patchPolicy(adminAtOne, { leave_carry_over_cap_days: bad })
        assert.equal(res.status, 400, `${bad} → ${JSON.stringify(res.body)}`)
      }
      assert.equal((await readPolicy(adminAtOne)).body.global_policy.leave_carry_over_cap_days, target)

      // The other studio's cap is its own.
      const theirs = await readPolicy(adminAtTwo)
      assert.equal(theirs.status, 200)
      assert.equal(theirs.body.global_policy.leave_carry_over_cap_days, originalPolicyTwo.row.leaveCarryOverCapDays)
    })
  })

  test('LEV-18 changing the carry-over cap leaves already-opened Pools where they are; only future year boundaries use it', async () => {
    await withPolicyRestored(one, async () => {
      await setCap(10)
      const zed = await instructor('Zed Cap')
      await storePool(one, zed, Y - 1, { annual: 14, medical: 14, study: 7 })
      const opened = balanceOf(await ownLeave(zed), 'annual')
      assert.deepEqual({ carried: opened.carried_days, pool: opened.pool_days }, { carried: 10, pool: 24 })

      await setCap(4)

      assert.deepEqual((await storedPools(zed, Y)).annual, { days: 24, carried: 10 })
      const still = balanceOf(await ownLeave(zed), 'annual')
      assert.deepEqual({ carried: still.carried_days, pool: still.pool_days }, { carried: 10, pool: 24 })
      const next = balanceOf(await ownLeave(zed, Y + 1), 'annual')
      assert.deepEqual({ carried: next.carried_days, pool: next.pool_days }, { carried: 4, pool: 18 })
    })
  })

  test('LEV-63 lowering the study cap or declaring a pair that approved leave now breaches leaves that leave unchanged', async () => {
    const amy = await instructor('Amy Study')
    const bo = await instructor('Bo Study')
    const start = `${Y + 1}-03-02`
    const end = `${Y + 1}-03-04`
    const ids = [
      await storeRequest(one, amy, { type: 'study', start, end, days: 3, status: 'approved' }),
      await storeRequest(one, bo, { type: 'study', start, end, days: 3, status: 'approved' }),
      await storeRequest(one, amy, { type: 'annual', start: `${Y + 1}-04-06`, days: 1, status: 'approved' }),
      await storeRequest(one, bo, { type: 'annual', start: `${Y + 1}-04-06`, days: 1, status: 'approved' }),
    ]
    const rowsOf = () =>
      harness.db
        .select()
        .from(schema.leaveRequests)
        .where(sql`${schema.leaveRequests.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`)
    const before = await rowsOf()

    await withPolicyRestored(one, async snap => {
      const res = await patchPolicy(adminAtOne, {
        study_leave_cap: 1,
        leave_conflicts: [
          ...snap.conflicts.map(p => ({ instructor_a_id: p.instructorAId, instructor_b_id: p.instructorBId })),
          { instructor_a_id: amy.staffId, instructor_b_id: bo.staffId },
        ],
      })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.study_leave_cap, 1)
      assert.equal(res.body.leave_conflicts.length, snap.conflicts.length + 1)

      assert.deepEqual(await rowsOf(), before)
      const amyNext = await ownLeave(amy, Y + 1)
      assert.equal(balanceOf(amyNext, 'study').taken_days, 3)
      assert.equal(balanceOf(amyNext, 'annual').taken_days, 1)
    })
  })

  test('LEV-121 a policy save with a new study cap and an invalid Leave Conflict pair is refused whole: neither cap nor pairs change', async () => {
    const cy = await instructor('Cy Pair')
    const dee = await instructor('Dee Pair')
    const gone = await staff(one, 'Eli Archived', 'instructor', 'archived')

    await withPolicyRestored(one, async snap => {
      const existing = snap.conflicts.map(p => ({ instructor_a_id: p.instructorAId, instructor_b_id: p.instructorBId }))
      const newCap = snap.row.studyLeaveCap === 5 ? 6 : 5
      const policyBefore = (await readPolicy(adminAtOne)).body

      for (const [label, pairs, code] of [
        ['self pair', [{ instructor_a_id: cy.staffId, instructor_b_id: cy.staffId }], 'invalid_leave_conflict'],
        [
          'duplicate pair',
          [
            { instructor_a_id: cy.staffId, instructor_b_id: dee.staffId },
            { instructor_a_id: dee.staffId, instructor_b_id: cy.staffId },
          ],
          'duplicate_leave_conflict',
        ],
        [
          'inactive instructor',
          [{ instructor_a_id: cy.staffId, instructor_b_id: gone.staffId }],
          'leave_conflict_instructor_not_active',
        ],
      ] as const) {
        const res = await patchPolicy(adminAtOne, { study_leave_cap: newCap, leave_conflicts: [...existing, ...pairs] })
        assert.equal(res.status, 400, `${label} → ${JSON.stringify(res.body)}`)
        assert.equal(res.body.error, code, label)

        const now = (await readPolicy(adminAtOne)).body
        assert.equal(now.global_policy.study_leave_cap, snap.row.studyLeaveCap, `${label}: the cap is unchanged`)
        assert.deepEqual(now.leave_conflicts, policyBefore.leave_conflicts, `${label}: the pairs are unchanged`)
      }
    })
  })

  // ── Refusals ──────────────────────────────────────────────────────────────

  test('LEV-24 an instructor is refused Global Policy, reading or updating the carry-over cap', async () => {
    const fay = await instructor('Fay Policy')
    const capBefore = (await snapshotPolicy(one)).row.leaveCarryOverCapDays

    assert.equal((await readPolicy(fay)).status, 403)
    for (const body of [{ leave_carry_over_cap_days: capBefore === 1 ? 2 : 1 }, { study_leave_cap: 50 }, { cancel_cap_count: 3 }]) {
      const res = await patchPolicy(fay, body)
      assert.equal(res.status, 403, `${JSON.stringify(body)} → ${JSON.stringify(res.body)}`)
    }
    assert.equal((await snapshotPolicy(one)).row.leaveCarryOverCapDays, capBefore)
  })

  test('LEV-25 an instructor cannot change their own Assigned Days, through the staff route or their own profile', async () => {
    const gus = await instructor('Gus Self')

    const viaStaff = await patchStaff(gus, gus, { annual_leave_days: 40, annual_remaining_days: 30 })
    assert.equal(viaStaff.status, 403, JSON.stringify(viaStaff.body))
    assert.equal(viaStaff.body.error, 'forbidden_role')
    const listed = await call(gus.headers, 'GET', '/api/v1/portal/admin/staff')
    assert.equal(listed.status, 403, JSON.stringify(listed.body))
    assert.equal(listed.body.error, 'forbidden_role')

    // Their own profile route has no leave field; an extra key is ignored, not applied.
    const own = await call(gus.headers, 'PATCH', '/api/v1/portal/instructor/profile', { annual_leave_days: 40, bio: 'hi' })
    assert.equal(own.status, 200, JSON.stringify(own.body))
    assert.equal(own.body.bio, 'hi', 'the fields the route does own are saved')
    assert.ok(!('annual_leave_days' in own.body), 'the profile carries no Assigned Days to have changed')
    assert.deepEqual(await assigned(gus), { annual: 14, medical: 14, study: 7 })
    assert.equal(balanceOf(await ownLeave(gus), 'annual').remaining_days, 14)
  })

  test('a member is refused the instructor leave read and the admin staff and policy routes', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/v1/portal/instructor/leave', undefined],
      ['GET', '/api/v1/portal/admin/staff', undefined],
      ['PATCH', `/api/v1/portal/admin/staff/${officeAtOne.staffId}`, { annual_leave_days: 3 }],
      ['GET', '/api/v1/portal/admin/policy', undefined],
      ['PATCH', '/api/v1/portal/admin/policy/global', { leave_carry_over_cap_days: 1 }],
    ] as const) {
      // A member's session is a row the staff pool has never seen.
      const res = await call(memberAtOne.headers, method, path, body)
      assert.equal(res.status, 401, `${method} ${path} → ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, 'invalid_token', `${method} ${path}`)
    }
  })

  test('an admin (no instructor row) reading the instructor leave route is refused, not handed a Pool', async () => {
    const res = await call(adminAtOne.headers, 'GET', '/api/v1/portal/instructor/leave')
    assert.equal(res.status, 403, JSON.stringify(res.body))
    const rows = await harness.db.select().from(schema.leavePools).where(eq(schema.leavePools.instructorId, adminAtOne.staffId))
    assert.equal(rows.length, 0)
  })

  // ── Cross-Tenant ──────────────────────────────────────────────────────────

  test("another studio's admin can neither see nor change an instructor's leave figures", async () => {
    const hal = await instructor('Hal Isolated')
    const opened = await ownLeave(hal)
    const poolsBefore = await storedPools(hal, Y)

    assert.ok(!(await staffList(adminAtTwo)).some(s => s.id === hal.staffId), "not in the other studio's staff list")
    const res = await patchStaff(adminAtTwo, hal, { annual_leave_days: 40, annual_remaining_days: 1 })
    assert.equal(res.status, 404, JSON.stringify(res.body))

    assert.deepEqual(await assigned(hal), { annual: 14, medical: 14, study: 7 })
    assert.deepEqual(await storedPools(hal, Y), poolsBefore)
    assert.deepEqual((await ownLeave(hal)).balances, opened.balances)
  })

  test("an instructor's balances carry nothing of another studio's, and their session does not open the other studio", async () => {
    const ira = await instructor('Ira One')
    const jan = await instructor('Jan Two', two)
    await storeRequest(two, jan, { type: 'annual', start: `${Y}-01-05`, end: `${Y}-01-09`, days: 5, status: 'approved' })
    await storeRequest(two, jan, { type: 'medical', start: `${Y}-01-12`, days: 1, status: 'pending' })

    const mine = await ownLeave(ira)
    assert.equal(mine.requests.length, 0)
    for (const b of mine.balances) {
      assert.equal(b.taken_days, 0, b.type)
      assert.equal(b.pending_days, 0, b.type)
    }
    // Theirs is theirs.
    const theirs = await ownLeave(jan)
    assert.equal(balanceOf(theirs, 'annual').taken_days, 5)
    assert.equal(theirs.requests.length, 2)

    // Ira's session presented on the other studio's portal.
    const elsewhere = {
      ...ira.headers,
      Origin: `http://${two.slug}.portal.localhost:3001`,
      'X-Tenant-Slug': two.slug,
    }
    const res = await call(elsewhere, 'GET', '/api/v1/portal/instructor/leave')
    // Signed in on the first studio: logins are per studio, so the other one cannot see the session.
    assert.equal(res.status, 401, JSON.stringify(res.body))
    assert.equal(res.body.error, 'invalid_token')
  })
})
