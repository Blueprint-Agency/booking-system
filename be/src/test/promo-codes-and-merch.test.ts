import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, inArray, like, or, sql } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.promo-merch.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `PromoMerch ${run}`
const DAY = 24 * 60 * 60 * 1000

/**
 * What a **member** does with the admin catalogue (#205): a Promo Code typed at
 * checkout, and merch bought and read back from their purchase history.
 *
 * Every step goes over HTTP the way the two apps send it — the admin makes the
 * packages, codes and merch in the portal, the member checks the code and pays
 * in the member app, and the payment provider's `checkout.session.completed`
 * arrives at the webhook. The provider itself is the in-process fake
 * (`stripe-fake.ts`), the one true third party here.
 *
 * Written from the Scenario Inventory's PRM and MRC rows
 * (`docs/md/test-scenarios.md`), which come from fe-client-features §6.1, §6b,
 * §7 and §8.1b and spec-pre-launch-batch §9–§11.
 */
describe('promo codes and merch, as a member uses them', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Studio = { id: string; slug: string; admin: Headers; locationId: string }
  type Member = { clientId: string; headers: Headers }

  let one!: Studio
  let two!: Studio
  /** Catalogue at studio one, made through the portal. */
  let bundle!: { id: string; name: string }
  let otherBundle!: { id: string; name: string }
  let plan!: { id: string; name: string }

  let members = 0
  const clientIds: string[] = []
  let sessions = 0

  async function reply(res: Response): Promise<Reply> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const send = async (method: string, path: string, headers: Headers, body?: unknown) =>
    reply(
      await harness.app.request(path, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )

  const anonymous = (at: { slug: string }): Headers => ({
    Origin: frontendOrigin('client', at),
    'X-Tenant-Slug': at.slug,
  })

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const email = `owner-${tenant.slug}@${DOMAIN}`
    const admin = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: 'Owner', role: 'admin', status: 'active', authUserId: user!.id })
    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenant.id))
      .limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    return { ...tenant, admin, locationId: location.id }
  }

  /** A fresh member each time: checkout is rate-limited per member. */
  async function member(at: Studio): Promise<Member> {
    const email = `member-${++members}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: `Member ${members}`, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    clientIds.push(client!.id)
    return { clientId: client!.id, headers }
  }

  async function classPackage(at: Studio, body: Record<string, unknown>) {
    const res = await send('POST', '/api/v1/portal/admin/class-packages', at.admin, body)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return { id: res.body.id as string, name: res.body.name as string }
  }

  /** A Promo Code made in the portal; the text is unique per run. */
  async function promoCode(at: Studio, over: Record<string, unknown> = {}) {
    const res = await send('POST', '/api/v1/portal/admin/promo-codes', at.admin, {
      code: `P${run}-${randomUUID().slice(0, 4)}`.toUpperCase().slice(0, 24),
      label: '20% off',
      kind: 'percent',
      percent_off: 20,
      applies_to_all: true,
      ...over,
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body as { id: string; code: string }
  }

  async function merchItem(at: Studio, title: string, price: string) {
    const res = await send('POST', '/api/v1/portal/admin/merch', at.admin, { title, price_sgd: price })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body as { id: string; title: string; price_sgd: string }
  }

  const validate = (who: Member, code: string, packageId = bundle.id) =>
    send('POST', '/api/v1/me/checkout/validate-promo', who.headers, {
      code,
      package_kind: 'class',
      package_id: packageId,
    })

  const checkout = (who: Member, body: Record<string, unknown>) =>
    send('POST', '/api/v1/me/checkout/package', who.headers, { package_kind: 'class', ...body })

  /** The last payment session the fake was asked for. */
  const lastSession = () => {
    const calls = fake.callsTo('checkout.sessions.create')
    assert.ok(calls.length > 0, 'a payment session was created')
    return calls.at(-1)!.args[0] as { metadata: Record<string, string>; line_items: any[] }
  }

  /** The provider's delivery for the last session, paid in full. */
  async function payLastSession(): Promise<string> {
    const params = lastSession()
    const intent = `pi_promo_merch_${randomUUID().slice(0, 12)}`
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_promo_merch_${sessions}`,
          payment_intent: intent,
          payment_status: 'paid',
          amount_total: params.line_items.reduce((n, l) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0),
          metadata: params.metadata,
        },
      },
    }
    const res = await reply(
      // The studio's own endpoint: the one whose member the session was for.
      await harness.app.request(stripeWebhookPath(params.metadata.tenant_id === two.id ? two.slug : one.slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=fake' },
        body: JSON.stringify(event),
      }),
    )
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return intent
  }

  async function purchasesOf(clientId: string) {
    return harness.db
      .select()
      .from(schema.purchases)
      .where(eq(schema.purchases.clientId, clientId))
      .orderBy(schema.purchases.createdAt)
  }

  async function redemptionsOf(promoCodeId: string) {
    return harness.db
      .select()
      .from(schema.promoCodeRedemptions)
      .where(eq(schema.promoCodeRedemptions.promoCodeId, promoCodeId))
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')

    const { installStripeFake } = await import('./stripe-fake')
    fake = installStripeFake()
    fake.reply('customers.create', () => ({ id: `cus_promo_merch_${randomUUID().slice(0, 8)}` }))
    fake.reply('checkout.sessions.create', () => {
      sessions++
      return { id: `cs_promo_merch_${sessions}`, url: `https://pay.example.test/cs_promo_merch_${sessions}` }
    })
    fake.reply('webhooks.constructEvent', (body: unknown) => JSON.parse(String(body)))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    // Each studio sells on an account of its own — the only way a studio sells
    // at all (#293) — and its deliveries arrive on its own endpoint.
    fake.ownAccount(one)
    fake.ownAccount(two)

    bundle = await classPackage(one, {
      name: `${NAME} Pass`,
      kind: 'credit_bundle',
      credits: 5,
      validity_days: 60,
      price_sgd: '100.00',
    })
    otherBundle = await classPackage(one, {
      name: `${NAME} Other pass`,
      kind: 'credit_bundle',
      credits: 10,
      validity_days: 90,
      price_sgd: '180.00',
    })
    plan = await classPackage(one, {
      name: `${NAME} Plan`,
      kind: 'unlimited',
      duration_months: 3,
      price_sgd: '300.00',
    })
  })

  after(async () => {
    if (!harness) return
    fake?.restore()

    try {
      await cleanup()
    } finally {
      await harness.close()
    }
  })

  async function cleanup() {
    const db = harness.db
    if (clientIds.length) {
      await db.delete(schema.promoCodeRedemptions).where(inArray(schema.promoCodeRedemptions.clientId, clientIds))
      await db.delete(schema.merchOrders).where(inArray(schema.merchOrders.clientId, clientIds))
      await db.delete(schema.stripePayments).where(inArray(schema.stripePayments.clientId, clientIds))
      await db.delete(schema.clientPackages).where(inArray(schema.clientPackages.clientId, clientIds))
      await db.delete(schema.purchases).where(inArray(schema.purchases.clientId, clientIds))
      // Checkout makes each member a customer at the payment provider.
      await db.delete(schema.paymentCustomers).where(inArray(schema.paymentCustomers.clientId, clientIds))
    }
    const codes = await db
      .select({ id: schema.promoCodes.id })
      .from(schema.promoCodes)
      .where(like(schema.promoCodes.code, `P${run}-%`.toUpperCase()))
    if (codes.length) {
      const ids = codes.map(c => c.id)
      await db.delete(schema.promoCodeRedemptions).where(inArray(schema.promoCodeRedemptions.promoCodeId, ids))
      await db.delete(schema.promoCodeProducts).where(inArray(schema.promoCodeProducts.promoCodeId, ids))
      await db.delete(schema.promoCodes).where(inArray(schema.promoCodes.id, ids))
    }
    const packages = await db
      .select({ id: schema.classPackages.id })
      .from(schema.classPackages)
      .where(like(schema.classPackages.name, `${NAME} %`))
    if (packages.length) {
      await db.delete(schema.promotions).where(inArray(schema.promotions.parentId, packages.map(p => p.id)))
      await db.delete(schema.classPackages).where(inArray(schema.classPackages.id, packages.map(p => p.id)))
    }
    await db.delete(schema.merch).where(like(schema.merch.title, `${NAME} %`))
    const staff = await db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const staffIds = staff.map(s => s.id)
    const authIds = [
      ...(await db.select({ id: schema.staffAuthUsers.id }).from(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))),
      ...(await db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))),
    ].map(u => u.id)
    if (authIds.length) {
      await db
        .delete(schema.authEvents)
        .where(or(inArray(schema.authEvents.actorUserId, authIds), inArray(schema.authEvents.subjectUserId, authIds)))
    }
    if (staffIds.length) await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
    await db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    if (clientIds.length) await db.delete(schema.clients).where(inArray(schema.clients.id, clientIds))
    if (staffIds.length) await db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    await db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
  }

  /* ── Promo Codes ─────────────────────────────────────────────────────── */

  test('PRM-01 a code typed in lower case with stray spaces is accepted, at the check and at checkout', async () => {
    const code = await promoCode(one)
    const who = await member(one)

    const typed = `  ${code.code.toLowerCase()} `
    const checked = await validate(who, typed)
    assert.equal(checked.status, 200, JSON.stringify(checked.body))
    assert.equal(checked.body.valid, true, JSON.stringify(checked.body))
    assert.equal(checked.body.code, code.code, 'the stored, normalised form comes back')
    assert.equal(checked.body.effective_price_sgd, '80.00')

    const res = await checkout(who, { package_id: bundle.id, promo_code: typed })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(lastSession().metadata.promo_code_id, code.id)
  })

  test('PRM-16, PRM-02 the Purchase carries the code’s discount taken off the already-promoted price', async () => {
    // A live Promotion: 100.00 → 90.00. The code then takes 20% of 90.00.
    const promoted = await classPackage(one, {
      name: `${NAME} Promoted pass`,
      kind: 'credit_bundle',
      credits: 5,
      validity_days: 60,
      price_sgd: '100.00',
      promotions: [
        {
          label: 'Opening week',
          kind: 'percent',
          percent_off: 10,
          starts_at: new Date(Date.now() - DAY).toISOString(),
          ends_at: new Date(Date.now() + 7 * DAY).toISOString(),
        },
      ],
    })
    const code = await promoCode(one)
    const who = await member(one)

    const checked = await validate(who, code.code, promoted.id)
    assert.equal(checked.body.valid, true, JSON.stringify(checked.body))
    assert.equal(checked.body.discount_sgd, '18.00', '20% of the promoted 90.00, not of the 100.00 List Price')
    assert.equal(checked.body.effective_price_sgd, '72.00')

    const res = await checkout(who, { package_id: promoted.id, promo_code: code.code })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.ok(res.body.url, 'the member is sent to pay')

    const [purchase] = await purchasesOf(who.clientId)
    assert.ok(purchase, 'checkout opened a Purchase')
    assert.equal(purchase.totalSgd, '72.00', 'the Purchase is for the discounted amount')
    assert.equal(purchase.status, 'open')
    const session = lastSession()
    assert.equal(session.line_items.length, 1)
    assert.equal(session.line_items[0].price_data.unit_amount, 7200, 'and the provider is asked for exactly that')

    const [held] = await redemptionsOf(code.id)
    assert.equal(held?.status, 'held', 'the Redemption is Held when checkout starts')

    await payLastSession()
    const [paid] = await purchasesOf(who.clientId)
    assert.equal(paid!.status, 'paid')
    assert.equal(paid!.amountPaidSgd, '72.00')
    const [granted] = await harness.db
      .select()
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.clientId, who.clientId))
    assert.equal(granted?.amountPaidSgd, '72.00', 'the package records what was paid')
    assert.equal(granted?.appliedPromoCodeId, code.id, 'and which code paid for part of it')
    const [consumed] = await redemptionsOf(code.id)
    assert.equal(consumed?.status, 'consumed', 'and Consumed once payment succeeds')
    assert.equal(consumed?.discountSgd, '18.00')
  })

  test('PRM-03 on an Unlimited Plan with the Cross-Location Add-On, the code discounts the plan line only', async () => {
    const code = await promoCode(one, { percent_off: 50 })
    const plain = await member(one)
    const coded = await member(one)
    const body = { package_id: plan.id, location_id: one.locationId, cross_location_add_on: true }

    const full = await checkout(plain, body)
    assert.equal(full.status, 200, JSON.stringify(full.body))
    const addOnSgd = lastSession().metadata.cross_location_sgd
    assert.ok(Number(addOnSgd) > 0, 'the studio charges for the Add-On')

    const res = await checkout(coded, { ...body, promo_code: code.code })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const session = lastSession()
    assert.equal(session.metadata.amount_sgd, '150.00', 'half off the plan')
    assert.equal(session.metadata.cross_location_sgd, addOnSgd, 'the Add-On is untouched')
    const amounts = session.line_items.map(l => l.price_data.unit_amount)
    assert.deepEqual(amounts, [15000, Math.round(Number(addOnSgd) * 100)])
    const [purchase] = await purchasesOf(coded.clientId)
    assert.equal(Number(purchase!.totalSgd), 150 + Number(addOnSgd))
  })

  test('PRM-04 an expired code is refused with "This code has expired"', async () => {
    const code = await promoCode(one, { expires_at: new Date(Date.now() - DAY).toISOString() })
    const who = await member(one)

    const checked = await validate(who, code.code)
    assert.equal(checked.status, 200)
    assert.equal(checked.body.valid, false)
    assert.equal(checked.body.message, 'This code has expired')

    const res = await checkout(who, { package_id: bundle.id, promo_code: code.code })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.error, 'promo_code_invalid')
    assert.equal(res.body.message, 'This code has expired')
    assert.deepEqual(await purchasesOf(who.clientId), [], 'nothing was opened to charge')
  })

  test('PRM-05 a code at its total cap is refused with "This code has been fully claimed"', async () => {
    const code = await promoCode(one, { max_redemptions: 1 })
    const first = await member(one)
    const second = await member(one)

    const taken = await checkout(first, { package_id: bundle.id, promo_code: code.code })
    assert.equal(taken.status, 200, JSON.stringify(taken.body))

    const checked = await validate(second, code.code)
    assert.equal(checked.body.valid, false)
    assert.equal(checked.body.message, 'This code has been fully claimed')
    const res = await checkout(second, { package_id: bundle.id, promo_code: code.code })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.message, 'This code has been fully claimed')
    assert.deepEqual(await purchasesOf(second.clientId), [])
  })

  test('PRM-06 a member who has used a code is refused with "You’ve already used this code"', async () => {
    // Takes the whole price, so the first use completes with no payment step.
    const code = await promoCode(one, { kind: 'amount', amount_off_sgd: '100.00' })
    const who = await member(one)

    const free = await checkout(who, { package_id: bundle.id, promo_code: code.code })
    assert.equal(free.status, 201, JSON.stringify(free.body))
    assert.equal(free.body.outcome, 'granted')
    const [used] = await redemptionsOf(code.id)
    assert.equal(used?.status, 'consumed')

    const checked = await validate(who, code.code)
    assert.equal(checked.body.valid, false)
    assert.equal(checked.body.message, "You've already used this code")
    const again = await checkout(who, { package_id: bundle.id, promo_code: code.code })
    assert.equal(again.status, 400, JSON.stringify(again.body))
    assert.equal(again.body.message, "You've already used this code")
  })

  test('PRM-07 a code scoped to other products is refused naming the product being bought', async () => {
    const code = await promoCode(one, {
      applies_to_all: false,
      products: [{ product_type: 'class_package', product_id: otherBundle.id }],
    })
    const who = await member(one)

    const checked = await validate(who, code.code)
    assert.equal(checked.body.valid, false)
    assert.equal(checked.body.message, `This code doesn't apply to ${bundle.name}`)
    const res = await checkout(who, { package_id: bundle.id, promo_code: code.code })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.message, `This code doesn't apply to ${bundle.name}`)

    const inScope = await validate(who, code.code, otherBundle.id)
    assert.equal(inScope.body.valid, true, 'the product it names takes it')
  })

  test('PRM-08 an unknown code and an archived code get the same "We don’t recognise that code"', async () => {
    const archived = await promoCode(one)
    const res = await send('POST', `/api/v1/portal/admin/promo-codes/${archived.id}/archive`, one.admin)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const who = await member(one)

    const unknown = await validate(who, `NOPE-${run}`.toUpperCase())
    const gone = await validate(who, archived.code)
    assert.equal(unknown.body.valid, false)
    assert.equal(unknown.body.message, "We don't recognise that code")
    assert.deepEqual(gone.body, unknown.body, 'nothing tells an archived code from one that never existed')
  })

  test('PRM-09 a code accepted on the review step and archived before paying refuses the checkout', async () => {
    const code = await promoCode(one)
    const who = await member(one)

    const checked = await validate(who, code.code)
    assert.equal(checked.body.valid, true, 'accepted on the review step')
    await send('POST', `/api/v1/portal/admin/promo-codes/${code.id}/archive`, one.admin)

    const before = fake.callsTo('checkout.sessions.create').length
    const res = await checkout(who, { package_id: bundle.id, promo_code: code.code })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.error, 'promo_code_invalid')
    assert.equal(fake.callsTo('checkout.sessions.create').length, before, 'no payment session at full price')
    assert.deepEqual(await purchasesOf(who.clientId), [])
  })

  test('PRM-15 a code that exists only at another studio is not recognised here', async () => {
    const theirs = await promoCode(two)
    const who = await member(one)

    const checked = await validate(who, theirs.code)
    assert.equal(checked.body.valid, false)
    assert.equal(checked.body.message, "We don't recognise that code")
    const res = await checkout(who, { package_id: bundle.id, promo_code: theirs.code })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.message, "We don't recognise that code")
    assert.deepEqual(await redemptionsOf(theirs.id), [], 'the other studio’s code is untouched')
  })

  /* ── Merch ───────────────────────────────────────────────────────────── */

  test('MRC-01 a signed-in member and an anonymous visitor see the same merch at the same prices', async () => {
    const mat = await merchItem(one, `${NAME} Mat`, '45.00')
    await merchItem(two, `${NAME} Their mat`, '99.00')
    const who = await member(one)

    const signedIn = await send('GET', '/api/v1/public/merch', who.headers)
    const visitor = await send('GET', '/api/v1/public/merch', anonymous(one))
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body))
    assert.equal(visitor.status, 200, JSON.stringify(visitor.body))
    assert.deepEqual(signedIn.body, visitor.body)
    const listed = visitor.body.merch.find((m: { id: string }) => m.id === mat.id)
    assert.equal(listed?.price_sgd, '45.00')
    assert.ok(
      !visitor.body.merch.some((m: { title: string }) => m.title === `${NAME} Their mat`),
      'another studio’s merch is not in this studio’s shop',
    )
  })

  test('MRC-04 a merch item priced 0 is ordered at once with no payment step', async () => {
    const sticker = await merchItem(one, `${NAME} Sticker`, '0')
    const who = await member(one)
    const before = fake.callsTo('checkout.sessions.create').length

    const res = await send('POST', '/api/v1/me/checkout/merch', who.headers, { merch_id: sticker.id })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.outcome, 'granted')
    assert.equal(fake.callsTo('checkout.sessions.create').length, before, 'the provider is never asked')

    const history = await send('GET', '/api/v1/me/merch-orders', who.headers)
    assert.equal(history.body.orders.length, 1)
    assert.equal(history.body.orders[0].title, `${NAME} Sticker`)
    assert.equal(history.body.orders[0].amount_sgd, '0.00')
  })

  test('MRC-05 /account/merch shows what was bought at the title and price paid, newest first', async () => {
    const hoodie = await merchItem(one, `${NAME} Hoodie`, '60.00')
    const bottle = await merchItem(one, `${NAME} Bottle`, '25.00')
    const who = await member(one)

    for (const item of [hoodie, bottle]) {
      const res = await send('POST', '/api/v1/me/checkout/merch', who.headers, { merch_id: item.id })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.ok(res.body.url, 'sent to pay')
      await payLastSession()
    }
    const renamed = await send('PATCH', `/api/v1/portal/admin/merch/${hoodie.id}`, one.admin, {
      title: `${NAME} Hoodie (new season)`,
      price_sgd: '80.00',
    })
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body))

    const history = await send('GET', '/api/v1/me/merch-orders', who.headers)
    assert.equal(history.status, 200, JSON.stringify(history.body))
    assert.deepEqual(
      history.body.orders.map((o: { title: string; amount_sgd: string }) => [o.title, o.amount_sgd]),
      [
        [`${NAME} Bottle`, '25.00'],
        [`${NAME} Hoodie`, '60.00'],
      ],
    )
  })

  test('MRC-06 an admin deletes a merch item a member bought, and the purchase history keeps it', async () => {
    const towel = await merchItem(one, `${NAME} Towel`, '0')
    const who = await member(one)
    await send('POST', '/api/v1/me/checkout/merch', who.headers, { merch_id: towel.id })

    const res = await send('DELETE', `/api/v1/portal/admin/merch/${towel.id}`, one.admin)
    assert.equal(res.status, 204)

    const history = await send('GET', '/api/v1/me/merch-orders', who.headers)
    assert.equal(history.body.orders.length, 1)
    assert.equal(history.body.orders[0].title, `${NAME} Towel`)
    assert.equal(history.body.orders[0].amount_sgd, '0.00')
    assert.equal(history.body.orders[0].merch_id, null, 'the order no longer points at the deleted item')
  })

  test('MRC-07 archived merch leaves the shop and cannot be bought', async () => {
    const block = await merchItem(one, `${NAME} Block`, '15.00')
    const archived = await send('PATCH', `/api/v1/portal/admin/merch/${block.id}`, one.admin, { archived: true })
    assert.equal(archived.status, 200, JSON.stringify(archived.body))
    const who = await member(one)

    const shop = await send('GET', '/api/v1/public/merch', who.headers)
    assert.ok(!shop.body.merch.some((m: { id: string }) => m.id === block.id), 'not listed')
    const res = await send('POST', '/api/v1/me/checkout/merch', who.headers, { merch_id: block.id })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.error, 'merch_not_available')
    assert.deepEqual(await purchasesOf(who.clientId), [])
  })

  test('MRC-10 a member cannot buy another studio’s merch', async () => {
    const theirs = await merchItem(two, `${NAME} Their strap`, '0')
    const who = await member(one)

    const res = await send('POST', '/api/v1/me/checkout/merch', who.headers, { merch_id: theirs.id })
    assert.equal(res.status, 404, JSON.stringify(res.body))
    const [orders] = await harness.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.merchOrders)
      .where(eq(schema.merchOrders.merchId, theirs.id))
    assert.equal(orders!.n, 0)
  })
})
