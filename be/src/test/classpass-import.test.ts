import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import JSZip from 'jszip'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { classPassEmail, newReservationId, type ClassPassEmailOptions } from './classpass-email'
import { withEnv } from './with-env'
import type { MailTransport, OutboundMessage } from '../lib/mailer'
import type { InboundEmail } from '../services/classpass/receive'

const run = Date.now().toString(36)
const DOMAIN = `${run}.classpass-import.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const STRETCH = `Yoga Stretch ${run}`
const WARM = `Warm Yoga ${run}`
const PACKAGE_NAME = `ClassPass import pass ${run}`
const LOCATION = `ClassPass import room ${run}`
/** What ClassPass calls the Location in its emails. */
const CLASSPASS_LOCATION = `Northwind-Import ${run}`
const INBOUND_DOMAIN = 'classpass-import-inbound.test'
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Importing a ClassPass booking email (#411): a forwarded `ClassPass user
 * reservation` email puts the member on the class at the mapped Location and
 * time, as a ClassPass booking; one the importer cannot place is kept with its
 * reason and books nothing.
 *
 * Every test drives the one entry point, `receiveClassPassEmail`, with a
 * fixture email (`classpass-email.ts`), and reads what it did through the
 * portal: the class roster, the member's profile, the check-in desk, finance,
 * the ClassPass page and the member export.
 */
describe('importing a ClassPass booking email', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  const secret = `whsec_${randomBytes(24).toString('base64')}`
  withEnv({ CLASSPASS_INBOUND_DOMAIN: INBOUND_DOMAIN, RESEND_WEBHOOK_SECRET: secret })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let receiveSvc!: typeof import('../services/classpass/receive')
  let settingsSvc!: typeof import('../services/classpass/settings')

  type Staff = { id: string; email: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    timezone: string
    locationId: string
    stretchTypeId: string
    warmTypeId: string
    classPackageId: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; email: string; name: string }

  let one!: Studio
  let two!: Studio

  const sent: OutboundMessage[] = []
  const recording: MailTransport = {
    name: 'null',
    async send(message) {
      sent.push(message)
      return { messageId: `classpass-import-${sent.length}`, response: 'recorded' }
    },
  }
  let restoreMail: () => void = () => {}
  let undoFetcher: () => void = () => {}
  const fetchable = new Map<string, InboundEmail>()
  const keptIds: string[] = []

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }
  const shifted = (from: Date, ms: number) => new Date(from.getTime() + ms)
  /** A whole minute about a week out, a few hours apart per call, so no two tests share a start. */
  let slot = 0
  const nextStart = () => new Date(Math.floor((Date.now() + 7 * DAY) / HOUR) * HOUR + slot++ * 3 * HOUR + 30 * MINUTE)

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  /** The date and time as ClassPass writes them, in the studio's own timezone: `Sep 18, 2026` and `1:30 PM`. */
  function classPassWhen(at: Date, timezone: string): { date: string; time: string } {
    const plain = (s: string) => s.replace(/\s/g, ' ')
    const date = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(at)
    const time = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(at)
    return { date: plain(date), time: plain(time) }
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${name}-${tenant.slug}`)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { id: row!.id, email, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [t] = await harness.db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, tenant.id))
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: LOCATION })
      .returning({ id: schema.locations.id })
    const types = await harness.db
      .insert(schema.classTypes)
      .values([
        { tenantId: tenant.id, name: STRETCH },
        { tenantId: tenant.id, name: WARM },
      ])
      .returning({ id: schema.classTypes.id })
    const [classPackage] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: PACKAGE_NAME, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const admin = await staffAt(tenant, 'admin', 'admin')
    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass/locations', {
        method: 'POST',
        headers: { ...admin.headers, ...json },
        body: JSON.stringify({ location_name: CLASSPASS_LOCATION, location_id: location!.id }),
      }),
      201,
    )
    await expectStatus(
      await harness.app.request('/api/v1/portal/admin/classpass', {
        method: 'PATCH',
        headers: { ...admin.headers, ...json },
        body: JSON.stringify({ enabled: true }),
      }),
      200,
    )
    return {
      ...tenant,
      timezone: t!.timezone,
      locationId: location!.id,
      stretchTypeId: types[0]!.id,
      warmTypeId: types[1]!.id,
      classPackageId: classPackage!.id,
      admin,
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
    }
  }

  async function addClass(
    at: Studio,
    startsAt: Date,
    options: { classTypeId?: string; capacityOnline?: number; capacityBuffer?: number; lifecycle?: 'active' | 'cancelled' } = {},
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: options.classTypeId ?? at.stretchTypeId,
        mainInstructorId: at.instructor.id,
        locationId: at.locationId,
        startsAt,
        endsAt: shifted(startsAt, HOUR),
        capacityOnline: options.capacityOnline ?? 10,
        capacityBuffer: options.capacityBuffer ?? 0,
        creditCost: 1,
        createdByStaffId: at.instructor.id,
        lifecycle: options.lifecycle ?? 'active',
        cancelledAt: options.lifecycle === 'cancelled' ? new Date() : null,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  async function member(at: Studio, name: string): Promise<Member> {
    const email = emailFor(`${name}-${at.slug}`)
    await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, name }
  }

  async function give(at: Studio, who: Member, credits = 10): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'credit_bundle',
        sourceClassPackageId: at.classPackageId,
        validityDays: 90,
        creditsOrSessionsRemaining: credits,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /** A ClassPass booking email for the class starting at `startsAt`, at the mapped Location. */
  function bookingEmail(at: Studio, startsAt: Date, options: ClassPassEmailOptions = {}): InboundEmail {
    return classPassEmail({
      className: STRETCH,
      location: CLASSPASS_LOCATION,
      ...classPassWhen(startsAt, at.timezone),
      memberName: 'Placeholder Member',
      memberEmail: emailFor(`placeholder-${randomUUID().slice(0, 8)}`),
      ...options,
    })
  }

  async function receive(at: Studio, email: InboundEmail) {
    const result = await receiveSvc.receiveClassPassEmail(at.id, email)
    keptIds.push(result.id)
    return result
  }

  /* ── reading ────────────────────────────────────────────────────────── */

  async function roster(at: Studio, classId: string): Promise<Record<string, any>[]> {
    const body = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}`, { headers: at.admin.headers }),
      200,
    )
    return body.attendees as Record<string, any>[]
  }

  async function profile(at: Studio, clientId: string) {
    return expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${clientId}`, { headers: at.admin.headers }),
      200,
    )
  }

  async function clientByEmail(at: Studio, email: string) {
    const [row] = await harness.db
      .select()
      .from(schema.clients)
      .where(sql`${schema.clients.tenantId} = ${at.id} AND lower(${schema.clients.email}) = lower(${email})`)
    return row
  }

  async function status(at: Studio) {
    return expectStatus(await harness.app.request('/api/v1/portal/admin/classpass', { headers: at.admin.headers }), 200)
  }

  async function finance(at: Studio, from: Date, to: Date) {
    const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })
    return expectStatus(await harness.app.request(`/api/v1/portal/admin/finance?${qs}`, { headers: at.admin.headers }), 200)
  }

  async function balanceOf(packageId: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, packageId))
    return row!.creditsOrSessionsRemaining
  }

  /* ── the webhook ────────────────────────────────────────────────────── */

  function sign(body: string) {
    const id = `msg_${randomUUID()}`
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const raw = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const signature = createHmac('sha256', raw).update(`${id}.${timestamp}.${body}`).digest('base64')
    return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` }
  }

  async function deliver(address: string, message: InboundEmail) {
    const emailId = randomUUID()
    fetchable.set(emailId, message)
    const body = JSON.stringify({
      type: 'email.received',
      created_at: new Date().toISOString(),
      data: {
        email_id: emailId,
        created_at: new Date().toISOString(),
        from: message.from,
        to: message.to,
        received_for: [address],
        bcc: [],
        cc: [],
        message_id: message.messageId,
        subject: message.subject,
        attachments: [],
      },
    })
    return harness.app.request('/api/v1/webhooks/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sign(body) },
      body,
    })
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    receiveSvc = inTenantContext(await import('../services/classpass/receive'))
    settingsSvc = inTenantContext(await import('../services/classpass/settings'))
    restoreMail = (await import('../lib/mailer')).useTransport(recording)
    undoFetcher = (await import('../services/classpass/inbound')).useInboundFetcher(async emailId => {
      const message = fetchable.get(emailId)
      if (!message) throw new Error(`no message ${emailId}`)
      return message
    })
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    restoreMail()
    undoFetcher()
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const ourClasses = sql`SELECT id FROM classes WHERE created_by_staff_id IN (${staff})`
    await harness.db.execute(sql`DELETE FROM classpass_inbound_emails WHERE member_email LIKE ${ours} OR client_id IN (${clients}) OR booking_id IN (SELECT id FROM bookings WHERE class_id IN (${ourClasses}))`)
    for (const id of keptIds) await harness.db.execute(sql`DELETE FROM classpass_inbound_emails WHERE id = ${id}`)
    await harness.db.execute(sql`DELETE FROM classpass_location_mappings WHERE location_id IN (SELECT id FROM locations WHERE name = ${LOCATION})`)
    await harness.db.execute(sql`UPDATE classpass_settings SET enabled = false WHERE tenant_id IN (${one.id}, ${two.id})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM check_ins WHERE booking_id IN (SELECT id FROM bookings WHERE class_id IN (${ourClasses}))`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE class_id IN (${ourClasses})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name IN (${STRETCH}, ${WARM})`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name = ${LOCATION}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM auth_events WHERE actor_user_id IN (SELECT id FROM staff_auth_users WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── tests ──────────────────────────────────────────────────────────── */

  test('CPS-30 a 2026-layout booking email books the member onto the class at the mapped Location and time, as a ClassPass booking with its reservation ID', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const ada = await member(one, 'ada-import')
    const reservationId = newReservationId()

    const result = await receive(one, bookingEmail(one, startsAt, { reservationId, memberName: ada.name, memberEmail: ada.email }))

    assert.equal(result.outcome, 'imported')
    const [a] = await roster(one, classId)
    assert.equal(a?.client.id, ada.clientId)
    assert.equal(a?.source, 'classpass')
    const history = await profile(one, ada.clientId)
    assert.deepEqual(
      (history.upcoming_bookings as Record<string, any>[]).map(b => [b.booking_id, b.source]),
      [[a!.booking_id, 'classpass']],
    )
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, a!.booking_id))
    assert.equal(row!.classpassReservationId, reservationId)
    assert.equal((await status(one)).counts.imported >= 1, true)
  })

  test('CPS-31 an imported booking spends none of the member\'s credits and moves no finance figure', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const bo = await member(one, 'bo-credits')
    const bundle = await give(one, bo)
    const window = [shifted(startsAt, -2 * DAY), shifted(startsAt, DAY)] as const
    const before = await finance(one, ...window)

    await receive(one, bookingEmail(one, startsAt, { memberName: bo.name, memberEmail: bo.email }))

    const [a] = await roster(one, classId)
    assert.equal(a?.client.id, bo.clientId)
    assert.equal(a?.credits_used, 0)
    assert.equal(await balanceOf(bundle), 10)
    const afterwards = await finance(one, ...window)
    assert.deepEqual(afterwards.totals, before.totals)
    assert.deepEqual(afterwards.rows, before.rows)
  })

  test('CPS-32 an existing client is found by email whatever its case, and nobody is emailed', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const cy = await member(one, 'cy-existing')
    sent.splice(0)

    await receive(one, bookingEmail(one, startsAt, { memberName: 'C. Y.', memberEmail: cy.email.toUpperCase() }))

    const attendees = await roster(one, classId)
    assert.deepEqual(attendees.map(a => a.client.id), [cy.clientId])
    assert.deepEqual(sent.splice(0).map(m => m.to), [])
  })

  test('CPS-33 a member the studio does not know is created with their name and email, no phone, and no invitation', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const email = emailFor('dee-new')
    sent.splice(0)

    await receive(one, bookingEmail(one, startsAt, { memberName: 'Dee New', memberEmail: email }))

    const created = await clientByEmail(one, email)
    assert.ok(created, 'the member was created')
    assert.equal(created.name, 'Dee New')
    assert.equal(created.phone, '')
    const attendees = await roster(one, classId)
    assert.deepEqual(attendees.map(a => [a.client.id, a.source]), [[created.id, 'classpass']])
    assert.deepEqual(sent.splice(0).map(m => m.to), [])
  })

  test('CPS-34 two classes at the Location and time: the one whose Class Type name matches, whatever its case, is booked', async () => {
    const startsAt = nextStart()
    const stretch = await addClass(one, startsAt)
    const warm = await addClass(one, startsAt, { classTypeId: one.warmTypeId })

    const result = await receive(one, bookingEmail(one, startsAt, { className: WARM.toUpperCase() }))

    assert.equal(result.outcome, 'imported')
    assert.equal((await roster(one, warm)).length, 1)
    assert.equal((await roster(one, stretch)).length, 0)
  })

  test("CPS-35 the email's time is read in the studio's timezone, not UTC", async () => {
    const startsAt = nextStart()
    const local = await addClass(one, startsAt)
    // The same wall-clock time read as UTC: the class a UTC reading would pick.
    const { date, time } = classPassWhen(startsAt, one.timezone)
    const asUtc = new Date(`${new Date(`${date} ${time} UTC`).toISOString()}`)
    assert.notEqual(asUtc.getTime(), startsAt.getTime(), 'the studio is not on UTC')
    const decoy = await addClass(one, asUtc)

    await receive(one, bookingEmail(one, startsAt))

    assert.equal((await roster(one, local)).length, 1)
    assert.equal((await roster(one, decoy)).length, 0)
  })

  test('CPS-36 a full class takes an Overbook seat, every Admin is emailed, and the ClassPass page flags it', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt, { capacityOnline: 1, capacityBuffer: 0 })
    await receive(one, bookingEmail(one, startsAt))
    const flaggedBefore = ((await status(one)).overbooked as unknown[]).length
    sent.splice(0)
    const eve = await member(one, 'eve-overbook')

    await receive(one, bookingEmail(one, startsAt, { memberName: eve.name, memberEmail: eve.email }))

    const seat = (await roster(one, classId)).find(a => a.client.id === eve.clientId)?.seat
    assert.equal(seat, 'overbook')
    const mail = sent.splice(0)
    assert.ok(
      mail.some(m => m.to === one.admin.email && /overbooked/i.test(m.subject)),
      `an Admin is emailed: ${JSON.stringify(mail.map(m => [m.to, m.subject]))}`,
    )
    assert.equal(mail.some(m => m.to === eve.email), false, 'the member is not')
    const flagged = (await status(one)).overbooked as Record<string, any>[]
    assert.equal(flagged.length, flaggedBefore + 1)
    assert.ok(flagged.some(f => f.class_id === classId && f.client_name === eve.name))
  })

  test('CPS-37 the same email twice, and the same reservation in a second email, book once; the second is no change', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const reservationId = newReservationId()
    const email = bookingEmail(one, startsAt, { reservationId })

    const first = await receive(one, email)
    const again = await receive(one, { ...email, receivedAt: new Date() })
    const forwardedTwice = await receive(one, { ...bookingEmail(one, startsAt, { reservationId }), messageId: `<${randomUUID()}@info.classpass.com>` })

    assert.equal(first.outcome, 'imported')
    assert.equal(again.duplicate, true)
    assert.equal(forwardedTwice.outcome, 'noop')
    assert.equal((await roster(one, classId)).length, 1)
  })

  test('CPS-38 a webhook Resend delivers twice books the member once', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const { address } = await settingsSvc.readClassPass(one.id)
    const email = bookingEmail(one, startsAt)

    assert.equal((await deliver(address!, email)).status, 200)
    assert.equal((await deliver(address!, email)).status, 200)

    const attendees = await roster(one, classId)
    assert.equal(attendees.length, 1)
    assert.equal(attendees[0]!.source, 'classpass')
  })

  test('CPS-39 a location with no ClassPass location mapping is kept for review as unmapped_location and books nothing', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const before = (await status(one)).counts.review

    const result = await receive(one, bookingEmail(one, startsAt, { location: `Northwind - Elsewhere ${run}` }))

    assert.deepEqual([result.outcome, result.reason], ['review', 'unmapped_location'])
    assert.equal((await status(one)).counts.review, before + 1)
    assert.deepEqual(await roster(one, classId), [])
  })

  test('CPS-40 no class at the Location and time is kept for review as no_class', async () => {
    const startsAt = nextStart()
    const other = await addClass(one, shifted(startsAt, 15 * MINUTE))
    const email = emailFor('fay-noclass')

    const result = await receive(one, bookingEmail(one, startsAt, { memberEmail: email }))

    assert.deepEqual([result.outcome, result.reason], ['review', 'no_class'])
    assert.deepEqual(await roster(one, other), [])
    assert.equal(await clientByEmail(one, email), undefined, 'no member is created for a booking that is not made')
  })

  test('CPS-41 two classes at the Location and time, neither named as ClassPass names it, are kept for review as ambiguous_class', async () => {
    const startsAt = nextStart()
    const a = await addClass(one, startsAt)
    const b = await addClass(one, startsAt)

    const result = await receive(one, bookingEmail(one, startsAt, { className: 'Something Else' }))

    assert.deepEqual([result.outcome, result.reason], ['review', 'ambiguous_class'])
    assert.deepEqual(await roster(one, a), [])
    assert.deepEqual(await roster(one, b), [])
  })

  test('CPS-42 a booking for a cancelled class is kept for review as class_cancelled', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt, { lifecycle: 'cancelled' })

    const result = await receive(one, bookingEmail(one, startsAt))

    assert.deepEqual([result.outcome, result.reason], ['review', 'class_cancelled'])
    const [{ n }] = (await harness.db.execute(
      sql`SELECT count(*)::int AS n FROM bookings WHERE class_id = ${classId}`,
    )) as unknown as [{ n: number }]
    assert.equal(n, 0)
  })

  test('CPS-43 a booking email missing a field it needs is kept as unparsed, with its content, and books nothing', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const before = (await status(one)).counts.unparsed

    const missing: ClassPassEmailOptions[] = [
      { reservationId: '' },
      { reservationId: 'not-a-reservation-id' },
      { memberEmail: '' },
      { location: '' },
      { time: '' },
      { date: 'Smarch 40, 2026' },
    ]
    for (const options of missing) {
      const email = bookingEmail(one, startsAt, options)
      const result = await receive(one, email)
      assert.deepEqual([result.outcome, result.reason], ['unparsed', 'unparsed'], JSON.stringify(options))
      const [kept] = await harness.db.select().from(schema.classpassInboundEmails).where(eq(schema.classpassInboundEmails.id, result.id))
      assert.equal(kept!.html, email.html, 'the original content is kept')
    }

    assert.equal((await status(one)).counts.unparsed, before + missing.length)
    assert.deepEqual(await roster(one, classId), [])
  })

  test('CPS-44 with the import switched off, a booking email is kept as ignored and books nothing', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    await settingsSvc.setClassPassEnabled(one.id, false)
    try {
      const result = await receive(one, bookingEmail(one, startsAt))
      assert.equal(result.outcome, 'ignored')
      assert.deepEqual(await roster(one, classId), [])
    } finally {
      await settingsSvc.setClassPassEnabled(one.id, true)
    }
  })

  test('CPS-45 a member the studio removed is kept for review as client_deleted, not booked or recreated', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const gus = await member(one, 'gus-removed')
    await harness.db.update(schema.clients).set({ deletedAt: new Date() }).where(eq(schema.clients.id, gus.clientId))

    const result = await receive(one, bookingEmail(one, startsAt, { memberName: gus.name, memberEmail: gus.email }))

    assert.deepEqual([result.outcome, result.reason], ['review', 'client_deleted'])
    assert.deepEqual(await roster(one, classId), [])
  })

  test('CPS-46 a member who already holds a seat on the class is kept for review as already_booked', async () => {
    const startsAt = nextStart()
    const classId = await addClass(one, startsAt)
    const hal = await member(one, 'hal-twice')
    await give(one, hal)
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}/bookings`, {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ client_id: hal.clientId }),
      }),
      201,
    )

    const result = await receive(one, bookingEmail(one, startsAt, { memberName: hal.name, memberEmail: hal.email }))

    assert.deepEqual([result.outcome, result.reason], ['review', 'already_booked'])
    assert.deepEqual((await roster(one, classId)).map(a => a.source), ['direct'])
  })

  test("CPS-47 the ClassPass emails about a member are in their export and go when they are permanently deleted", async () => {
    const startsAt = nextStart()
    await addClass(one, startsAt)
    const ivy = await member(one, 'ivy-export')
    const placed = await receive(one, bookingEmail(one, startsAt, { memberName: ivy.name, memberEmail: ivy.email }))
    // One the importer could not place names them by their address only.
    const unplaced = await receive(one, bookingEmail(one, shifted(startsAt, 5 * MINUTE), { memberName: ivy.name, memberEmail: ivy.email }))
    assert.equal(placed.outcome, 'imported')
    assert.equal(unplaced.reason, 'no_class')

    const res = await harness.app.request(`/api/v1/portal/admin/clients/${ivy.clientId}/export`, { headers: one.admin.headers })
    assert.equal(res.status, 200)
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    const exported = JSON.parse(await zip.file('tables/classpass_inbound_emails.json')!.async('string')) as { id: string }[]
    assert.deepEqual(exported.map(r => r.id).sort(), [placed.id, unplaced.id].sort())

    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${ivy.clientId}/permanently`, {
        method: 'DELETE',
        headers: one.admin.headers,
      }),
      200,
    )
    const left = await harness.db
      .select({ id: schema.classpassInboundEmails.id })
      .from(schema.classpassInboundEmails)
      .where(sql`${schema.classpassInboundEmails.id} IN (${placed.id}, ${unplaced.id})`)
    assert.deepEqual(left, [])
  })

  test('CPS-48 the check-in desk shows a ClassPass booking as ClassPass', async () => {
    harness.clock.reset()
    const startsAt = new Date(Math.ceil((Date.now() + 2 * MINUTE) / MINUTE) * MINUTE)
    const classId = await addClass(one, startsAt)
    const jo = await member(one, 'jo-desk')

    await receive(one, bookingEmail(one, startsAt, { memberName: jo.name, memberEmail: jo.email }))

    const desk = await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/check-in?location_id=${one.locationId}`, { headers: one.admin.headers }),
      200,
    )
    const session = (desk.sessions as Record<string, any>[]).find(s => s.id === classId)
    assert.ok(session, 'the class is on the desk')
    assert.deepEqual(
      (session.roster as Record<string, any>[]).map(r => [r.client_id, r.source]),
      [[jo.clientId, 'classpass']],
    )
  })

  test("CPS-49 one studio's ClassPass location mapping and classes are its own: the same email at another studio books nothing there", async () => {
    const startsAt = nextStart()
    const ours = await addClass(one, startsAt)
    const theirs = await addClass(two, startsAt)
    // The other studio has no mapping for this name.
    await harness.db.execute(sql`DELETE FROM classpass_location_mappings WHERE tenant_id = ${two.id}`)

    const there = await receive(two, bookingEmail(two, startsAt))

    assert.deepEqual([there.outcome, there.reason], ['review', 'unmapped_location'])
    assert.deepEqual(await roster(two, theirs), [])
    assert.deepEqual(await roster(one, ours), [])
  })
})
