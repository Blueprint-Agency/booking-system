import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { MailTransport, OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.pt-request-emails.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const PT_PACKAGE_NAME = `PT-mail sessions ${run}`
const ROOM_NAME = `PT-mail room ${run}`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The private-session emails a request sends (NTF-55 .. NTF-59): received, when
 * the member submits it; confirmed, when staff schedule it, which is the
 * implicit approval; expired, when it lapses unanswered. Each is read back from
 * a recording transport, so every message the action sent is seen: one per
 * recipient, the right template, the words it was rendered with, nobody else
 * mailed, and nothing mailed for a call that was refused.
 */
describe('private session request emails over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let jobs!: typeof import('../jobs')
  let ptPackagesSvc!: typeof import('../services/packages/pt-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type SessionType = '1on1' | '2on1'
  type Studio = { id: string; slug: string; locationId: string; locationName: string; roomId: string; pt: Record<SessionType, string> }
  type Staff = { staffId: string; name: string; headers: Record<string, string> }
  type Member = { clientId: string; name: string; email: string; headers: Record<string, string> }

  let one!: Studio
  let admin!: Staff
  let coach!: Staff
  let made = 0

  const sent: OutboundMessage[] = []
  const recording: MailTransport = {
    name: 'null',
    async send(message) {
      sent.push(message)
      return { messageId: `pt-request-emails-${sent.length}`, response: 'recorded' }
    },
  }
  let restoreMail: () => void = () => {}
  const templateOf = (m: OutboundMessage) => m.tags.find(t => t.name === 'template')?.value
  /** Every message sent since the last call, and forget them. */
  const drain = () => sent.splice(0).map(m => ({ to: m.to, template: templateOf(m), subject: m.subject, text: m.text ?? '', html: m.html }))
  const pairs = (mail: ReturnType<typeof drain>) => mail.map(m => [m.to, m.template])

  const expectStatus = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as any) : null
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db
      .select({ id: schema.locations.id, name: schema.locations.name })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenant.id))
      .limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location.id, name: ROOM_NAME, capacity: 4 })
      .returning({ id: schema.rooms.id })
    const ptPackage = (sessionType: SessionType) =>
      ptPackagesSvc.createPtPackage(tenant.id, {
        name: `${PT_PACKAGE_NAME} ${sessionType}`,
        sessionType,
        numSessions: 10,
        validityDays: 90,
        priceSgd: '900.00',
      })
    return {
      ...tenant,
      locationId: location.id,
      locationName: location.name,
      roomId: room!.id,
      pt: { '1on1': (await ptPackage('1on1')).id, '2on1': (await ptPackage('2on1')).id },
    }
  }

  async function staff(at: Studio, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = `${name}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, at)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, at.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    return { staffId: row!.id, name, headers }
  }

  async function member(at: Studio, name = `Member${made}`): Promise<Member> {
    const email = `member-${made++}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, name, email, headers }
  }

  async function givePt(at: Studio, who: Member, sessionType: SessionType): Promise<string> {
    const { clientPackageId } = await purchaseSvc.grantPackage(at.id, {
      clientId: who.clientId,
      purchaseId: null,
      amountSgd: '900.00',
      packageKind: 'pt',
      packageId: at.pt[sessionType],
    })
    return clientPackageId
  }

  /* ── routes ─────────────────────────────────────────────────────────── */

  const slotDate = () => new Date(harness.clock.now().getTime() + 5 * DAY + 8 * HOUR).toISOString().slice(0, 10)

  const submit = (at: Studio, who: Member, sessionType: SessionType, clientPackageId: string, partner?: Member) =>
    harness.app.request('/api/v1/me/pt-sessions/request', {
      method: 'POST',
      headers: { ...who.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId: at.locationId,
        sessionType,
        clientPackageId,
        slots: [
          { proposedDate: slotDate(), startTime: '09:00' },
          { proposedDate: slotDate(), startTime: '14:30' },
        ],
        ...(partner ? { partner: { kind: 'existing', coClientId: partner.clientId } } : {}),
      }),
    })

  async function request(at: Studio, who: Member, sessionType: SessionType, clientPackageId: string, partner?: Member): Promise<string> {
    return (await expectStatus(await submit(at, who, sessionType, clientPackageId, partner), 201)).pt_request_id as string
  }

  let slots = 0
  const nextStart = () => new Date(Date.now() + 3 * DAY + slots++ * 2 * HOUR)

  const scheduleBody = (at: Studio, startsAt: Date, instructorId?: string) => ({
    location_id: at.locationId,
    room_id: at.roomId,
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
    ...(instructorId ? { instructor_id: instructorId } : {}),
  })

  const adminSchedule = (at: Studio, requestId: string, startsAt = nextStart()) =>
    harness.app.request(`/api/v1/portal/admin/pt-sessions/${requestId}/schedule`, {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...scheduleBody(at, startsAt, coach.staffId), instructor_pay_sgd: 60 }),
    })

  const instructorSchedule = (at: Studio, requestId: string, startsAt = nextStart()) =>
    harness.app.request(`/api/v1/portal/instructor/pt-requests/${requestId}/schedule`, {
      method: 'POST',
      headers: { ...coach.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(scheduleBody(at, startsAt)),
    })

  const memberCancelRequest = (who: Member, requestId: string) =>
    harness.app.request(`/api/v1/me/pt-sessions/${requestId}/cancel`, { method: 'POST', headers: who.headers })

  /**
   * Move the clock a minute past the request's expiry and run the expiry job,
   * which ends every request that has lapsed by then, this file's others
   * included. Returns the mail the job sent to `watching`, and forgets the rest.
   */
  async function expireAfter(requestId: string, watching: Member[]) {
    const [row] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, requestId))
    harness.clock.set(new Date(row!.expiresAt!.getTime() + MINUTE))
    await jobs.scheduledJobs.expireStaleSessions()
    const emails = watching.map(w => w.email)
    return drain().filter(m => emails.includes(m.to))
  }

  const balance = async (clientPackageId: string) =>
    (await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, clientPackageId)))[0]!.creditsOrSessionsRemaining

  const logRows = (email: string) =>
    harness.db
      .select({ slug: schema.emailLog.templateSlug, status: schema.emailLog.status })
      .from(schema.emailLog)
      .where(eq(schema.emailLog.recipientEmail, email))

  async function switchOff(slug: string): Promise<() => Promise<void>> {
    await harness.db.insert(schema.emailSwitches).values({ tenantId: one.id, slug, enabled: false })
    return async () => {
      await harness.db.delete(schema.emailSwitches).where(and(eq(schema.emailSwitches.tenantId, one.id), eq(schema.emailSwitches.slug, slug)))
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    jobs = await import('../jobs')
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    restoreMail = (await import('../lib/mailer')).useTransport(recording)
    one = await studio(harness.tenants.one)
    admin = await staff(one, 'ptmail-admin', 'admin')
    coach = await staff(one, 'ptmail-coach', 'instructor')
  })

  after(async () => {
    if (!harness) return
    restoreMail()
    try {
      harness.clock.reset()
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
      const sessions = sql`SELECT id FROM pt_sessions WHERE pt_request_id IN (${requests})`
      const exec = (q: ReturnType<typeof sql>) => harness.db.execute(q)
      await exec(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await exec(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await exec(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${requests})`)
      await exec(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${sessions})`)
      await exec(sql`DELETE FROM pt_sessions WHERE id IN (${sessions})`)
      await exec(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
      await exec(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await exec(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await exec(sql`DELETE FROM pt_packages WHERE name LIKE ${`${PT_PACKAGE_NAME}%`}`)
      await exec(sql`DELETE FROM rooms WHERE name = ${ROOM_NAME}`)
      await exec(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
      await exec(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await exec(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await exec(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await exec(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  /* ── NTF-55: received ──────────────────────────────────────────────── */

  test('NTF-55 submitting a request emails the requester that it was received, naming each time they proposed, and nobody else', async () => {
    const ana = await member(one, 'Ana')
    const partner = await member(one, 'Pia')
    const solo = await givePt(one, ana, '1on1')
    const pair = await givePt(one, ana, '2on1')
    drain()

    await request(one, ana, '1on1', solo)
    const mail = drain()
    assert.deepEqual(pairs(mail), [[ana.email, 'pt_request_submitted']])
    assert.equal(mail[0]!.subject, 'Your private session request was received')
    assert.match(mail[0]!.text, /Hi Ana,/)
    assert.match(mail[0]!.text, /9:00 am or .*2:30 pm/, 'both proposed times, as the member typed them')
    assert.match(mail[0]!.text, /The session for this request is held from your package until it is answered\./)
    assert.doesNotMatch(mail[0]!.text, /deducted/i)
    assert.equal(await balance(solo), 9, 'the session is in fact held: submitting debits the package')

    await request(one, ana, '2on1', pair, partner)
    assert.deepEqual(pairs(drain()), [[ana.email, 'pt_request_submitted']], 'the partner is not mailed on submission')
  })

  test('NTF-55 a request the studio refuses sends no email', async () => {
    const bea = await member(one, 'Bea')
    const solo = await givePt(one, bea, '1on1')
    drain()

    await expectStatus(await submit(one, bea, '2on1', solo), 400)
    assert.deepEqual(drain(), [])
  })

  test('NTF-56 with the received email switched off the requester is not mailed and the send is logged skipped; the request is still made', async () => {
    const restore = await switchOff('pt_request_submitted')
    try {
      const cat = await member(one, 'Cat')
      const solo = await givePt(one, cat, '1on1')
      drain()

      const requestId = await request(one, cat, '1on1', solo)
      assert.ok(requestId)
      assert.deepEqual(drain(), [])
      assert.deepEqual(await logRows(cat.email), [{ slug: 'pt_request_submitted', status: 'skipped' }])
    } finally {
      await restore()
    }
  })

  /* ── NTF-57: confirmed ─────────────────────────────────────────────── */

  test('NTF-57 staff scheduling a request emails the requester that it is confirmed, naming the instructor, the place and the time, with a link to their bookings', async () => {
    const dan = await member(one, 'Dan')
    const solo = await givePt(one, dan, '1on1')
    const requestId = await request(one, dan, '1on1', solo)
    drain()

    const startsAt = nextStart()
    await expectStatus(await adminSchedule(one, requestId, startsAt), 201)

    const mail = drain()
    assert.deepEqual(pairs(mail), [[dan.email, 'pt_session_approved']])
    assert.match(mail[0]!.subject, /^Your private session on .+ is confirmed$/)
    assert.ok(mail[0]!.text.includes(coach.name), 'the instructor is named')
    assert.ok(mail[0]!.text.includes(one.locationName), 'the Location is named')
    assert.match(mail[0]!.html, new RegExp(`href="http://${one.slug}\\.localhost:3000/account/bookings[^"]*"`), "the link is the studio's own app")
  })

  test('NTF-57 an instructor scheduling a request confirms it the same way, and a 2-on-1 partner, who holds a seat, is told too', async () => {
    const eve = await member(one, 'Eve')
    const fay = await member(one, 'Fay')
    const pair = await givePt(one, eve, '2on1')
    const requestId = await request(one, eve, '2on1', pair, fay)
    drain()

    await expectStatus(await instructorSchedule(one, requestId), 201)

    assert.deepEqual(
      pairs(drain()).sort(),
      [
        [eve.email, 'pt_session_approved'],
        [fay.email, 'pt_session_approved'],
      ].sort(),
    )
  })

  test('NTF-57 a schedule the studio refuses sends nothing, and a request already scheduled is not confirmed twice', async () => {
    const gus = await member(one, 'Gus')
    const solo = await givePt(one, gus, '1on1')
    const requestId = await request(one, gus, '1on1', solo)
    const startsAt = nextStart()
    await expectStatus(await adminSchedule(one, requestId, startsAt), 201)
    drain()

    await expectStatus(await adminSchedule(one, requestId, nextStart()), 409)
    assert.deepEqual(drain(), [], 'a second schedule of one request mails nobody')

    const hal = await member(one, 'Hal')
    const halRequest = await request(one, hal, '1on1', await givePt(one, hal, '1on1'))
    drain()
    await expectStatus(await adminSchedule(one, halRequest, startsAt), 409)
    assert.deepEqual(drain(), [], 'a schedule that clashes with the first session mails nobody')
  })

  test('NTF-58 the confirmation is sent whatever the studio\'s switch says, because staff did it to the member\'s request', async () => {
    const restore = await switchOff('pt_session_approved')
    try {
      const ivy = await member(one, 'Ivy')
      const requestId = await request(one, ivy, '1on1', await givePt(one, ivy, '1on1'))
      drain()

      await expectStatus(await adminSchedule(one, requestId), 201)
      assert.deepEqual(pairs(drain()), [[ivy.email, 'pt_session_approved']])
    } finally {
      await restore()
    }
  })

  /* ── NTF-59: expired ───────────────────────────────────────────────── */

  test('NTF-59 a request that lapses unanswered emails the requester that it expired, with its debit back, and a 2-on-1 partner is not mailed', async () => {
    harness.clock.set(new Date())
    const jon = await member(one, 'Jon')
    const kim = await member(one, 'Kim')
    const pair = await givePt(one, jon, '2on1')
    const requestId = await request(one, jon, '2on1', pair, kim)
    drain()

    const mail = await expireAfter(requestId, [jon, kim])
    assert.deepEqual(pairs(mail), [[jon.email, 'pt_request_expired']])
    assert.equal(mail[0]!.subject, 'Your private session request expired')
    assert.match(mail[0]!.text, /Hi Jon,/)
    assert.match(mail[0]!.text, /9:00 am or .*2:30 pm/, 'the times they proposed')
    assert.equal(await balance(pair), 10, 'both held sessions are back')
    assert.match(mail[0]!.text, /2 sessions have been returned to your package\./, 'the email says what the package took back')
    assert.doesNotMatch(mail[0]!.text, /nothing was deducted/i)
    harness.clock.reset()
  })

  test('NTF-61 a request that lapses on a package a Refund has Voided is emailed that it expired, and not that a session came back, because none did', async () => {
    harness.clock.set(new Date())
    const vera = await member(one, 'Vera')
    const solo = await givePt(one, vera, '1on1')
    const requestId = await request(one, vera, '1on1', solo)
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId: one.id, clientId: vera.clientId, kind: 'pt_package', totalSgd: '900.00', status: 'refunded' })
      .returning({ id: schema.purchases.id })
    await harness.db.update(schema.clientPackages).set({ purchaseId: purchase!.id, active: false }).where(eq(schema.clientPackages.id, solo))
    drain()

    const mail = await expireAfter(requestId, [vera])
    assert.deepEqual(pairs(mail), [[vera.email, 'pt_request_expired']])
    assert.match(mail[0]!.text, /was not answered in time, so it has expired\./)
    assert.doesNotMatch(mail[0]!.text, /returned to your package|deducted/i)
    assert.equal(await balance(solo), 9, 'the Voided package took nothing back')
    harness.clock.reset()
  })

  test('NTF-59 the expiry email is sent whatever the switch says, and a member cancelling their own pending request gets the cancelled email, not the expired one', async () => {
    harness.clock.set(new Date())
    const restore = await switchOff('pt_request_expired')
    try {
      const lee = await member(one, 'Lee')
      const mia = await member(one, 'Mia')
      const leeRequest = await request(one, lee, '1on1', await givePt(one, lee, '1on1'))
      const miaRequest = await request(one, mia, '1on1', await givePt(one, mia, '1on1'))
      drain()

      await expectStatus(await memberCancelRequest(mia, miaRequest), 200)
      assert.deepEqual(pairs(drain()), [[mia.email, 'pt_request_cancelled']])

      assert.deepEqual(pairs(await expireAfter(leeRequest, [lee, mia])), [[lee.email, 'pt_request_expired']])
    } finally {
      await restore()
      harness.clock.reset()
    }
  })

  test('NTF-59 a request an instructor or admin already scheduled does not expire, and nobody is mailed an expiry for it', async () => {
    harness.clock.set(new Date())
    const nat = await member(one, 'Nat')
    const requestId = await request(one, nat, '1on1', await givePt(one, nat, '1on1'))
    const startsAt = nextStart()
    await expectStatus(await adminSchedule(one, requestId, startsAt), 201)
    drain()

    assert.deepEqual(await expireAfter(requestId, [nat]), [])
    harness.clock.reset()
  })
})
