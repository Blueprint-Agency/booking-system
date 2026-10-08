import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { ownAccountId, type StripeFake } from './stripe-fake'
import {
  completedEvent,
  deliverTo,
  forgetPurchases,
  lastCheckoutSession,
  sellingFake,
  sessionTotal,
} from './corporate-purchase'

const run = Date.now().toString(36)
const DOMAIN = `${run}.corporate-checkout.test`
// Not ending in "Flow" / "Bundle" / "Retreat" / "Mat": isolation.test.ts purges by those suffixes.
const NAME = `CorpCheckout ${run}`

/**
 * Buying a corporate package (#374; fe-client-features §6.2, be-client
 * `POST /checkout/package` and § Corporate branch, admin-restructure §9b).
 *
 * A corporate package is paid by card on the studio's own account, at its
 * price: no credits, no Promotion, no Promo Code. The payment, once confirmed,
 * is what makes the member's one pending Corporate Request — there is no free
 * request form beside it.
 */
describe('buying a corporate package over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake

  type Tenant = { id: string; slug: string }
  type Member = { clientId: string; email: string; headers: Record<string, string> }
  type Staff = { staffId: string; headers: Record<string, string> }

  let one!: Tenant
  let two!: Tenant
  let adminAtOne!: Staff
  let adminAtTwo!: Staff
  let packageAtOne!: string
  let members = 0

  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  async function staff(at: Tenant): Promise<Staff> {
    const email = `admin-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, at)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, at.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name: `Desk ${at.slug}`, role: 'admin', status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    return { staffId: row!.id, headers }
  }

  async function member(at: Tenant): Promise<Member> {
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

  async function corporatePackage(at: Tenant, by: Staff, priceSgd: string, status: 'active' | 'archived' = 'active') {
    const [row] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: at.id, name: `${NAME} Offsite ${priceSgd}`, priceSgd, status, createdByStaffId: by.staffId })
      .returning({ id: schema.corporatePackages.id })
    return row!.id
  }

  const checkout = (headers: Record<string, string>, body: Record<string, unknown>) =>
    harness.app.request('/api/v1/me/checkout/package', {
      method: 'POST',
      headers: { ...headers, ...json },
      body: JSON.stringify(body),
    })

  const buyCorporate = (who: { headers: Record<string, string> }, packageId = packageAtOne, extra: Record<string, unknown> = {}) =>
    checkout(who.headers, { package_kind: 'corporate', package_id: packageId, ...extra })

  const requestsOf = (who: Member) =>
    harness.db.select().from(schema.corporateRequests).where(eq(schema.corporateRequests.clientId, who.clientId))
  const purchasesOf = (who: Member) => harness.db.select().from(schema.purchases).where(eq(schema.purchases.clientId, who.clientId))
  const paymentsOf = (who: Member) => harness.db.select().from(schema.stripePayments).where(eq(schema.stripePayments.clientId, who.clientId))
  const packagesOf = (who: Member) => harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, who.clientId))
  const sessionsAsked = () => fake.callsTo('checkout.sessions.create').length

  /** Every row the purchase path could write, counted in both studios. */
  async function writes(): Promise<string> {
    const [r] = await harness.db.execute<Record<string, number>>(sql`
      SELECT
        (SELECT count(*)::int FROM purchases WHERE tenant_id IN (${one.id}::uuid, ${two.id}::uuid)) AS purchases,
        (SELECT count(*)::int FROM stripe_payments WHERE tenant_id IN (${one.id}::uuid, ${two.id}::uuid)) AS payments,
        (SELECT count(*)::int FROM corporate_requests WHERE tenant_id IN (${one.id}::uuid, ${two.id}::uuid)) AS requests,
        (SELECT count(*)::int FROM client_packages WHERE tenant_id IN (${one.id}::uuid, ${two.id}::uuid)) AS packages`)
    return JSON.stringify(r)
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ one, two } = harness.tenants)
    fake = await sellingFake(harness)
    adminAtOne = await staff(one)
    adminAtTwo = await staff(two)
    packageAtOne = await corporatePackage(one, adminAtOne, '1500.00')
  })

  after(async () => {
    if (!harness) return
    try {
      fake?.restore()
      const ours = `%@${DOMAIN}`
      const clientIds = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM corporate_requests WHERE client_id IN (${clientIds})`)
      await forgetPurchases(harness, clientIds)
      await harness.db.execute(sql`DELETE FROM corporate_packages WHERE created_by_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test('CORP-02 a corporate package is paid by card on the studio’s own account, at its price, and nothing is granted before the payment lands', async () => {
    const mia = await member(one)
    const body = await expectStatus(await buyCorporate(mia), 200)
    assert.match(String(body.url), /^https:\/\/pay\.example\.test\//)

    const { account, params } = lastCheckoutSession(fake)
    assert.equal(account, ownAccountId(one), 'charged on the studio’s own account')
    assert.deepEqual(params.payment_method_types, ['card'], 'card only')
    assert.equal(sessionTotal(params), 150000, 'the package’s own price, no Promotion')
    assert.equal(params.line_items.length, 1)
    assert.equal(params.metadata.kind, 'corporate_package')
    assert.equal(params.metadata.package_id, packageAtOne)
    assert.equal(params.metadata.client_id, mia.clientId)
    assert.equal(params.metadata.tenant_id, one.id)

    const [sale] = await purchasesOf(mia)
    assert.ok(sale, 'a Purchase was opened')
    assert.equal(sale.kind, 'corporate_package')
    assert.equal(sale.status, 'open')
    assert.equal(sale.totalSgd, '1500.00')
    assert.equal((await requestsOf(mia)).length, 0, 'no request before the payment lands')
    assert.equal((await paymentsOf(mia)).length, 0)
    assert.equal((await packagesOf(mia)).length, 0, 'a corporate package grants no credits')
  })

  test('CORP-02 a corporate checkout takes no Promo Code, no part payment and no package extras, and an archived package is not sold', async () => {
    const mia = await member(one)
    const archived = await corporatePackage(one, adminAtOne, '700.00', 'archived')
    const sessions = sessionsAsked()
    const before = await writes()

    for (const extra of [
      { promo_code: 'TEAMDEAL' },
      { part_payment_sgd: 100 },
      { location_id: randomUUID() },
      { instructor_id: randomUUID() },
      { cross_location_add_on: true },
    ]) {
      const res = await buyCorporate(mia, packageAtOne, extra)
      assert.equal(res.status, 400, `${JSON.stringify(extra)}: ${await res.text()}`)
    }
    await expectStatus(await buyCorporate(mia, archived), 400, 'corporate_package_not_active')
    await expectStatus(await buyCorporate(mia, randomUUID()), 404, 'corporate_package_not_found')

    assert.equal(sessionsAsked(), sessions, 'the provider was asked for a session')
    assert.equal(await writes(), before, 'a refused checkout wrote something')
  })

  test('CORP-02 another studio’s member and a staff session are refused the corporate checkout, and nothing is written', async () => {
    const nat = await member(two)
    const sessions = sessionsAsked()
    const before = await writes()

    // Their own session, carried to this studio's hostname: this studio has never seen it.
    const crossed = { ...nat.headers, 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('client', one) }
    await expectStatus(await checkout(crossed, { package_kind: 'corporate', package_id: packageAtOne }), 401, 'invalid_token')
    // At their own studio, this studio's package does not exist.
    await expectStatus(await buyCorporate(nat), 404, 'corporate_package_not_found')
    // The wrong role: an Admin's staff session is not a member's.
    const asStaff = { ...adminAtOne.headers, 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('client', one) }
    await expectStatus(await checkout(asStaff, { package_kind: 'corporate', package_id: packageAtOne }), 401, 'invalid_token')

    assert.equal(sessionsAsked(), sessions, 'the provider was asked for a session')
    assert.equal(await writes(), before, 'a refused checkout wrote something')
  })

  test('CORP-03 a confirmed corporate payment makes exactly one pending Corporate Request for the member and grants no credits', async () => {
    const mia = await member(one)
    await expectStatus(await buyCorporate(mia), 200)
    const { params } = lastCheckoutSession(fake)
    const intent = `pi_${randomUUID()}`
    await expectStatus(await deliverTo(harness, one.slug, completedEvent(params, intent)), 200)

    const requests = await requestsOf(mia)
    assert.equal(requests.length, 1, 'one request')
    assert.equal(requests[0]!.status, 'pending')
    assert.equal(requests[0]!.corporatePackageId, packageAtOne)
    assert.equal(requests[0]!.tenantId, one.id)
    assert.equal(requests[0]!.message, null, 'there is no form, so no note')

    const payments = await paymentsOf(mia)
    assert.equal(payments.length, 1)
    assert.equal(payments[0]!.kind, 'corporate_package')
    assert.equal(payments[0]!.status, 'succeeded')
    assert.equal(payments[0]!.amountSgd, '1500.00')
    assert.equal(payments[0]!.paymentIntentId, intent)
    assert.equal(payments[0]!.providerAccountId, ownAccountId(one))
    assert.equal(payments[0]!.clientPackageId, null)

    const [sale] = await purchasesOf(mia)
    assert.equal(sale!.status, 'paid')
    assert.equal(sale!.amountPaidSgd, '1500.00')
    assert.equal((await packagesOf(mia)).length, 0, 'no credits')

    // The member reads it on their corporate bookings.
    const listed = await expectStatus(await harness.app.request('/api/v1/me/corporate-requests', { headers: mia.headers }), 200)
    assert.deepEqual(
      listed.corporate_requests.map((r: any) => [r.id, r.status, r.package.id]),
      [[requests[0]!.id, 'pending', packageAtOne]],
    )
  })

  test('CORP-03 a redelivered, replayed or concurrent confirmation of the same corporate payment makes no second request', async () => {
    const mia = await member(one)
    await expectStatus(await buyCorporate(mia), 200)
    const { params } = lastCheckoutSession(fake)
    const intent = `pi_${randomUUID()}`
    const first = completedEvent(params, intent)

    // Two deliveries racing, then the same event again, then a fresh event for the same payment.
    const raced = await Promise.all([deliverTo(harness, one.slug, first), deliverTo(harness, one.slug, first)])
    for (const res of raced) await expectStatus(res, 200)
    await expectStatus(await deliverTo(harness, one.slug, first), 200)
    await expectStatus(await deliverTo(harness, one.slug, completedEvent(params, intent)), 200)

    // The confirmation page's fallback replays it by hand.
    fake.reply('checkout.sessions.retrieve', () => first.data.object)
    await expectStatus(
      await harness.app.request('/api/v1/me/checkout/sync-session', {
        method: 'POST',
        headers: { ...mia.headers, ...json },
        body: JSON.stringify({ session_id: first.data.object.id }),
      }),
      200,
    )

    assert.equal((await requestsOf(mia)).length, 1, 'exactly one request')
    assert.equal((await paymentsOf(mia)).length, 1, 'exactly one payment')
    assert.equal((await packagesOf(mia)).length, 0)
  })

  test('CORP-03 a delivery naming one studio’s corporate sale on another studio’s endpoint is refused, and nothing is written', async () => {
    const mia = await member(one)
    await expectStatus(await buyCorporate(mia), 200)
    const event = completedEvent(lastCheckoutSession(fake).params)
    const before = await writes()

    const refused = await deliverTo(harness, two.slug, event)
    assert.notEqual(refused.status, 200, 'another studio’s delivery was accepted')
    // And one the provider never signed.
    const unsigned = await deliverTo(harness, one.slug, event, 'not-a-signature')
    assert.equal(unsigned.status, 400, await unsigned.text())

    assert.equal(await writes(), before, 'a refused delivery wrote something')
    assert.equal((await requestsOf(mia)).length, 0)
  })

  test('CORP-03 a corporate package with nothing to pay makes its pending request at once, with no provider session and no credits', async () => {
    const mia = await member(one)
    const free = await corporatePackage(one, adminAtOne, '0.00')
    const sessions = sessionsAsked()

    const body = await expectStatus(await buyCorporate(mia, free), 201)
    assert.equal(body.outcome, 'granted')
    assert.equal(sessionsAsked(), sessions, 'no provider session for nothing to pay')
    const requests = await requestsOf(mia)
    assert.deepEqual(requests.map(r => [r.id, r.status, r.corporatePackageId]), [[body.corporate_request_id, 'pending', free]])
    assert.equal((await packagesOf(mia)).length, 0)
  })

  test('CORP-02 there is no free request form: a Corporate Request cannot be made without the payment', async () => {
    const mia = await member(one)
    const before = await writes()
    const res = await harness.app.request('/api/v1/me/corporate-requests', {
      method: 'POST',
      headers: { ...mia.headers, ...json },
      body: JSON.stringify({ package_id: packageAtOne, preferred_location: 'the office', notes: 'team of twelve' }),
    })
    await expectStatus(res, 404, 'not_found')
    assert.equal(await writes(), before)
  })
})
