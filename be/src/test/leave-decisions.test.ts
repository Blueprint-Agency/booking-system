import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { MailTransport, OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const DOMAIN = `${run}.leave-decisions.test`
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Deciding leave over real HTTP (#204): an admin approves, rejects and revokes;
 * the instructor withdraws and cancels his own; the Supporting Document is
 * uploaded, signed and never leaks its key; the calendar redacts; and a mail
 * transport that fails never takes a decision down with it.
 *
 * Real Postgres and real sign-in. Only the two true third parties are faked:
 * storage (the R2 client's `send`, backed by an in-memory bucket) and the mail
 * transport (a recorder that can be told to fail).
 *
 * Every leave date is in one far-future year picked at random per run, so no
 * other file's rows share a calendar window, a cap or a clash with these.
 */
describe('leave decisions over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let r2Module!: typeof import('../lib/r2')
  let mailer!: typeof import('../lib/mailer')
  let MAX_BYTES!: number

  type Staff = { staffId: string; email: string; name: string; headers: Record<string, string> }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  let adminOne!: Staff
  let secondAdminOne!: Staff
  let adminTwo!: Staff
  let ada!: Staff // instructor, tenant one
  let ben!: Staff // instructor, tenant one
  let cal!: Staff // instructor, tenant one
  let dee!: Staff // instructor, tenant two
  let memberOne!: Member

  // ── Fake storage: an in-memory bucket behind the R2 client's `send` ────────
  const bucket = new Map<string, { bytes: Uint8Array; contentType: string }>()
  let restoreStorage: () => void = () => {}

  // ── Fake mail: records every message; can be made to throw ─────────────────
  const sent: OutboundMessage[] = []
  let mailFailure: Error | null = null
  const recordingTransport: MailTransport = {
    name: 'null',
    async send(message) {
      if (mailFailure) throw mailFailure
      sent.push(message)
      return { messageId: `leave-decisions-${sent.length}`, response: 'recorded' }
    },
  }
  let restoreMail: () => void = () => {}

  // ── Dates: one random far-future year, a fresh stretch per request ─────────
  const YEAR = 2300 + Math.floor(Math.random() * 600)
  let cursor = Date.UTC(YEAR, 0, 5)
  const plain = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  function nextDates(days = 1): { start: string; end: string } {
    const start = cursor
    const end = start + (days - 1) * DAY_MS
    cursor = end + 2 * DAY_MS
    return { start: plain(start), end: plain(end) }
  }
  const sgToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date())
  const sgDayOffset = (offset: number) =>
    plain(Date.parse(`${sgToday()}T00:00:00Z`) + offset * DAY_MS)

  const emailFor = (label: string) => `${label}@${DOMAIN}`

  async function staff(tenant: { id: string; slug: string }, label: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${label}-${tenant.slug}`)
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

  async function member(tenant: { id: string; slug: string }, label: string): Promise<Member> {
    const email = emailFor(`${label}-${tenant.slug}`)
    const headers = await harness.signInAs('client', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: tenant.id, email, name: `${label} ${run}`, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  type Res = { status: number; body: any; text: string }
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
  async function file(
    who: Staff,
    type: LeaveType,
    opts: { days?: number; start?: string; end?: string; reason?: string } = {},
  ): Promise<{ id: string; reason: string; start: string; end: string }> {
    const dates = opts.start ? { start: opts.start, end: opts.end ?? opts.start } : nextDates(opts.days ?? 1)
    const reason = opts.reason ?? `${type} reason ${run} ${Math.random().toString(36).slice(2, 8)}`
    const res = await call(who, 'POST', '/instructor/leave', {
      type,
      start_date: dates.start,
      end_date: dates.end,
      reason,
    })
    assert.equal(res.status, 201, res.text)
    return { id: res.body.id, reason, ...dates }
  }

  const approve = (who: Staff | Member, id: string) => call(who, 'POST', `/admin/leave/${id}/approve`)
  const reject = (who: Staff | Member, id: string, reason?: string) =>
    call(who, 'POST', `/admin/leave/${id}/reject`, reason === undefined ? {} : { reason })
  const revoke = (who: Staff | Member, id: string) => call(who, 'POST', `/admin/leave/${id}/revoke`)
  const withdraw = (who: Staff | Member, id: string) => call(who, 'POST', `/instructor/leave/${id}/withdraw`)
  const cancel = (who: Staff | Member, id: string) => call(who, 'POST', `/instructor/leave/${id}/cancel`)

  async function row(id: string) {
    const [r] = await harness.db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.id, id))
    assert.ok(r, `leave request ${id} exists`)
    return r
  }

  /** The instructor's own Remaining for one Leave Type in this run's year. */
  async function remaining(who: Staff, type: LeaveType, year = YEAR): Promise<number> {
    const res = await call(who, 'GET', `/instructor/leave?year=${year}`)
    assert.equal(res.status, 200, res.text)
    const balance = (res.body.balances as { type: string; remaining_days: number }[]).find(b => b.type === type)
    assert.ok(balance, `a ${type} balance`)
    return balance.remaining_days
  }

  async function upload(who: Staff | Member, id: string, bytes: Uint8Array, type: string, filename = 'document'): Promise<Res> {
    const form = new FormData()
    form.append('file', new File([bytes], filename, { type }))
    const res = await harness.app.request(`/api/v1/portal/instructor/leave/${id}/document`, {
      method: 'POST',
      headers: who.headers,
      body: form,
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

  const fileBytes = (size: number, fill = 7) => new Uint8Array(size).fill(fill)

  /**
   * What following the signed URL returns, as the fake bucket would serve it:
   * the object under the key the URL is signed for, in the configured bucket.
   */
  function followSignedUrl(url: string): { key: string; object: { bytes: Uint8Array; contentType: string } | undefined } {
    const u = new URL(url)
    const bucketName = r2Module.r2Bucket()!
    assert.ok(u.searchParams.get('X-Amz-Signature'), 'the URL is signed')
    assert.equal(u.searchParams.get('X-Amz-Expires'), '300', 'the URL is short-lived')
    let path = decodeURIComponent(u.pathname.slice(1))
    if (u.hostname.startsWith(`${bucketName}.`)) {
      // virtual-hosted style: the bucket is the host
    } else {
      assert.ok(path.startsWith(`${bucketName}/`), `the URL names the bucket: ${url}`)
      path = path.slice(bucketName.length + 1)
    }
    return { key: path, object: bucket.get(path) }
  }

  const templateOf = (m: OutboundMessage) => m.tags.find(t => t.name === 'template')?.value
  const mailTo = (email: string, slug: string) => sent.filter(m => m.to === email && templateOf(m) === slug)

  const errorLines = () => harness.logs.lines().filter(l => l.level === 'error')

  /** A refusal: exactly this status, carrying exactly this error code. */
  function refused(res: Res, status: number, error: string, what = '') {
    assert.equal(res.status, status, `${what} ${res.text}`)
    assert.equal(res.body?.error, error, `${what} ${res.text}`)
  }
  // A member's session is a row the staff pool has never seen: unauthenticated
  // on every portal route, not merely unprivileged.
  const refusedAsMember = (res: Res, what = '') => refused(res, 401, 'invalid_token', what)

  /** A request of `who`'s, brought to `state` through the real routes. */
  async function inState(
    who: Staff,
    state: 'approved' | 'rejected' | 'withdrawn' | 'cancelled' | 'revoked',
  ): Promise<string> {
    const { id } = await file(who, 'annual')
    const step = async (res: Res) => assert.equal(res.status, 200, `to ${state}: ${res.text}`)
    if (state === 'rejected') await step(await reject(adminOne, id, `No ${run}`))
    else if (state === 'withdrawn') await step(await withdraw(who, id))
    else {
      await step(await approve(adminOne, id))
      if (state === 'cancelled') await step(await cancel(who, id))
      if (state === 'revoked') await step(await revoke(adminOne, id))
    }
    assert.equal((await row(id)).status, state)
    return id
  }

  before(async () => {
    // A bucket name and signing credentials, for a machine whose `.env` has
    // none — the fake below answers every call, so no real R2 is ever reached,
    // and a presigned URL is computed locally.
    process.env.R2_BUCKET_NAME ||= 'leave-decisions-test-bucket'
    process.env.R2_ACCOUNT_ID ||= 'leave-decisions-test-account'
    process.env.R2_ACCESS_KEY_ID ||= 'leave-decisions-test-key'
    process.env.R2_SECRET_ACCESS_KEY ||= 'leave-decisions-test-secret'

    harness = await startTestApp()
    schema = await import('../db/schema')
    r2Module = await import('../lib/r2')
    mailer = await import('../lib/mailer')
    MAX_BYTES = (await import('../services/leave/rules')).SUPPORTING_DOCUMENT_MAX_BYTES

    const originalSend = r2Module.r2.send
    r2Module.r2.send = (async (command: { constructor: { name: string }; input: any }) => {
      if (command.constructor.name === 'PutObjectCommand') {
        const { Key, Body, ContentType, Bucket } = command.input
        assert.equal(Bucket, r2Module.r2Bucket())
        bucket.set(Key, { bytes: new Uint8Array(Body), contentType: ContentType })
        return {}
      }
      throw new Error(`fake storage: unexpected ${command.constructor.name}`)
    }) as unknown as typeof r2Module.r2.send
    restoreStorage = () => {
      r2Module.r2.send = originalSend
    }
    restoreMail = mailer.useTransport(recordingTransport)

    const { one, two } = harness.tenants
    adminOne = await staff(one, 'admin-anna', 'admin')
    secondAdminOne = await staff(one, 'admin-bruno', 'admin')
    adminTwo = await staff(two, 'admin-carla', 'admin')
    ada = await staff(one, 'ada', 'instructor')
    ben = await staff(one, 'ben', 'instructor')
    cal = await staff(one, 'cal', 'instructor')
    dee = await staff(two, 'dee', 'instructor')
    memberOne = await member(one, 'mia')
  })

  after(async () => {
    restoreMail()
    restoreStorage()
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM leave_requests WHERE instructor_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM leave_pools WHERE instructor_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    // Submissions mail every admin of the studio — theirs too, not only ours —
    // so those log rows are found by this run's id in what was rendered.
    await harness.db.execute(
      sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}
            OR (template_slug LIKE 'leave_%' AND body_rendered LIKE ${`%${run}%`})`,
    )
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  // ── Decisions ──────────────────────────────────────────────────────────────

  test('LEV-79 an admin approves a pending request: it is approved, records who and when, the instructor is emailed, and it cannot be decided twice', async () => {
    const req = await file(ada, 'annual', { days: 2 })
    const before = Date.now()

    const res = await approve(adminOne, req.id)

    assert.equal(res.status, 200, res.text)
    const r = await row(req.id)
    assert.equal(r.status, 'approved')
    assert.equal(r.decidedByStaffId, adminOne.staffId)
    assert.ok(r.decidedAt, 'decision time recorded')
    assert.ok(r.decidedAt.getTime() >= before - 1000 && r.decidedAt.getTime() <= Date.now() + 1000)

    const mail = mailTo(ada.email, 'leave_approved')
    assert.equal(mail.length, 1, 'the instructor gets one approval email')
    assert.match(mail[0]!.subject, /approved/i)
    assert.ok(mail[0]!.html.includes(ada.name), 'addressed to the instructor')

    // Only a pending request can be decided.
    refused(await approve(adminOne, req.id), 409, 'leave_not_pending', 'approve again')
    refused(await reject(adminOne, req.id, 'too late'), 409, 'leave_not_pending', 'reject after approval')
    assert.equal((await row(req.id)).status, 'approved')
  })

  test('LEV-82 approve and reject are refused on a request already approved, rejected, withdrawn, cancelled or revoked, and it is left as it was', async () => {
    // His own instructor: the decisions below mail him, and other tests count
    // what the shared instructors are sent.
    const eli = await staff(harness.tenants.one, 'eli', 'instructor')
    for (const state of ['approved', 'rejected', 'withdrawn', 'cancelled', 'revoked'] as const) {
      const id = await inState(eli, state)
      const before = await row(id)
      const mailsBefore = sent.length

      refused(await approve(adminOne, id), 409, 'leave_not_pending', `approve ${state}`)
      refused(await reject(adminOne, id, `Second thoughts ${run}`), 409, 'leave_not_pending', `reject ${state}`)

      const after = await row(id)
      assert.equal(after.status, state, `${state} stays ${state}`)
      assert.equal(after.decidedByStaffId, before.decidedByStaffId, `${state}: no decision recorded`)
      assert.equal(after.decisionReason, before.decisionReason, `${state}: the decision reason is untouched`)
      assert.equal(sent.length, mailsBefore, `${state}: nobody was emailed`)
    }
  })

  test('LEV-80 an admin rejects with a reason: rejected, the days return to Remaining, and the email carries the reason', async () => {
    const start = await remaining(ben, 'annual')
    const req = await file(ben, 'annual', { days: 2 })
    assert.equal(await remaining(ben, 'annual'), start - 2, 'pending days are committed')

    const why = `Short staffed that week ${run}`
    const res = await reject(adminOne, req.id, why)

    assert.equal(res.status, 200, res.text)
    const r = await row(req.id)
    assert.equal(r.status, 'rejected')
    assert.equal(r.decisionReason, why)
    assert.equal(r.decidedByStaffId, adminOne.staffId)
    assert.equal(await remaining(ben, 'annual'), start, 'the days are back')

    const mail = mailTo(ben.email, 'leave_rejected')
    assert.equal(mail.length, 1)
    assert.ok(mail[0]!.html.includes(why), 'the email includes the reason')
    assert.ok(mail[0]!.text?.includes(why), 'the plain-text part includes the reason')
  })

  test('LEV-81 a rejection without a reason is refused and the request stays pending', async () => {
    const req = await file(ben, 'annual')
    const mailsBefore = mailTo(ben.email, 'leave_rejected').length

    for (const reason of [undefined, '', '   ']) {
      const res = await reject(adminOne, req.id, reason)
      assert.equal(res.status, 400, `reason ${JSON.stringify(reason)}: ${res.text}`)
    }
    const r = await row(req.id)
    assert.equal(r.status, 'pending')
    assert.equal(r.decidedByStaffId, null)
    assert.equal(mailTo(ben.email, 'leave_rejected').length, mailsBefore, 'no rejection was mailed')
  })

  test('LEV-83 an admin revokes approved leave that starts after today: revoked, the days return to the Pool, and the instructor is told who revoked it and when', async () => {
    const start = await remaining(cal, 'annual')
    const req = await file(cal, 'annual', { days: 3 })
    assert.equal((await approve(adminOne, req.id)).status, 200)
    assert.equal(await remaining(cal, 'annual'), start - 3)

    const res = await revoke(adminOne, req.id)

    assert.equal(res.status, 200, res.text)
    assert.equal((await row(req.id)).status, 'revoked')
    assert.equal(await remaining(cal, 'annual'), start, 'the days are back with no further action')

    const mail = mailTo(cal.email, 'leave_revoked')
    assert.equal(mail.length, 1)
    assert.ok(mail[0]!.html.includes(adminOne.name), 'names who revoked it')
    const todaySg = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Asia/Singapore' }).format(new Date())
    assert.ok(mail[0]!.html.includes(todaySg), `says when (${todaySg})`)
    assert.match(mail[0]!.html, /\d{1,2}:\d{2}/, 'with the time of day')
  })

  test('LEV-84 a second admin revoking leave keeps the original approver, approval time and decision reason on the row', async () => {
    const req = await file(ada, 'annual')
    assert.equal((await approve(adminOne, req.id)).status, 200)
    const approved = await row(req.id)

    const res = await revoke(secondAdminOne, req.id)

    assert.equal(res.status, 200, res.text)
    const r = await row(req.id)
    assert.equal(r.status, 'revoked')
    assert.equal(r.decidedByStaffId, adminOne.staffId, 'the approver stays recorded')
    assert.equal(r.decidedAt?.getTime(), approved.decidedAt?.getTime(), 'the approval time stays')
    assert.equal(r.decisionReason, approved.decisionReason, 'the decision reason is not overwritten')
    // Who revoked it is on the audit trail, not in the decision columns.
    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.targetId, req.id), eq(schema.auditLog.actorStaffId, secondAdminOne.staffId)))
    assert.ok(audit.some(a => a.action.endsWith('/revoke')), 'the revoking admin is on the audit log')
    // And the email names the one who revoked, not the one who approved.
    const mail = mailTo(ada.email, 'leave_revoked').filter(m => m.html.includes(secondAdminOne.name))
    assert.equal(mail.length, 1)
  })

  test('LEV-86 an instructor — or a member — is refused approve, reject and revoke, even on his own request', async () => {
    const pending = await file(ada, 'annual')
    const toRevoke = await file(ada, 'annual')
    assert.equal((await approve(adminOne, toRevoke.id)).status, 200)

    for (const caller of [ada, ben] as const) {
      refused(await approve(caller, pending.id), 403, 'forbidden_role', 'approve')
      refused(await reject(caller, pending.id, 'nope'), 403, 'forbidden_role', 'reject')
      refused(await revoke(caller, toRevoke.id), 403, 'forbidden_role', 'revoke')
      // There is no decision route under the instructor's own subtree either.
      for (const action of ['approve', 'reject', 'revoke']) {
        const res = await call(caller, 'POST', `/instructor/leave/${pending.id}/${action}`, { reason: 'x' })
        assert.equal(res.status, 404, `${action} under /instructor: ${res.text}`)
      }
    }
    refusedAsMember(await approve(memberOne, pending.id), 'member approve')
    refusedAsMember(await reject(memberOne, pending.id, 'nope'), 'member reject')
    refusedAsMember(await revoke(memberOne, toRevoke.id), 'member revoke')

    assert.equal((await row(pending.id)).status, 'pending')
    assert.equal((await row(toRevoke.id)).status, 'approved')
  })

  test('LEV-79, LEV-80, LEV-83 another studio’s admin cannot approve, reject or revoke a request here: not found, and nothing changes', async () => {
    const pending = await file(ben, 'annual')
    const approvedReq = await file(ben, 'annual')
    assert.equal((await approve(adminOne, approvedReq.id)).status, 200)
    const mailsBefore = sent.length

    const a = await approve(adminTwo, pending.id)
    const r = await reject(adminTwo, pending.id, 'from elsewhere')
    const v = await revoke(adminTwo, approvedReq.id)

    for (const res of [a, r, v]) {
      assert.equal(res.status, 404, res.text)
      assert.equal(res.body.error, 'leave_request_not_found')
    }
    assert.equal((await row(pending.id)).status, 'pending')
    assert.equal((await row(pending.id)).decidedByStaffId, null)
    assert.equal((await row(approvedReq.id)).status, 'approved')
    assert.equal(sent.length, mailsBefore, 'nobody was emailed')
  })

  // ── The instructor's own transitions ───────────────────────────────────────

  test('LEV-87 an instructor withdraws his own pending request: withdrawn, and the days are back immediately', async () => {
    const start = await remaining(ada, 'study')
    const req = await file(ada, 'study', { days: 2 })
    assert.equal(await remaining(ada, 'study'), start - 2)

    const res = await withdraw(ada, req.id)

    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.status, 'withdrawn')
    assert.equal((await row(req.id)).status, 'withdrawn')
    assert.equal(await remaining(ada, 'study'), start)
  })

  test('LEV-88 an instructor cancels his own approved leave that starts after today: cancelled, and the days are back immediately', async () => {
    const start = await remaining(ben, 'annual')
    const req = await file(ben, 'annual', { days: 2 })
    assert.equal((await approve(adminOne, req.id)).status, 200)
    assert.equal(await remaining(ben, 'annual'), start - 2)

    const res = await cancel(ben, req.id)

    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.status, 'cancelled')
    assert.equal((await row(req.id)).status, 'cancelled')
    assert.equal(await remaining(ben, 'annual'), start)
  })

  test('LEV-89, LEV-91 withdraw is refused once a request is no longer pending, and cancel is refused unless it is approved', async () => {
    // LEV-89: every state a request can leave pending for.
    const fin = await staff(harness.tenants.one, 'fin', 'instructor')
    for (const state of ['approved', 'rejected', 'withdrawn', 'cancelled', 'revoked'] as const) {
      const id = await inState(fin, state)
      refused(await withdraw(fin, id), 409, 'leave_not_pending', `withdraw ${state}`)
      assert.equal((await row(id)).status, state, `${state} stays ${state}`)
    }

    const pending = await file(cal, 'annual')
    const rejected = await file(cal, 'annual')
    assert.equal((await reject(adminOne, rejected.id, `No ${run}`)).status, 200)
    for (const id of [pending.id, rejected.id]) {
      const c = await cancel(cal, id)
      assert.equal(c.status, 409, c.text)
      assert.equal(c.body.error, 'leave_not_approved')
    }
    assert.equal((await row(pending.id)).status, 'pending')
    assert.equal((await row(rejected.id)).status, 'rejected')
  })

  test('LEV-85, LEV-90 approved leave that has already started can be neither revoked by an admin nor cancelled by its instructor', async () => {
    // Medical is the one type that may be filed after the fact.
    const req = await file(cal, 'medical', { start: sgDayOffset(-2), end: sgDayOffset(1) })
    assert.equal((await approve(adminOne, req.id)).status, 200)

    const v = await revoke(adminOne, req.id)
    assert.equal(v.status, 409, v.text)
    assert.equal(v.body.error, 'leave_already_started')
    const c = await cancel(cal, req.id)
    assert.equal(c.status, 409, c.text)
    assert.equal(c.body.error, 'leave_already_started')
    assert.equal((await row(req.id)).status, 'approved')
  })

  test('LEV-92 another instructor — or a member — cannot withdraw or cancel a request that is not his', async () => {
    const pending = await file(ada, 'annual')
    const approvedReq = await file(ada, 'annual')
    assert.equal((await approve(adminOne, approvedReq.id)).status, 200)

    // Scoped to the caller's own requests: someone else's is simply not found.
    refused(await withdraw(ben, pending.id), 404, 'leave_request_not_found', 'colleague withdraw')
    refused(await cancel(ben, approvedReq.id), 404, 'leave_request_not_found', 'colleague cancel')
    // An admin reaches the instructor routes, but is not the owning instructor either.
    refused(await withdraw(adminOne, pending.id), 404, 'leave_request_not_found', 'admin withdraw')
    refused(await cancel(adminOne, approvedReq.id), 404, 'leave_request_not_found', 'admin cancel')
    // Nor another studio's instructor.
    refused(await withdraw(dee, pending.id), 404, 'leave_request_not_found', 'other studio withdraw')
    refusedAsMember(await withdraw(memberOne, pending.id), 'member withdraw')
    refusedAsMember(await cancel(memberOne, approvedReq.id), 'member cancel')

    assert.equal((await row(pending.id)).status, 'pending')
    assert.equal((await row(approvedReq.id)).status, 'approved')
  })

  // ── Supporting Documents ───────────────────────────────────────────────────

  test('LEV-65 a medical request takes a jpg, png or pdf of 5MB or less as its Supporting Document', async () => {
    for (const [type, ext] of [
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['application/pdf', 'pdf'],
    ] as const) {
      const req = await file(ada, 'medical')
      const bytes = fileBytes(2048, ext.length)

      const res = await upload(ada, req.id, bytes, type, `note.${ext}`)

      assert.equal(res.status, 200, res.text)
      assert.equal(res.body.has_supporting_document, true)
      const key = (await row(req.id)).supportingDocumentR2Key
      assert.ok(key, 'the key is stored on the request')
      assert.ok(key.startsWith(`t/${harness.tenants.one.id}/`), `under the studio's prefix: ${key}`)
      assert.ok(key.endsWith(`.${ext}`))
      assert.deepEqual(bucket.get(key)?.bytes, bytes, 'the object is in the bucket')
      assert.equal(bucket.get(key)?.contentType, type)
    }
  })

  test('LEV-66 a study request takes a Supporting Document exactly as a medical one does', async () => {
    const req = await file(ben, 'study')
    const bytes = fileBytes(4096, 3)

    const res = await upload(ben, req.id, bytes, 'application/pdf', 'course.pdf')

    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.has_supporting_document, true)
    const key = (await row(req.id)).supportingDocumentR2Key
    assert.ok(key)
    assert.deepEqual(bucket.get(key)?.bytes, bytes)
  })

  test('LEV-67 medical leave with no Supporting Document is accepted — the document is optional', async () => {
    const res = await call(ben, 'POST', '/instructor/leave', {
      type: 'medical',
      start_date: sgToday(),
      end_date: sgToday(),
      reason: `Fever ${run}`,
    })

    assert.equal(res.status, 201, res.text)
    assert.equal(res.body.status, 'pending')
    assert.equal(res.body.has_supporting_document, false)
    assert.equal((await row(res.body.id)).supportingDocumentR2Key, null)
  })

  test('LEV-68 a second upload replaces the first: the request still holds exactly one Supporting Document', async () => {
    const req = await file(ada, 'medical')
    const first = fileBytes(1000, 1)
    const second = fileBytes(1500, 2)
    assert.equal((await upload(ada, req.id, first, 'image/png', 'a.png')).status, 200)
    const firstKey = (await row(req.id)).supportingDocumentR2Key

    const res = await upload(ada, req.id, second, 'application/pdf', 'b.pdf')

    assert.equal(res.status, 200, res.text)
    const key = (await row(req.id)).supportingDocumentR2Key
    assert.ok(key && firstKey)
    assert.notEqual(key, firstKey)
    assert.deepEqual(bucket.get(key)?.bytes, second)
    // What an admin retrieves is the second file.
    const url = await call(adminOne, 'GET', `/admin/leave/${req.id}/document`)
    assert.equal(url.status, 200, url.text)
    assert.deepEqual(followSignedUrl(url.body.url).object?.bytes, second)
  })

  test('LEV-69, LEV-70 an annual request takes no Supporting Document, and a file that is not jpg, png or pdf is refused', async () => {
    const annual = await file(ben, 'annual')
    const a = await upload(ben, annual.id, fileBytes(100), 'application/pdf', 'x.pdf')
    assert.equal(a.status, 400, a.text)
    assert.equal(a.body.error, 'document_not_allowed_on_annual_leave')
    assert.equal((await row(annual.id)).supportingDocumentR2Key, null)

    const medical = await file(ben, 'medical')
    for (const type of ['text/plain', 'image/gif', 'application/zip']) {
      const res = await upload(ben, medical.id, fileBytes(100), type, 'x.bin')
      assert.equal(res.status, 400, `${type}: ${res.text}`)
      assert.equal(res.body.error, 'document_type_not_allowed')
    }
    assert.equal((await row(medical.id)).supportingDocumentR2Key, null)
  })

  test('LEV-71 a Supporting Document just under the maximum is accepted and one just over is refused as too large', async () => {
    const req = await file(cal, 'medical')

    const under = await upload(cal, req.id, fileBytes(MAX_BYTES - 1), 'application/pdf', 'under.pdf')
    assert.equal(under.status, 200, `just under the maximum: ${under.status} ${under.text}`)
    assert.equal(under.body.has_supporting_document, true)

    const overReq = await file(cal, 'medical')
    const over = await upload(cal, overReq.id, fileBytes(MAX_BYTES + 1), 'application/pdf', 'over.pdf')
    // One byte over: the body still fits the envelope allowance, so it is the
    // service's byte rule that refuses it.
    refused(over, 400, 'document_too_large', 'just over the maximum')
    assert.equal((await row(overReq.id)).supportingDocumentR2Key, null)
  })

  test('LEV-73 an admin asks for a Supporting Document and gets a short-lived signed URL that retrieves the file', async () => {
    const req = await file(ada, 'medical')
    const bytes = fileBytes(3000, 9)
    assert.equal((await upload(ada, req.id, bytes, 'image/jpeg', 'mc.jpg')).status, 200)

    const res = await call(adminOne, 'GET', `/admin/leave/${req.id}/document`)

    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.expires_in, 300)
    const got = followSignedUrl(res.body.url)
    assert.equal(got.key, (await row(req.id)).supportingDocumentR2Key)
    assert.deepEqual(got.object?.bytes, bytes)
  })

  test('LEV-74 the owning instructor gets a signed URL for his own Supporting Document', async () => {
    const req = await file(ben, 'medical')
    const bytes = fileBytes(1234, 4)
    assert.equal((await upload(ben, req.id, bytes, 'image/png', 'mc.png')).status, 200)

    const res = await call(ben, 'GET', `/instructor/leave/${req.id}/document`)

    assert.equal(res.status, 200, res.text)
    assert.deepEqual(followSignedUrl(res.body.url).object?.bytes, bytes)
  })

  test('LEV-75 a colleague is refused another instructor’s Supporting Document before learning whether one exists; a member and another studio are refused too', async () => {
    const withDoc = await file(ada, 'medical')
    assert.equal((await upload(ada, withDoc.id, fileBytes(500), 'application/pdf', 'x.pdf')).status, 200)
    const withoutDoc = await file(ada, 'medical')

    const a = await call(ben, 'GET', `/instructor/leave/${withDoc.id}/document`)
    const b = await call(ben, 'GET', `/instructor/leave/${withoutDoc.id}/document`)

    assert.equal(a.status, 403, a.text)
    assert.equal(a.body.error, 'leave_not_yours')
    assert.equal(b.status, a.status, 'the same answer whether or not a document exists')
    assert.deepEqual(b.body, a.body)
    assert.ok(!a.text.includes('supporting-documents') && !a.text.includes('url'), 'no key, no URL')

    const m = await call(memberOne, 'GET', `/instructor/leave/${withDoc.id}/document`)
    refusedAsMember(m, 'member')
    assert.ok(!m.text.includes('X-Amz'), 'no URL')
    for (const path of [`/admin/leave/${withDoc.id}/document`, `/instructor/leave/${withDoc.id}/document`]) {
      const other = await call(path.startsWith('/admin') ? adminTwo : dee, 'GET', path)
      assert.equal(other.status, 404, `another studio on ${path}: ${other.text}`)
      assert.ok(!other.text.includes('X-Amz'), 'no URL')
    }
  })

  test('LEV-76 the leave calendar, the approval queue and the instructor’s own reads say only whether a Supporting Document exists, never its key', async () => {
    const req = await file(cal, 'medical')
    assert.equal((await upload(cal, req.id, fileBytes(700), 'application/pdf', 'x.pdf')).status, 200)
    const key = (await row(req.id)).supportingDocumentR2Key!
    assert.ok(key)

    const queue = await call(adminOne, 'GET', '/admin/leave?status=all')
    const adminCal = await call(adminOne, 'GET', `/leave-calendar?from=${YEAR}-01-01&to=${YEAR}-12-31`)
    const ownCal = await call(cal, 'GET', `/leave-calendar?from=${YEAR}-01-01&to=${YEAR}-12-31`)
    const own = await call(cal, 'GET', `/instructor/leave?year=${YEAR}`)

    for (const [label, res] of [['queue', queue], ['admin calendar', adminCal], ['own calendar', ownCal], ['own history', own]] as const) {
      assert.equal(res.status, 200, `${label}: ${res.text}`)
      assert.ok(!res.text.includes(key), `${label} leaks the key`)
      assert.ok(!res.text.includes('supporting-documents/'), `${label} leaks a key`)
      assert.ok(!res.text.includes('r2_key') && !res.text.includes('R2Key'), `${label} names a key field`)
    }
    const q = queue.body.leave_requests.find((r: any) => r.id === req.id)
    assert.equal(q.has_supporting_document, true)
    const c = adminCal.body.leave.find((r: any) => r.id === req.id)
    assert.equal(c.detail.has_supporting_document, true)
    const o = own.body.requests.find((r: any) => r.id === req.id)
    assert.equal(o.has_supporting_document, true)
  })

  test('LEV-77 a Supporting Document stored under the old key prefix still resolves to the original file', async () => {
    const req = await file(ada, 'medical')
    // As the rename left it: a row whose key predates the new prefix, and the
    // object sitting in the bucket under exactly that key.
    const legacyKey = `medical-certificates/${ada.staffId}/${req.id}.pdf`
    const bytes = fileBytes(900, 5)
    bucket.set(legacyKey, { bytes, contentType: 'application/pdf' })
    await harness.db
      .update(schema.leaveRequests)
      .set({ supportingDocumentR2Key: legacyKey })
      .where(eq(schema.leaveRequests.id, req.id))

    const res = await call(adminOne, 'GET', `/admin/leave/${req.id}/document`)

    assert.equal(res.status, 200, res.text)
    const got = followSignedUrl(res.body.url)
    assert.equal(got.key, legacyKey)
    assert.deepEqual(got.object?.bytes, bytes)
  })

  // ── The queue and the calendar ─────────────────────────────────────────────

  test('LEV-78 the pending queue lists every pending request in the studio with its type, reason and Supporting Document flag — and none from another studio', async () => {
    const adaMedical = await file(ada, 'medical')
    assert.equal((await upload(ada, adaMedical.id, fileBytes(300), 'image/png', 'x.png')).status, 200)
    const benAnnual = await file(ben, 'annual')
    const calStudy = await file(cal, 'study')
    const deeAnnual = await file(dee, 'annual')

    const res = await call(adminOne, 'GET', '/admin/leave')

    assert.equal(res.status, 200, res.text)
    const byId = new Map<string, any>(res.body.leave_requests.map((r: any) => [r.id, r]))
    for (const [req, who, type, doc] of [
      [adaMedical, ada, 'medical', true],
      [benAnnual, ben, 'annual', false],
      [calStudy, cal, 'study', false],
    ] as const) {
      const entry = byId.get(req.id)
      assert.ok(entry, `${who.name}'s ${type} request is in the queue`)
      assert.equal(entry.status, 'pending')
      assert.equal(entry.type, type)
      assert.equal(entry.reason, req.reason)
      assert.equal(entry.has_supporting_document, doc)
      assert.equal(entry.instructor.id, who.staffId)
    }
    assert.ok(res.body.leave_requests.every((r: any) => r.status === 'pending'), 'only pending')
    assert.ok(!byId.has(deeAnnual.id), 'another studio’s request is not in the queue')
    assert.ok(!res.text.includes(deeAnnual.reason))

    // And the other way round.
    const theirs = await call(adminTwo, 'GET', '/admin/leave?status=all')
    assert.equal(theirs.status, 200)
    assert.ok(theirs.body.leave_requests.some((r: any) => r.id === deeAnnual.id))
    assert.ok(!theirs.body.leave_requests.some((r: any) => [adaMedical.id, benAnnual.id, calStudy.id].includes(r.id)))
  })

  test('LEV-109 an admin reading the leave calendar sees the Leave Type, reason, decision reason and document flag on every entry — and nothing from another studio', async () => {
    const annual = await file(ada, 'annual')
    assert.equal((await approve(adminOne, annual.id)).status, 200)
    const medical = await file(ben, 'medical')
    assert.equal((await upload(ben, medical.id, fileBytes(200), 'application/pdf', 'x.pdf')).status, 200)
    const study = await file(cal, 'study')
    const theirs = await file(dee, 'annual')

    const res = await call(adminOne, 'GET', `/leave-calendar?from=${YEAR}-01-01&to=${YEAR}-12-31`)

    assert.equal(res.status, 200, res.text)
    const byId = new Map<string, any>(res.body.leave.map((e: any) => [e.id, e]))
    for (const [req, type, doc] of [
      [annual, 'annual', false],
      [medical, 'medical', true],
      [study, 'study', false],
    ] as const) {
      const e = byId.get(req.id)
      assert.ok(e, `${type} entry on the calendar`)
      assert.ok(e.detail, 'full detail for an admin')
      assert.equal(e.detail.type, type)
      assert.equal(e.detail.reason, req.reason)
      assert.ok('decision_reason' in e.detail)
      assert.equal(e.detail.has_supporting_document, doc)
    }
    assert.equal(byId.get(annual.id).detail.decided_by, adminOne.name)
    assert.ok(res.body.leave.every((e: any) => e.detail !== null), 'every entry carries detail for an admin')
    assert.ok(!byId.has(theirs.id), 'another studio’s leave is not on this calendar')
    assert.ok(!res.text.includes(theirs.reason))
  })

  test('LEV-110 an instructor reading his own leave sees type, reason and decision reason — on the calendar and in his history', async () => {
    const pending = await file(ada, 'study')
    const rejected = await file(ada, 'annual')
    const why = `Clashes with the retreat ${run}`
    assert.equal((await reject(adminOne, rejected.id, why)).status, 200)

    const calRes = await call(ada, 'GET', `/leave-calendar?from=${YEAR}-01-01&to=${YEAR}-12-31`)
    assert.equal(calRes.status, 200, calRes.text)
    const mine = calRes.body.leave.find((e: any) => e.id === pending.id)
    assert.ok(mine?.detail, 'his own entry carries detail')
    assert.equal(mine.detail.type, 'study')
    assert.equal(mine.detail.reason, pending.reason)
    assert.ok('decision_reason' in mine.detail)

    const history = await call(ada, 'GET', `/instructor/leave?year=${YEAR}`)
    assert.equal(history.status, 200, history.text)
    const h = history.body.requests.find((r: any) => r.id === rejected.id)
    assert.equal(h.type, 'annual')
    assert.equal(h.reason, rejected.reason)
    assert.equal(h.decision_reason, why)
    assert.equal(h.status, 'rejected')
    const p = history.body.requests.find((r: any) => r.id === pending.id)
    assert.equal(p.type, 'study')
    assert.equal(p.reason, pending.reason)
  })

  test('LEV-111 an instructor reading the all-staff calendar sees each colleague and their dates, but not the type, reason, decision reason, document or cap flag', async () => {
    const colleagueMedical = await file(ben, 'medical')
    assert.equal((await upload(ben, colleagueMedical.id, fileBytes(200), 'application/pdf', 'x.pdf')).status, 200)
    const colleagueStudy = await file(cal, 'study')
    assert.equal((await approve(adminOne, colleagueStudy.id)).status, 200)

    const res = await call(ada, 'GET', `/leave-calendar?from=${YEAR}-01-01&to=${YEAR}-12-31`)

    assert.equal(res.status, 200, res.text)
    for (const [req, who] of [
      [colleagueMedical, ben],
      [colleagueStudy, cal],
    ] as const) {
      const e = res.body.leave.find((x: any) => x.id === req.id)
      assert.ok(e, `${who.name}'s leave is on the calendar`)
      assert.equal(e.instructor.id, who.staffId)
      assert.equal(e.instructor.name, who.name)
      assert.equal(e.start_date, req.start)
      assert.equal(e.end_date, req.end)
      assert.equal(e.detail, null, 'no detail on a colleague’s entry')
      for (const field of ['type', 'reason', 'decision_reason', 'has_supporting_document', 'over_cap', 'days', 'decided_by']) {
        assert.ok(!(field in e), `no ${field} at the top level`)
      }
      assert.ok(!res.text.includes(req.reason), 'the colleague’s reason is nowhere in the body')
    }
    const colleagueEntries = res.body.leave.filter((e: any) => e.instructor.id !== ada.staffId)
    assert.ok(colleagueEntries.length >= 2)
    assert.ok(colleagueEntries.every((e: any) => e.detail === null))
  })

  // ── Mail failures ──────────────────────────────────────────────────────────

  test('LEV-117 when the mail transport fails, a submission is still recorded and the failure is logged with the full error', async () => {
    const failure = new Error(`transport down ${run} (submission)`)
    harness.logs.clear()
    mailFailure = failure
    let res: Res
    const dates = nextDates()
    try {
      res = await call(ada, 'POST', '/instructor/leave', {
        type: 'annual',
        start_date: dates.start,
        end_date: dates.end,
        reason: `Mail fails ${run}`,
      })
    } finally {
      mailFailure = null
    }

    assert.equal(res.status, 201, res.text)
    assert.equal((await row(res.body.id)).status, 'pending')
    const logged = errorLines().filter(l => (l.err as any)?.message === failure.message)
    assert.ok(logged.length >= 1, `the failure is logged: ${JSON.stringify(errorLines())}`)
    const line = logged[0]!
    assert.equal(line.template, 'leave_request_submitted')
    const err = line.err as { message: string; stack?: string; type?: string }
    assert.ok(err.stack?.includes(failure.message), 'the error object, stack and all')
    assert.equal(err.type, 'Error')
  })

  test('LEV-118 when the mail transport fails, approve, reject and revoke still stand and each failure is logged with the full error', async () => {
    const toApprove = await file(ben, 'annual')
    const toReject = await file(ben, 'annual')
    const toRevoke = await file(ben, 'annual')
    assert.equal((await approve(adminOne, toRevoke.id)).status, 200)

    const failure = new Error(`transport down ${run} (decision)`)
    harness.logs.clear()
    mailFailure = failure
    const results: Res[] = []
    try {
      results.push(await approve(adminOne, toApprove.id))
      results.push(await reject(adminOne, toReject.id, `No cover ${run}`))
      results.push(await revoke(adminOne, toRevoke.id))
    } finally {
      mailFailure = null
    }

    for (const res of results) assert.equal(res.status, 200, res.text)
    assert.equal((await row(toApprove.id)).status, 'approved')
    assert.equal((await row(toReject.id)).status, 'rejected')
    assert.equal((await row(toRevoke.id)).status, 'revoked')

    const logged = errorLines().filter(l => (l.err as any)?.message === failure.message)
    for (const slug of ['leave_approved', 'leave_rejected', 'leave_revoked']) {
      const line = logged.find(l => l.template === slug)
      assert.ok(line, `the ${slug} failure is logged: ${JSON.stringify(logged)}`)
      const err = line.err as { stack?: string }
      assert.ok(err.stack?.includes(failure.message), `${slug}: the error object, stack and all`)
      assert.equal(line.to, ben.email)
    }
  })
})
