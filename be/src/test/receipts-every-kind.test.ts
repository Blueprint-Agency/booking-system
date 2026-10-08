import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.receipts-every-kind.test`
// Not ending in "Flow" / "Bundle" / "Retreat": isolation.test.ts purges by those suffixes.
const NAME = `Every receipt ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** The studio's Cross-Location Add-On rate for this file: a figure of its own, so the Add-On lines are known. */
const RATE = '20.00'

/**
 * Every kind of Purchase gets its Receipt the moment it is paid in full (#385),
 * including one that cost nothing; a part-paid one gets none until it settles,
 * and a Complimentary Package or an Abandoned Purchase never gets one.
 *
 * Everything is asked over HTTP: the checkout, the provider's delivery to the
 * studio's own webhook endpoint (the Stripe fake stands in for the provider),
 * and the member's `/me/receipts`. Written from the INV rows of the Scenario
 * Inventory (`docs/md/test-scenarios.md`).
 */
describe('a Receipt for every kind of Purchase, over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake

  type Staff = { id: string; headers: Record<string, string> }
  type Member = { clientId: string; email: string; headers: Record<string, string> }
  type Event = { id: string; type: string; data: { object: Record<string, any> } }
  let studio!: {
    id: string
    slug: string
    locationId: string
    roomId: string
    admin: Staff
    instructor: Staff
    rateBefore: string
  }

  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as Record<string, any>) : {}
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = `${name}-${tenant.slug}@${DOMAIN}`
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
    return { id: row!.id, headers }
  }

  let products = 0
  async function classPackage(
    values: Partial<typeof schema.classPackages.$inferInsert> & { kind: 'credit_bundle' | 'unlimited' | 'trial'; priceSgd: string },
  ): Promise<{ id: string; name: string }> {
    const name = `${NAME} ${values.kind} ${products++}`
    const [row] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: studio.id, name, status: 'active', credits: 5, validityDays: 30, ...values })
      .returning({ id: schema.classPackages.id })
    return { id: row!.id, name }
  }

  async function ptPackage(priceSgd: string): Promise<{ id: string; name: string }> {
    const name = `${NAME} pt ${products++}`
    const [row] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: studio.id, name, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd })
      .returning({ id: schema.ptPackages.id })
    return { id: row!.id, name }
  }

  async function merchItem(priceSgd: string): Promise<{ id: string; name: string }> {
    const name = `${NAME} mat ${products++}`
    const [row] = await harness.db
      .insert(schema.merch)
      .values({ tenantId: studio.id, title: name, priceSgd })
      .returning({ id: schema.merch.id })
    return { id: row!.id, name }
  }

  async function corporatePackage(priceSgd: string): Promise<{ id: string; name: string }> {
    const name = `${NAME} corporate ${products++}`
    const [row] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: studio.id, name, priceSgd, status: 'active', createdByStaffId: studio.admin.id })
      .returning({ id: schema.corporatePackages.id })
    return { id: row!.id, name }
  }

  let codes = 0
  /** A Promo Code taking `amountOffSgd` off anything. */
  async function promoCode(amountOffSgd: string): Promise<{ id: string; code: string }> {
    const code = `RK${run.toUpperCase()}${codes++}`.slice(0, 24)
    const [row] = await harness.db
      .insert(schema.promoCodes)
      .values({ tenantId: studio.id, code, label: `${amountOffSgd} off`, kind: 'amount', amountOffSgd, appliesToAll: true, createdByStaffId: studio.admin.id })
      .returning({ id: schema.promoCodes.id })
    return { id: row!.id, code }
  }

  let slot = 0
  /** A one-day workshop with one tier, built through the admin editor's own routes. */
  async function workshop(regularPriceSgd: string): Promise<{ id: string; tierId: string; name: string }> {
    const call = async (path: string, body: unknown) => expectStatus(await post(studio.admin.headers, path, body), 201)
    const name = `${NAME} workshop ${slot}`
    const created = await call('/api/v1/portal/admin/workshops', {
      name,
      location_id: studio.locationId,
      main_instructor_id: studio.instructor.id,
      main_instructor_pay_sgd: 100,
    })
    const startsAt = new Date(Date.now() + 40 * DAY + slot++ * 3 * HOUR)
    const day = await call(`/api/v1/portal/admin/workshops/${created.id}/days`, {
      ord: 1,
      room_id: studio.roomId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 2 * HOUR).toISOString(),
      capacity_online: 10,
    })
    const made = await call(`/api/v1/portal/admin/workshops/${created.id}/tiers`, {
      name: 'Full',
      ord: 1,
      day_ids: [day.id],
      regular_price_sgd: regularPriceSgd,
    })
    return { id: created.id, tierId: made.id, name: `${name} — Full` }
  }

  let members = 0
  async function member(name = 'Mia Tan'): Promise<Member> {
    const email = `member-${members++}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, studio)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, studio.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  /** An Unlimited Plan the member already holds, Dormant with its whole Duration ahead. */
  async function holdsUnlimited(who: Member, durationMonths: number): Promise<string> {
    const plan = await classPackage({ kind: 'unlimited', durationMonths, priceSgd: '300.00', credits: null, validityDays: null })
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: studio.id,
        clientId: who.clientId,
        kind: 'unlimited',
        sourceClassPackageId: plan.id,
        locationId: studio.locationId,
        durationMonths,
        active: true,
        amountPaidSgd: '300.00',
        listPriceSgd: '300.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  const post = (headers: Record<string, string>, path: string, body: unknown) =>
    harness.app.request(path, { method: 'POST', headers: { ...headers, ...json }, body: JSON.stringify(body) })

  const buyPackage = (who: Member, body: Record<string, unknown>) => post(who.headers, '/api/v1/me/checkout/package', body)

  /** How each intent was paid, as the provider will say when it is retrieved. A Visa ending 4242 unless named. */
  const cards = new Map<string, { brand: string; last4: string }>()

  /**
   * The provider's delivery saying the last checkout's session was paid: the
   * whole of what that session charged, on a fresh intent.
   */
  function paidEvent(card = { brand: 'visa', last4: '4242' }): Event {
    const params = fake.callsTo('checkout.sessions.create').at(-1)!.args[0] as { metadata: Record<string, string>; line_items: any[] }
    const intent = `pi_every_${randomUUID().slice(0, 12)}`
    cards.set(intent, card)
    return {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_every_${randomUUID().slice(0, 12)}`,
          payment_intent: intent,
          payment_status: 'paid',
          amount_total: params.line_items.reduce((n, l) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0),
          metadata: params.metadata,
        },
      },
    }
  }

  /** The provider's delivery, to the studio's own endpoint. */
  const deliver = async (event: Event) =>
    expectStatus(
      await harness.app.request(stripeWebhookPath(studio.slug), {
        method: 'POST',
        headers: { ...json, 'stripe-signature': 't=1,v1=fake' },
        body: JSON.stringify(event),
      }),
      200,
    )

  /** Start a checkout that goes to the provider's page, and have the provider say it was paid. */
  async function pay(res: Response): Promise<Event> {
    const started = await expectStatus(res, 200)
    assert.match(started.url, /^https:\/\/pay\.example\.test\//)
    const event = paidEvent()
    await deliver(event)
    return event
  }

  const receiptsOf = async (who: Member) =>
    (await expectStatus(await harness.app.request('/api/v1/me/receipts', { headers: who.headers }), 200)).receipts as any[]

  /** The member's one Receipt, read whole. */
  async function onlyReceipt(who: Member): Promise<Record<string, any>> {
    const listed = await receiptsOf(who)
    assert.equal(listed.length, 1, `exactly one Receipt: ${JSON.stringify(listed)}`)
    return expectStatus(await harness.app.request(`/api/v1/me/receipts/${listed[0].id}`, { headers: who.headers }), 200)
  }

  const sequence = (number: string) => Number(number.replace(/^R-/, ''))

  /**
   * The provider delivers the same payment again: still one Receipt, the same
   * one, and the studio's next Receipt takes the very next number.
   */
  async function redeliverIssuesNothing(who: Member, event: Event, receipt: Record<string, any>): Promise<void> {
    await deliver(event)
    const again = await onlyReceipt(who)
    assert.equal(again.id, receipt.id, 'the same Receipt')
    assert.equal(again.number, receipt.number, 'the same number')

    const next = await member()
    await pay(await buyPackage(next, { package_kind: 'class', package_id: (await classPackage({ kind: 'credit_bundle', priceSgd: '10.00' })).id }))
    assert.equal(sequence((await onlyReceipt(next)).number), sequence(receipt.number) + 1, 'no number was skipped')
  }

  /** A line as the member's Receipt shows it. */
  const line = (description: string, listPriceSgd: string, opts: { quantity?: number; discountSgd?: string; amountSgd?: string } = {}) => [
    description,
    opts.quantity ?? 1,
    listPriceSgd,
    opts.discountSgd ?? '0.00',
    opts.amountSgd ?? listPriceSgd,
  ]
  const linesOf = (receipt: Record<string, any>) =>
    receipt.lines.map((l: any) => [l.description, l.quantity, l.list_price_sgd, l.discount_sgd, l.amount_sgd])
  const paymentsOf = (receipt: Record<string, any>) =>
    receipt.payments.map((p: any) => [p.method, p.card_brand, p.card_last4, p.amount_sgd])
  const totalsOf = (receipt: Record<string, any>) => [receipt.subtotal_sgd, receipt.discount_sgd, receipt.total_sgd]

  /** A paid sale's one Receipt: its kind, lines, totals, and the one Visa payment that paid it. */
  async function assertPaidReceipt(
    who: Member,
    expected: { kind: string; lines: unknown[]; totals: [string, string, string] },
  ): Promise<Record<string, any>> {
    const receipt = await onlyReceipt(who)
    assert.equal(receipt.kind, expected.kind)
    assert.equal(receipt.status, 'issued')
    assert.deepEqual(receipt.buyer, { name: 'Mia Tan', email: who.email })
    assert.deepEqual(linesOf(receipt), expected.lines)
    assert.deepEqual(totalsOf(receipt), expected.totals)
    assert.deepEqual(paymentsOf(receipt), [['card', 'visa', '4242', expected.totals[2]]])
    return receipt
  }

  /** A free sale granted on the spot, and its one S$0.00 Receipt with no payments. */
  async function assertFreeReceipt(who: Member, res: Response, expected: { kind: string; lines: unknown[]; subtotalSgd?: string }) {
    const sessionsBefore = fake.callsTo('checkout.sessions.create').length
    const granted = await expectStatus(res, 201)
    assert.equal(granted.outcome, 'granted')
    assert.equal(fake.callsTo('checkout.sessions.create').length, sessionsBefore, 'no payment step')
    const receipt = await onlyReceipt(who)
    assert.equal(receipt.kind, expected.kind)
    assert.equal(receipt.status, 'issued')
    assert.deepEqual(linesOf(receipt), expected.lines)
    const subtotal = expected.subtotalSgd ?? '0.00'
    assert.deepEqual(totalsOf(receipt), [subtotal, subtotal, '0.00'])
    assert.equal(receipt.total_sgd, '0.00')
    assert.deepEqual(receipt.payments, [], 'nothing was paid')
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')

    fake = (await import('./stripe-fake')).installStripeFake()
    fake.reply('customers.create', () => ({ id: `cus_every_${randomUUID().slice(0, 8)}` }))
    fake.reply('checkout.sessions.create', () => {
      const id = `cs_${randomUUID()}`
      return { id, url: `https://pay.example.test/${id}` }
    })
    fake.reply('webhooks.constructEvent', (body: unknown) => JSON.parse(String(body)))
    fake.reply('paymentIntents.retrieve', (id: unknown) => {
      const card = cards.get(String(id)) ?? { brand: 'visa', last4: '4242' }
      return {
        id,
        latest_charge: {
          id: `ch_${String(id)}`,
          receipt_url: `https://pay.example.test/receipts/${String(id)}`,
          payment_method_details: { type: 'card', card: { brand: card.brand, last4: card.last4, wallet: null } },
        },
      }
    })
    fake.reply('refunds.create', () => ({ id: `re_${randomUUID().slice(0, 8)}`, status: 'succeeded' }))

    const tenant = harness.tenants.one
    fake.ownAccount(tenant)
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `Every receipt hall ${run}` })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `Every receipt room ${run}`, capacity: 30 })
      .returning({ id: schema.rooms.id })
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, tenant.id))
    assert.ok(policy, 'a seeded policy')
    await harness.db
      .update(schema.globalPolicy)
      .set({ crossLocationRateSgd: RATE, partPaymentEnabled: true })
      .where(eq(schema.globalPolicy.tenantId, tenant.id))
    studio = {
      ...tenant,
      locationId: location!.id,
      roomId: room!.id,
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
      rateBefore: policy.crossLocationRateSgd,
    }
    partPaymentBefore = policy.partPaymentEnabled
  })
  let partPaymentBefore = true

  after(async () => {
    if (!harness) return
    fake?.restore()
    try {
      if (studio) {
        await harness.db
          .update(schema.globalPolicy)
          .set({ crossLocationRateSgd: studio.rateBefore, partPaymentEnabled: partPaymentBefore })
          .where(eq(schema.globalPolicy.tenantId, studio.id))
      }
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      const workshops = sql`SELECT id FROM workshops WHERE created_by_staff_id IN (${staffIds})`
      const locations = sql`SELECT id FROM locations WHERE name = ${`Every receipt hall ${run}`}`
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM promo_code_redemptions WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM corporate_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM merch_orders WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE workshop_id IN (${workshops}) OR client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM promo_codes WHERE created_by_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${workshops}))`)
      await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshops WHERE id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM corporate_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM merch WHERE title LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (${locations})`)
      await harness.db.execute(sql`DELETE FROM locations WHERE id IN (${locations})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  /* ── paid, through the webhook ──────────────────────────────────────── */

  test('INV-20 a paid PT package gives the member one Receipt, and its redelivery issues no second one and skips no number', async () => {
    const pt = await ptPackage('400.00')
    const ana = await member()
    const event = await pay(await buyPackage(ana, { package_kind: 'pt', package_id: pt.id }))
    const receipt = await assertPaidReceipt(ana, {
      kind: 'pt_package',
      lines: [line(pt.name, '400.00')],
      totals: ['400.00', '0.00', '400.00'],
    })
    await redeliverIssuesNothing(ana, event, receipt)
  })

  test('INV-21 a paid Trial Pass gives the member one Receipt, and its redelivery issues no second one and skips no number', async () => {
    const trial = await classPackage({ kind: 'trial', credits: 1, validityDays: 14, priceSgd: '25.00' })
    const ivy = await member()
    const event = await pay(await buyPackage(ivy, { package_kind: 'class', package_id: trial.id }))
    const receipt = await assertPaidReceipt(ivy, {
      kind: 'class_package',
      lines: [line(trial.name, '25.00')],
      totals: ['25.00', '0.00', '25.00'],
    })
    await redeliverIssuesNothing(ivy, event, receipt)
  })

  test('INV-22 an Unlimited Plan bought with a Cross-Location Add-On and a Promo Code gives one Receipt with two lines, the discount and the total', async () => {
    const plan = await classPackage({ kind: 'unlimited', durationMonths: 3, priceSgd: '300.00', credits: null, validityDays: null })
    const code = await promoCode('50.00')
    const leo = await member()
    const event = await pay(
      await buyPackage(leo, {
        package_kind: 'class',
        package_id: plan.id,
        location_id: studio.locationId,
        cross_location_add_on: true,
        promo_code: code.code,
      }),
    )
    const receipt = await assertPaidReceipt(leo, {
      kind: 'class_package',
      // 3 months at the studio's rate of 20.00.
      lines: [line(plan.name, '300.00', { discountSgd: '50.00', amountSgd: '250.00' }), line('Cross-Location Add-On', RATE, { quantity: 3, amountSgd: '60.00' })],
      totals: ['360.00', '50.00', '310.00'],
    })
    assert.deepEqual(
      receipt.lines[0].discounts.map((d: any) => [d.source, d.label, d.amount_sgd]),
      [['promo_code', code.code, '50.00']],
      'the Promo Code that took it off',
    )
    await redeliverIssuesNothing(leo, event, receipt)
  })

  test('INV-23 a paid workshop place gives the member one Receipt, and its redelivery issues no second one and skips no number', async () => {
    const w = await workshop('85.50')
    const zoe = await member()
    const event = await pay(await post(zoe.headers, '/api/v1/me/checkout/workshop', { workshop_id: w.id, workshop_tier_id: w.tierId }))
    const receipt = await assertPaidReceipt(zoe, {
      kind: 'workshop',
      lines: [line(w.name, '85.50')],
      totals: ['85.50', '0.00', '85.50'],
    })
    await redeliverIssuesNothing(zoe, event, receipt)
  })

  test('INV-24 paid Merch gives the member one Receipt, and its redelivery issues no second one and skips no number', async () => {
    const mat = await merchItem('42.00')
    const kai = await member()
    const event = await pay(await post(kai.headers, '/api/v1/me/checkout/merch', { merch_id: mat.id }))
    const receipt = await assertPaidReceipt(kai, {
      kind: 'merch',
      lines: [line(mat.name, '42.00')],
      totals: ['42.00', '0.00', '42.00'],
    })
    await redeliverIssuesNothing(kai, event, receipt)
  })

  test('INV-25 a standalone Cross-Location Add-On gives the member one Receipt, and its redelivery issues no second one and skips no number', async () => {
    const eli = await member()
    const held = await holdsUnlimited(eli, 3)
    const event = await pay(await post(eli.headers, '/api/v1/me/checkout/cross-location', { client_package_id: held }))
    const receipt = await assertPaidReceipt(eli, {
      kind: 'cross_location_add_on',
      lines: [line('Cross-Location Add-On', RATE, { quantity: 3, amountSgd: '60.00' })],
      totals: ['60.00', '0.00', '60.00'],
    })
    await redeliverIssuesNothing(eli, event, receipt)
  })

  test('INV-26 a paid corporate package gives the member one Receipt, and its redelivery issues no second one and skips no number', async () => {
    const offsite = await corporatePackage('480.00')
    const eve = await member()
    const event = await pay(await buyPackage(eve, { package_kind: 'corporate', package_id: offsite.id }))
    const receipt = await assertPaidReceipt(eve, {
      kind: 'corporate_package',
      lines: [line(offsite.name, '480.00')],
      totals: ['480.00', '0.00', '480.00'],
    })
    await redeliverIssuesNothing(eve, event, receipt)
  })

  /* ── free, opened as an already-paid Purchase ───────────────────────── */

  test('INV-27 a free Trial Pass gives the member one S$0.00 Receipt with no payments', async () => {
    const trial = await classPackage({ kind: 'trial', credits: 1, validityDays: 14, priceSgd: '0.00' })
    const ivy = await member()
    await assertFreeReceipt(ivy, await buyPackage(ivy, { package_kind: 'class', package_id: trial.id }), {
      kind: 'class_package',
      lines: [line(trial.name, '0.00')],
    })
  })

  test('INV-28 a plan a Promo Code took to zero gives one S$0.00 Receipt showing the List Price and the discount, with no payments', async () => {
    const ten = await classPackage({ kind: 'credit_bundle', priceSgd: '150.00' })
    const code = await promoCode('150.00')
    const mia = await member()
    await assertFreeReceipt(mia, await buyPackage(mia, { package_kind: 'class', package_id: ten.id, promo_code: code.code }), {
      kind: 'class_package',
      lines: [line(ten.name, '150.00', { discountSgd: '150.00', amountSgd: '0.00' })],
      subtotalSgd: '150.00',
    })
  })

  test('INV-29 a free workshop place gives the member one S$0.00 Receipt with no payments', async () => {
    const w = await workshop('0.00')
    const sam = await member()
    await assertFreeReceipt(sam, await post(sam.headers, '/api/v1/me/checkout/workshop', { workshop_id: w.id, workshop_tier_id: w.tierId }), {
      kind: 'workshop',
      lines: [line(w.name, '0.00')],
    })
  })

  test('INV-30 free Merch gives the member one S$0.00 Receipt with no payments', async () => {
    const sticker = await merchItem('0.00')
    const kai = await member()
    await assertFreeReceipt(kai, await post(kai.headers, '/api/v1/me/checkout/merch', { merch_id: sticker.id }), {
      kind: 'merch',
      lines: [line(sticker.name, '0.00')],
    })
  })

  test('INV-31 a $0 corporate package gives the member one S$0.00 Receipt with no payments', async () => {
    const offsite = await corporatePackage('0.00')
    const eve = await member()
    await assertFreeReceipt(eve, await buyPackage(eve, { package_kind: 'corporate', package_id: offsite.id }), {
      kind: 'corporate_package',
      lines: [line(offsite.name, '0.00')],
    })
  })

  /* ── Part Payment ───────────────────────────────────────────────────── */

  /** Part-pay `who`'s checkout: the first card's delivery, and the Purchase it left open. */
  async function partPay(who: Member, res: Response, card: { brand: string; last4: string }) {
    await expectStatus(res, 200)
    await deliver(paidEvent(card))
    const open = (await expectStatus(await harness.app.request('/api/v1/me/purchases/open', { headers: who.headers }), 200)).purchases as any[]
    assert.equal(open.length, 1, 'the Purchase is left open')
    return open[0] as { id: string; paid_sgd: string; outstanding_sgd: string }
  }

  test('INV-32 a Part Payment has no Receipt while Open, and one listing both payments once the last one settles it', async () => {
    const ten = await classPackage({ kind: 'credit_bundle', priceSgd: '200.00' })
    const pia = await member()
    const open = await partPay(pia, await buyPackage(pia, { package_kind: 'class', package_id: ten.id, part_payment_sgd: 80 }), {
      brand: 'visa',
      last4: '4242',
    })
    assert.equal(open.paid_sgd, '80.00')
    assert.deepEqual(await receiptsOf(pia), [], 'no Receipt while the Balance is outstanding')

    await expectStatus(await post(pia.headers, `/api/v1/me/purchases/${open.id}/resume`, {}), 200)
    await deliver(paidEvent({ brand: 'mastercard', last4: '5555' }))

    const receipt = await onlyReceipt(pia)
    assert.equal(receipt.kind, 'class_package')
    assert.deepEqual(linesOf(receipt), [line(ten.name, '200.00')])
    assert.deepEqual(totalsOf(receipt), ['200.00', '0.00', '200.00'])
    assert.deepEqual(
      paymentsOf(receipt),
      [
        ['card', 'visa', '4242', '80.00'],
        ['card', 'mastercard', '5555', '120.00'],
      ],
      'every payment that paid it, in the order they landed',
    )
  })

  /* ── never a Receipt ────────────────────────────────────────────────── */

  test('INV-33 a Complimentary Package given by an admin issues no Receipt', async () => {
    const ten = await classPackage({ kind: 'credit_bundle', priceSgd: '150.00' })
    const gus = await member()
    await expectStatus(
      await post(studio.admin.headers, `/api/v1/portal/admin/clients/${gus.clientId}/packages/issue`, {
        package_kind: 'class',
        package_id: ten.id,
        reason: 'Class cancelled by the studio',
      }),
      201,
    )
    assert.deepEqual(await receiptsOf(gus), [])
  })

  test('INV-34 an Open Purchase refunded and Abandoned never gets a Receipt', async () => {
    const ten = await classPackage({ kind: 'credit_bundle', priceSgd: '200.00' })
    const ola = await member()
    const open = await partPay(ola, await buyPackage(ola, { package_kind: 'class', package_id: ten.id, part_payment_sgd: 50 }), {
      brand: 'visa',
      last4: '4242',
    })
    const refunds = fake.callsTo('refunds.create').length
    await expectStatus(await post(studio.admin.headers, `/api/v1/portal/admin/purchases/${open.id}/refund`, { reason: 'Member moved away' }), 200)
    const [returned] = fake.callsTo('refunds.create').slice(refunds)
    assert.ok(returned, 'the payment was sent back')
    const intent = (returned.args[0] as { payment_intent: string }).payment_intent
    // The provider confirms the money went back, which is what abandons the Purchase.
    await deliver({
      id: `evt_${randomUUID()}`,
      type: 'charge.refunded',
      data: { object: { id: `ch_${randomUUID().slice(0, 12)}`, payment_intent: intent, amount: 5000, amount_captured: 5000, amount_refunded: 5000, metadata: {} } },
    })
    const stillOpen = (await expectStatus(await harness.app.request('/api/v1/me/purchases/open', { headers: ola.headers }), 200)).purchases as any[]
    assert.deepEqual(stillOpen, [], 'the Purchase is no longer open')
    assert.deepEqual(await receiptsOf(ola), [])
  })
})
