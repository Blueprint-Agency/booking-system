import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { isoWeekday, localDateOf } from '../services/schedule/series-dates'
import type { MailTransport, OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.waitlist-cancel-mail.test`
const NAME = `Waitmail ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const WAITLIST_LINE = /You were on the waitlist for this class, so nothing was taken from your package\./

/**
 * A class that will not run tells the members waiting on it, not only the ones
 * booked on it (spec-waitlist.md §6). Whoever cancels it, and whether it goes
 * alone or with the rest of an ended series, each member still waiting is sent
 * the class-cancelled email once, after the cancel has committed, saying that
 * their place in line cost them nothing. A member who already left the line,
 * whose place expired, or who was promoted out of it is not told twice.
 */
describe('class-cancelled email to the waitlist', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let dbModule!: typeof import('../db')

  type Staff = { id: string; email: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    bundleId: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  let one!: Studio

  const sent: OutboundMessage[] = []
  const recording: MailTransport = {
    name: 'null',
    async send(message) {
      sent.push(message)
      return { messageId: `waitlist-cancel-mail-${sent.length}`, response: 'recorded' }
    },
  }
  let restoreMail: () => void = () => {}
  const templateOf = (m: OutboundMessage) => m.tags.find(t => t.name === 'template')?.value
  const drain = () => sent.splice(0).map(m => ({ to: m.to, template: templateOf(m), subject: m.subject, text: m.text ?? '' }))

  const json = { 'Content-Type': 'application/json' }
  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? JSON.parse(text) : {}
  }

  let people = 0
  async function staffAt(tenant: { id: string; slug: string }, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = `${role}-${people++}-${tenant.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, tenant.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: role === 'admin' ? 'Ada' : 'Ines', role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    return { id: row!.id, email, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `${NAME} room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    const [classType] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: `${NAME} Hatha` })
      .returning({ id: schema.classTypes.id })
    const [bundle] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} ten pack`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    return {
      ...tenant,
      locationId: location!.id,
      roomId: room!.id,
      classTypeId: classType!.id,
      bundleId: bundle!.id,
      admin: await staffAt(tenant, 'admin'),
      instructor: await staffAt(tenant, 'instructor'),
    }
  }

  let members = 0
  async function member(at: Studio): Promise<Member> {
    const email = `member-${members++}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  async function withCredits(at: Studio, who: Member): Promise<Member> {
    await harness.db.insert(schema.clientPackages).values({
      tenantId: at.id,
      clientId: who.clientId,
      kind: 'credit_bundle',
      sourceClassPackageId: at.bundleId,
      validityDays: 90,
      creditsOrSessionsRemaining: 10,
      expiresAt: new Date(Date.now() + 60 * DAY),
      active: true,
      amountPaidSgd: '100.00',
      listPriceSgd: '100.00',
    })
    return who
  }

  let slots = 0
  async function addClass(at: Studio, startsAt = new Date(Date.now() + 3 * DAY + slots++ * 2 * HOUR)): Promise<string> {
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
        capacityWaitlist: 5,
        creditCost: 1,
        createdByStaffId: at.admin.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  async function booked(who: Member, classId: string): Promise<string> {
    const res = await harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({ class_id: classId }),
    })
    return (await expectStatus(res, 201)).booking_id as string
  }

  async function inLine(
    at: Studio,
    who: Member,
    classId: string,
    status: 'waiting' | 'withdrawn' | 'expired' | 'promoted' = 'waiting',
    bookingId: string | null = null,
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.waitlistEntries)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        classId,
        status,
        bookingId,
        resolvedAt: status === 'waiting' ? null : new Date(),
        resolvedBy: status === 'waiting' ? null : 'system',
      })
      .returning({ id: schema.waitlistEntries.id })
    return row!.id
  }

  const committedStatusOf = async (entryId: string) =>
    (await harness.db.select({ status: schema.waitlistEntries.status }).from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, entryId)))[0]!.status

  const adminCancel = (at: Studio, classId: string) =>
    harness.app.request(`/api/v1/portal/admin/schedule/classes/${classId}/cancel`, { method: 'POST', headers: { ...at.admin.headers, ...json }, body: '{}' })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    dbModule = await import('../db')
    restoreMail = (await import('../lib/mailer')).useTransport(recording)
    one = await studio(harness.tenants.one)
  })

  after(async () => {
    if (!harness) return
    restoreMail()
    try {
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM waitlist_entries WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM class_series WHERE created_by_staff_id IN (${staff})`)
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

  test('NTF-31 an Admin cancelling a class emails each member waiting on it once, after the cancel has committed, and its booked members as before', async () => {
    const seated = await withCredits(one, await member(one))
    const first = await member(one)
    const second = await member(one)
    const classId = await addClass(one)
    await booked(seated, classId)
    const firstEntry = await inLine(one, first, classId)
    await inLine(one, second, classId)
    drain()

    const statusAtSend: string[] = []
    const restore = (await import('../lib/mailer')).useTransport({
      name: 'null',
      async send(message) {
        if (message.to === first.email) statusAtSend.push(await committedStatusOf(firstEntry))
        return recording.send(message)
      },
    })
    try {
      const res = await expectStatus(await adminCancel(one, classId), 200)
      assert.equal(res.total_bookings, 1)
    } finally {
      restore()
    }

    const mail = drain()
    assert.deepEqual(
      mail.map(m => [m.to, m.template]).sort(),
      [
        [first.email, 'admin_cancel_class'],
        [second.email, 'admin_cancel_class'],
        [seated.email, 'admin_cancel_class'],
      ].sort(),
    )
    assert.deepEqual(statusAtSend, ['removed'], 'sent once the line was already removed outside the cancel')
    const to = (email: string) => mail.find(m => m.to === email)!
    for (const waiter of [first, second]) {
      assert.match(to(waiter.email).subject, new RegExp(`${NAME} Hatha`))
      assert.match(to(waiter.email).text, WAITLIST_LINE)
      assert.doesNotMatch(to(waiter.email).text, /returned/i, 'a place in line spent nothing, so nothing came back')
    }
    assert.match(to(seated.email).text, /1 credit has been returned to your package\./)
    assert.doesNotMatch(to(seated.email).text, WAITLIST_LINE)
  })

  test('NTF-32 an instructor cancelling their own class emails each member waiting on it', async () => {
    const waiter = await member(one)
    const classId = await addClass(one)
    await inLine(one, waiter, classId)
    drain()

    await expectStatus(
      await harness.app.request(`/api/v1/portal/instructor/schedule/classes/${classId}/cancel`, {
        method: 'POST',
        headers: { ...one.instructor.headers, ...json },
        body: JSON.stringify({ reason: 'unwell' }),
      }),
      200,
    )

    const toWaiter = drain().filter(m => m.to === waiter.email)
    assert.deepEqual(toWaiter.map(m => m.template), ['admin_cancel_class'])
    assert.match(toWaiter[0]!.text, WAITLIST_LINE)
  })

  test('NTF-33 a class cancel whose transaction rolls back emails nobody waiting on it', async () => {
    const waiter = await member(one)
    const classId = await addClass(one)
    const entry = await inLine(one, waiter, classId)
    const { cancelClass } = await import('../services/bookings/cancel-class')
    drain()

    await assert.rejects(
      dbModule.withTenant(one.id, async () => {
        await cancelClass(one.id, { classId, actorStaffId: one.admin.id })
        throw new Error('the request failed after the cancel')
      }),
      /failed after the cancel/,
    )

    assert.deepEqual(drain(), [])
    assert.equal(await committedStatusOf(entry), 'waiting', 'the line is as it was')

    await expectStatus(await adminCancel(one, classId), 200)
    assert.deepEqual(drain().map(m => [m.to, m.template]), [[waiter.email, 'admin_cancel_class']], 'the cancel that commits tells them')
  })

  test('NTF-34 ending a series emails the members waiting on each class it cancels, once for each class, after the end has committed', async () => {
    const teacher = one.instructor
    const tz = 'Asia/Singapore'
    const firstDate = localDateOf(new Date(Date.now() + 5 * DAY), tz)
    const lastDate = localDateOf(new Date(Date.now() + 12 * DAY), tz)
    const created = await expectStatus(
      await harness.app.request('/api/v1/portal/admin/schedule/series', {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({
          class_type_id: one.classTypeId,
          main_instructor_id: teacher.id,
          instructor_pay_sgd: 50,
          supporting_instructors: [],
          location_id: one.locationId,
          room_id: one.roomId,
          weekday: isoWeekday(firstDate),
          start_time: '07:00',
          end_time: '08:00',
          capacity_online: 1,
          capacity_waitlist: 3,
          capacity_buffer: 0,
          credit_cost: 1,
          first_date: firstDate,
          last_date: lastDate,
          excluded_dates: [],
        }),
      }),
      201,
    )
    const seriesId = created.series.id as string
    const classIds = created.class_ids as string[]
    assert.equal(classIds.length, 2)

    const onBoth = await member(one)
    const onSecond = await member(one)
    await inLine(one, onBoth, classIds[0]!)
    await inLine(one, onBoth, classIds[1]!)
    await inLine(one, onSecond, classIds[1]!)
    drain()

    const lifecycles = async () =>
      (await harness.db.select({ lifecycle: schema.classes.lifecycle }).from(schema.classes).where(inArray(schema.classes.id, classIds)))
        .map(c => c.lifecycle)
        .sort()
    const seenAtSend: string[][] = []
    const restore = (await import('../lib/mailer')).useTransport({
      name: 'null',
      async send(message) {
        if (message.to === onBoth.email || message.to === onSecond.email) seenAtSend.push(await lifecycles())
        return recording.send(message)
      },
    })
    try {
      const ended = await expectStatus(
        await harness.app.request(`/api/v1/portal/admin/schedule/series/${seriesId}/end`, {
          method: 'POST',
          headers: { ...one.admin.headers, ...json },
          body: JSON.stringify({ from_date: firstDate }),
        }),
        200,
      )
      assert.deepEqual([...ended.cancelled_class_ids].sort(), [...classIds].sort())
    } finally {
      restore()
    }

    const mail = drain()
    const toBoth = mail.filter(m => m.to === onBoth.email)
    const toSecond = mail.filter(m => m.to === onSecond.email)
    assert.deepEqual(toBoth.map(m => m.template), ['admin_cancel_class', 'admin_cancel_class'])
    assert.equal(new Set(toBoth.map(m => m.subject)).size, 2, 'one email for each class, each naming its own date')
    assert.deepEqual(toSecond.map(m => m.template), ['admin_cancel_class'])
    for (const m of [...toBoth, ...toSecond]) assert.match(m.text, WAITLIST_LINE)
    assert.deepEqual(seenAtSend, [
      ['cancelled', 'cancelled'],
      ['cancelled', 'cancelled'],
      ['cancelled', 'cancelled'],
    ], 'every class was already cancelled outside the transaction when each email went')
  })

  test('NTF-35 a class cancel emails nobody whose place in its line was already left, expired or promoted, nor a line on a class that has started, whose entry the sweep then expires', async () => {
    const still = await member(one)
    const left = await member(one)
    const expired = await member(one)
    const promoted = await withCredits(one, await member(one))
    const classId = await addClass(one)
    await inLine(one, still, classId)
    await inLine(one, left, classId, 'withdrawn')
    await inLine(one, expired, classId, 'expired')
    const promotedBooking = await booked(promoted, classId)
    await inLine(one, promoted, classId, 'promoted', promotedBooking)

    const late = await member(one)
    const started = await addClass(one, new Date(Date.now() - 10 * 60 * 1000))
    const lateEntry = await inLine(one, late, started)
    drain()

    await expectStatus(await adminCancel(one, classId), 200)
    await expectStatus(await adminCancel(one, started), 200)

    const mail = drain()
    assert.deepEqual(
      mail.map(m => [m.to, m.template]).sort(),
      [
        [promoted.email, 'admin_cancel_class'],
        [still.email, 'admin_cancel_class'],
      ].sort(),
      'the member still waiting is told, and the promoted member only about the booking the promotion made',
    )
    assert.match(mail.find(m => m.to === still.email)!.text, WAITLIST_LINE)
    assert.doesNotMatch(mail.find(m => m.to === promoted.email)!.text, WAITLIST_LINE)

    const resolution = async () =>
      (
        await harness.db
          .select({ status: schema.waitlistEntries.status, resolvedBy: schema.waitlistEntries.resolvedBy })
          .from(schema.waitlistEntries)
          .where(eq(schema.waitlistEntries.id, lateEntry))
      )[0]!
    assert.deepEqual(await resolution(), { status: 'waiting', resolvedBy: null }, 'the cancel leaves a started class\'s line alone')
    await (await import('../jobs')).scheduledJobs.expireWaitlists()
    assert.deepEqual(await resolution(), { status: 'expired', resolvedBy: 'system' })
    assert.deepEqual(drain(), [], 'the sweep emails nobody')
  })

  test('NTF-36 a member waiting on a class and seated on it by a ClassPass import is emailed once when it is cancelled, about the booking', async () => {
    const both = await member(one)
    const classId = await addClass(one)
    await inLine(one, both, classId)
    const { classPassBookClass } = await import('../services/bookings/book')
    await dbModule.withTenant(one.id, () => classPassBookClass(one.id, { clientId: both.clientId, classId, reservationId: `cp-${run}-36` }))
    drain()

    await expectStatus(await adminCancel(one, classId), 200)

    const mail = drain()
    assert.deepEqual(mail.map(m => [m.to, m.template]), [[both.email, 'admin_cancel_class']])
    assert.doesNotMatch(mail[0]!.text, WAITLIST_LINE)
  })
})
