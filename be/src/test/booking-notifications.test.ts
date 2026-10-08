import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { MailTransport, OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.booking-notifications.test`
// Not ending in " Bundle" / " Flow" / " Retreat" / " Mat": isolation.test.ts purges those.
const NAME = `Notify ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The emails a booking and its cancellation send (#359: NTF-08, NTF-09,
 * NTF-10, NTF-11), each from the studio's own template row, read back from a
 * recording transport so every message the action sent is seen: one email per
 * recipient, the right template, the variables it was rendered with, and
 * nobody else mailed. A refused call — another studio's member, the wrong
 * role — sends nothing.
 */
describe('booking and cancellation emails over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  type Staff = { id: string; email: string; name: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    locationName: string
    roomId: string
    classTypeId: string
    bundleId: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; email: string; name: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio

  const sent: OutboundMessage[] = []
  const recording: MailTransport = {
    name: 'null',
    async send(message) {
      sent.push(message)
      return { messageId: `booking-notifications-${sent.length}`, response: 'recorded' }
    },
  }
  let restoreMail: () => void = () => {}
  const templateOf = (m: OutboundMessage) => m.tags.find(t => t.name === 'template')?.value
  /** Every message sent since the last call, as [recipient, template], and forget them. */
  const drain = () => sent.splice(0).map(m => ({ to: m.to, template: templateOf(m), subject: m.subject, text: m.text ?? '', html: m.html }))

  const json = { 'Content-Type': 'application/json' }
  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? JSON.parse(text) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  let people = 0
  async function staffAt(tenant: { id: string; slug: string }, role: 'admin' | 'instructor'): Promise<Staff> {
    const name = `${role === 'admin' ? 'Ada' : 'Ines'} ${people}`
    const email = `${role}-${people++}-${tenant.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, tenant.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    return { id: row!.id, email, name, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `${NAME} room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    const [classType] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: `${NAME} Vinyasa` })
      .returning({ id: schema.classTypes.id })
    const [bundle] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} ten pack`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    return {
      ...tenant,
      locationId: location!.id,
      locationName: location!.name,
      roomId: room!.id,
      classTypeId: classType!.id,
      bundleId: bundle!.id,
      admin: await staffAt(tenant, 'admin'),
      instructor: await staffAt(tenant, 'instructor'),
    }
  }

  let members = 0
  async function member(at: Studio, name = 'Mia'): Promise<Member> {
    const email = `member-${members++}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, name, headers }
  }

  /** A Credit Bundle holding `credits`, or an Unlimited Plan at the studio's Location, already Activated. */
  async function give(at: Studio, who: Member, kind: 'credit_bundle' | 'unlimited', credits = 10): Promise<string> {
    const unlimited = kind === 'unlimited'
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind,
        sourceClassPackageId: unlimited ? null : at.bundleId,
        locationId: unlimited ? at.locationId : null,
        durationMonths: unlimited ? 1 : null,
        validityDays: unlimited ? null : 90,
        creditsOrSessionsRemaining: unlimited ? null : credits,
        expiresAt: new Date(Date.now() + 60 * DAY),
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  let classSlots = 0
  async function addClass(at: Studio, options: { creditCost?: number } = {}): Promise<string> {
    const startsAt = new Date(Date.now() + 3 * DAY + classSlots++ * 2 * HOUR)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.instructor.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: options.creditCost ?? 1,
        createdByStaffId: at.admin.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /** A PT package holding `sessions` (after any debit the fixture records), Activated. */
  async function givePt(at: Studio, who: Member, sessions: number): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'pt',
        validityDays: 90,
        creditsOrSessionsRemaining: sessions,
        expiresAt: new Date(Date.now() + 60 * DAY),
        active: true,
        amountPaidSgd: '400.00',
        listPriceSgd: '400.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  const codes = () => ({ qrToken: randomUUID(), code: `RT-${randomUUID().slice(0, 6).toUpperCase()}` })

  let ptSlots = 0
  /**
   * A private session as the studio left it: a member's request, debited
   * `cost` sessions from `pkg` (the fixture's balance is already net of it),
   * pending — or scheduled with the instructor, a booking for the requester
   * and, on a 2-on-1, one for the partner.
   */
  async function ptRequest(
    at: Studio,
    who: Member,
    pkg: string,
    opts: { scheduled: boolean; partner?: Member; origin?: 'member' | 'portal' },
  ): Promise<{ requestId: string; sessionId: string | null; bookingId: string | null; startsAt: Date }> {
    const sessionType = opts.partner ? '2on1' : '1on1'
    const cost = opts.partner && opts.origin !== 'portal' ? 2 : 1
    const startsAt = new Date(Date.now() + 4 * DAY + ptSlots++ * 2 * HOUR)
    const [req] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        locationId: at.locationId,
        sessionType,
        coClientId: opts.partner?.clientId ?? null,
        status: opts.scheduled ? 'scheduled' : 'pending',
        origin: opts.origin ?? 'member',
        createdByStaffId: opts.origin === 'portal' ? at.admin.id : null,
        expiresAt: new Date(Date.now() + 2 * DAY),
        debitedClientPackageId: opts.origin === 'portal' ? null : pkg,
      })
      .returning({ id: schema.ptRequests.id })
    if (!opts.scheduled) return { requestId: req!.id, sessionId: null, bookingId: null, startsAt }
    const [session] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: at.id,
        ptRequestId: req!.id,
        instructorId: at.instructor.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        sessionType,
        capacityOnline: opts.partner ? 2 : 1,
        scheduledAt: new Date(),
        scheduledByStaffId: at.admin.id,
      })
      .returning({ id: schema.ptSessions.id })
    await harness.db.update(schema.ptRequests).set({ scheduledPtSessionId: session!.id }).where(eq(schema.ptRequests.id, req!.id))
    const [booking] = await harness.db
      .insert(schema.bookings)
      .values({ tenantId: at.id, clientId: who.clientId, kind: 'pt', ptSessionId: session!.id, clientPackageId: pkg, creditsOrSessionsUsed: cost, ...codes() })
      .returning({ id: schema.bookings.id })
    if (opts.partner) {
      const partnerPkg = opts.origin === 'portal' ? await givePt(at, opts.partner, 4) : null
      await harness.db.insert(schema.bookings).values({
        tenantId: at.id,
        clientId: opts.partner.clientId,
        kind: 'pt',
        ptSessionId: session!.id,
        clientPackageId: partnerPkg,
        creditsOrSessionsUsed: partnerPkg ? 1 : 0,
        ...codes(),
      })
    }
    return { requestId: req!.id, sessionId: session!.id, bookingId: booking!.id, startsAt }
  }

  const memberCancel = (who: Member, bookingId: string) =>
    harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers: who.headers })

  const balance = async (pkg: string) =>
    (await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, pkg)))[0]!.creditsOrSessionsRemaining

  const book = (who: Member, classId: string) =>
    harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({ class_id: classId }),
    })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    restoreMail = (await import('../lib/mailer')).useTransport(recording)
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    restoreMail()
    try {
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM clients WHERE email LIKE ${ours})`)
      await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'cancelledByStaffId' IN (SELECT id::text FROM staff_users WHERE email LIKE ${ours})`)
      await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM pt_sessions WHERE instructor_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (SELECT id FROM workshops WHERE created_by_staff_id IN (${staff}))`)
      await harness.db.execute(sql`DELETE FROM workshops WHERE created_by_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM rooms WHERE name LIKE ${`${NAME}%`}`)
    } finally {
      await harness.close()
    }
  })

  /* ── NTF-08 ─────────────────────────────────────────────────────────── */

  test('NTF-08 booking a class on a Credit Bundle emails the member one confirmation naming the credits used and the credits remaining', async () => {
    const mia = await member(one)
    await give(one, mia, 'credit_bundle', 10)
    const classId = await addClass(one, { creditCost: 2 })
    drain()

    const booked = await expectStatus(await book(mia, classId), 201)

    const mail = drain()
    assert.deepEqual(mail.map(m => [m.to, m.template]), [[mia.email, 'class_booking_confirmed']])
    const [confirmation] = mail
    assert.match(confirmation!.subject, new RegExp(`${NAME} Vinyasa`))
    assert.match(confirmation!.text, /This booking used 2 credits from .*ten pack, and 8 credits remain on it\./)
    assert.ok(confirmation!.text.includes(booked.code as string), 'the check-in code is in the email')
    assert.ok(confirmation!.text.includes(one.instructor.name), 'the instructor is named')
    assert.ok(confirmation!.text.includes(one.locationName), 'the Location is named')

    const logged = await harness.db.select().from(schema.emailLog).where(eq(schema.emailLog.recipientEmail, mia.email))
    assert.deepEqual(logged.map(r => [r.templateSlug, r.tenantId, r.status]), [['class_booking_confirmed', one.id, 'sent']])
  })

  test('NTF-08 booking a class on an Unlimited Plan says the plan covers it instead of counting credits', async () => {
    const leo = await member(one, 'Leo')
    await give(one, leo, 'unlimited')
    const classId = await addClass(one)
    drain()

    await expectStatus(await book(leo, classId), 201)

    const mail = drain()
    assert.deepEqual(mail.map(m => [m.to, m.template]), [[leo.email, 'class_booking_confirmed']])
    assert.match(mail[0]!.text, /Booked on your Unlimited Plan, so no credits were used\./)
    assert.doesNotMatch(mail[0]!.text, /remain/)
  })

  test('NTF-08 a booking refused to another studio\'s member, or to staff, sends nothing', async () => {
    const outsider = await member(two, 'Oli')
    await give(two, outsider, 'credit_bundle')
    const classId = await addClass(one)
    drain()

    // Another studio's member, presented at studio one: not a session there.
    const res = await harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...outsider.headers, 'X-Tenant-Slug': one.slug, Origin: `http://${one.slug}.localhost:3000`, ...json },
      body: JSON.stringify({ class_id: classId }),
    })
    await expectStatus(res, 401, 'invalid_token')
    // Staff on the member app: the wrong pool.
    await expectStatus(
      await harness.app.request('/api/v1/me/bookings/class', {
        method: 'POST',
        headers: { ...one.admin.headers, 'X-Tenant-Slug': one.slug, Origin: `http://${one.slug}.localhost:3000`, ...json },
        body: JSON.stringify({ class_id: classId }),
      }),
      401,
      'invalid_token',
    )
    assert.deepEqual(drain(), [])
  })

  test('NTF-08 a booking still commits when its confirmation cannot be sent', async () => {
    const ivy = await member(one, 'Ivy')
    const pkg = await give(one, ivy, 'credit_bundle', 5)
    const classId = await addClass(one)
    const [template] = await harness.db
      .delete(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.tenantId, one.id), eq(schema.emailTemplates.slug, 'class_booking_confirmed')))
      .returning()
    try {
      drain()
      await expectStatus(await book(ivy, classId), 201)
      assert.deepEqual(drain(), [])
      const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, pkg))
      assert.equal(row!.creditsOrSessionsRemaining, 4, 'the credit was spent: the booking stands')
      assert.ok(
        harness.logs.lines().some(l => l.msg === 'booking confirmation email failed'),
        'the failed send is reported',
      )
    } finally {
      await harness.db.insert(schema.emailTemplates).values(template!)
    }
  })

  /* ── NTF-09 ─────────────────────────────────────────────────────────── */

  test('NTF-09 a member cancelling a class outside the window is emailed that the credits came back, and nobody else is mailed', async () => {
    const mia = await member(one)
    const pkg = await give(one, mia, 'credit_bundle', 10)
    const classId = await addClass(one, { creditCost: 2 })
    const booked = await expectStatus(await book(mia, classId), 201)
    drain()

    const res = await expectStatus(await memberCancel(mia, booked.booking_id), 200)
    assert.equal(res.refund_fired, true)
    assert.equal(await balance(pkg), 10, 'the two credits are back')

    const mail = drain()
    assert.deepEqual(mail.map(m => [m.to, m.template]), [[mia.email, 'class_cancelled_credit_returned']])
    assert.match(mail[0]!.text, new RegExp(`${NAME} Vinyasa`))
    assert.match(mail[0]!.text, /2 credits have been returned to your package\./)
    assert.match(mail[0]!.html, new RegExp(`href="http://${one.slug}\\.localhost:3000/classes"`), 'the link is the studio\'s own app')
  })

  test('NTF-09 a member cancelling a private session outside the window is emailed that the session came back', async () => {
    const leo = await member(one, 'Leo')
    const pkg = await givePt(one, leo, 4)
    const { bookingId } = await ptRequest(one, leo, pkg, { scheduled: true })
    drain()

    await expectStatus(await memberCancel(leo, bookingId!), 200)
    assert.equal(await balance(pkg), 5)

    const mail = drain()
    assert.deepEqual(mail.map(m => [m.to, m.template]), [[leo.email, 'pt_cancelled_session_returned']])
    assert.ok(mail[0]!.text.includes(one.instructor.name), 'the instructor is named')
    assert.match(mail[0]!.text, /1 session has been returned to your package\./)
  })

  test('NTF-09 a cancel refused to another studio\'s member or to another member sends nothing', async () => {
    const mia = await member(one)
    await give(one, mia, 'credit_bundle', 10)
    const booked = await expectStatus(await book(mia, await addClass(one)), 201)
    const sam = await member(one, 'Sam')
    const outsider = await member(two, 'Oli')
    drain()

    await expectStatus(await memberCancel(sam, booked.booking_id), 403, 'not_your_booking')
    await expectStatus(
      await harness.app.request(`/api/v1/me/bookings/${booked.booking_id}`, {
        method: 'DELETE',
        headers: { ...outsider.headers, 'X-Tenant-Slug': one.slug, Origin: `http://${one.slug}.localhost:3000` },
      }),
      401,
      'invalid_token',
    )
    assert.deepEqual(drain(), [])
  })

  /* ── NTF-10 ─────────────────────────────────────────────────────────── */

  const staffPost = (who: Staff, path: string) =>
    harness.app.request(`/api/v1/portal/${path}`, { method: 'POST', headers: { ...who.headers, ...json }, body: '{}' })

  /** A workshop with one tier and a confirmed place for each attendee, paid `paid` each. */
  async function workshopWith(at: Studio, attendees: Array<{ who: Member; paid: string }>): Promise<string> {
    const [w] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: at.id, name: `${NAME} Retreat weekend`, locationId: at.locationId, createdByStaffId: at.admin.id })
      .returning({ id: schema.workshops.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: at.id, workshopId: w!.id, name: 'Full', regularPriceSgd: '120.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    for (const { who, paid } of attendees) {
      await harness.db.insert(schema.bookings).values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'workshop',
        workshopId: w!.id,
        workshopTierId: tier!.id,
        listPriceSgd: '120.00',
        amountPaidSgd: paid,
        ...codes(),
      })
    }
    return w!.id
  }

  test('NTF-10 an Admin cancelling a class emails every booked member the admin-cancellation email with the credits returned, and nobody else', async () => {
    const mia = await member(one)
    const leo = await member(one, 'Leo')
    const gone = await member(one, 'Gus')
    await give(one, mia, 'credit_bundle', 10)
    await give(one, leo, 'unlimited')
    await give(one, gone, 'credit_bundle', 10)
    const classId = await addClass(one, { creditCost: 2 })
    await expectStatus(await book(mia, classId), 201)
    await expectStatus(await book(leo, classId), 201)
    const left = await expectStatus(await book(gone, classId), 201)
    await expectStatus(await memberCancel(gone, left.booking_id), 200)
    drain()

    const res = await expectStatus(await staffPost(one.admin, `admin/schedule/classes/${classId}/cancel`), 200)
    assert.equal(res.total_bookings, 2)

    const mail = drain()
    assert.deepEqual(
      mail.map(m => [m.to, m.template]).sort(),
      [
        [leo.email, 'admin_cancel_class'],
        [mia.email, 'admin_cancel_class'],
      ].sort(),
    )
    const to = (email: string) => mail.find(m => m.to === email)!
    assert.match(to(mia.email).text, /2 credits have been returned to your package\./)
    assert.match(to(leo.email).text, /did not use any credits, so nothing was taken from your package\./)
    assert.match(to(mia.email).subject, new RegExp(`${NAME} Vinyasa`))
  })

  test('NTF-10 an Admin cancelling a workshop emails every attendee what they paid, in the studio\'s money form', async () => {
    const mia = await member(one)
    const leo = await member(one, 'Leo')
    const workshopId = await workshopWith(one, [
      { who: mia, paid: '120.00' },
      { who: leo, paid: '0.00' },
    ])
    drain()

    await expectStatus(await staffPost(one.admin, `admin/workshops/${workshopId}/cancel`), 200)

    const mail = drain()
    assert.deepEqual(
      mail.map(m => [m.to, m.template]).sort(),
      [
        [leo.email, 'admin_cancel_workshop'],
        [mia.email, 'admin_cancel_workshop'],
      ].sort(),
    )
    const to = (email: string) => mail.find(m => m.to === email)!
    assert.match(to(mia.email).text, /You paid S\$120\.00 for your place\./)
    assert.match(to(leo.email).text, /You paid S\$0\.00 for your place\./)
    assert.match(to(mia.email).subject, /Retreat weekend was cancelled/)
  })

  test('NTF-10 an Admin cancelling a private session emails every member on it the admin-cancellation email with the session returned', async () => {
    const mia = await member(one)
    const leo = await member(one, 'Leo')
    const miaPkg = await givePt(one, mia, 4)
    const { requestId } = await ptRequest(one, mia, miaPkg, { scheduled: true, partner: leo, origin: 'portal' })
    drain()

    await expectStatus(await staffPost(one.admin, `admin/pt-sessions/${requestId}/cancel`), 200)
    assert.equal(await balance(miaPkg), 5)

    const mail = drain()
    assert.deepEqual(
      mail.map(m => [m.to, m.template]).sort(),
      [
        [leo.email, 'admin_cancel_pt'],
        [mia.email, 'admin_cancel_pt'],
      ].sort(),
    )
    for (const m of mail) {
      assert.ok(m.text.includes(one.instructor.name), 'the instructor is named')
      assert.match(m.text, /1 session has been returned to your package\./)
    }
  })

  test('NTF-10 a cancel refused to an instructor on the admin route or to another studio\'s admin sends nothing', async () => {
    const mia = await member(one)
    await give(one, mia, 'credit_bundle', 10)
    const classId = await addClass(one)
    await expectStatus(await book(mia, classId), 201)
    const workshopId = await workshopWith(one, [{ who: mia, paid: '120.00' }])
    drain()

    await expectStatus(await staffPost(one.instructor, `admin/schedule/classes/${classId}/cancel`), 403, 'forbidden_role')
    await expectStatus(await staffPost(one.instructor, `admin/workshops/${workshopId}/cancel`), 403, 'forbidden_role')
    const elsewhere = { ...two.admin, headers: { ...two.admin.headers, 'X-Tenant-Slug': one.slug, Origin: `http://${one.slug}.portal.localhost:3001` } }
    await expectStatus(await staffPost(elsewhere, `admin/schedule/classes/${classId}/cancel`), 401, 'invalid_token')
    assert.deepEqual(drain(), [])
  })

  /* ── NTF-11 ─────────────────────────────────────────────────────────── */

  const memberCancelRequest = (who: Member, requestId: string) =>
    harness.app.request(`/api/v1/me/pt-sessions/${requestId}/cancel`, { method: 'POST', headers: who.headers })

  test('NTF-11 a PT Request cancelled before scheduling emails the member, with the sessions returned', async () => {
    const mia = await member(one)
    const pkg = await givePt(one, mia, 4)
    const { requestId } = await ptRequest(one, mia, pkg, { scheduled: false })
    drain()

    const res = await expectStatus(await memberCancelRequest(mia, requestId), 200)
    assert.equal(res.status, 'cancelled_before_scheduled')
    assert.equal(await balance(pkg), 5)

    const mail = drain()
    assert.deepEqual(mail.map(m => [m.to, m.template]), [[mia.email, 'pt_request_cancelled']])
    assert.equal(mail[0]!.subject, 'Your private session request was cancelled')
    assert.match(mail[0]!.text, /1 session has been returned to your package\./)
  })

  test('NTF-11 a PT Request cancelled after scheduling emails the member with the refund, and the partner, who paid nothing, with no refund line', async () => {
    const mia = await member(one)
    const leo = await member(one, 'Leo')
    const pkg = await givePt(one, mia, 4)
    const { requestId } = await ptRequest(one, mia, pkg, { scheduled: true, partner: leo })
    drain()

    const res = await expectStatus(await staffPost(one.admin, `admin/pt-sessions/${requestId}/cancel`), 200)
    assert.equal(res.result.status, 'cancelled_after_scheduled')
    assert.equal(await balance(pkg), 6, 'both sessions of the 2-on-1 are back')

    const mail = drain()
    assert.deepEqual(
      mail.map(m => [m.to, m.template]).sort(),
      [
        [leo.email, 'pt_request_cancelled'],
        [mia.email, 'pt_request_cancelled'],
      ].sort(),
    )
    const to = (email: string) => mail.find(m => m.to === email)!
    assert.ok(to(mia.email).subject.includes(one.instructor.name), 'a scheduled session is named by its instructor')
    assert.match(to(mia.email).text, /2 sessions have been returned to your package\./)
    assert.doesNotMatch(to(leo.email).text, /returned to your package/)
  })

  test('NTF-11 a PT Request cancel refused to another member, another studio\'s member or an instructor on the admin route sends nothing', async () => {
    const mia = await member(one)
    const sam = await member(one, 'Sam')
    const outsider = await member(two, 'Oli')
    const pkg = await givePt(one, mia, 4)
    const { requestId } = await ptRequest(one, mia, pkg, { scheduled: true })
    drain()

    await expectStatus(await memberCancelRequest(sam, requestId), 403, 'not_your_request')
    await expectStatus(
      await harness.app.request(`/api/v1/me/pt-sessions/${requestId}/cancel`, {
        method: 'POST',
        headers: { ...outsider.headers, 'X-Tenant-Slug': one.slug, Origin: `http://${one.slug}.localhost:3000` },
      }),
      401,
      'invalid_token',
    )
    await expectStatus(await staffPost(one.instructor, `admin/pt-sessions/${requestId}/cancel`), 403, 'forbidden_role')
    assert.deepEqual(drain(), [])
    assert.equal(await balance(pkg), 4, 'nothing moved')
  })
})
