import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { MailTransport, OutboundMessage, SendMailResult } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.after-commit.test`
const NAME = `AfterCommit ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * Work that announces a write runs once that write has committed (`afterCommit`,
 * db/index.ts). A studio request is one `withTenant` transaction (middleware/
 * tenant.ts), so a service's own `db.transaction` is only a savepoint inside
 * it: mail sent when that savepoint returns would go out before COMMIT,
 * holding the class lock across the mail provider's call, and a mail-side
 * database error would abort the request's transaction under a booking the
 * route had already answered 201.
 */
describe('after-commit work', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let dbModule!: typeof import('../db')
  let mailer!: typeof import('../lib/mailer')

  type Studio = { id: string; slug: string; locationId: string; roomId: string; classTypeId: string; bundleId: string; staffId: string; staffHeaders: Record<string, string> }
  type Member = { clientId: string; email: string; headers: Record<string, string> }
  let one!: Studio

  const json = { 'Content-Type': 'application/json' }
  const templateOf = (m: OutboundMessage) => m.tags.find(t => t.name === 'template')?.value

  /** Swap in a transport for one test; always restored. */
  async function withTransport<T>(send: (m: OutboundMessage) => Promise<SendMailResult>, fn: () => Promise<T>): Promise<T> {
    const restore = mailer.useTransport({ name: 'null', send } satisfies MailTransport)
    try {
      return await fn()
    } finally {
      restore()
    }
  }
  const ok = (id: string): SendMailResult => ({ messageId: id, response: 'recorded' }) as SendMailResult

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `${NAME} room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    const [classType] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: `${NAME} Yin` })
      .returning({ id: schema.classTypes.id })
    const [bundle] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} five pack`, kind: 'credit_bundle', credits: 5, validityDays: 90, priceSgd: '100.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const email = `admin@${DOMAIN}`
    const staffHeaders = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, tenant.id)))
    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: 'Ada', role: 'admin', status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: staff!.id })
    return { ...tenant, locationId: location!.id, roomId: room!.id, classTypeId: classType!.id, bundleId: bundle!.id, staffId: staff!.id, staffHeaders }
  }

  let members = 0
  async function member(at: Studio): Promise<Member> {
    const email = `member-${members++}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    await harness.db.insert(schema.clientPackages).values({
      tenantId: at.id,
      clientId: client!.id,
      kind: 'credit_bundle',
      sourceClassPackageId: at.bundleId,
      validityDays: 90,
      creditsOrSessionsRemaining: 5,
      expiresAt: new Date(Date.now() + 60 * DAY),
      active: true,
      amountPaidSgd: '100.00',
      listPriceSgd: '100.00',
    })
    return { clientId: client!.id, email, headers }
  }

  let slots = 0
  async function addClass(at: Studio): Promise<string> {
    const startsAt = new Date(Date.now() + 3 * DAY + slots++ * 2 * HOUR)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.staffId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: at.staffId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  const book = (who: Member, classId: string) =>
    harness.app.request('/api/v1/me/bookings/class', { method: 'POST', headers: { ...who.headers, ...json }, body: JSON.stringify({ class_id: classId }) })

  const bookingsOf = (who: Member) =>
    harness.db.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.clientId, who.clientId))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    dbModule = await import('../db')
    mailer = await import('../lib/mailer')
    one = await studio(harness.tenants.one)
  })

  after(async () => {
    if (!harness) return
    try {
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM clients WHERE email LIKE ${ours})`)
      await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'cancelledByStaffId' IN (SELECT id::text FROM staff_users WHERE email LIKE ${ours})`)
      await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM classes WHERE class_type_id IN (SELECT id FROM class_types WHERE name LIKE ${`${NAME}%`})`)
      await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (SELECT id FROM workshops WHERE created_by_staff_id IN (${staff}))`)
      await harness.db.execute(sql`DELETE FROM workshops WHERE created_by_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (SELECT id FROM staff_users WHERE email LIKE ${ours})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM rooms WHERE name LIKE ${`${NAME}%`}`)
    } finally {
      await harness.close()
    }
  })

  /* ── the hook ───────────────────────────────────────────────────────── */

  test('after-commit work runs once the outermost transaction commits, in the order it was registered', async () => {
    const { withTenant, afterCommit } = dbModule
    const ran: string[] = []
    const value = await withTenant(one.id, async () => {
      afterCommit(async () => void ran.push('first'))
      afterCommit(async () => void ran.push('second'))
      assert.deepEqual(ran, [], 'nothing runs inside the transaction')
      return 'done'
    })
    assert.equal(value, 'done')
    assert.deepEqual(ran, ['first', 'second'])
  })

  test('after-commit work is dropped when the transaction rolls back, and when the savepoint it was registered in does', async () => {
    const { withTenant, afterCommit, db } = dbModule
    const ran: string[] = []
    await assert.rejects(
      withTenant(one.id, async () => {
        afterCommit(async () => void ran.push('rolled back'))
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.equal(ran.length, 0, 'nothing ran')

    await withTenant(one.id, async () => {
      afterCommit(async () => void ran.push('kept'))
      await db
        .transaction(async () => {
          afterCommit(async () => void ran.push('savepoint rolled back'))
          throw new Error('savepoint')
        })
        .catch(() => {})
      afterCommit(async () => void ran.push('after the savepoint'))
    })
    assert.deepEqual(ran, ['kept', 'after the savepoint'])
  })

  test('a failing piece of after-commit work is reported, and neither the result nor the work after it is affected', async () => {
    const { withTenant, afterCommit } = dbModule
    const ran: string[] = []
    const value = await withTenant(one.id, async () => {
      afterCommit(async () => {
        throw new Error('mail provider down')
      })
      afterCommit(async () => void ran.push('next'))
      return 42
    })
    assert.equal(value, 42)
    assert.deepEqual(ran, ['next'])
    assert.ok(harness.logs.lines().some(l => l.msg === 'after-commit work failed'), 'the failure is reported')
  })

  /* ── the booking confirmation ───────────────────────────────────────── */

  test('NTF-08 the booking confirmation is sent only after the booking has committed', async () => {
    const mia = await member(one)
    const classId = await addClass(one)
    const seenAtSend: number[] = []
    await withTransport(
      async m => {
        // A separate connection: it sees only what has committed.
        if (m.to === mia.email) seenAtSend.push((await bookingsOf(mia)).length)
        return ok('after-commit-1')
      },
      async () => {
        const res = await book(mia, classId)
        assert.equal(res.status, 201, await res.text())
      },
    )
    assert.deepEqual(seenAtSend, [1], 'one confirmation, sent when the booking was already visible outside its transaction')
  })

  test('NTF-08 a booking whose transaction rolls back sends nothing', async () => {
    const mia = await member(one)
    const classId = await addClass(one)
    const { bookClass } = await import('../services/bookings/book')
    const sent: OutboundMessage[] = []
    await withTransport(
      async m => {
        sent.push(m)
        return ok('after-commit-2')
      },
      async () => {
        await assert.rejects(
          dbModule.withTenant(one.id, async () => {
            await bookClass(one.id, { clientId: mia.clientId, classId })
            throw new Error('the request failed after the booking')
          }),
          /failed after the booking/,
        )
      },
    )
    assert.deepEqual(sent.filter(m => m.to === mia.email), [], 'no confirmation for a booking that never committed')
    assert.deepEqual(await bookingsOf(mia), [])
  })

  test('NTF-08 a confirmation that fails on the database and at the provider leaves the booking committed and the response 201', async () => {
    const mia = await member(one)
    const classId = await addClass(one)
    await withTransport(
      async m => {
        if (m.to === mia.email) {
          // A database error on the mail path: in the request's own transaction
          // it would abort it, and the booking with it.
          await dbModule.db.execute(sql`select 1 / 0`).catch(() => {})
          throw new Error('mail provider down')
        }
        return ok('after-commit-3')
      },
      async () => {
        const res = await book(mia, classId)
        assert.equal(res.status, 201, await res.text())
      },
    )
    assert.equal((await bookingsOf(mia)).length, 1, 'the booking stands')
  })

  test('NTF-08 the class is not locked while its confirmation is sent: two bookings whose sends wait on each other both complete', async () => {
    const mia = await member(one)
    const leo = await member(one)
    const classId = await addClass(one)
    const ours = new Set([mia.email, leo.email])
    let release!: () => void
    const bothSending = new Promise<void>(resolve => (release = resolve))
    let sending = 0
    let timedOut = false
    await withTransport(
      async m => {
        if (ours.has(m.to) && templateOf(m) === 'class_booking_confirmed') {
          if (++sending === 2) release()
          // Each send waits until the other booking is sending too — which it
          // can only reach once this one's class lock is released.
          await Promise.race([
            bothSending,
            new Promise<void>(resolve =>
              setTimeout(() => {
                timedOut = true
                resolve()
              }, 5000),
            ),
          ])
        }
        return ok('after-commit-4')
      },
      async () => {
        const [a, b] = await Promise.all([book(mia, classId), book(leo, classId)])
        assert.equal(a.status, 201, await a.text())
        assert.equal(b.status, 201, await b.text())
      },
    )
    assert.equal(sending, 2)
    assert.equal(timedOut, false, 'neither send waited out its timeout: the second booking was not held behind the first send')
  })

  /* ── the cancellation emails ────────────────────────────────────────── */

  /** What `read` saw — over a separate connection — each time `template` was sent to `to` during `act`. */
  async function readAtSend<T>(to: string, template: string, read: () => Promise<T>, act: () => Promise<void>): Promise<T[]> {
    const seen: T[] = []
    await withTransport(async m => {
      if (m.to === to && templateOf(m) === template) seen.push(await read())
      return ok('after-commit-cancel')
    }, act)
    return seen
  }

  const staffPost = (path: string) =>
    harness.app.request(`/api/v1/portal/${path}`, { method: 'POST', headers: { ...one.staffHeaders, ...json }, body: '{}' })

  test('NTF-09 a member\'s cancellation email is sent only after the cancellation has committed', async () => {
    const mia = await member(one)
    const classId = await addClass(one)
    const booked = await book(mia, classId)
    const { booking_id: bookingId } = (await booked.json()) as { booking_id: string }
    const stateOf = async () =>
      (await harness.db.select({ state: schema.bookings.state }).from(schema.bookings).where(eq(schema.bookings.id, bookingId)))[0]!.state

    const seen = await readAtSend(mia.email, 'class_cancelled_credit_returned', stateOf, async () => {
      const res = await harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers: mia.headers })
      assert.equal(res.status, 200, await res.text())
    })
    assert.deepEqual(seen, ['cancelled'])
  })

  test('NTF-10 an Admin\'s class cancellation emails each member only after the cancellation has committed', async () => {
    const mia = await member(one)
    const classId = await addClass(one)
    assert.equal((await book(mia, classId)).status, 201)
    const lifecycleOf = async () =>
      (await harness.db.select({ lifecycle: schema.classes.lifecycle }).from(schema.classes).where(eq(schema.classes.id, classId)))[0]!.lifecycle

    const seen = await readAtSend(mia.email, 'admin_cancel_class', lifecycleOf, async () => {
      const res = await staffPost(`admin/schedule/classes/${classId}/cancel`)
      assert.equal(res.status, 200, await res.text())
    })
    assert.deepEqual(seen, ['cancelled'])
  })

  test('NTF-10 an Admin\'s workshop cancellation emails each attendee only after the cancellation has committed', async () => {
    const mia = await member(one)
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: one.id, name: `${NAME} weekend`, locationId: one.locationId, createdByStaffId: one.staffId })
      .returning({ id: schema.workshops.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: one.id, workshopId: workshop!.id, name: 'Full', regularPriceSgd: '80.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    await harness.db.insert(schema.bookings).values({
      tenantId: one.id,
      clientId: mia.clientId,
      kind: 'workshop',
      workshopId: workshop!.id,
      workshopTierId: tier!.id,
      listPriceSgd: '80.00',
      amountPaidSgd: '80.00',
      qrToken: randomUUID(),
      code: `RT-${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    const lifecycleOf = async () =>
      (await harness.db.select({ lifecycle: schema.workshops.lifecycle }).from(schema.workshops).where(eq(schema.workshops.id, workshop!.id)))[0]!.lifecycle

    const seen = await readAtSend(mia.email, 'admin_cancel_workshop', lifecycleOf, async () => {
      const res = await staffPost(`admin/workshops/${workshop!.id}/cancel`)
      assert.equal(res.status, 200, await res.text())
    })
    assert.deepEqual(seen, ['cancelled'])
  })

  test('NTF-11 a PT Request\'s cancellation email is sent only after the cancellation has committed', async () => {
    const mia = await member(one)
    const [pkg] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: one.id,
        clientId: mia.clientId,
        kind: 'pt',
        validityDays: 90,
        creditsOrSessionsRemaining: 3,
        expiresAt: new Date(Date.now() + 60 * DAY),
        active: true,
        amountPaidSgd: '300.00',
        listPriceSgd: '300.00',
      })
      .returning({ id: schema.clientPackages.id })
    const [request] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: one.id,
        clientId: mia.clientId,
        locationId: one.locationId,
        sessionType: '1on1',
        status: 'pending',
        origin: 'member',
        expiresAt: new Date(Date.now() + 2 * DAY),
        debitedClientPackageId: pkg!.id,
      })
      .returning({ id: schema.ptRequests.id })
    const statusOf = async () =>
      (await harness.db.select({ status: schema.ptRequests.status }).from(schema.ptRequests).where(eq(schema.ptRequests.id, request!.id)))[0]!.status

    const seen = await readAtSend(mia.email, 'pt_request_cancelled', statusOf, async () => {
      const res = await harness.app.request(`/api/v1/me/pt-sessions/${request!.id}/cancel`, { method: 'POST', headers: mia.headers })
      assert.equal(res.status, 200, await res.text())
    })
    assert.deepEqual(seen, ['cancelled_before_scheduled'])
  })
})
