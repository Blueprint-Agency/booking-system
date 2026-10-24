import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { ownAccountId, stripeWebhookPath, type StripeFake } from './stripe-fake'
import { billed } from './billing-details-fixture'

const run = Date.now().toString(36)
const DOMAIN = `${run}.package-purchase.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `Purchase ${run}`
const CLASS_TYPE_NAME = `Purchase class type ${run}`
const SECOND_LOCATION_NAME = `Purchase second premises ${run}`
/** The only signature the fake provider accepts; anything else fails the check. */
const GOOD_SIGNATURE = 't=1,v1=package-purchase'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * Buying packages over real HTTP (#215): checkout, the payment provider's
 * webhook, and every rule checkout applies before a member is charged.
 *
 * Written from the PKG and PAY rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`). Every test acts through a route and then reads
 * the rows it left — the package, the Purchase, the payment — not just the
 * response. The payment provider is the one fake (`stripe-fake.ts`): a checkout
 * records the session it asked for, and a test "pays" by delivering that
 * session back through the webhook, signed or not.
 */
describe('buying packages over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let jobs!: typeof import('../jobs')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let fake!: StripeFake

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    timezone: string
    locationId: string
    roomId: string
    secondLocationId: string
    secondRoomId: string
    classTypeId: string
    admin: Staff
    instructor: Staff
    bundleId: string
    unlimitedId: string
    trialId: string
    freeTrialId: string
    ptId: string
    rateSgd: string
  }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio

  const json = { 'Content-Type': 'application/json' }
  const emailFor = (name: string) => `${name}@${DOMAIN}`

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${name}-${tenant.slug}`)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select({ id: schema.staffAuthUsers.id }).from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    return { id: row!.id, headers }
  }

  async function catalogue(tenantId: string, values: Partial<typeof schema.classPackages.$inferInsert> & { kind: 'credit_bundle' | 'unlimited' | 'trial' }): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId, name: `${NAME} ${values.kind}`, priceSgd: '150.00', status: 'active', ...values })
      .returning({ id: schema.classPackages.id })
    return row!.id
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location.id)).limit(1)
    assert.ok(room, `expected a seeded room for ${tenant.slug}`)
    const [second] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: SECOND_LOCATION_NAME })
      .returning({ id: schema.locations.id })
    const [secondRoom] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: second!.id, name: `Room ${run}`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    const [row] = await harness.db.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, tenant.id))
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, tenant.id))
    assert.ok(policy, `expected a seeded policy for ${tenant.slug}`)

    const classType = await classTypesSvc.createClassType(tenant.id, { name: CLASS_TYPE_NAME })
    const admin = await staffAt(tenant, 'admin', 'admin')
    const instructor = await staffAt(tenant, 'instructor', 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: instructor.id })

    const [pt] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: `${NAME} pt`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00' })
      .returning({ id: schema.ptPackages.id })

    return {
      ...tenant,
      timezone: row!.timezone,
      locationId: location.id,
      roomId: room.id,
      secondLocationId: second!.id,
      secondRoomId: secondRoom!.id,
      classTypeId: classType.id,
      admin,
      instructor,
      bundleId: await catalogue(tenant.id, { kind: 'credit_bundle', credits: 10, validityDays: 90 }),
      unlimitedId: await catalogue(tenant.id, { kind: 'unlimited', durationMonths: 3, priceSgd: '300.00' }),
      trialId: await catalogue(tenant.id, { kind: 'trial', credits: 1, validityDays: 14, priceSgd: '20.00' }),
      freeTrialId: await catalogue(tenant.id, { kind: 'trial', credits: 1, validityDays: 14, priceSgd: '0.00', name: `${NAME} free trial` }),
      ptId: pt!.id,
      rateSgd: policy.crossLocationRateSgd,
    }
  }

  let members = 0
  async function member(at: Studio): Promise<Member> {
    const email = emailFor(`member-${members++}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  type HeldKind = 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  /** A package the member already holds, as an earlier purchase would have left it. */
  async function holds(
    at: Studio,
    who: Member,
    kind: HeldKind,
    options: { expiresAt?: Date | null; active?: boolean; locationId?: string; durationMonths?: number; crossLocation?: string | null } = {},
  ): Promise<string> {
    const unlimited = kind === 'unlimited'
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind,
        sourceClassPackageId: kind === 'pt' ? null : { credit_bundle: at.bundleId, unlimited: at.unlimitedId, trial: at.trialId }[kind],
        sourcePtPackageId: kind === 'pt' ? at.ptId : null,
        locationId: unlimited ? (options.locationId ?? at.locationId) : null,
        durationMonths: unlimited ? (options.durationMonths ?? 3) : null,
        validityDays: unlimited ? null : 90,
        crossLocationPaidSgd: options.crossLocation ?? null,
        creditsOrSessionsRemaining: unlimited ? null : 5,
        expiresAt: options.expiresAt ?? null,
        active: options.active ?? true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  async function addClass(at: Studio, options: { startsIn?: number; atSecond?: boolean } = {}): Promise<string> {
    const startsAt = new Date(harness.clock.now().getTime() + (options.startsIn ?? 3 * DAY))
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.instructor.id,
        locationId: options.atSecond ? at.secondLocationId : at.locationId,
        roomId: options.atSecond ? at.secondRoomId : at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: at.instructor.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  const checkout = async (who: Member, body: Record<string, unknown>) =>
    harness.app.request('/api/v1/me/checkout/package', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify(await billed(harness.app, who.headers, body)),
    })

  const buyClass = (who: Member, packageId: string, extra: Record<string, unknown> = {}) =>
    checkout(who, { package_kind: 'class', package_id: packageId, ...extra })

  const post = (who: Member, path: string, body: unknown) =>
    harness.app.request(path, { method: 'POST', headers: { ...who.headers, ...json }, body: JSON.stringify(body) })

  const book = (who: Member, classId: string) => post(who, '/api/v1/me/bookings/class', { class_id: classId })

  const get = async (who: Member, path: string) => expectStatus(await harness.app.request(path, { headers: who.headers }), 200)

  /** The session the last checkout asked the provider for. */
  function lastSession(): { account: string | null; params: { metadata: Record<string, string>; line_items: any[] } } {
    const call = fake.callsTo('checkout.sessions.create').at(-1)
    assert.ok(call, 'no checkout session was created')
    return { account: call.account, params: call.args[0] as any }
  }

  const sessionTotal = (params: { line_items: any[] }) =>
    params.line_items.reduce((n: number, l: any) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0)

  type Delivery = {
    intent?: string
    signature?: string
    endpoint?: string
    metadata?: Record<string, string>
    /** Which of the checkout events, and what it says of the money; paid on completion by default. */
    type?: 'checkout.session.completed' | 'checkout.session.async_payment_succeeded'
    paymentStatus?: 'paid' | 'unpaid'
    /** What the session captured, in cents, when the card paid less than the session asked (a Part Payment). */
    amountTotal?: number
  }

  /** The provider's checkout-completed delivery for the last session, paid in full. */
  async function deliver(options: Delivery = {}): Promise<Response> {
    const { params } = lastSession()
    const event = {
      id: `evt_${randomUUID()}`,
      type: options.type ?? 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${randomUUID()}`,
          payment_intent: options.intent ?? `pi_${randomUUID()}`,
          payment_status: options.paymentStatus ?? 'paid',
          amount_total: options.amountTotal ?? sessionTotal(params),
          metadata: options.metadata ?? params.metadata,
        },
      },
    }
    // The studio's own endpoint (#293): the one whose member the session was for.
    const endpoint = options.endpoint ?? stripeWebhookPath(params.metadata.tenant_id === two.id ? two.slug : one.slug)
    return harness.app.request(endpoint, {
      method: 'POST',
      headers: { ...json, 'stripe-signature': options.signature ?? GOOD_SIGNATURE },
      body: JSON.stringify(event),
    })
  }

  /** Check out and pay: the checkout, then the webhook. Returns the package granted. */
  async function purchase(who: Member, body: Record<string, unknown>) {
    await expectStatus(await checkout(who, body), 200)
    await expectStatus(await deliver(), 200)
    const [granted] = await packagesOf(who).then(rows => rows.filter(r => r.sourceClassPackageId === body.package_id || r.sourcePtPackageId === body.package_id).slice(-1))
    assert.ok(granted, 'the webhook granted nothing')
    return granted
  }

  /* ── state ──────────────────────────────────────────────────────────── */

  const packagesOf = (who: Member) =>
    harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, who.clientId)).orderBy(schema.clientPackages.purchasedAt)
  const purchasesOf = (who: Member) => harness.db.select().from(schema.purchases).where(eq(schema.purchases.clientId, who.clientId))
  const paymentsOf = (who: Member) => harness.db.select().from(schema.stripePayments).where(eq(schema.stripePayments.clientId, who.clientId))
  const pkg = async (id: string) => {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, id))
    assert.ok(row, `no package ${id}`)
    return row
  }
  const sessionsAsked = () => fake.callsTo('checkout.sessions.create').length

  /** Nothing was charged or recorded: no provider session, no Purchase, no package. */
  async function assertNothingSold(who: Member, sessionsBefore: number, packagesBefore = 0): Promise<void> {
    assert.equal(sessionsAsked(), sessionsBefore, 'the provider was asked for a session')
    assert.equal((await purchasesOf(who)).length, 0, 'a Purchase was opened')
    assert.equal((await packagesOf(who)).length, packagesBefore, 'a package was granted')
  }

  /**
   * The fake provider, with both studios selling on accounts of their own —
   * the only way a studio sells at all (#293).
   */
  async function installFake(): Promise<StripeFake> {
    const installed = (await import('./stripe-fake')).installStripeFake()
    installed.ownAccount(harness.tenants.one)
    installed.ownAccount(harness.tenants.two)
    installed.reply('customers.create', () => ({ id: `cus_${randomUUID().slice(0, 8)}` }))
    installed.reply('checkout.sessions.create', () => {
      const id = `cs_${randomUUID()}`
      return { id, url: `https://pay.example.test/${id}` }
    })
    installed.reply('webhooks.constructEvent', (body: unknown, signature: unknown) => {
      if (signature !== GOOD_SIGNATURE) throw new Error('No signatures found matching the expected signature for payload')
      return JSON.parse(String(body))
    })
    installed.reply('paymentIntents.retrieve', intentAtProvider)
    return installed
  }

  /** Intents the provider has given back in full, with what each captured in cents. */
  const refundedAtProvider = new Map<string, number>()

  /** A payment intent as the provider reads it back, with its latest charge. */
  function intentAtProvider(id: unknown) {
    const captured = refundedAtProvider.get(String(id))
    return {
      id,
      latest_charge: {
        id: `ch_${String(id)}`,
        receipt_url: null,
        // What the provider says of a charge given back from its dashboard.
        ...(captured === undefined
          ? {}
          : { amount: captured, amount_captured: captured, amount_refunded: captured, refunded: true }),
      },
    }
  }

  /**
   * The provider's `charge.refunded` delivery for a whole refund, as its
   * dashboard sends it, to studio one's own endpoint.
   */
  async function deliverRefund(intent: string, capturedCents: number): Promise<Response> {
    refundedAtProvider.set(intent, capturedCents)
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_${intent}`,
          payment_intent: intent,
          amount: capturedCents,
          amount_captured: capturedCents,
          amount_refunded: capturedCents,
          refunded: true,
          metadata: {},
        },
      },
    }
    return harness.app.request(stripeWebhookPath(one.slug), {
      method: 'POST',
      headers: { ...json, 'stripe-signature': GOOD_SIGNATURE },
      body: JSON.stringify(event),
    })
  }

  /** A studio Admin acting in the portal. */
  const asAdmin = (method: 'GET' | 'POST', path: string, body?: unknown) =>
    harness.app.request(`/api/v1/portal/admin${path}`, {
      method,
      headers: { ...one.admin.headers, ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    jobs = await import('../jobs')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))

    fake = await installFake()

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM promo_code_redemptions WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_billing_details WHERE client_id IN (SELECT id FROM clients WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM promo_code_products WHERE promo_code_id IN (SELECT id FROM promo_codes WHERE created_by_staff_id IN (${staff}))`)
    await harness.db.execute(sql`DELETE FROM promo_codes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM promotions WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (SELECT id FROM locations WHERE name = ${SECOND_LOCATION_NAME})`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name = ${SECOND_LOCATION_NAME}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── buying through checkout and the webhook ────────────────────────── */

  test('PAY-17, PKG-05 a Credit Bundle is granted only when the webhook confirms payment: one Purchase for the amount paid, the package Dormant and listed on the account', async () => {
    const mia = await member(one)
    const started = await expectStatus(await buyClass(mia, one.bundleId), 200)
    assert.match(started.url, /^https:\/\/pay\.example\.test\//)
    const { params } = lastSession()
    assert.equal(sessionTotal(params), 15000, 'the session charges the List Price')
    assert.equal(params.metadata.client_id, mia.clientId)

    // Paying has not happened yet: the sale is open and nothing is granted.
    const [open] = await purchasesOf(mia)
    assert.ok(open)
    assert.equal(open.status, 'open')
    assert.equal(open.totalSgd, '150.00')
    assert.equal(open.amountPaidSgd, '0.00')
    assert.equal((await packagesOf(mia)).length, 0, 'granted before the money arrived')
    const before = await get(mia, '/api/v1/me/packages')
    assert.equal(before.client_packages.length, 0)

    const intent = `pi_${randomUUID()}`
    await expectStatus(await deliver({ intent }), 200)

    const purchases = await purchasesOf(mia)
    assert.equal(purchases.length, 1, 'one Purchase')
    const [sale] = purchases
    assert.equal(sale!.totalSgd, '150.00')
    assert.equal(sale!.amountPaidSgd, '150.00')
    assert.notEqual(sale!.status, 'open', 'the Purchase is settled')

    const [payment, ...morePayments] = await paymentsOf(mia)
    assert.equal(morePayments.length, 0)
    assert.equal(payment!.paymentIntentId, intent)
    assert.equal(payment!.amountSgd, '150.00')
    assert.equal(payment!.status, 'succeeded')
    assert.equal(payment!.purchaseId, sale!.id)
    assert.equal(payment!.providerAccountId, ownAccountId(one), "on the studio's own account, the one that signed the delivery")

    const [granted, ...more] = await packagesOf(mia)
    assert.equal(more.length, 0)
    assert.equal(payment!.clientPackageId, granted!.id)
    assert.equal(granted!.kind, 'credit_bundle')
    assert.equal(granted!.sourceClassPackageId, one.bundleId)
    assert.equal(granted!.purchaseId, sale!.id)
    assert.equal(granted!.creditsOrSessionsRemaining, 10)
    assert.equal(granted!.validityDays, 90, 'the catalogue validity is frozen on the sale')
    assert.equal(granted!.expiresAt, null, 'Dormant until its first booking')
    assert.equal(granted!.active, true)
    assert.equal(granted!.amountPaidSgd, '150.00')
    assert.equal(granted!.listPriceSgd, '150.00')

    const listed = await get(mia, '/api/v1/me/packages')
    assert.deepEqual(
      listed.client_packages.map((p: any) => [p.id, p.kind, p.credits_or_sessions_remaining, p.dormant]),
      [[granted!.id, 'credit_bundle', 10, true]],
    )
  })

  test('PAY-17 an Unlimited Plan and a priced Trial Pass are bought the same way, each landing Dormant', async () => {
    const leo = await member(one)
    const plan = await purchase(leo, { package_kind: 'class', package_id: one.unlimitedId, location_id: one.locationId })
    assert.equal(plan.kind, 'unlimited')
    assert.equal(plan.locationId, one.locationId, 'the Home Location picked at checkout')
    assert.equal(plan.durationMonths, 3)
    assert.equal(plan.creditsOrSessionsRemaining, null)
    assert.equal(plan.expiresAt, null)
    assert.equal(plan.amountPaidSgd, '300.00')

    const ivy = await member(one)
    const trial = await purchase(ivy, { package_kind: 'class', package_id: one.trialId })
    assert.equal(trial.kind, 'trial')
    assert.equal(trial.creditsOrSessionsRemaining, 1)
    assert.equal(trial.validityDays, 14)
    assert.equal(trial.expiresAt, null)
    assert.equal(trial.amountPaidSgd, '20.00')

    for (const who of [leo, ivy]) {
      const [sale] = await purchasesOf(who)
      assert.equal(sale!.amountPaidSgd, sale!.totalSgd)
      const [payment] = await paymentsOf(who)
      assert.equal(payment!.status, 'succeeded')
    }
  })

  test('PAY-14 the same success webhook delivered twice grants one package and records one Purchase and one payment', async () => {
    const ana = await member(one)
    await expectStatus(await buyClass(ana, one.bundleId), 200)
    const intent = `pi_${randomUUID()}`
    await expectStatus(await deliver({ intent }), 200)
    await expectStatus(await deliver({ intent }), 200)

    assert.equal((await packagesOf(ana)).length, 1, 'one package')
    const purchases = await purchasesOf(ana)
    assert.equal(purchases.length, 1, 'one Purchase')
    assert.equal(purchases[0]!.amountPaidSgd, '150.00', 'the redelivery did not pay twice')
    assert.equal((await paymentsOf(ana)).length, 1, 'one payment')
    assert.equal((await packagesOf(ana))[0]!.creditsOrSessionsRemaining, 10)
  })

  test('PAY-46 a checkout completed but not yet paid grants nothing; the async-payment-succeeded webhook then grants once', async () => {
    const kai = await member(one)
    await expectStatus(await buyClass(kai, one.bundleId), 200)
    const intent = `pi_${randomUUID()}`

    // The member left the provider's page; an asynchronous method is still settling.
    await expectStatus(await deliver({ intent, paymentStatus: 'unpaid' }), 200)
    assert.equal((await packagesOf(kai)).length, 0, 'granted before the money arrived')
    assert.equal((await paymentsOf(kai)).length, 0, 'a payment recorded before the money arrived')
    const [open] = await purchasesOf(kai)
    assert.equal(open!.status, 'open')
    assert.equal(open!.amountPaidSgd, '0.00')

    await expectStatus(await deliver({ intent, type: 'checkout.session.async_payment_succeeded' }), 200)
    const [granted, ...more] = await packagesOf(kai)
    assert.equal(more.length, 0)
    assert.equal(granted!.creditsOrSessionsRemaining, 10)
    const [payment] = await paymentsOf(kai)
    assert.equal(payment!.paymentIntentId, intent)
    assert.equal(payment!.status, 'succeeded')
    assert.equal(payment!.clientPackageId, granted!.id)
    const [sale] = await purchasesOf(kai)
    assert.equal(sale!.amountPaidSgd, '150.00')

    // Redelivered, or arriving after a completion that was already paid: nothing more.
    await expectStatus(await deliver({ intent, type: 'checkout.session.async_payment_succeeded' }), 200)
    await expectStatus(await deliver({ intent }), 200)
    assert.equal((await packagesOf(kai)).length, 1, 'one package')
    assert.equal((await paymentsOf(kai)).length, 1, 'one payment')
    assert.equal((await purchasesOf(kai))[0]!.amountPaidSgd, '150.00')
  })

  /* ── what changed between checkout and payment ──────────────────────── */

  /** The member's package as the Admin's client page lists it, with its Refund state. */
  async function adminSees(who: Member, clientPackageId: string): Promise<Record<string, any>> {
    const detail = await expectStatus(await asAdmin('GET', `/clients/${who.clientId}`), 200)
    const listed = [...detail.packages, ...detail.past_packages].find((p: any) => p.id === clientPackageId)
    assert.ok(listed, "the package is not on the Admin's client page")
    return listed
  }

  test('PAY-59 a package archived between checkout and payment is granted when the payment lands, and the Admin sees it and can refund it', async () => {
    const retiring = await catalogue(one.id, { kind: 'credit_bundle', credits: 10, validityDays: 90, name: `${NAME} retiring bundle` })
    const ada = await member(one)
    await expectStatus(await buyClass(ada, retiring), 200)
    await expectStatus(await asAdmin('POST', `/class-packages/${retiring}/archive`), 200)

    const intent = `pi_${randomUUID()}`
    await expectStatus(await deliver({ intent }), 200)

    const [payment, ...morePayments] = await paymentsOf(ada)
    assert.equal(morePayments.length, 0)
    assert.equal(payment!.paymentIntentId, intent, 'the money is recorded')
    assert.equal(payment!.status, 'succeeded')
    assert.equal(payment!.amountSgd, '150.00')
    const [sale] = await purchasesOf(ada)
    assert.equal(sale!.status, 'paid')
    assert.equal(sale!.amountPaidSgd, '150.00')
    const [granted, ...more] = await packagesOf(ada)
    assert.equal(more.length, 0)
    assert.equal(granted!.sourceClassPackageId, retiring, 'the member gets what they paid for')
    assert.equal(granted!.purchaseId, sale!.id)
    assert.equal(granted!.creditsOrSessionsRemaining, 10)
    assert.equal(granted!.active, true)
    assert.equal(payment!.clientPackageId, granted!.id)

    const listed = await adminSees(ada, granted!.id)
    assert.equal(listed.refundable, true)
    assert.equal(listed.refund_amount_sgd, '150.00')
    const asked = fake.callsTo('refunds.create').length
    await expectStatus(await asAdmin('POST', `/clients/${ada.clientId}/packages/${granted!.id}/refund`, { reason: 'Plan retired' }), 200)
    const [call, ...moreCalls] = fake.callsTo('refunds.create').slice(asked)
    assert.equal(moreCalls.length, 0)
    assert.equal((call!.args[0] as { payment_intent: string }).payment_intent, intent, 'the Refund returns this payment')
  })

  test('PAY-59 a Part Payment whose package was archived before the Balance was cleared is granted on the payment that settles it', async () => {
    const retiring = await catalogue(one.id, { kind: 'credit_bundle', credits: 10, validityDays: 90, name: `${NAME} retiring part-paid bundle` })
    const bo = await member(one)
    await expectStatus(await buyClass(bo, retiring), 200)
    // The first card covers S$50 of the S$150.
    await expectStatus(await deliver({ intent: `pi_${randomUUID()}`, amountTotal: 5000 }), 200)
    const [open] = await purchasesOf(bo)
    assert.equal(open!.status, 'open')
    assert.equal(open!.amountPaidSgd, '50.00')

    await expectStatus(await asAdmin('POST', `/class-packages/${retiring}/archive`), 200)

    // Weeks later the member clears the rest.
    await expectStatus(await post(bo, `/api/v1/me/purchases/${open!.id}/resume`, {}), 200)
    await expectStatus(await deliver(), 200)

    const [sale] = await purchasesOf(bo)
    assert.equal(sale!.status, 'paid')
    assert.equal(sale!.amountPaidSgd, '150.00')
    const payments = await paymentsOf(bo)
    assert.deepEqual(payments.map(p => [p.amountSgd, p.status]).sort(), [['100.00', 'succeeded'], ['50.00', 'succeeded']])
    const [granted, ...more] = await packagesOf(bo)
    assert.equal(more.length, 0)
    assert.equal(granted!.sourceClassPackageId, retiring)
    assert.equal(granted!.purchaseId, sale!.id)
    assert.equal((await adminSees(bo, granted!.id)).refundable, true)
  })

  test('PAY-59 a PT package whose Bound Instructor was archived between checkout and payment is granted, bound to them, and the Admin sees it and can refund it', async () => {
    const [bound] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: one.id, name: `${NAME} bound pt`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00', instructorBound: true })
      .returning({ id: schema.ptPackages.id })
    const leaver = await staffAt(one, 'leaver', 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: leaver.id })

    const cy = await member(one)
    await expectStatus(await checkout(cy, { package_kind: 'pt', package_id: bound!.id, instructor_id: leaver.id }), 200)
    await expectStatus(await asAdmin('POST', `/staff/${leaver.id}/archive`), 200)

    const intent = `pi_${randomUUID()}`
    await expectStatus(await deliver({ intent }), 200)

    const [payment] = await paymentsOf(cy)
    assert.equal(payment!.paymentIntentId, intent, 'the money is recorded')
    assert.equal(payment!.status, 'succeeded')
    const [sale] = await purchasesOf(cy)
    assert.equal(sale!.status, 'paid')
    const [granted, ...more] = await packagesOf(cy)
    assert.equal(more.length, 0)
    assert.equal(granted!.sourcePtPackageId, bound!.id)
    assert.equal(granted!.boundInstructorId, leaver.id, 'bound to the instructor the member picked, archived and visibly so')
    assert.equal(payment!.clientPackageId, granted!.id)
    assert.equal((await adminSees(cy, granted!.id)).refundable, true)
  })

  test('PAY-60 a payment the studio refunded from the provider dashboard before this system recorded it grants nothing when its checkout-completed delivery lands', async () => {
    const ola = await member(one)
    await expectStatus(await buyClass(ola, one.bundleId), 200)
    const intent = `pi_${randomUUID()}`

    // The refund arrives first: there is no payment row for it to unwind yet.
    await expectStatus(await deliverRefund(intent, 15000), 200)
    assert.equal((await paymentsOf(ola)).length, 0)

    await expectStatus(await deliver({ intent }), 200)

    assert.equal((await packagesOf(ola)).length, 0, 'a package was granted on money already given back')
    const [payment, ...morePayments] = await paymentsOf(ola)
    assert.equal(morePayments.length, 0)
    assert.equal(payment!.paymentIntentId, intent, 'the payment is recorded')
    assert.equal(payment!.status, 'refunded', 'as given back')
    const [sale] = await purchasesOf(ola)
    assert.equal(sale!.status, 'abandoned', 'the sale is closed: nothing was granted and the money is back')
    assert.equal(sale!.amountPaidSgd, '0.00')

    // The provider retries, and the confirmation page replays it.
    await expectStatus(await deliver({ intent }), 200)
    assert.equal((await packagesOf(ola)).length, 0)
    assert.equal((await paymentsOf(ola))[0]!.status, 'refunded')
    assert.equal((await purchasesOf(ola))[0]!.status, 'abandoned')
  })

  /* ── a Refund while the member is paying ────────────────────────────── */

  const resume = (who: Member, purchaseId: string) => post(who, `/api/v1/me/purchases/${purchaseId}/resume`, {})
  const refundOpen = (purchaseId: string) => asAdmin('POST', `/purchases/${purchaseId}/refund`, { reason: 'Member asked' })

  /** A member S$50 into a S$150 Credit Bundle, with a Resume page open for the other S$100. */
  async function midResume(): Promise<{ who: Member; purchaseId: string; firstIntent: string; resumeSessionId: string }> {
    const who = await member(one)
    await expectStatus(await buyClass(who, one.bundleId), 200)
    const firstIntent = `pi_${randomUUID()}`
    await expectStatus(await deliver({ intent: firstIntent, amountTotal: 5000 }), 200)
    const [open] = await purchasesOf(who)
    assert.equal(open!.status, 'open')
    assert.equal(open!.amountPaidSgd, '50.00')
    await expectStatus(await resume(who, open!.id), 200)
    const [resumed] = await purchasesOf(who)
    assert.ok(resumed!.checkoutSessionId, 'the Resume page is the Purchase’s live session')
    return { who, purchaseId: open!.id, firstIntent, resumeSessionId: resumed!.checkoutSessionId! }
  }

  test("RFD-20 refunding a part-paid Purchase ends the member's open Resume page before any money goes back, and the member cannot pay towards it again", async () => {
    const { who, purchaseId, firstIntent, resumeSessionId } = await midResume()
    const from = fake.calls.length

    await expectStatus(await refundOpen(purchaseId), 200)

    const made = fake.calls.slice(from)
    assert.deepEqual(
      made.filter(c => c.method === 'checkout.sessions.expire').map(c => c.args[0]),
      [resumeSessionId],
      'the Resume page was ended at the provider',
    )
    const methods = made.map(c => c.method)
    assert.ok(
      methods.indexOf('checkout.sessions.expire') < methods.indexOf('refunds.create'),
      'the page was ended before any money went back',
    )

    // Asked for, not yet confirmed: the Purchase is still open, and still no
    // place to put more money.
    const sessions = sessionsAsked()
    await expectStatus(await resume(who, purchaseId), 400, 'purchase_not_open')
    assert.equal(sessionsAsked(), sessions, 'a new payment page was made for a Purchase being refunded')

    await expectStatus(await deliverRefund(firstIntent, 5000), 200)
    assert.equal((await purchasesOf(who))[0]!.status, 'abandoned')
    await expectStatus(await resume(who, purchaseId), 400, 'purchase_not_open')
    assert.equal(sessionsAsked(), sessions)
    assert.equal((await packagesOf(who)).length, 0)
  })

  test('RFD-21 a payment that lands on a Purchase already refunded and Abandoned is recorded and given back to the member, and grants nothing', async () => {
    const { who, purchaseId, firstIntent } = await midResume()
    // The studio returns the first card from the provider's dashboard while the
    // member's Resume page is still open, and the member then pays on it.
    await expectStatus(await deliverRefund(firstIntent, 5000), 200)
    assert.equal((await purchasesOf(who))[0]!.status, 'abandoned')

    const lateIntent = `pi_${randomUUID()}`
    const asked = fake.callsTo('refunds.create').length
    await expectStatus(await deliver({ intent: lateIntent }), 200)

    const late = (await paymentsOf(who)).find(p => p.paymentIntentId === lateIntent)
    assert.ok(late, 'the payment is recorded')
    assert.equal(late.purchaseId, purchaseId)
    assert.equal(late.amountSgd, '100.00')
    assert.ok(late.refundRequestedAt, 'its return is on its way')
    const returned = fake.callsTo('refunds.create').slice(asked)
    assert.deepEqual(
      returned.map(c => (c.args[0] as { payment_intent: string }).payment_intent),
      [lateIntent],
      'the late payment, and only it, is given back',
    )
    assert.equal(returned[0]!.account, ownAccountId(one), 'on the account it was paid on')
    assert.equal((await packagesOf(who)).length, 0, 'a package was granted on a refunded Purchase')
    assert.equal((await purchasesOf(who))[0]!.status, 'abandoned')

    // A redelivery does not ask for it twice; the provider's confirmation lands it.
    await expectStatus(await deliver({ intent: lateIntent }), 200)
    assert.equal(fake.callsTo('refunds.create').length, asked + 1)
    await expectStatus(await deliverRefund(lateIntent, 10000), 200)
    assert.equal((await paymentsOf(who)).find(p => p.paymentIntentId === lateIntent)!.status, 'refunded')
    const [sale] = await purchasesOf(who)
    assert.equal(sale!.status, 'abandoned')
    assert.equal(sale!.amountPaidSgd, '0.00')
  })

  test('RFD-22 a Resume page the member has already paid on, whose payment has not reached the studio, holds the Refund back until it does, and the payment is then counted', async () => {
    const { who, purchaseId, resumeSessionId } = await midResume()
    const lateIntent = `pi_${randomUUID()}`
    // The provider says the page can no longer be ended: it was paid on.
    fake.reply('checkout.sessions.expire', () => {
      throw Object.assign(new Error('Only Checkout Sessions with a status in ["open"] can be expired.'), {
        type: 'StripeInvalidRequestError',
      })
    })
    fake.reply('checkout.sessions.retrieve', (id: unknown) => ({
      id,
      status: id === resumeSessionId ? 'complete' : 'expired',
      payment_status: id === resumeSessionId ? 'paid' : 'unpaid',
      payment_intent: id === resumeSessionId ? lateIntent : null,
    }))
    try {
      const asked = fake.callsTo('refunds.create').length
      await expectStatus(await refundOpen(purchaseId), 409, 'checkout_session_busy')
      assert.equal(fake.callsTo('refunds.create').length, asked, 'money went back while a payment was still landing')
      assert.equal((await paymentsOf(who)).filter(p => p.refundRequestedAt).length, 0)

      // The payment lands, settling the Balance: the package is granted, and
      // its own Refund returns both cards.
      await expectStatus(await deliver({ intent: lateIntent }), 200)
      const [sale] = await purchasesOf(who)
      assert.equal(sale!.status, 'paid')
      const [granted] = await packagesOf(who)
      assert.ok(granted, 'the settled Purchase granted its package')
      await expectStatus(await asAdmin('POST', `/clients/${who.clientId}/packages/${granted.id}/refund`, { reason: 'Member asked' }), 200)
      assert.deepEqual(
        fake.callsTo('refunds.create').slice(asked).map(c => (c.args[0] as { payment_intent: string }).payment_intent).sort(),
        (await paymentsOf(who)).map(p => p.paymentIntentId).sort(),
        'every payment the studio received is returned',
      )
    } finally {
      fake.reply('checkout.sessions.expire', (id: unknown) => ({ id, status: 'expired' }))
      fake.reply('checkout.sessions.retrieve', (id: unknown) => ({ id, status: 'expired', payment_status: 'unpaid', payment_intent: null }))
    }
  })

  /**
   * Hold a delivery part-way: its `nth` read of `intent` at the provider waits
   * until released. `reached` settles when the read is made.
   */
  function holdIntentRead(intent: string, nth: number) {
    let reach!: () => void
    let release!: () => void
    const reached = new Promise<void>(resolve => (reach = resolve))
    const released = new Promise<void>(resolve => (release = resolve))
    let reads = 0
    fake.reply('paymentIntents.retrieve', async (id: unknown) => {
      if (id === intent && ++reads === nth) {
        reach()
        await released
      }
      return intentAtProvider(id)
    })
    return { reached, release }
  }

  /**
   * Settles once some transaction in this database is waiting on another's
   * row, or once `stop` says nobody needs to know any more.
   */
  async function someoneWaitsOnARow(stop: () => boolean): Promise<void> {
    while (!stop()) {
      const rows = await harness.db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event IN ('transactionid', 'tuple')`)
      if (Number((rows as unknown as { n: number }[])[0]?.n ?? 0) > 0) return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }

  /**
   * The studio returns the first card from the provider's dashboard and the
   * member pays the rest on their Resume page a moment later, and the two
   * deliveries overlap: the payment's is held at its `nth` read of its own
   * intent, and the refund's runs beside it until it finishes or waits.
   *
   * `cardBackFirst: false` turns the money round: the member's payment was
   * taken first and the card goes back while its delivery is part-way.
   */
  async function overlapRefundWithLatePayment(nth: number, { cardBackFirst = true } = {}) {
    const { who, purchaseId, firstIntent } = await midResume()
    if (cardBackFirst) refundedAtProvider.set(firstIntent, 5000)
    const lateIntent = `pi_${randomUUID()}`
    const asked = fake.callsTo('refunds.create').length
    const hold = holdIntentRead(lateIntent, nth)
    try {
      const paying = deliver({ intent: lateIntent })
      // A delivery that never needs the read it is held at simply finishes.
      await Promise.race([hold.reached, paying])
      let refunded = false
      const refunding = deliverRefund(firstIntent, 5000).finally(() => (refunded = true))
      await Promise.race([refunding, someoneWaitsOnARow(() => refunded)])
      hold.release()
      await expectStatus(await paying, 200)
      await expectStatus(await refunding, 200)
    } finally {
      hold.release()
      fake.reply('paymentIntents.retrieve', intentAtProvider)
    }
    return { who, purchaseId, firstIntent, lateIntent, asked }
  }

  /** Abandoned, nothing granted, and the late payment recorded and on its way back. */
  async function assertLatePaymentGivenBack(o: Awaited<ReturnType<typeof overlapRefundWithLatePayment>>) {
    assert.equal((await packagesOf(o.who)).length, 0, 'a package was granted on money the studio no longer holds')
    const [sale] = await purchasesOf(o.who)
    assert.equal(sale!.status, 'abandoned', 'the Purchase was reopened, or settled, after its Refund')
    assert.equal(sale!.amountPaidSgd, '0.00')
    const payments = await paymentsOf(o.who)
    assert.equal(payments.find(p => p.paymentIntentId === o.firstIntent)!.status, 'refunded')
    const late = payments.find(p => p.paymentIntentId === o.lateIntent)
    assert.ok(late, 'the late payment is recorded')
    assert.equal(late.purchaseId, o.purchaseId)
    assert.ok(late.refundRequestedAt, 'the late payment is on its way back')
    const returned = fake.callsTo('refunds.create').slice(o.asked)
    assert.deepEqual(
      returned.map(c => (c.args[0] as { payment_intent: string }).payment_intent),
      [o.lateIntent],
      'the late payment, and only it, is given back',
    )
    assert.equal(returned[0]!.account, ownAccountId(one))

    await expectStatus(await deliverRefund(o.lateIntent, 10000), 200)
    assert.equal((await paymentsOf(o.who)).find(p => p.paymentIntentId === o.lateIntent)!.status, 'refunded')
    assert.equal((await purchasesOf(o.who))[0]!.status, 'abandoned')
  }

  test('RFD-23 a refund delivery that finishes while a late payment’s delivery is part-way leaves the Purchase Abandoned and gives the late payment back', async () => {
    // Held at its first read of its own intent: it has read the Purchase and
    // recorded its payment, and has not yet written the Balance.
    await assertLatePaymentGivenBack(await overlapRefundWithLatePayment(1))
  })

  test('RFD-23 a late payment whose delivery writes the Balance before an overlapping refund delivery is given back, and grants nothing', async () => {
    // Held at its second read: the Balance is written and the package granted,
    // and the refund delivery runs against that before it commits.
    await assertLatePaymentGivenBack(await overlapRefundWithLatePayment(2))
  })

  test('RFD-23 a card returned while the payment that settled its Purchase is still landing waits for that payment, and never reopens the Purchase', async () => {
    // When the payment's delivery read the first card back from the provider it
    // was still held, so the two together settled the Balance.
    const o = await overlapRefundWithLatePayment(1, { cardBackFirst: false })

    const [sale] = await purchasesOf(o.who)
    assert.equal(sale!.status, 'paid', 'the Purchase was left open, or Abandoned, under a payment that settled it')
    const [granted, ...more] = await packagesOf(o.who)
    assert.equal(more.length, 0)
    assert.equal(granted!.purchaseId, o.purchaseId)
    const payments = await paymentsOf(o.who)
    assert.equal(payments.find(p => p.paymentIntentId === o.firstIntent)!.status, 'refunded')
    assert.equal(payments.find(p => p.paymentIntentId === o.lateIntent)!.status, 'succeeded')
    // One card of a settled Purchase back is not a Refund of it: nothing more
    // goes back on its own, and the plan is the Admin's to refund.
    assert.equal(fake.callsTo('refunds.create').length, o.asked)
    assert.equal((await adminSees(o.who, granted!.id)).refundable, true)
  })

  test('PAY-62 a part-paid Purchase one of whose payments the studio returned from the provider dashboard can still be resumed for what is owed', async () => {
    const who = await member(one)
    await expectStatus(await buyClass(who, one.bundleId), 200)
    const firstIntent = `pi_${randomUUID()}`
    await expectStatus(await deliver({ intent: firstIntent, amountTotal: 5000 }), 200)
    const [open] = await purchasesOf(who)
    await expectStatus(await resume(who, open!.id), 200)
    await expectStatus(await deliver({ intent: `pi_${randomUUID()}`, amountTotal: 5000 }), 200)
    assert.equal((await purchasesOf(who))[0]!.status, 'open')

    // One card goes back from the dashboard; the other S$50 is still held.
    await expectStatus(await deliverRefund(firstIntent, 5000), 200)
    assert.equal((await purchasesOf(who))[0]!.status, 'open')

    const sessions = sessionsAsked()
    const resumed = await expectStatus(await resume(who, open!.id), 200)
    assert.equal(sessionsAsked(), sessions + 1, 'no payment page was made')
    assert.equal(resumed.charged_sgd, '100.00', 'the page asks for what is still owed')
    assert.equal(sessionTotal(lastSession().params), 10000)
    assert.equal((await packagesOf(who)).length, 0)
  })

  test('PAY-61 a Purchase nothing was ever paid towards cannot be resumed, so its frozen price is never charged without a fresh checkout', async () => {
    const zoe = await member(one)
    await expectStatus(await buyClass(zoe, one.bundleId), 200)
    const [open] = await purchasesOf(zoe)
    assert.equal(open!.status, 'open')
    assert.equal(open!.amountPaidSgd, '0.00')
    const sessions = sessionsAsked()

    await expectStatus(await resume(zoe, open!.id), 400, 'purchase_not_open')

    assert.equal(sessionsAsked(), sessions, 'a payment page was made for a Purchase never paid towards')
  })

  test('PAY-17 a webhook whose signature does not verify grants nothing and records no payment', async () => {
    const eli = await member(one)
    await expectStatus(await buyClass(eli, one.bundleId), 200)
    await expectStatus(await deliver({ signature: 't=1,v1=forged' }), 400, 'invalid_webhook_signature')

    assert.equal((await packagesOf(eli)).length, 0)
    assert.equal((await paymentsOf(eli)).length, 0)
    const [sale] = await purchasesOf(eli)
    assert.equal(sale!.status, 'open')
    assert.equal(sale!.amountPaidSgd, '0.00')
  })

  test("PAY-17 a studio selling on its own payment account is charged there, and a delivery naming another studio's member on its endpoint is refused", async () => {
    const account = `acct_${run}_two`
    fake.credentials(two.id, { accountId: account })
    try {
      const ned = await member(two)
      await expectStatus(await buyClass(ned, two.bundleId), 200)
      assert.equal(lastSession().account, account, "the session was opened on the studio's own account")

      // Studio two's endpoint, signed with studio two's secret, for studio one's member.
      const mia = await member(one)
      await expectStatus(await buyClass(mia, one.bundleId), 200)
      assert.equal(lastSession().account, ownAccountId(one), 'studio one sells on its own account, not studio two’s')
      const refused = await deliver({ endpoint: stripeWebhookPath(two.slug) })
      assert.notEqual(refused.status, 200, 'another studio’s delivery was accepted')
      assert.equal((await packagesOf(mia)).length, 0, "studio two's delivery granted studio one's package")
      assert.equal((await paymentsOf(mia)).length, 0)

      // Studio two's own member, delivered to its own endpoint: granted, and the
      // payment is recorded on the account the money is on.
      await expectStatus(await buyClass(ned, two.bundleId), 200)
      await expectStatus(await deliver({ endpoint: stripeWebhookPath(two.slug) }), 200)
      const [granted] = await packagesOf(ned)
      assert.ok(granted, 'the studio’s own delivery granted nothing')
      assert.equal(granted.tenantId, two.id)
      const [payment] = await paymentsOf(ned)
      assert.equal(payment!.providerAccountId, account)
      assert.equal(payment!.tenantId, two.id)
    } finally {
      fake.restore()
      fake = await installFake()
    }
  })

  /* ── refusals before any charge ─────────────────────────────────────── */

  test('PAY-02 an Unlimited Plan checked out without a Home Location is refused before the provider is asked', async () => {
    const zoe = await member(one)
    const asked = sessionsAsked()
    await expectStatus(await buyClass(zoe, one.unlimitedId), 400, 'unlimited_requires_location')
    await assertNothingSold(zoe, asked)
  })

  test('PAY-03 a Home Location sent with anything other than an Unlimited Plan is refused', async () => {
    const zed = await member(one)
    const asked = sessionsAsked()
    for (const body of [
      { package_kind: 'class', package_id: one.bundleId },
      { package_kind: 'class', package_id: one.trialId },
      { package_kind: 'pt', package_id: one.ptId },
    ]) {
      await expectStatus(await checkout(zed, { ...body, location_id: one.locationId }), 400, 'location_only_applies_to_unlimited')
    }
    await assertNothingSold(zed, asked)
  })

  test("PAY-04 with a live Unlimited Plan, the member's entitlements name the plan's Home Location", async () => {
    const kim = await member(one)
    await holds(one, kim, 'unlimited', { locationId: one.secondLocationId, expiresAt: new Date(Date.now() + 30 * DAY) })

    const catalogue = await get(kim, '/api/v1/me/class-packages')
    assert.equal(catalogue.entitlements.has_active_unlimited, true)
    assert.equal(catalogue.entitlements.unlimited_location?.id, one.secondLocationId)
    const account = await get(kim, '/api/v1/me/packages')
    assert.equal(account.entitlements.unlimited_location?.id, one.secondLocationId)

    // A member with no plan has nothing to be locked to.
    const fay = await member(one)
    assert.equal((await get(fay, '/api/v1/me/class-packages')).entitlements.unlimited_location, null)
  })

  /** Buy a plan and return the one new row it granted — ids, not the catalogue, tell several plans apart. */
  async function buyPlan(who: Member, locationId: string) {
    const held = new Set((await packagesOf(who)).map(r => r.id))
    await expectStatus(await buyClass(who, one.unlimitedId, { location_id: locationId }), 200)
    await expectStatus(await deliver(), 200)
    const added = (await packagesOf(who)).filter(r => !held.has(r.id))
    assert.equal(added.length, 1, 'the webhook granted exactly one plan')
    return added[0]!
  }

  test('PAY-05 a renewal is sold at the live plan’s own Location or at another one, and waits Dormant', async () => {
    const ray = await member(one)
    const current = await holds(one, ray, 'unlimited', { locationId: one.locationId, expiresAt: new Date(Date.now() + 20 * DAY) })

    const elsewhere = await buyPlan(ray, one.secondLocationId)
    assert.equal(elsewhere.locationId, one.secondLocationId, 'homed where the member asked (be/docs/adr/0010)')
    assert.equal(elsewhere.expiresAt, null, 'it waits Dormant')

    const renewal = await buyPlan(ray, one.locationId)
    assert.notEqual(renewal.id, current)
    assert.equal(renewal.locationId, one.locationId)
    assert.equal(renewal.expiresAt, null, 'the renewal waits Dormant')
    assert.ok((await pkg(current)).expiresAt, 'the current plan is untouched')
  })

  test('PAY-15 holding an Activated plan and a Dormant renewal, a third plan is sold and waits Dormant beside them', async () => {
    const amy = await member(one)
    const running = await holds(one, amy, 'unlimited', { expiresAt: new Date(Date.now() + 20 * DAY) })
    const waiting = await holds(one, amy, 'unlimited')
    const third = await buyPlan(amy, one.locationId)
    assert.equal(third.expiresAt, null)
    assert.equal(third.active, true)
    assert.equal((await packagesOf(amy)).length, 3, 'no cap on live plans any more')
    assert.ok((await pkg(running)).expiresAt, 'the running plan is untouched')
    assert.equal((await pkg(waiting)).expiresAt, null)
  })

  test('PKG-06 a member holding a Trial Pass or a PT package may buy a Credit Bundle, an Unlimited Plan or a PT package alongside it', async () => {
    for (const held of ['trial', 'pt'] as const) {
      const bea = await member(one)
      await holds(one, bea, held)
      const bundle = await purchase(bea, { package_kind: 'class', package_id: one.bundleId })
      assert.equal(bundle.kind, 'credit_bundle')
      const plan = await purchase(bea, { package_kind: 'class', package_id: one.unlimitedId, location_id: one.locationId })
      assert.equal(plan.kind, 'unlimited')
      const pt = await purchase(bea, { package_kind: 'pt', package_id: one.ptId })
      assert.equal(pt.kind, 'pt')
      assert.deepEqual((await packagesOf(bea)).map(p => p.kind).sort(), [held, 'credit_bundle', 'pt', 'unlimited'].sort())
      assert.equal((await purchasesOf(bea)).length, 3)
    }
  })

  test('PKG-07 a member who has ever held a Trial Pass is refused another 409 trial_already_used before any charge, and the catalogue shows it used', async () => {
    const running = await member(one)
    await holds(one, running, 'trial')
    const lapsed = await member(one)
    await holds(one, lapsed, 'trial', { expiresAt: new Date(Date.now() - DAY), active: false })

    for (const who of [running, lapsed]) {
      const asked = sessionsAsked()
      await expectStatus(await buyClass(who, one.trialId), 409, 'trial_already_used')
      await expectStatus(await buyClass(who, one.freeTrialId), 409, 'trial_already_used')
      await assertNothingSold(who, asked, 1)
      const catalogue = await get(who, '/api/v1/me/class-packages')
      assert.equal(catalogue.entitlements.trial_used, true)
      assert.equal(catalogue.entitlements.trial_eligible, false)
    }
  })

  test('PKG-28 a member who never held a Trial Pass but holds or held another package is refused it 409 trial_not_eligible before any charge', async () => {
    for (const [kind, options] of [
      ['credit_bundle', {}],
      ['unlimited', {}],
      ['pt', {}],
      ['credit_bundle', { expiresAt: new Date(Date.now() - DAY), active: false }],
    ] as const) {
      const sam = await member(one)
      await holds(one, sam, kind, options)
      const asked = sessionsAsked()
      await expectStatus(await buyClass(sam, one.trialId), 409, 'trial_not_eligible')
      await expectStatus(await buyClass(sam, one.freeTrialId), 409, 'trial_not_eligible')
      await assertNothingSold(sam, asked, 1)
    }
  })

  test('PKG-08 two Trial Pass purchases by one member racing grant only one trial', async () => {
    const tia = await member(one)
    const answers = await Promise.all([buyClass(tia, one.freeTrialId), buyClass(tia, one.freeTrialId)])
    const statuses = answers.map(r => r.status).sort()
    assert.deepEqual(statuses, [201, 409], `expected one grant and one refusal, got ${statuses}`)
    const trials = (await packagesOf(tia)).filter(p => p.kind === 'trial')
    assert.equal(trials.length, 1, 'one trial')
  })

  /* ── prices: Promotions and Promo Codes ─────────────────────────────── */

  async function promotion(at: Studio, parentId: string, values: { label: string; percentOff?: number; specialPriceSgd?: string; startsAt: Date; endsAt: Date }): Promise<string> {
    const [row] = await harness.db
      .insert(schema.promotions)
      .values({
        tenantId: at.id,
        parentType: 'class_package',
        parentId,
        kind: values.percentOff !== undefined ? 'percent' : 'special_price',
        percentOff: values.percentOff ?? null,
        specialPriceSgd: values.specialPriceSgd ?? null,
        label: values.label,
        startsAt: values.startsAt,
        endsAt: values.endsAt,
        createdByStaffId: at.admin.id,
      })
      .returning({ id: schema.promotions.id })
    return row!.id
  }

  test('PKG-02, PKG-03, PKG-04 at purchase the one live Promotion giving the lowest price applies, a tie goes to the lowest id, and one outside its window is ignored', async () => {
    const bundle = await catalogue(one.id, { kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '150.00', name: `${NAME} promoted` })
    const now = Date.now()
    const live = { startsAt: new Date(now - DAY), endsAt: new Date(now + DAY) }
    await promotion(one, bundle, { label: 'Ten off', percentOff: 10, ...live }) // 135.00
    const winner = await promotion(one, bundle, { label: 'Hundred', specialPriceSgd: '100.00', ...live })
    await promotion(one, bundle, { label: 'Also hundred', specialPriceSgd: '100.00', ...live }) // same price, later id
    await promotion(one, bundle, { label: 'Ended', specialPriceSgd: '50.00', startsAt: new Date(now - 3 * DAY), endsAt: new Date(now - DAY) })
    await promotion(one, bundle, { label: 'Not yet', specialPriceSgd: '40.00', startsAt: new Date(now + DAY), endsAt: new Date(now + 3 * DAY) })

    const lia = await member(one)
    await expectStatus(await buyClass(lia, bundle), 200)
    const { params } = lastSession()
    assert.equal(sessionTotal(params), 10000, 'charged the lowest live price, and only one Promotion applied')
    assert.equal(params.metadata.applied_promotion_id, winner)

    await expectStatus(await deliver(), 200)
    const [granted] = await packagesOf(lia)
    assert.equal(granted!.appliedPromotionId, winner, 'the tie went to the lowest id')
    assert.equal(granted!.amountPaidSgd, '100.00')
    assert.equal(granted!.listPriceSgd, '150.00')
    const [sale] = await purchasesOf(lia)
    assert.equal(sale!.totalSgd, '100.00')
    assert.equal(sale!.amountPaidSgd, '100.00')
  })

  test('PAY-06 a Promotion or a Promo Code taking the total to 0 skips payment and grants the package at once', async () => {
    // A Promotion that makes the bundle free.
    const freeBundle = await catalogue(one.id, { kind: 'credit_bundle', credits: 5, validityDays: 30, priceSgd: '80.00', name: `${NAME} gratis` })
    await promotion(one, freeBundle, { label: 'On the house', specialPriceSgd: '0.00', startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + DAY) })
    const uma = await member(one)
    let asked = sessionsAsked()
    const granted = await expectStatus(await buyClass(uma, freeBundle), 201)
    assert.equal(granted.outcome, 'granted')
    assert.equal(sessionsAsked(), asked, 'the provider was asked for a session')
    const [held] = await packagesOf(uma)
    assert.equal(held!.id, granted.client_package_id)
    assert.equal(held!.amountPaidSgd, '0.00')
    assert.equal(held!.listPriceSgd, '80.00')
    assert.equal(held!.creditsOrSessionsRemaining, 5)
    const [sale] = await purchasesOf(uma)
    assert.ok(sale, 'the sale is recorded')
    assert.equal(sale.totalSgd, '0.00')
    assert.notEqual(sale.status, 'open')
    assert.equal((await paymentsOf(uma)).length, 0, 'no money moved')

    // A Promo Code worth more than the price.
    const code = `FREE-${run.slice(-6).toUpperCase()}`
    const [promo] = await harness.db
      .insert(schema.promoCodes)
      .values({ tenantId: one.id, code, label: 'Free bundle', kind: 'amount', amountOffSgd: '500.00', appliesToAll: true, createdByStaffId: one.admin.id })
      .returning({ id: schema.promoCodes.id })
    const val = await member(one)
    asked = sessionsAsked()
    const viaCode = await expectStatus(await buyClass(val, one.bundleId, { promo_code: code }), 201)
    assert.equal(viaCode.outcome, 'granted')
    assert.equal(sessionsAsked(), asked)
    const [bundle] = await packagesOf(val)
    assert.equal(bundle!.id, viaCode.client_package_id)
    assert.equal(bundle!.appliedPromoCodeId, promo!.id)
    assert.equal(bundle!.amountPaidSgd, '0.00')
    assert.equal(bundle!.creditsOrSessionsRemaining, 10)
    assert.equal((await purchasesOf(val)).length, 1)
  })

  /* ── the Cross-Location Add-On ──────────────────────────────────────── */

  const quote = (who: Member, clientPackageId: string) =>
    post(who, '/api/v1/me/checkout/cross-location/quote', { client_package_id: clientPackageId })
  const buyAddOn = async (who: Member, clientPackageId: string) =>
    post(who, '/api/v1/me/checkout/cross-location', await billed(harness.app, who.headers, { client_package_id: clientPackageId }))

  const addMonths = (d: Date, months: number) => {
    const next = new Date(d)
    next.setUTCMonth(next.getUTCMonth() + months)
    return next
  }

  test('PAY-07 on an Activated plan with 3 months and 10 days left, the Add-On is quoted as 4 whole months times the rate', async () => {
    const at = new Date('2031-03-01T04:00:00Z')
    harness.clock.set(at)
    try {
      const pia = await member(one)
      const plan = await holds(one, pia, 'unlimited', { expiresAt: new Date(addMonths(at, 3).getTime() + 10 * DAY) })
      const q = await expectStatus(await quote(pia, plan), 200)
      assert.equal(q.months, 4)
      assert.equal(q.rate_sgd, one.rateSgd)
      assert.equal(q.price_sgd, (Number(one.rateSgd) * 4).toFixed(2))
    } finally {
      harness.clock.reset()
    }
  })

  test("PAY-08 on a Dormant plan, the Add-On is priced at the plan's full Duration", async () => {
    const quinn = await member(one)
    const plan = await holds(one, quinn, 'unlimited', { durationMonths: 6 })
    const q = await expectStatus(await quote(quinn, plan), 200)
    assert.equal(q.months, 6)
    assert.equal(q.price_sgd, (Number(one.rateSgd) * 6).toFixed(2))
  })

  test('PAY-09 a standalone Add-On bought on a live plan makes the plan cover every Location of the studio', async () => {
    const rex = await member(one)
    const plan = await holds(one, rex, 'unlimited', { durationMonths: 2 })
    const elsewhere = await addClass(one, { atSecond: true })
    await expectStatus(await book(rex, elsewhere), 409, 'location_not_covered')

    await expectStatus(await buyAddOn(rex, plan), 200)
    const { params } = lastSession()
    assert.equal(params.metadata.kind, 'cross_location_add_on')
    const price = (Number(one.rateSgd) * 2).toFixed(2)
    assert.equal(sessionTotal(params), Math.round(Number(price) * 100))
    assert.equal((await pkg(plan)).crossLocationPaidSgd, null, 'covered before the money arrived')

    await expectStatus(await deliver(), 200)
    assert.equal((await pkg(plan)).crossLocationPaidSgd, price)
    const [sale] = await purchasesOf(rex)
    assert.equal(sale!.totalSgd, price)
    assert.equal(sale!.amountPaidSgd, price)
    const [payment] = await paymentsOf(rex)
    assert.equal(payment!.clientPackageId, plan)
    assert.equal(payment!.amountSgd, price)

    const entitlements = (await get(rex, '/api/v1/me/packages')).entitlements
    assert.equal(entitlements.unlimited_covers_both, true)
    await expectStatus(await book(rex, elsewhere), 201)
  })

  test('PAY-10 a plan that already carries an Add-On is refused another', async () => {
    const sue = await member(one)
    const plan = await holds(one, sue, 'unlimited', { crossLocation: '40.00' })
    const asked = sessionsAsked()
    await expectStatus(await quote(sue, plan), 409, 'cross_location_already_added')
    await expectStatus(await buyAddOn(sue, plan), 409, 'cross_location_already_added')
    assert.equal(sessionsAsked(), asked)
    assert.equal((await purchasesOf(sue)).length, 0)
    assert.equal((await pkg(plan)).crossLocationPaidSgd, '40.00')
  })

  test('PAY-11 a member holding no live Unlimited Plan is refused a standalone Add-On', async () => {
    const tom = await member(one)
    const bundle = await holds(one, tom, 'credit_bundle')
    const lapsed = await holds(one, tom, 'unlimited', { expiresAt: new Date(Date.now() - DAY), active: false })
    const asked = sessionsAsked()
    await expectStatus(await buyAddOn(tom, bundle), 400, 'cross_location_requires_unlimited')
    await expectStatus(await buyAddOn(tom, lapsed), 400, 'cross_location_plan_not_live')
    assert.equal(sessionsAsked(), asked)
    assert.equal((await purchasesOf(tom)).length, 0)
  })

  test('PAY-12 an Add-On ends with its plan when the plan expires', async () => {
    const tick = await expiryTick(one)
    const una = await member(one)
    const plan = await holds(one, una, 'unlimited', { crossLocation: '40.00', expiresAt: new Date(tick.getTime() - HOUR) })

    harness.clock.set(tick)
    try {
      await jobs.scheduledJobs.expirePackages()
      const ended = await pkg(plan)
      assert.equal(ended.active, false, 'the plan expired')
      const entitlements = (await get(una, '/api/v1/me/packages')).entitlements
      assert.equal(entitlements.has_active_unlimited, false)
      assert.equal(entitlements.unlimited_covers_both, false, 'the Add-On outlived its plan')
      await expectStatus(await book(una, await addClass(one, { atSecond: true })), 409)
      await expectStatus(await book(una, await addClass(one)), 409)
    } finally {
      harness.clock.reset()
    }
  })

  /** The next instant the daily expiry job runs for `at`: 01:05 in its own zone, a week out. */
  async function expiryTick(at: Studio): Promise<Date> {
    const { isDailySlot, SLOT_MINUTES } = await import('../jobs/local-time')
    const slot = SLOT_MINUTES * 60 * 1000
    // On the grid, as the scheduler's ticks are: five minutes past an
    // unaligned start can fall outside the slot it was found in.
    const from = Math.floor((Date.now() + 7 * DAY) / slot) * slot
    for (let t = from; t < from + 2 * DAY; t += slot) {
      if (isDailySlot(at.timezone, 1, new Date(t))) return new Date(t + 5 * 60 * 1000)
    }
    throw new Error(`no 01:00 slot for ${at.timezone}`)
  }

  /* ── whose packages ─────────────────────────────────────────────────── */

  test("PAY-17 another studio's package cannot be bought, and a member sees and uses only their own packages", async () => {
    const mia = await member(one)
    const ned = await member(two)
    const asked = sessionsAsked()
    await expectStatus(await buyClass(mia, two.bundleId), 404, 'class_package_not_found')
    await expectStatus(await checkout(mia, { package_kind: 'pt', package_id: two.ptId }), 404, 'pt_package_not_found')
    await assertNothingSold(mia, asked)

    const miasBundle = await holds(one, mia, 'credit_bundle')
    const miasPlan = await holds(one, mia, 'unlimited')
    const nedsPlan = await holds(two, ned, 'unlimited')

    // Another member of the same studio.
    const kit = await member(one)
    assert.deepEqual((await get(kit, '/api/v1/me/packages')).client_packages, [])
    await expectStatus(await quote(kit, miasPlan), 404, 'client_package_not_found')
    await expectStatus(await buyAddOn(kit, miasPlan), 404, 'client_package_not_found')

    // A member of another studio.
    assert.deepEqual(
      (await get(ned, '/api/v1/me/packages')).client_packages.map((p: any) => p.id),
      [nedsPlan],
      "another studio's packages are visible",
    )
    await expectStatus(await quote(ned, miasPlan), 404, 'client_package_not_found')
    await expectStatus(await buyAddOn(ned, miasPlan), 404, 'client_package_not_found')
    await expectStatus(await quote(mia, nedsPlan), 404, 'client_package_not_found')

    // Mia's own list is hers, unchanged by any of that.
    const listed = (await get(mia, '/api/v1/me/packages')).client_packages.map((p: any) => p.id).sort()
    assert.deepEqual(listed, [miasBundle, miasPlan].sort())
    assert.equal((await pkg(miasPlan)).crossLocationPaidSgd, null)
  })

  test('PAY-17 checkout is refused to a session signed in on another studio and to a staff session', async () => {
    const mia = await member(one)
    const asked = sessionsAsked()
    // Mia's session, presented on studio two's hostname.
    const elsewhere = { ...mia, headers: { ...mia.headers, 'X-Tenant-Slug': two.slug, Origin: `http://${two.slug}.localhost:3000` } }
    // Neither session is a member's here, so neither has Billing details to name:
    // the request is refused before its body is read.
    await expectStatus(await post(elsewhere, '/api/v1/me/checkout/package', { package_kind: 'class', package_id: two.bundleId }), 401)
    // A staff member's session is not a member's.
    const staff = { ...mia, headers: one.admin.headers }
    await expectStatus(await post(staff, '/api/v1/me/checkout/package', { package_kind: 'class', package_id: one.bundleId }), 401)
    assert.equal(sessionsAsked(), asked)
    assert.equal((await purchasesOf(mia)).length, 0)
  })

  test('PAY-17 a checkout-completed delivery naming a package of another studio grants nothing', async () => {
    const mia = await member(one)
    await expectStatus(await buyClass(mia, one.bundleId), 200)
    const { params } = lastSession()
    // The body is edited to name studio two's catalogue: the grant runs in the
    // buyer's studio, where that id names nothing.
    const res = await deliver({ metadata: { ...params.metadata, package_id: two.bundleId } })
    assert.notEqual(res.status, 200)
    assert.equal((await packagesOf(mia)).filter(p => p.sourceClassPackageId === two.bundleId).length, 0)
    const [twoOwn] = await harness.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.clientPackages)
      .where(and(eq(schema.clientPackages.tenantId, two.id), eq(schema.clientPackages.clientId, mia.clientId)))
    assert.equal(twoOwn!.n, 0)
  })
})
