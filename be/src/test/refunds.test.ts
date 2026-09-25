import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { ownAccountId, stripeWebhookPath, type StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.refunds.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Refund class type ${run}`
const BUNDLE_NAME = `Refund pass ${run}`
const PLAN_NAME = `Refund plan ${run}`
const PT_PACKAGE_NAME = `Refund PT ${run}`
const WORKSHOP_NAME = `Refund workshop ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * Refunds over real HTTP (#216), with the payment provider replaced by the
 * in-process fake at its one seam (`stripe-fake.ts`).
 *
 * A Refund is two halves, and every journey here drives both the way they run
 * in production: an admin presses the button (`issueRefund`, which only calls
 * the provider), and then the provider's `charge.refunded` delivery arrives at
 * the webhook route and does the unwind. The dashboard path is the second half
 * alone. Each test then reads the rows back: the Purchase, its payments, the
 * package, its bookings and their cancellation records, the Promo Code
 * redemption — and which provider account the fake was called on.
 */
describe('refunds over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake
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
    planId: string
    ptPackageId: string
  }
  type Staff = { staffId: string; headers: Record<string, string> }
  type Member = { clientId: string; headers: Record<string, string> }
  type Paid = { purchaseId: string; clientPackageId: string; intents: string[] }
  type Reply = { status: number; body: any }

  let one!: Studio
  let two!: Studio
  let adminAtOne!: Staff
  let teacherAtOne!: Staff
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
    const plan = await classPackagesSvc.createClassPackage(tenant.id, {
      name: PLAN_NAME,
      kind: 'unlimited',
      durationMonths: 1,
      priceSgd: '300.00',
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
      planId: plan.id,
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

  /**
   * A paid Purchase of one of the studio's packages, settled by one payment per
   * entry in `payments` (the provider account each was taken on — the studio's
   * own unless a test says otherwise), and the package it granted — the rows the
   * checkout webhook leaves behind.
   */
  async function buy(
    at: Studio,
    who: Member,
    item: 'bundle' | 'plan' | 'pt',
    payments: (string | null)[] = [ownAccountId(at)],
  ): Promise<Paid> {
    const price = { bundle: 200, plan: 300, pt: 500 }[item]
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: item === 'pt' ? 'pt_package' : 'class_package',
        totalSgd: price.toFixed(2),
        amountPaidSgd: price.toFixed(2),
        status: 'paid',
      })
      .returning({ id: schema.purchases.id })
    const { clientPackageId } = await purchaseSvc.grantPackage(at.id, {
      clientId: who.clientId,
      purchaseId: purchase!.id,
      amountSgd: price.toFixed(2),
      packageKind: item === 'pt' ? 'pt' : 'class',
      packageId: { bundle: at.bundleId, plan: at.planId, pt: at.ptPackageId }[item],
      ...(item === 'plan' ? { locationId: at.locationId } : {}),
    })
    const share = (price / payments.length).toFixed(2)
    const intents: string[] = []
    for (const account of payments) {
      const intent = `pi_refunds_${randomUUID().slice(0, 12)}`
      intents.push(intent)
      await harness.db.insert(schema.stripePayments).values({
        tenantId: at.id,
        paymentIntentId: intent,
        purchaseId: purchase!.id,
        amountSgd: share,
        kind: item === 'pt' ? 'pt_package' : 'class_package',
        clientId: who.clientId,
        clientPackageId,
        status: 'succeeded',
        providerAccountId: account,
      })
    }
    return { purchaseId: purchase!.id, clientPackageId, intents }
  }

  /** A paid workshop place: the booking IS the purchase, and holds no package. */
  async function buyWorkshop(at: Studio, who: Member, account: string | null = ownAccountId(at)) {
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: at.id, name: WORKSHOP_NAME, locationId: at.locationId, createdByStaffId: adminAtOne.staffId })
      .returning({ id: schema.workshops.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: at.id, workshopId: workshop!.id, name: 'Full', regularPriceSgd: '120.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId: at.id, clientId: who.clientId, kind: 'workshop', totalSgd: '120.00', amountPaidSgd: '120.00', status: 'paid' })
      .returning({ id: schema.purchases.id })
    const [booking] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'workshop',
        workshopId: workshop!.id,
        workshopTierId: tier!.id,
        creditsOrSessionsUsed: 0,
        listPriceSgd: '120.00',
        amountPaidSgd: '120.00',
        purchaseId: purchase!.id,
        qrToken: `refund-workshop-${randomUUID()}`,
        code: `RT-${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning({ id: schema.bookings.id })
    const intent = `pi_refunds_${randomUUID().slice(0, 12)}`
    await harness.db.insert(schema.stripePayments).values({
      tenantId: at.id,
      paymentIntentId: intent,
      purchaseId: purchase!.id,
      amountSgd: '120.00',
      kind: 'workshop',
      clientId: who.clientId,
      bookingId: booking!.id,
      status: 'succeeded',
      providerAccountId: account,
    })
    return { purchaseId: purchase!.id, bookingId: booking!.id, intent }
  }

  async function addClass(at: Studio, startsIn: number): Promise<string> {
    const startsAt = new Date(Date.now() + startsIn)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: teacherAtOne.staffId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: teacherAtOne.staffId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  async function reply(res: Response): Promise<Reply> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const post = async (path: string, headers: Record<string, string>, body: unknown) =>
    reply(
      await harness.app.request(path, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )

  const book = (who: Member, classId: string) =>
    post('/api/v1/me/bookings/class', who.headers, { class_id: classId })

  /** The Refund button on the member's package. */
  const refundPackage = (by: { headers: Record<string, string> }, who: Member, paid: Paid, extra: object = {}) =>
    post(`/api/v1/portal/admin/clients/${who.clientId}/packages/${paid.clientPackageId}/refund`, by.headers, {
      reason: 'Member moved away',
      ...extra,
    })

  const refundWorkshop = (by: { headers: Record<string, string> }, who: Member, bookingId: string) =>
    post(`/api/v1/portal/admin/clients/${who.clientId}/workshop-bookings/${bookingId}/refund`, by.headers, {
      reason: 'Member cannot attend',
    })

  /**
   * The provider's `charge.refunded` delivery, as its dashboard or our own
   * refund call triggers it. `refunded` below `captured` is a part-refund.
   * Delivered to studio one's own endpoint unless a test names another (#293).
   */
  async function deliverRefund(
    intent: string,
    opts: { captured?: number; refunded?: number; endpoint?: string } = {},
  ): Promise<Reply> {
    const { captured = 20000, endpoint = stripeWebhookPath(one.slug) } = opts
    const refunded = opts.refunded ?? captured
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_${randomUUID().slice(0, 12)}`,
          payment_intent: intent,
          amount: captured,
          amount_captured: captured,
          amount_refunded: refunded,
          metadata: {},
        },
      },
    }
    return reply(
      await harness.app.request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=fake' },
        body: JSON.stringify(event),
      }),
    )
  }

  /**
   * Each refund the fake was asked for since `from`, delivered back as the
   * provider would — after checking it was asked on `account` (studio one's
   * own, where every refund here is made unless a test says otherwise).
   */
  async function settle(from: number, account: string | null = ownAccountId(one)): Promise<void> {
    const calls = fake.callsTo('refunds.create').slice(from)
    assert.ok(calls.length > 0, 'the button called the provider')
    for (const call of calls) {
      assert.equal(call.account, account, 'refunded on the account the money came in on')
      const intent = (call.args[0] as { payment_intent: string }).payment_intent
      const res = await deliverRefund(intent)
      assert.equal(res.status, 200, JSON.stringify(res.body))
    }
  }

  const refundCalls = () => fake.callsTo('refunds.create')

  /** Put a studio back on the account every test here gives it. */
  const backOnOwnAccount = (at: Studio) => fake.ownAccount(at)

  async function purchaseRow(id: string) {
    const [row] = await harness.db.select().from(schema.purchases).where(eq(schema.purchases.id, id))
    assert.ok(row)
    return row
  }

  const paymentsOf = (purchaseId: string) =>
    harness.db
      .select({ intent: schema.stripePayments.paymentIntentId, status: schema.stripePayments.status })
      .from(schema.stripePayments)
      .where(eq(schema.stripePayments.purchaseId, purchaseId))

  async function packageRow(id: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, id))
    assert.ok(row)
    return row
  }

  async function bookingRow(id: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, id))
    assert.ok(row)
    return row
  }

  const ledgerOf = (clientPackageId: string) =>
    harness.db
      .select({ delta: schema.manualAdjustments.delta })
      .from(schema.manualAdjustments)
      .where(eq(schema.manualAdjustments.clientPackageId, clientPackageId))

  const cancellationsOf = (bookingId: string) =>
    harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))

  /** Everything a refund can move, for "nothing moved" assertions. */
  async function state(paid: Paid) {
    return {
      purchase: await purchaseRow(paid.purchaseId),
      payments: await paymentsOf(paid.purchaseId),
      package: await packageRow(paid.clientPackageId),
      ledger: await ledgerOf(paid.clientPackageId),
    }
  }

  /** The Purchase is closed as refunded, its Balance zeroed, every payment back. */
  async function assertRefunded(purchaseId: string) {
    const purchase = await purchaseRow(purchaseId)
    assert.equal(purchase.status, 'refunded')
    assert.equal(purchase.amountPaidSgd, '0.00')
    for (const p of await paymentsOf(purchaseId)) assert.equal(p.status, 'refunded', p.intent)
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

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    // Each studio sells on an account of its own — the only way a studio sells
    // at all (#293) — and a refund goes back on it.
    backOnOwnAccount(one)
    backOnOwnAccount(two)
    adminAtOne = await staff(one, 'owner', 'admin')
    teacherAtOne = await staff(one, 'teacher', 'instructor')
    adminAtTwo = await staff(two, 'owner', 'admin')
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM check_ins WHERE booking_id IN (SELECT id FROM bookings WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM promo_code_redemptions WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM promo_codes WHERE created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (SELECT id FROM pt_requests WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name IN (${BUNDLE_NAME}, ${PLAN_NAME})`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name = ${PT_PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (SELECT id FROM workshops WHERE name = ${WORKSHOP_NAME})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name = ${WORKSHOP_NAME}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test("RFD-01 a package refund returns the whole amount on the studio's own account: no amount is ever sent", async () => {
    const ana = await member(one, 'Ana Whole')
    const paid = await buy(one, ana, 'bundle')
    const from = refundCalls().length

    // An amount in the request is not a partial refund; it is ignored.
    const res = await refundPackage(adminAtOne, ana, paid, { amount_sgd: '50.00' })

    assert.equal(res.status, 200, JSON.stringify(res.body))
    const calls = refundCalls().slice(from)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.account, ownAccountId(one), "the studio sells on its own account")
    assert.deepEqual(calls[0]!.args[0], { payment_intent: paid.intents[0] }, 'the whole intent, no amount')
    assert.deepEqual(calls[0]!.args[1], { idempotencyKey: `refund:${paid.intents[0]}` })

    // Pressing the button moved money and nothing else; the provider's delivery unwinds.
    assert.equal((await purchaseRow(paid.purchaseId)).status, 'paid')
    await settle(from)

    await assertRefunded(paid.purchaseId)
    const pkg = await packageRow(paid.clientPackageId)
    assert.equal(pkg.active, false, 'the package is voided')
    assert.equal(pkg.creditsOrSessionsRemaining, 10, 'its balance is not paid out as credit')
    assert.deepEqual(await ledgerOf(paid.clientPackageId), [])
  })

  test('RFD-01 a workshop refund returns the whole amount and ends the place', async () => {
    const ben = await member(one, 'Ben Workshop')
    const bought = await buyWorkshop(one, ben)
    const from = refundCalls().length

    const res = await refundWorkshop(adminAtOne, ben, bought.bookingId)

    assert.equal(res.status, 200, JSON.stringify(res.body))
    const calls = refundCalls().slice(from)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.account, ownAccountId(one))
    assert.deepEqual(calls[0]!.args[0], { payment_intent: bought.intent })
    await settle(from)

    await assertRefunded(bought.purchaseId)
    const booking = await bookingRow(bought.bookingId)
    assert.equal(booking.state, 'cancelled')
    assert.equal(booking.refundOutcome, 'stripe_refunded')
  })

  test("RFD-01 a part-refund from the provider's dashboard unwinds nothing", async () => {
    const cy = await member(one, 'Cy Partial')
    const paid = await buy(one, cy, 'bundle')
    const untouched = await state(paid)

    const res = await deliverRefund(paid.intents[0]!, { captured: 20000, refunded: 5000 })

    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(await state(paid), untouched)
    assert.equal(untouched.package.active, true)
    assert.equal(untouched.purchase.status, 'paid')
  })

  test("RFD-01 a Purchase paid in two payments is returned on each, and voided only once both are back", async () => {
    // Two cards on one Purchase (a Part Payment and its balance, say). A payment
    // on the platform account refuses the whole Refund instead (#293) — see
    // own-account-only.test.ts, PAY-27.
    const own = ownAccountId(one)
    try {
      const di = await member(one, 'Di Split')
      const paid = await buy(one, di, 'bundle', [own, own])
      const from = refundCalls().length

      const res = await refundPackage(adminAtOne, di, paid)

      assert.equal(res.status, 200, JSON.stringify(res.body))
      const calls = refundCalls().slice(from)
      assert.deepEqual(
        calls.map(c => [c.account, (c.args[0] as { payment_intent: string }).payment_intent]),
        [
          [own, paid.intents[0]],
          [own, paid.intents[1]],
        ],
        'each payment goes back on the account it came in on',
      )

      // The first delivery alone is a half-done Refund: the plan stands.
      assert.equal((await deliverRefund(paid.intents[0]!)).status, 200)
      assert.equal((await packageRow(paid.clientPackageId)).active, true)
      assert.equal((await purchaseRow(paid.purchaseId)).status, 'paid')

      assert.equal((await deliverRefund(paid.intents[1]!)).status, 200)
      await assertRefunded(paid.purchaseId)
      assert.equal((await packageRow(paid.clientPackageId)).active, false)
    } finally {
      backOnOwnAccount(one)
    }
  })

  test('RFD-01 a Purchase cannot be refunded twice: the second press is refused and calls nobody', async () => {
    const ed = await member(one, 'Ed Twice')
    const paid = await buy(one, ed, 'bundle')
    const from = refundCalls().length
    assert.equal((await refundPackage(adminAtOne, ed, paid)).status, 200)
    await settle(from)
    const settled = await state(paid)

    const again = await refundPackage(adminAtOne, ed, paid)
    assert.equal(again.status, 409, JSON.stringify(again.body))
    assert.equal(again.body.error, 'already_refunded')
    assert.equal(refundCalls().length, from + 1, 'the provider was asked once')

    // The provider redelivering its event changes nothing either.
    assert.equal((await deliverRefund(paid.intents[0]!)).status, 200)
    assert.deepEqual(await state(paid), settled)
  })

  test('RFD-02 a refund cancels every future booking it paid for and leaves attended classes as history', async () => {
    const fi = await member(one, 'Fi History')
    const paid = await buy(one, fi, 'bundle')
    const pastClass = await addClass(one, 3 * DAY)
    const futureClass = await addClass(one, 4 * DAY)
    const past = await book(fi, pastClass)
    const future = await book(fi, futureClass)
    assert.equal(past.status, 201, JSON.stringify(past.body))
    assert.equal(future.status, 201, JSON.stringify(future.body))
    // The first class has since happened, and she came.
    await harness.db
      .update(schema.classes)
      .set({ startsAt: new Date(Date.now() - 2 * HOUR), endsAt: new Date(Date.now() - HOUR) })
      .where(eq(schema.classes.id, pastClass))
    const ticked = await post('/api/v1/portal/admin/check-in/manual', adminAtOne.headers, {
      booking_id: past.body.booking_id,
      attended: true,
    })
    assert.equal(ticked.status, 200, JSON.stringify(ticked.body))
    assert.equal((await packageRow(paid.clientPackageId)).creditsOrSessionsRemaining, 8)

    const from = refundCalls().length
    assert.equal((await refundPackage(adminAtOne, fi, paid)).status, 200)
    await settle(from)

    await assertRefunded(paid.purchaseId)
    const cancelled = await bookingRow(future.body.booking_id)
    assert.equal(cancelled.state, 'cancelled')
    assert.equal(cancelled.refundOutcome, 'n_a', 'no credit goes back to a voided package')
    const [record] = await cancellationsOf(future.body.booking_id)
    assert.equal(record?.source, 'admin')
    assert.equal(record?.refundFired, false)

    const kept = await bookingRow(past.body.booking_id)
    assert.equal(kept.state, 'confirmed')
    assert.equal(kept.checkInState, 'attended')
    assert.equal((await cancellationsOf(past.body.booking_id)).length, 0)

    const pkg = await packageRow(paid.clientPackageId)
    assert.equal(pkg.active, false)
    assert.equal(pkg.creditsOrSessionsRemaining, 8, 'the cancelled booking returns no credit')
    assert.deepEqual(await ledgerOf(paid.clientPackageId), [])
  })

  test('RFD-03 a refunded Purchase hands its Promo Code back to the member and to the pool', async () => {
    const gil = await member(one, 'Gil Promo')
    const hal = await member(one, 'Hal Promo')
    const paid = await buy(one, gil, 'bundle')
    const code = `BACK${run.slice(-6).toUpperCase()}`
    const [promo] = await harness.db
      .insert(schema.promoCodes)
      .values({
        tenantId: one.id,
        code,
        label: 'Ten off',
        kind: 'percent',
        percentOff: 10,
        maxRedemptions: 1,
        appliesToAll: true,
        createdByStaffId: adminAtOne.staffId,
      })
      .returning({ id: schema.promoCodes.id })
    await harness.db.insert(schema.promoCodeRedemptions).values({
      tenantId: one.id,
      promoCodeId: promo!.id,
      clientId: gil.clientId,
      status: 'consumed',
      heldUntil: new Date(),
      consumedAt: new Date(),
      stripePaymentIntentId: paid.intents[0]!,
      discountSgd: '20.00',
    })
    const check = (who: Member) =>
      post('/api/v1/me/checkout/validate-promo', who.headers, { code, package_kind: 'class', package_id: one.bundleId })

    const gilBefore = await check(gil)
    const halBefore = await check(hal)
    assert.equal(gilBefore.body.valid, false, JSON.stringify(gilBefore.body))
    assert.equal(gilBefore.body.reason, 'already_redeemed')
    assert.equal(halBefore.body.valid, false, JSON.stringify(halBefore.body))
    assert.equal(halBefore.body.reason, 'fully_claimed')

    const from = refundCalls().length
    assert.equal((await refundPackage(adminAtOne, gil, paid)).status, 200)
    await settle(from)

    await assertRefunded(paid.purchaseId)
    const pkg = await packageRow(paid.clientPackageId)
    assert.equal(pkg.active, false)
    assert.equal(pkg.creditsOrSessionsRemaining, 10)
    assert.deepEqual(await ledgerOf(paid.clientPackageId), [])
    const [redemption] = await harness.db
      .select({ status: schema.promoCodeRedemptions.status })
      .from(schema.promoCodeRedemptions)
      .where(eq(schema.promoCodeRedemptions.promoCodeId, promo!.id))
    assert.equal(redemption?.status, 'refunded')
    const gilAfter = await check(gil)
    const halAfter = await check(hal)
    assert.equal(gilAfter.status, 200)
    assert.equal(gilAfter.body.valid, true, `the member may use it again: ${JSON.stringify(gilAfter.body)}`)
    assert.equal(halAfter.body.valid, true, `the place is back in the pool: ${JSON.stringify(halAfter.body)}`)
  })

  test("RFD-04 a refund issued from the provider's dashboard runs the same unwind as the button", async () => {
    const ivy = await member(one, 'Ivy Dashboard')
    const paid = await buy(one, ivy, 'bundle')
    const futureClass = await addClass(one, 5 * DAY)
    const future = await book(ivy, futureClass)
    assert.equal(future.status, 201, JSON.stringify(future.body))
    const from = refundCalls().length

    // Nobody pressed anything here: the money went back at the provider.
    const res = await deliverRefund(paid.intents[0]!)

    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(refundCalls().length, from, 'the app does not refund what the provider already has')
    await assertRefunded(paid.purchaseId)
    const pkg = await packageRow(paid.clientPackageId)
    assert.equal(pkg.active, false)
    assert.equal(pkg.creditsOrSessionsRemaining, 9, 'the cancelled booking hands no credit back to a voided package')
    assert.deepEqual(await ledgerOf(paid.clientPackageId), [])
    const cancelled = await bookingRow(future.body.booking_id)
    assert.equal(cancelled.state, 'cancelled')
    assert.equal(cancelled.refundOutcome, 'n_a')
    assert.equal((await cancellationsOf(future.body.booking_id))[0]?.source, 'admin')

    // And the button afterwards is the double refund it would be.
    const again = await refundPackage(adminAtOne, ivy, paid)
    assert.equal(again.status, 409)
    assert.equal(refundCalls().length, from)
  })

  test('RFD-05 a refunded Credit Bundle with credits left pays for no later class', async () => {
    const jo = await member(one, 'Jo Bundle')
    const paid = await buy(one, jo, 'bundle')
    const from = refundCalls().length
    assert.equal((await refundPackage(adminAtOne, jo, paid)).status, 200)
    await settle(from)
    const refunded = await state(paid)
    assert.equal(refunded.package.creditsOrSessionsRemaining, 10)
    assert.equal(refunded.package.active, false)

    const attempt = await book(jo, await addClass(one, 3 * DAY))

    // A voided package is no candidate at all, so the member has nothing to pay with.
    assert.equal(attempt.status, 409, JSON.stringify(attempt.body))
    assert.equal(attempt.body.error, 'insufficient_credits')
    assert.deepEqual(await state(paid), refunded)
    const bookings = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.clientId, jo.clientId))
    assert.equal(bookings.length, 0)
  })

  test('RFD-05 a refunded Unlimited Plan with time left pays for no later class', async () => {
    const kai = await member(one, 'Kai Plan')
    const paid = await buy(one, kai, 'plan')
    // Activated by a first booking, so it has time left when refunded.
    const first = await book(kai, await addClass(one, 3 * DAY))
    assert.equal(first.status, 201, JSON.stringify(first.body))
    const running = await packageRow(paid.clientPackageId)
    assert.ok(running.expiresAt && running.expiresAt.getTime() > Date.now() + 7 * DAY)

    const from = refundCalls().length
    assert.equal((await refundPackage(adminAtOne, kai, paid)).status, 200)
    await settle(from)
    await assertRefunded(paid.purchaseId)
    const refunded = await state(paid)
    assert.equal(refunded.package.active, false)
    assert.equal((await bookingRow(first.body.booking_id)).state, 'cancelled')

    const attempt = await book(kai, await addClass(one, 4 * DAY))

    assert.equal(attempt.status, 409, JSON.stringify(attempt.body))
    assert.equal(attempt.body.error, 'insufficient_credits')
    assert.deepEqual(await state(paid), refunded)
  })

  test('RFD-05 a refunded PT package with sessions left pays for no PT request', async () => {
    const lu = await member(one, 'Lu Private')
    const paid = await buy(one, lu, 'pt')
    const from = refundCalls().length
    assert.equal((await refundPackage(adminAtOne, lu, paid)).status, 200)
    await settle(from)
    await assertRefunded(paid.purchaseId)
    const refunded = await state(paid)
    assert.equal(refunded.package.creditsOrSessionsRemaining, 5)

    const soon = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10)
    const attempt = await post('/api/v1/me/pt-sessions/request', lu.headers, {
      classTypeId: one.classTypeId,
      locationId: one.locationId,
      sessionType: '1on1',
      clientPackageId: paid.clientPackageId,
      slots: [{ proposedDate: soon, startTime: '09:00', endTime: '10:00' }],
    })

    assert.equal(attempt.status, 409, JSON.stringify(attempt.body))
    assert.equal(attempt.body.error, 'package_not_consumable')
    assert.deepEqual(await state(paid), refunded)
    const requests = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.clientId, lu.clientId))
    assert.equal(requests.length, 0)
  })

  test("another studio's admin cannot refund a studio's package or workshop place, and no money moves", async () => {
    const mo = await member(one, 'Mo Guarded')
    const paid = await buy(one, mo, 'bundle')
    const place = await buyWorkshop(one, mo)
    const untouched = await state(paid)
    const from = refundCalls().length

    const pkg = await refundPackage(adminAtTwo, mo, paid)
    assert.equal(pkg.status, 404, JSON.stringify(pkg.body))
    const ws = await refundWorkshop(adminAtTwo, mo, place.bookingId)
    assert.equal(ws.status, 404, JSON.stringify(ws.body))
    const open = await post(`/api/v1/portal/admin/purchases/${paid.purchaseId}/refund`, adminAtTwo.headers, { reason: 'probe' })
    assert.equal(open.status, 404, JSON.stringify(open.body))

    // Studio two's session carried to studio one's hostname is refused outright.
    const crossed = { headers: { ...adminAtTwo.headers, 'X-Tenant-Slug': one.slug } }
    assert.ok([401, 403].includes((await refundPackage(crossed, mo, paid)).status))

    assert.equal(refundCalls().length, from)
    assert.deepEqual(await state(paid), untouched)
    assert.equal((await bookingRow(place.bookingId)).state, 'confirmed')
  })

  test("a refund delivery on another studio's own endpoint is refused and unwinds nothing", async () => {
    fake.credentials(two.id, { accountId: `acct_other_${run}` })
    try {
      const ned = await member(one, 'Ned Delivery')
      const paid = await buy(one, ned, 'bundle')
      const untouched = await state(paid)

      const res = await deliverRefund(paid.intents[0]!, { endpoint: stripeWebhookPath(two.slug) })

      assert.ok(res.status >= 400, JSON.stringify(res.body))
      assert.deepEqual(await state(paid), untouched)
    } finally {
      backOnOwnAccount(two)
    }
  })

  test('an instructor or a member cannot refund, and no money moves', async () => {
    const oz = await member(one, 'Oz Refund')
    const paid = await buy(one, oz, 'bundle')
    const place = await buyWorkshop(one, oz)
    const untouched = await state(paid)
    const from = refundCalls().length

    assert.equal((await refundPackage(teacherAtOne, oz, paid)).status, 403)
    assert.equal((await refundWorkshop(teacherAtOne, oz, place.bookingId)).status, 403)
    assert.equal((await refundPackage(oz, oz, paid)).status, 401)
    assert.equal((await refundWorkshop(oz, oz, place.bookingId)).status, 401)

    // Nor may an admin refund one member's package through another member's page.
    const pat = await member(one, 'Pat Other')
    const mismatched = await post(
      `/api/v1/portal/admin/clients/${pat.clientId}/packages/${paid.clientPackageId}/refund`,
      adminAtOne.headers,
      { reason: 'wrong member' },
    )
    assert.equal(mismatched.status, 404, JSON.stringify(mismatched.body))

    assert.equal(refundCalls().length, from)
    assert.deepEqual(await state(paid), untouched)
    assert.equal((await bookingRow(place.bookingId)).state, 'confirmed')
  })
})
