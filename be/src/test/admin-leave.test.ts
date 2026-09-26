import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { MailTransport, OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const DOMAIN = `${run}.admin-leave.test`
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Leave belongs to a staff member, not an instructor profile (#315): an admin
 * files leave exactly as an instructor does, through the one self-service mount
 * both roles share, and decides it on the same queue — their own request
 * included. Leave Conflicts and the study Leave Cap stay instructor-only.
 *
 * Real Postgres and real sign-in; only the mail transport is faked, so who is
 * and is not emailed can be read off what was sent.
 *
 * Every future leave date is in one far-future year picked at random per run,
 * so no other file's rows share a calendar window, a cap or a clash with these.
 */
describe('admin leave over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let mailer!: typeof import('../lib/mailer')

  type Tenant = { id: string; slug: string }
  type Staff = { staffId: string; email: string; name: string; headers: Record<string, string> }
  type Res = { status: number; body: any; text: string }

  let one!: Tenant
  let adminAnna!: Staff
  let adminBruno!: Staff

  const sent: OutboundMessage[] = []
  const recordingTransport: MailTransport = {
    name: 'null',
    async send(message) {
      sent.push(message)
      return { messageId: `admin-leave-${sent.length}`, response: 'recorded' }
    },
  }
  let restoreMail: () => void = () => {}
  const templateOf = (m: OutboundMessage) => m.tags.find(t => t.name === 'template')?.value
  const mailTo = (email: string, slug: string) => sent.filter(m => m.to === email && templateOf(m) === slug)

  let original!: { studyLeaveCap: number; pairs: { instructorAId: string; instructorBId: string }[] }

  const YEAR = 2300 + Math.floor(Math.random() * 600)
  let cursor = Date.UTC(YEAR, 0, 5)
  const plain = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  function nextDates(days = 1): { start: string; end: string } {
    const start = cursor
    const end = start + (days - 1) * DAY_MS
    cursor = end + 2 * DAY_MS
    return { start: plain(start), end: plain(end) }
  }

  async function staff(tenant: Tenant, label: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = `${label}@${DOMAIN}`
    const name = `${label} ${run}`
    const headers = await harness.signInAs('staff', email, tenant)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { staffId: row!.id, email, name, headers }
  }

  async function call(who: { headers: Record<string, string> }, method: string, path: string, json?: unknown): Promise<Res> {
    const res = await harness.app.request(`/api/v1/portal${path}`, {
      method,
      headers: json === undefined ? who.headers : { ...who.headers, 'Content-Type': 'application/json' },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    })
    const text = await res.text()
    let body: any = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    return { status: res.status, body, text }
  }

  type LeaveType = 'annual' | 'medical' | 'study'
  async function file(who: Staff, type: LeaveType, dates = nextDates()): Promise<{ id: string; start: string; end: string }> {
    const res = await submit(who, type, dates)
    assert.equal(res.status, 201, `${who.name} filing ${type}: ${res.text}`)
    return { id: res.body.id, ...dates }
  }
  const submit = (who: Staff, type: LeaveType, dates: { start: string; end: string }) =>
    call(who, 'POST', '/leave', {
      type,
      start_date: dates.start,
      end_date: dates.end,
      reason: `admin leave test ${run}`,
    })

  const ownLeave = async (who: Staff, year?: number) => {
    const res = await call(who, 'GET', `/leave${year === undefined ? '' : `?year=${year}`}`)
    assert.equal(res.status, 200, res.text)
    return res.body as { leave_year: number; balances: any[]; requests: any[] }
  }
  const balanceOf = (leave: { balances: any[] }, type: LeaveType) => leave.balances.find(b => b.type === type)

  async function queue(who: Staff): Promise<any[]> {
    const res = await call(who, 'GET', '/admin/leave?status=all')
    assert.equal(res.status, 200, res.text)
    return res.body.leave_requests
  }

  async function setPolicy(body: Record<string, unknown>) {
    const res = await call(adminAnna, 'PATCH', '/admin/policy/global', body)
    assert.equal(res.status, 200, res.text)
  }
  const pairsBody = (extra: [Staff, Staff][] = []) => [
    ...original.pairs.map(p => ({ instructor_a_id: p.instructorAId, instructor_b_id: p.instructorBId })),
    ...extra.map(([a, b]) => ({ instructor_a_id: a.staffId, instructor_b_id: b.staffId })),
  ]

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    mailer = await import('../lib/mailer')
    restoreMail = mailer.useTransport(recordingTransport)
    one = harness.tenants.one

    const [policy] = await harness.db
      .select()
      .from(schema.globalPolicy)
      .where(eq(schema.globalPolicy.tenantId, one.id))
    assert.ok(policy, 'expected a seeded policy row')
    const pairs = await harness.db
      .select({ instructorAId: schema.leaveConflicts.instructorAId, instructorBId: schema.leaveConflicts.instructorBId })
      .from(schema.leaveConflicts)
      .where(eq(schema.leaveConflicts.tenantId, one.id))
    original = { studyLeaveCap: policy.studyLeaveCap, pairs }

    adminAnna = await staff(one, 'admin-anna', 'admin')
    adminBruno = await staff(one, 'admin-bruno', 'admin')
  })

  after(async () => {
    restoreMail()
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    try {
      await harness.db
        .update(schema.globalPolicy)
        .set({ studyLeaveCap: original.studyLeaveCap, updatedByStaffId: null })
        .where(eq(schema.globalPolicy.tenantId, one.id))
      await harness.db.delete(schema.leaveConflicts).where(eq(schema.leaveConflicts.tenantId, one.id))
      if (original.pairs.length > 0) {
        await harness.db.insert(schema.leaveConflicts).values(original.pairs.map(p => ({ ...p, tenantId: one.id })))
      }
    } finally {
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM leave_requests WHERE staff_user_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM leave_pools WHERE staff_user_id IN (${staffIds})`)
      await harness.db.execute(
        sql`DELETE FROM leave_conflicts WHERE instructor_a_id IN (${staffIds}) OR instructor_b_id IN (${staffIds})`,
      )
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
      await harness.db.execute(
        sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}
              OR (template_slug LIKE 'leave_%' AND body_rendered LIKE ${`%${run}%`})`,
      )
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
      await harness.close()
    }
  })

  test('LEV-123 an admin files leave on the shared mount and holds 14/14/7 balances and a stored Pool', async () => {
    const opened = await ownLeave(adminAnna)
    assert.deepEqual(
      opened.balances.map(b => [b.type, b.assigned_days, b.pool_days, b.remaining_days]),
      [
        ['annual', 14, 14, 14],
        ['medical', 14, 14, 14],
        ['study', 7, 7, 7],
      ],
    )
    const pools = await harness.db
      .select()
      .from(schema.leavePools)
      .where(eq(schema.leavePools.staffUserId, adminAnna.staffId))
    assert.equal(pools.length, 3, 'reading the current Leave Year froze a Pool per Leave Type')

    const filed = await file(adminAnna, 'annual', nextDates(3))
    const later = await ownLeave(adminAnna, YEAR)
    assert.equal(balanceOf(later, 'annual').pending_days, 3)
    assert.equal(balanceOf(later, 'annual').remaining_days, 11)
    assert.deepEqual(later.requests.map(r => r.id), [filed.id])
  })

  test('LEV-124 the Leave queue lists admin and instructor requests side by side, each with the applicant role', async () => {
    const ivy = await staff(one, 'ivy', 'instructor')
    const mine = await file(adminBruno, 'annual')
    const theirs = await file(ivy, 'annual')

    const rows = await queue(adminAnna)
    const admin = rows.find(r => r.id === mine.id)
    const instructor = rows.find(r => r.id === theirs.id)
    assert.deepEqual(admin?.applicant, {
      id: adminBruno.staffId,
      name: adminBruno.name,
      email: adminBruno.email,
      role: 'admin',
    })
    assert.equal(instructor?.applicant.role, 'instructor')
  })

  test('LEV-125 an admin approves and revokes their own request, and is not emailed their own decision', async () => {
    const req = await file(adminAnna, 'annual')

    const approved = await call(adminAnna, 'POST', `/admin/leave/${req.id}/approve`)
    assert.equal(approved.status, 200, approved.text)
    const [row] = await harness.db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.id, req.id))
    assert.equal(row?.status, 'approved')
    assert.equal(row?.decidedByStaffId, adminAnna.staffId)
    assert.equal(mailTo(adminAnna.email, 'leave_approved').length, 0, 'no email to the admin who decided it')

    const revoked = await call(adminAnna, 'POST', `/admin/leave/${req.id}/revoke`)
    assert.equal(revoked.status, 200, revoked.text)
    assert.equal(mailTo(adminAnna.email, 'leave_revoked').length, 0)
  })

  test("LEV-126 another admin deciding an admin's request emails the applicant", async () => {
    const req = await file(adminBruno, 'annual')
    const res = await call(adminAnna, 'POST', `/admin/leave/${req.id}/reject`, { reason: `No ${run}` })
    assert.equal(res.status, 200, res.text)
    assert.equal(mailTo(adminBruno.email, 'leave_rejected').length, 1)
  })

  test('LEV-127 the submission email goes to every active admin except the applicant', async () => {
    const before = {
      anna: mailTo(adminAnna.email, 'leave_request_submitted').length,
      bruno: mailTo(adminBruno.email, 'leave_request_submitted').length,
    }
    await file(adminAnna, 'medical')
    assert.equal(mailTo(adminAnna.email, 'leave_request_submitted').length, before.anna, 'the applicant is not told')
    assert.equal(mailTo(adminBruno.email, 'leave_request_submitted').length, before.bruno + 1)
  })

  test('LEV-128 admins never count toward the study Leave Cap, in either direction', async () => {
    await setPolicy({ study_leave_cap: 1 })
    const gus = await staff(one, 'gus', 'instructor')
    const hal = await staff(one, 'hal', 'instructor')
    const dates = nextDates()

    await file(adminAnna, 'study', dates)
    // The admin's study day does not use up the one place.
    await file(gus, 'study', dates)
    // And the cap, now full with an instructor, does not refuse an admin.
    await file(adminBruno, 'study', dates)
    // But it still refuses the next instructor.
    const refused = await submit(hal, 'study', dates)
    assert.equal(refused.status, 409, refused.text)
    assert.equal(refused.body.error, 'leave_cap_reached')
  })

  test('LEV-129 an instructor promoted to admin keeps their history and balances, and leaves their Leave Conflicts', async () => {
    const pia = await staff(one, 'pia', 'instructor')
    const quin = await staff(one, 'quin', 'instructor')
    await setPolicy({ leave_conflicts: pairsBody([[pia, quin]]) })

    const dates = nextDates(2)
    const filed = await file(pia, 'annual', dates)
    const beforeYear = await ownLeave(pia, YEAR)

    const promoted = await call(adminAnna, 'PATCH', `/admin/staff/${pia.staffId}`, { role: 'admin' })
    assert.equal(promoted.status, 200, promoted.text)

    const afterYear = await ownLeave(pia, YEAR)
    assert.deepEqual(afterYear.balances, beforeYear.balances)
    assert.deepEqual(afterYear.requests.map(r => r.id), [filed.id])

    // The declared pair is kept, but an admin is in no conflict pair: their
    // partner's leave over the same days is not refused on their account.
    const partner = await submit(quin, 'annual', dates)
    assert.equal(partner.status, 201, partner.text)

    // Nor can a new pair name them.
    const res = await call(adminAnna, 'PATCH', '/admin/policy/global', {
      leave_conflicts: pairsBody([[pia, quin], [pia, adminBruno]]),
    })
    assert.equal(res.status, 400, res.text)
    assert.equal(res.body.error, 'leave_conflict_instructor_not_active')
  })

  test("LEV-130 an admin's Assigned Days and Remaining are edited on the staff screen, and the staff list shows everyone's leave", async () => {
    const res = await call(adminAnna, 'PATCH', `/admin/staff/${adminBruno.staffId}`, {
      annual_leave_days: 20,
      medical_remaining_days: 10,
    })
    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.annual_leave_days, 20)
    assert.equal(res.body.medical_remaining_days, 10)

    const list = await call(adminAnna, 'GET', '/admin/staff')
    assert.equal(list.status, 200, list.text)
    const bruno = list.body.staff.find((s: any) => s.id === adminBruno.staffId)
    assert.equal(bruno.annual_leave_days, 20)
    assert.equal(bruno.medical_remaining_days, 10)
    assert.equal(typeof bruno.study_pool_days, 'number')
  })

  test("LEV-131 the leave calendar shows an admin's leave under the same visibility rules", async () => {
    const viewer = await staff(one, 'vic', 'instructor')
    const req = await file(adminBruno, 'medical')

    const asInstructor = await call(viewer, 'GET', `/leave-calendar?from=${req.start}&to=${req.end}`)
    assert.equal(asInstructor.status, 200, asInstructor.text)
    const seen = asInstructor.body.leave.find((e: any) => e.id === req.id)
    assert.equal(seen?.staff.id, adminBruno.staffId)
    assert.equal(seen?.detail, null, "a colleague's leave type and reason stay hidden")

    const asAdmin = await call(adminAnna, 'GET', `/leave-calendar?from=${req.start}&to=${req.end}`)
    const full = asAdmin.body.leave.find((e: any) => e.id === req.id)
    assert.equal(full?.detail?.type, 'medical')
  })

  test('LEV-132 the instructor-only leave mount is gone: both roles use the shared one', async () => {
    const res = await call(adminAnna, 'GET', '/instructor/leave')
    assert.equal(res.status, 404, res.text)
  })
})
