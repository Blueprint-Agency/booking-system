import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.inbox.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Inbox class type ${run}`
const BUNDLE_NAME = `Inbox pass ${run}`
const PT_PACKAGE_NAME = `Inbox PT ${run}`
const WORKSHOP_NAME = `Inbox workshop ${run}`
const WEBHOOK_SECRET = 'whsec_inbox_test'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The admin Inbox and the admin Purchases surface over real HTTP (#206).
 *
 * **Inbox.** Its read routes (the list, the unread count, mark-read) still
 * answer `501`, so what can be proven today is the write side: every
 * cancellation the Inbox promises to report leaves one item behind, of the
 * right type, naming who acted, what was cancelled and what was refunded. Each
 * cancel is driven through the route a person uses; the item is read back from
 * the table.
 *
 * **Purchases.** Part-paid Purchases that were never granted and have gone
 * silent (#95): the list an admin reads, and the refund button — with the
 * payment provider replaced by the in-process fake, and its `charge.refunded`
 * delivery driven through the webhook route, exactly as `refunds.test.ts` does.
 */
describe('admin inbox and purchases over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake
  let webhookSecretWas: string | undefined
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let ptPackagesSvc!: typeof import('../services/packages/pt-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    bundleId: string
    ptPackageId: string
  }
  type Staff = { staffId: string; headers: Record<string, string> }
  type Member = { clientId: string; headers: Record<string, string> }
  type Reply = { status: number; body: any }
  type InboxRow = { type: string; payload: any; tenantId: string }

  let one!: Studio
  let two!: Studio
  let adminAtOne!: Staff
  let teacherAtOne!: Staff
  let otherTeacherAtOne!: Staff
  let adminAtTwo!: Staff

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
    const bundle = await classPackagesSvc.createClassPackage(tenant.id, {
      name: BUNDLE_NAME,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    const pt = await ptPackagesSvc.createPtPackage(tenant.id, {
      name: PT_PACKAGE_NAME,
      sessionType: '1on1',
      numSessions: 5,
      validityDays: 60,
      priceSgd: '500.00',
    })
    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      classTypeId: classType.id,
      bundleId: bundle.id,
      ptPackageId: pt.id,
    }
  }

  async function staff(at: Studio, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${name}-${at.slug}`)
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
    return { staffId: row!.id, headers }
  }

  async function member(at: Studio, name: string): Promise<Member> {
    const email = emailFor(`${name}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  async function reply(res: Response): Promise<Reply> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const get = async (path: string, headers: Record<string, string>) =>
    reply(await harness.app.request(`/api/v1${path}`, { headers }))

  const send = async (path: string, headers: Record<string, string>, method = 'POST', body?: unknown) =>
    reply(
      await harness.app.request(`/api/v1${path}`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )

  const ok = async (p: Promise<Reply>, status = 200) => {
    const res = await p
    assert.equal(res.status, status, JSON.stringify(res.body))
    return res.body
  }

  // ── Classes, bookings, PT and workshops ──────────────────────────────────

  /** A class taught by `teacherAtOne`, starting `startsIn` ms from now. */
  async function addClass(at: Studio, startsIn: number): Promise<string> {
    const instructor = teacherAtOne
    const startsAt = new Date(Date.now() + startsIn)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: instructor.staffId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: instructor.staffId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /** A member holding a bundle, booked onto `classId` through the member app. */
  async function bookedMember(at: Studio, name: string, classId: string): Promise<Member & { bookingId: string }> {
    const who = await member(at, name)
    await purchaseSvc.grantPackage(at.id, {
      clientId: who.clientId,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: at.bundleId,
    })
    const body = await ok(send('/me/bookings/class', who.headers, 'POST', { class_id: classId }), 201)
    return { ...who, bookingId: body.booking_id as string }
  }

  let slot = 0
  /** A PT request of `who`'s, scheduled by the admin: the request id. */
  async function scheduledPt(at: Studio, who: Member): Promise<string> {
    const { clientPackageId } = await purchaseSvc.grantPackage(at.id, {
      clientId: who.clientId,
      purchaseId: null,
      amountSgd: '500.00',
      packageKind: 'pt',
      packageId: at.ptPackageId,
    })
    const requested = await ok(
      send('/me/pt-sessions/request', who.headers, 'POST', {
        classTypeId: at.classTypeId,
        locationId: at.locationId,
        sessionType: '1on1',
        clientPackageId,
        slots: [{ proposedDate: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10), startTime: '09:00', endTime: '10:00' }],
      }),
      201,
    )
    const startsAt = new Date(Date.now() + 4 * DAY + slot++ * 2 * HOUR)
    await ok(
      send(`/portal/admin/pt-sessions/${requested.pt_request_id}/schedule`, adminAtOne.headers, 'POST', {
        location_id: at.locationId,
        room_id: at.roomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        instructor_id: teacherAtOne.staffId,
        instructor_pay_sgd: 60,
      }),
      201,
    )
    return requested.pt_request_id as string
  }

  async function addWorkshop(at: Studio, holders: Member[]): Promise<string> {
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: at.id, name: WORKSHOP_NAME, locationId: at.locationId, createdByStaffId: adminAtOne.staffId })
      .returning({ id: schema.workshops.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: at.id, workshopId: workshop!.id, name: 'Full', regularPriceSgd: '0.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    const startsAt = new Date(Date.now() + 8 * DAY)
    const [day] = await harness.db
      .insert(schema.workshopDays)
      .values({
        tenantId: at.id,
        workshopId: workshop!.id,
        ord: 1,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * HOUR),
        basePriceSgd: '0.00',
        capacityOnline: 10,
      })
      .returning({ id: schema.workshopDays.id })
    await harness.db.insert(schema.workshopTierDays).values({ tenantId: at.id, workshopTierId: tier!.id, workshopDayId: day!.id })
    for (const who of holders) {
      await harness.db.insert(schema.bookings).values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'workshop',
        workshopId: workshop!.id,
        workshopTierId: tier!.id,
        creditsOrSessionsUsed: 0,
        listPriceSgd: '0.00',
        amountPaidSgd: '0.00',
        qrToken: `inbox-ws-${randomUUID()}`,
        code: `IW-${randomUUID().slice(0, 6).toUpperCase()}`,
      })
    }
    return workshop!.id
  }

  /** Inbox items, at any studio, whose payload names `key` = `value`. */
  async function inboxNaming(key: string, value: string): Promise<InboxRow[]> {
    return harness.db
      .select({ type: schema.inboxItems.type, payload: schema.inboxItems.payload, tenantId: schema.inboxItems.tenantId })
      .from(schema.inboxItems)
      .where(sql`${schema.inboxItems.payload}->>${key} = ${value}`)
  }

  async function onlyItem(key: string, value: string): Promise<InboxRow> {
    const rows = await inboxNaming(key, value)
    assert.equal(rows.length, 1, `one Inbox item names ${key}=${value}: ${JSON.stringify(rows)}`)
    return rows[0]!
  }

  // ── Part-paid Purchases ──────────────────────────────────────────────────

  /**
   * A 200.00 Purchase, part-paid by one succeeded payment per entry in
   * `payments`, each landed `daysAgo` days ago. `open` is ungranted.
   */
  async function partPaid(
    at: Studio,
    who: Member,
    opts: { payments: string[]; daysAgo: number; status?: 'open' | 'paid' },
  ): Promise<{ purchaseId: string; intents: string[] }> {
    const landed = new Date(Date.now() - opts.daysAgo * DAY)
    const paid = opts.payments.reduce((sum, p) => sum + Number(p), 0).toFixed(2)
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'class_package',
        totalSgd: '200.00',
        amountPaidSgd: paid,
        status: opts.status ?? 'open',
        metadata: { item_name: BUNDLE_NAME },
        partPaidAt: landed,
        createdAt: landed,
      })
      .returning({ id: schema.purchases.id })
    const intents: string[] = []
    for (const amount of opts.payments) {
      const intent = `pi_inbox_${randomUUID().slice(0, 12)}`
      intents.push(intent)
      await harness.db.insert(schema.stripePayments).values({
        tenantId: at.id,
        paymentIntentId: intent,
        purchaseId: purchase!.id,
        amountSgd: amount,
        kind: 'class_package',
        clientId: who.clientId,
        status: 'succeeded',
        createdAt: landed,
      })
    }
    return { purchaseId: purchase!.id, intents }
  }

  const silentList = async (by: Staff) => (await ok(get('/portal/admin/purchases/silent', by.headers))).purchases as any[]

  const refundPurchase = (by: { headers: Record<string, string> }, purchaseId: string, body: unknown = { reason: 'Member never came back' }) =>
    send(`/portal/admin/purchases/${purchaseId}/refund`, by.headers, 'POST', body)

  /** The provider's `charge.refunded` delivery for one intent. */
  async function deliverRefund(intent: string, cents: number): Promise<Reply> {
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_${randomUUID().slice(0, 12)}`,
          payment_intent: intent,
          amount: cents,
          amount_captured: cents,
          amount_refunded: cents,
          metadata: {},
        },
      },
    }
    return reply(
      await harness.app.request('/api/v1/webhooks/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=fake' },
        body: JSON.stringify(event),
      }),
    )
  }

  async function purchaseRow(id: string) {
    const [row] = await harness.db.select().from(schema.purchases).where(eq(schema.purchases.id, id))
    assert.ok(row)
    return row
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    const { installStripeFake } = await import('./stripe-fake')
    fake = installStripeFake()
    fake.reply('refunds.create', { id: 're_fake', status: 'succeeded' })
    // The signature is the provider's to check; the fake hands the body back as
    // the event, which is what a valid signature would have produced.
    fake.reply('webhooks.constructEvent', (body: unknown) => JSON.parse(String(body)))
    webhookSecretWas = process.env.STRIPE_WEBHOOK_SECRET
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    adminAtOne = await staff(one, 'owner', 'admin')
    teacherAtOne = await staff(one, 'teacher', 'instructor')
    otherTeacherAtOne = await staff(one, 'cover', 'instructor')
    adminAtTwo = await staff(two, 'owner', 'admin')
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    if (webhookSecretWas === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = webhookSecretWas
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
    const sessions = sql`SELECT id FROM pt_sessions WHERE pt_request_id IN (${requests})`
    const ourClasses = sql`SELECT id FROM classes WHERE created_by_staff_id IN (${staffIds})`
    const ourWorkshops = sql`SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME}`
    const q = (query: ReturnType<typeof sql>) => harness.db.execute(query)
    await q(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await q(sql`DELETE FROM inbox_items WHERE payload->>'classId' IN (SELECT id::text FROM (${ourClasses}) c)`)
    await q(sql`DELETE FROM inbox_items WHERE payload->>'workshopId' IN (SELECT id::text FROM (${ourWorkshops}) w)`)
    await q(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await q(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await q(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${requests})`)
    await q(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${sessions})`)
    await q(sql`DELETE FROM pt_session_supporting_instructors WHERE pt_session_id IN (${sessions})`)
    await q(sql`DELETE FROM pt_sessions WHERE id IN (${sessions})`)
    await q(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
    await q(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await q(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await q(sql`DELETE FROM class_packages WHERE name = ${BUNDLE_NAME}`)
    await q(sql`DELETE FROM pt_packages WHERE name = ${PT_PACKAGE_NAME}`)
    await q(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
    await q(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${ourWorkshops}))`)
    await q(sql`DELETE FROM workshop_days WHERE workshop_id IN (${ourWorkshops})`)
    await q(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${ourWorkshops})`)
    await q(sql`DELETE FROM workshops WHERE name = ${WORKSHOP_NAME}`)
    await q(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await q(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await q(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await q(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await q(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await q(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  // ── Inbox: what each cancellation writes ─────────────────────────────────

  test('INB-01, INB-02 an Admin cancelling a class with 4 booked members writes one admin-cancel item naming the Admin, the class and 4 refunded', async () => {
    const classId = await addClass(one, 3 * DAY)
    for (const name of ['Ana', 'Ben', 'Cai', 'Dee']) await bookedMember(one, `${name} Class`, classId)

    const res = await ok(send(`/portal/admin/schedule/classes/${classId}/cancel`, adminAtOne.headers))
    assert.deepEqual(res, { total_bookings: 4, refunded_count: 4 })

    const item = await onlyItem('classId', classId)
    assert.equal(item.tenantId, one.id)
    assert.equal(item.type, 'admin_cancel_class_pt')
    assert.equal(item.payload.kind, 'class')
    assert.equal(item.payload.cancelledByStaffId, adminAtOne.staffId)
    assert.equal(item.payload.totalBookings, 4)
    assert.equal(item.payload.refundedCount, 4)
    assert.equal(item.payload.reason, undefined, 'an admin cancel carries no instructor reason')
  })

  test('INB-01 an Admin cancelling a scheduled PT session writes an admin-cancel item for it', async () => {
    const eli = await member(one, 'Eli PT')
    const requestId = await scheduledPt(one, eli)

    await ok(send(`/portal/admin/pt-sessions/${requestId}/cancel`, adminAtOne.headers))

    const item = await onlyItem('ptRequestId', requestId)
    assert.equal(item.type, 'admin_cancel_class_pt')
    assert.equal(item.payload.kind, 'pt')
    assert.equal(item.payload.clientId, eli.clientId)
    assert.equal(item.payload.actorStaffId, adminAtOne.staffId)
    assert.ok(item.payload.ptSessionId)
    assert.ok(item.payload.refundOutcome)
  })

  test('INB-01 an Admin cancelling a workshop writes an admin-cancel-workshop item with the places it cancelled', async () => {
    const holders = [await member(one, 'Fox Workshop'), await member(one, 'Gil Workshop')]
    const workshopId = await addWorkshop(one, holders)

    await ok(send(`/portal/admin/workshops/${workshopId}/cancel`, adminAtOne.headers))

    const item = await onlyItem('workshopId', workshopId)
    assert.equal(item.tenantId, one.id)
    assert.equal(item.type, 'admin_cancel_workshop')
    assert.equal(item.payload.cancelledByStaffId, adminAtOne.staffId)
    assert.equal(item.payload.affectedBookings, 2)
  })

  test('INB-03 a member cancelling a class booking or a scheduled PT session writes a client-cancellation item naming them and the refund outcome', async () => {
    const classId = await addClass(one, 3 * DAY)
    const hui = await bookedMember(one, 'Hui Self', classId)
    const cancelled = await ok(send(`/me/bookings/${hui.bookingId}`, hui.headers, 'DELETE'))

    const classItem = await onlyItem('bookingId', hui.bookingId)
    assert.equal(classItem.type, 'client_cancellation')
    assert.equal(classItem.payload.clientId, hui.clientId)
    assert.equal(classItem.payload.kind, 'class')
    assert.equal(classItem.payload.refundOutcome, cancelled.refund_outcome)
    assert.equal(classItem.payload.actorStaffId, undefined, 'no staff member acted')

    const ivy = await member(one, 'Ivy Self')
    const requestId = await scheduledPt(one, ivy)
    const ptCancelled = await ok(send(`/me/pt-sessions/${requestId}/cancel`, ivy.headers))

    const ptItem = await onlyItem('ptRequestId', requestId)
    assert.equal(ptItem.type, 'client_cancellation')
    assert.equal(ptItem.payload.clientId, ivy.clientId)
    assert.equal(ptItem.payload.kind, 'pt')
    assert.ok(ptItem.payload.ptSessionId, 'names the session')
    assert.equal(ptItem.payload.refundOutcome, ptCancelled.refundOutcome)
  })

  test('INB-04 an admin force-cancelling one booking writes an item with its refund outcome and the acting staff member', async () => {
    const classId = await addClass(one, 3 * DAY)
    const jun = await bookedMember(one, 'Jun Forced', classId)

    const res = await ok(send(`/portal/admin/bookings/${jun.bookingId}/cancel`, adminAtOne.headers))

    const item = await onlyItem('bookingId', jun.bookingId)
    assert.equal(item.type, 'admin_cancel_class_pt')
    assert.equal(item.payload.clientId, jun.clientId)
    assert.equal(item.payload.actorStaffId, adminAtOne.staffId)
    assert.equal(item.payload.refundOutcome, res.refund_outcome)
    assert.equal(item.payload.refundOutcome, 'credit_returned', 'an admin cancel refunds in full')
  })

  test('INB-07 the main instructor cancelling their class writes an instructor item with their reason and the counts', async () => {
    const classId = await addClass(one, 3 * DAY)
    await bookedMember(one, 'Kai Taught', classId)
    await bookedMember(one, 'Lux Taught', classId)

    const res = await ok(
      send(`/portal/instructor/schedule/classes/${classId}/cancel`, teacherAtOne.headers, 'POST', { reason: 'Lost my voice' }),
    )
    assert.deepEqual(res, { total_bookings: 2, refunded_count: 2 })

    const item = await onlyItem('classId', classId)
    assert.equal(item.type, 'instructor_cancel_class')
    assert.equal(item.payload.cancelledByStaffId, teacherAtOne.staffId)
    assert.equal(item.payload.reason, 'Lost my voice')
    assert.equal(item.payload.totalBookings, 2)
    assert.equal(item.payload.refundedCount, 2)
  })

  test('INB-08 a refused cancel writes no Inbox item: wrong role, another instructor’s class, or another studio', async () => {
    const classId = await addClass(one, 3 * DAY)
    const mo = await bookedMember(one, 'Mo Refused', classId)

    // A member, and an instructor, on the admin cancel.
    assert.equal((await send(`/portal/admin/schedule/classes/${classId}/cancel`, mo.headers)).status, 401)
    assert.equal((await send(`/portal/admin/schedule/classes/${classId}/cancel`, teacherAtOne.headers)).status, 403)
    assert.equal((await send(`/portal/admin/bookings/${mo.bookingId}/cancel`, teacherAtOne.headers)).status, 403)
    // An instructor who does not teach it.
    const notTheirs = await send(`/portal/instructor/schedule/classes/${classId}/cancel`, otherTeacherAtOne.headers, 'POST', {
      reason: 'Not mine',
    })
    assert.equal(notTheirs.status, 403, JSON.stringify(notTheirs.body))
    // Another studio's admin, naming this studio's class and booking.
    assert.equal((await send(`/portal/admin/schedule/classes/${classId}/cancel`, adminAtTwo.headers)).status, 404)
    assert.equal((await send(`/portal/admin/bookings/${mo.bookingId}/cancel`, adminAtTwo.headers)).status, 404)
    // …or carrying their session to this studio.
    const crossed = { ...adminAtTwo.headers, 'X-Tenant-Slug': one.slug }
    assert.ok([401, 403].includes((await send(`/portal/admin/schedule/classes/${classId}/cancel`, crossed)).status))

    assert.deepEqual(await inboxNaming('classId', classId), [])
    assert.deepEqual(await inboxNaming('bookingId', mo.bookingId), [])
    const [booking] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, mo.bookingId))
    assert.equal(booking!.state, 'confirmed')
  })

  // ── Purchases: part-paid and silent ──────────────────────────────────────

  test('RFD-06 the silent list shows only part-paid, ungranted Purchases untouched for 14 days, naming the member and what is held', async () => {
    const nia = await member(one, 'Nia Silent')
    const oli = await member(one, 'Oli Recent')
    const silent = await partPaid(one, nia, { payments: ['40.00', '30.00'], daysAgo: 20 })
    const recent = await partPaid(one, oli, { payments: ['50.00'], daysAgo: 3 })
    const settled = await partPaid(one, oli, { payments: ['200.00'], daysAgo: 30, status: 'paid' })
    // First paid long ago, but a second card went down yesterday: silence runs from the last payment.
    const resumed = await partPaid(one, oli, { payments: ['20.00'], daysAgo: 40 })
    await harness.db.insert(schema.stripePayments).values({
      tenantId: one.id,
      paymentIntentId: `pi_inbox_${randomUUID().slice(0, 12)}`,
      purchaseId: resumed.purchaseId,
      amountSgd: '30.00',
      kind: 'class_package',
      clientId: oli.clientId,
      status: 'succeeded',
      createdAt: new Date(Date.now() - DAY),
    })

    const res = await ok(get('/portal/admin/purchases/silent', adminAtOne.headers))
    assert.equal(res.silent_after_days, 14)
    const ids = (res.purchases as any[]).map(p => p.id)
    assert.ok(ids.includes(silent.purchaseId), 'the silent one is listed')
    assert.ok(!ids.includes(recent.purchaseId), 'paid towards this week: mid-purchase, not silent')
    assert.ok(!ids.includes(settled.purchaseId), 'a Purchase that granted its package is not on this list')
    assert.ok(!ids.includes(resumed.purchaseId), 'a recent second payment makes it live again')

    const row = (res.purchases as any[]).find(p => p.id === silent.purchaseId)
    assert.equal(row.client_id, nia.clientId)
    assert.equal(row.client_name, 'Nia Silent')
    assert.equal(row.total_sgd, '200.00')
    assert.equal(row.paid_sgd, '70.00')
    assert.equal(row.outstanding_sgd, '130.00')
    assert.equal(row.payment_count, 2)
    assert.equal(row.days_silent, 20)
    assert.ok(row.silence_notice)
    assert.equal(row.grants_nothing, true)

    // Another studio's admin sees none of it.
    assert.ok(!(await silentList(adminAtTwo)).some(p => p.id === silent.purchaseId))
  })

  test('RFD-07 refunding a silent Purchase returns every payment whole; once the provider confirms it is abandoned and leaves both lists', async () => {
    const pia = await member(one, 'Pia Refund')
    const held = await partPaid(one, pia, { payments: ['60.00', '40.00'], daysAgo: 21 })
    const from = fake.callsTo('refunds.create').length

    const res = await ok(refundPurchase(adminAtOne, held.purchaseId))
    assert.equal(res.refunded, true)
    assert.equal(res.payment_count, 2)
    assert.equal(res.returned_sgd, '100.00')
    assert.ok(res.returned_line)

    const calls = fake.callsTo('refunds.create').slice(from)
    assert.deepEqual(
      calls.map(c => (c.args[0] as { payment_intent: string; amount?: number })).sort((a, b) => a.payment_intent.localeCompare(b.payment_intent)),
      held.intents.map(payment_intent => ({ payment_intent })).sort((a, b) => a.payment_intent.localeCompare(b.payment_intent)),
      'each payment back in full: no amount is ever sent',
    )
    // Pressing the button moved money and nothing else; the provider's delivery closes it.
    assert.equal((await purchaseRow(held.purchaseId)).status, 'open')

    for (const [i, intent] of held.intents.entries()) {
      const delivered = await deliverRefund(intent, i === 0 ? 6000 : 4000)
      assert.equal(delivered.status, 200, JSON.stringify(delivered.body))
    }
    assert.equal((await purchaseRow(held.purchaseId)).status, 'abandoned')
    assert.ok(!(await silentList(adminAtOne)).some(p => p.id === held.purchaseId))
    const open = (await ok(get('/me/purchases/open', pia.headers))).purchases as any[]
    assert.ok(!open.some(p => p.id === held.purchaseId), 'the member no longer owes on it')

    // A second press is refused, and moves no money.
    const again = await refundPurchase(adminAtOne, held.purchaseId)
    assert.equal(again.status, 409, JSON.stringify(again.body))
    assert.equal(fake.callsTo('refunds.create').length, from + 2)
  })

  test('RFD-08 the purchase refund refuses a granted Purchase, a missing reason, and nothing-paid; no money moves', async () => {
    const quinn = await member(one, 'Quinn Paid')
    const granted = await partPaid(one, quinn, { payments: ['200.00'], daysAgo: 30, status: 'paid' })
    const held = await partPaid(one, quinn, { payments: ['20.00'], daysAgo: 30 })
    const [unpaid] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId: one.id, clientId: quinn.clientId, kind: 'class_package', totalSgd: '200.00' })
      .returning({ id: schema.purchases.id })
    const from = fake.callsTo('refunds.create').length

    const paidRefusal = await refundPurchase(adminAtOne, granted.purchaseId)
    assert.equal(paidRefusal.status, 400, JSON.stringify(paidRefusal.body))
    assert.equal(paidRefusal.body.error, 'purchase_not_open')
    assert.equal((await refundPurchase(adminAtOne, held.purchaseId, {})).status, 400, 'a reason is required')
    assert.equal((await refundPurchase(adminAtOne, held.purchaseId, { reason: '' })).status, 400)
    const nothing = await refundPurchase(adminAtOne, unpaid!.id)
    assert.equal(nothing.status, 400, JSON.stringify(nothing.body))
    assert.equal(nothing.body.error, 'purchase_not_refundable')

    assert.equal(fake.callsTo('refunds.create').length, from)
    assert.equal((await purchaseRow(granted.purchaseId)).status, 'paid')
    assert.equal((await purchaseRow(held.purchaseId)).status, 'open')
  })

  test('RFD-09 only this studio’s admins reach the purchases surface: members, instructors and another studio are refused', async () => {
    const ray = await member(one, 'Ray Guarded')
    const held = await partPaid(one, ray, { payments: ['25.00'], daysAgo: 30 })
    const from = fake.callsTo('refunds.create').length

    assert.equal((await get('/portal/admin/purchases/silent', ray.headers)).status, 401)
    assert.equal((await get('/portal/admin/purchases/silent', teacherAtOne.headers)).status, 403)
    assert.equal((await refundPurchase(ray, held.purchaseId)).status, 401)
    assert.equal((await refundPurchase(teacherAtOne, held.purchaseId)).status, 403)

    const elsewhere = await refundPurchase(adminAtTwo, held.purchaseId)
    assert.equal(elsewhere.status, 404, JSON.stringify(elsewhere.body))
    const crossed = { headers: { ...adminAtTwo.headers, 'X-Tenant-Slug': one.slug } }
    assert.ok([401, 403].includes((await refundPurchase(crossed, held.purchaseId)).status))
    assert.ok([401, 403].includes((await get('/portal/admin/purchases/silent', crossed.headers)).status))

    assert.equal(fake.callsTo('refunds.create').length, from)
    assert.equal((await purchaseRow(held.purchaseId)).status, 'open')
    const audit = await harness.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.targetId, held.purchaseId), eq(schema.auditLog.action, 'purchase_abandoned')))
    assert.deepEqual(audit, [])
  })
})
