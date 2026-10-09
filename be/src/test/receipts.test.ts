import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.receipts.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `Receipts ${run}`

/**
 * A member's Receipts (#384): the studio's own record of a paid Purchase,
 * issued when the payment provider says the money arrived and read back from
 * the member's account. Everything is asked over HTTP: a checkout, the
 * provider's delivery to the studio's own webhook endpoint (the Stripe fake
 * stands in for the provider), and `/me/receipts`.
 *
 * Written from the INV rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`).
 */
describe('member receipts over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake

  type Studio = { id: string; slug: string; packageId: string; packageName: string }
  type Member = { clientId: string; email: string; headers: Record<string, string> }
  let one!: Studio
  let two!: Studio

  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? JSON.parse(text) : {}
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const packageName = `${NAME} ten pack ${tenant.slug}`
    const [paid] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: packageName, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '150.00' })
      .returning({ id: schema.classPackages.id })
    return { ...tenant, packageId: paid!.id, packageName }
  }

  let members = 0
  async function member(at: Studio, name = 'Mia Tan'): Promise<Member> {
    const email = `member-${members++}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  /** Start the checkout for `at`'s ten pack, and hand back the session the provider was asked for. */
  async function checkout(who: Member, at: Studio) {
    await expectStatus(
      await harness.app.request('/api/v1/me/checkout/package', {
        method: 'POST',
        headers: { ...who.headers, ...json },
        body: JSON.stringify({ package_kind: 'class', package_id: at.packageId }),
      }),
      200,
    )
    const params = fake.callsTo('checkout.sessions.create').at(-1)!.args[0] as { metadata: Record<string, string>; line_items: any[] }
    const intent = `pi_receipts_${randomUUID().slice(0, 12)}`
    return {
      intent,
      event: {
        id: `evt_${randomUUID()}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_receipts_${randomUUID().slice(0, 12)}`,
            payment_intent: intent,
            payment_status: 'paid',
            amount_total: params.line_items.reduce((n, l) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0),
            metadata: params.metadata,
          },
        },
      },
    }
  }

  /** The provider's delivery, to the studio's own endpoint. */
  const deliver = (at: Studio, event: unknown) =>
    harness.app.request(stripeWebhookPath(at.slug), {
      method: 'POST',
      headers: { ...json, 'stripe-signature': 't=1,v1=fake' },
      body: JSON.stringify(event),
    })

  /** Buy `at`'s ten pack and have the provider say it was paid. */
  async function buy(who: Member, at: Studio) {
    const sale = await checkout(who, at)
    await expectStatus(await deliver(at, sale.event), 200)
    return sale
  }

  const receiptsOf = async (who: Member, query = '') =>
    expectStatus(await harness.app.request(`/api/v1/me/receipts${query}`, { headers: who.headers }), 200)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')

    fake = (await import('./stripe-fake')).installStripeFake()
    fake.reply('customers.create', () => ({ id: `cus_receipts_${randomUUID().slice(0, 8)}` }))
    let sessions = 0
    fake.reply('checkout.sessions.create', () => {
      sessions++
      return { id: `cs_receipts_session_${run}_${sessions}`, url: `https://pay.example.test/cs_receipts_${sessions}` }
    })
    fake.reply('webhooks.constructEvent', (body: unknown) => JSON.parse(String(body)))
    // Every charge is a Visa ending 4242.
    fake.reply('paymentIntents.retrieve', (id: unknown) => ({
      id,
      latest_charge: {
        id: `ch_${String(id)}`,
        receipt_url: `https://pay.example.test/receipts/${String(id)}`,
        payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', wallet: null } },
      },
    }))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    fake.ownAccount(one)
    fake.ownAccount(two)
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM receipts WHERE purchase_id IN (SELECT id FROM purchases WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.close()
  })

  test('INV-01 a paid class package gives the member one Receipt, listed and readable, matching the sale', async () => {
    const mia = await member(one)
    assert.deepEqual((await receiptsOf(mia)).receipts, [], 'nothing before the money arrives')
    const sale = await checkout(mia, one)
    assert.deepEqual((await receiptsOf(mia)).receipts, [], 'an Open Purchase has no Receipt')
    await expectStatus(await deliver(one, sale.event), 200)

    const listed = await receiptsOf(mia)
    assert.equal(listed.receipts.length, 1, 'exactly one Receipt')
    const [row] = listed.receipts
    assert.match(row.number, /^R-\d{6}$/)
    assert.equal(row.item, one.packageName)
    assert.equal(row.total_sgd, '150.00')
    assert.equal(row.status, 'issued')
    assert.ok(row.issued_at)

    const receipt = await expectStatus(await harness.app.request(`/api/v1/me/receipts/${row.id}`, { headers: mia.headers }), 200)
    assert.equal(receipt.id, row.id)
    assert.equal(receipt.number, row.number)
    assert.equal(receipt.kind, 'class_package')
    assert.equal(receipt.seller.name.length > 0, true, 'the studio is named')
    assert.deepEqual(receipt.buyer, { name: 'Mia Tan', email: mia.email })
    assert.deepEqual(
      receipt.lines.map((l: any) => [l.description, l.quantity, l.list_price_sgd, l.discount_sgd, l.amount_sgd]),
      [[one.packageName, 1, '150.00', '0.00', '150.00']],
    )
    assert.equal(receipt.subtotal_sgd, '150.00')
    assert.equal(receipt.discount_sgd, '0.00')
    assert.equal(receipt.total_sgd, '150.00')
    assert.equal(receipt.payments.length, 1)
    const [payment] = receipt.payments
    assert.equal(payment.method, 'card')
    assert.equal(payment.card_brand, 'visa')
    assert.equal(payment.card_last4, '4242')
    assert.equal(payment.amount_sgd, '150.00')
    assert.ok(payment.paid_at)
    assert.equal(receipt.refunded_at, null)
  })

  test('INV-02 the same payment delivered twice, or racing the confirmation page, gives one Receipt with one number', async () => {
    const leo = await member(one)
    const sale = await checkout(leo, one)
    const session = sale.event.data.object
    fake.reply('checkout.sessions.retrieve', () => session)
    const syncSession = () =>
      harness.app.request('/api/v1/me/checkout/sync-session', {
        method: 'POST',
        headers: { ...leo.headers, ...json },
        body: JSON.stringify({ session_id: session.id }),
      })

    // The webhook and the confirmation page's fallback at once, then the
    // provider delivering again.
    const raced = await Promise.all([deliver(one, sale.event), syncSession()])
    for (const res of raced) await expectStatus(res, 200)
    await expectStatus(await deliver(one, sale.event), 200)

    const { receipts } = await receiptsOf(leo)
    assert.equal(receipts.length, 1, 'exactly one Receipt')

    // The next sale at the studio takes the very next number: none was spent
    // on the deliveries that found the Receipt already issued.
    const ivy = await member(one)
    await buy(ivy, one)
    const [next] = (await receiptsOf(ivy)).receipts
    assert.equal(sequenceOf(next.number), sequenceOf(receipts[0].number) + 1)
  })

  test('INV-08 the confirmation page is told which Receipt the payment it confirms was given', async () => {
    const noa = await member(one)
    const sale = await checkout(noa, one)
    const session = sale.event.data.object
    fake.reply('checkout.sessions.retrieve', () => session)
    const synced = await expectStatus(
      await harness.app.request('/api/v1/me/checkout/sync-session', {
        method: 'POST',
        headers: { ...noa.headers, ...json },
        body: JSON.stringify({ session_id: session.id }),
      }),
      200,
    )
    const [receipt] = (await receiptsOf(noa)).receipts
    assert.deepEqual(synced.receipt, { id: receipt.id, number: receipt.number })
  })

  test('INV-03 numbers run on with no gaps within a studio, and each studio counts its own', async () => {
    const numbers: Record<string, number[]> = { [one.id]: [], [two.id]: [] }
    for (const at of [one, two, one, two, one]) {
      const who = await member(at)
      await buy(who, at)
      const [receipt] = (await receiptsOf(who)).receipts
      numbers[at.id]!.push(sequenceOf(receipt.number))
    }
    for (const at of [one, two]) {
      const seen = numbers[at.id]!
      assert.deepEqual(seen, seen.map((_, i) => seen[0]! + i), `consecutive at ${at.slug}: ${seen.join(', ')}`)
    }
  })

  test('INV-04 a delivery that rolls back after its Receipt was written leaves no gap in the numbers', async () => {
    const first = await member(one)
    await buy(first, one)
    const [before] = (await receiptsOf(first)).receipts

    const zoe = await member(one)
    const sale = await checkout(zoe, one)
    // The fault: the database refuses the Receipt itself, the last write of
    // the delivery, after its number was taken.
    await harness.db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION receipts_test_refuse() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'refused for the test'; END $$;
      CREATE TRIGGER receipts_test_refuse AFTER INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION receipts_test_refuse();
    `))
    try {
      const failed = await deliver(one, sale.event)
      assert.equal(failed.status, 500, 'the delivery fails, so the provider retries it')
    } finally {
      await harness.db.execute(sql.raw(`
        DROP TRIGGER IF EXISTS receipts_test_refuse ON receipts;
        DROP FUNCTION IF EXISTS receipts_test_refuse();
      `))
    }
    assert.deepEqual((await receiptsOf(zoe)).receipts, [], 'no Receipt from the delivery that rolled back')

    // The provider retries, and the Receipt takes the number the failure gave back.
    await expectStatus(await deliver(one, sale.event), 200)
    const [after] = (await receiptsOf(zoe)).receipts
    assert.equal(sequenceOf(after.number), sequenceOf(before.number) + 1)
  })

  test('INV-05 a Receipt keeps what it said after the package is renamed and the member changes their name', async () => {
    const [pack] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: one.id, name: `${NAME} five pack`, kind: 'credit_bundle', credits: 5, validityDays: 60, priceSgd: '90.00' })
      .returning({ id: schema.classPackages.id, name: schema.classPackages.name })
    const fivePack = { ...one, packageId: pack!.id, packageName: pack!.name }
    const ada = await member(one, 'Ada Tan')
    await buy(ada, fivePack)
    const [listed] = (await receiptsOf(ada)).receipts
    const issued = await expectStatus(await harness.app.request(`/api/v1/me/receipts/${listed.id}`, { headers: ada.headers }), 200)

    // The studio renames the package in its catalogue; the member renames themselves.
    await harness.db.update(schema.classPackages).set({ name: `${NAME} five pack, renamed` }).where(eq(schema.classPackages.id, pack!.id))
    await expectStatus(
      await harness.app.request('/api/v1/me', { method: 'PATCH', headers: { ...ada.headers, ...json }, body: JSON.stringify({ name: 'Ada Lim' }) }),
      200,
    )

    const [relisted] = (await receiptsOf(ada)).receipts
    assert.equal(relisted.item, `${NAME} five pack`)
    const reread = await expectStatus(await harness.app.request(`/api/v1/me/receipts/${listed.id}`, { headers: ada.headers }), 200)
    assert.deepEqual(reread, issued, 'the Receipt reads exactly as it was issued')
    assert.equal(reread.buyer.name, 'Ada Tan')
    assert.equal(reread.lines[0].description, `${NAME} five pack`)
  })

  test("INV-06 another member's Receipt and another studio's are 404 receipt_not_found", async () => {
    const owner = await member(one)
    await buy(owner, one)
    const [theirs] = (await receiptsOf(owner)).receipts
    const neighbour = await member(one)
    const elsewhere = await member(two)

    for (const who of [neighbour, elsewhere]) {
      const res = await expectStatus(await harness.app.request(`/api/v1/me/receipts/${theirs.id}`, { headers: who.headers }), 404)
      assert.equal(res.error, 'receipt_not_found')
      assert.deepEqual((await receiptsOf(who)).receipts, [], 'and it is not listed')
    }
    const unknown = await expectStatus(await harness.app.request(`/api/v1/me/receipts/${randomUUID()}`, { headers: owner.headers }), 404)
    assert.equal(unknown.error, 'receipt_not_found', 'the same answer as one that does not exist')
  })

  test('TEN-35 with the Tenant scope left out of the query, Row-Level Security still keeps one studio from reading another studio’s Receipts', async () => {
    const owner = await member(two)
    await buy(owner, two)
    const { withTenant, db } = await import('../db')
    const counted = async (tenantId: string) =>
      withTenant(tenantId, async () => {
        // No WHERE tenant_id: the policy is the only thing scoping this.
        const receipts = await db.select({ id: schema.receipts.id, tenantId: schema.receipts.tenantId }).from(schema.receipts)
        const counters = await db.select({ tenantId: schema.receiptCounters.tenantId }).from(schema.receiptCounters)
        return { receipts, counters }
      })
    const atOne = await counted(one.id)
    assert.ok(atOne.receipts.length > 0, 'studio one has Receipts of its own')
    assert.deepEqual([...new Set(atOne.receipts.map(r => r.tenantId))], [one.id])
    assert.deepEqual(atOne.counters.map(c => c.tenantId), [one.id])
    const atTwo = await counted(two.id)
    assert.deepEqual([...new Set(atTwo.receipts.map(r => r.tenantId))], [two.id])
    assert.deepEqual(atTwo.counters.map(c => c.tenantId), [two.id])
  })

  test('INV-07 Receipts list newest first, a page at a time, and the date filter keeps to the studio days asked for', async () => {
    const kai = await member(one)
    // Three separate sales by one member: three checkouts, each paid.
    for (let i = 0; i < 3; i++) await buy(kai, one)

    const all = await receiptsOf(kai)
    assert.equal(all.total, 3)
    const numbers = all.receipts.map((r: any) => sequenceOf(r.number))
    assert.deepEqual(numbers, [...numbers].sort((a, b) => b - a), 'newest first')

    const page1 = await receiptsOf(kai, '?page_size=2')
    const page2 = await receiptsOf(kai, '?page_size=2&page=2')
    assert.deepEqual([...page1.receipts, ...page2.receipts].map((r: any) => r.id), all.receipts.map((r: any) => r.id))
    assert.equal(page2.total, 3)

    // Today in the studio's own time, and the days either side of it.
    const sgDay = (offsetDays: number) => new Date(Date.now() + 8 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10)
    assert.equal((await receiptsOf(kai, `?from=${sgDay(0)}&to=${sgDay(0)}`)).total, 3, 'today holds them')
    assert.equal((await receiptsOf(kai, `?from=${sgDay(1)}`)).total, 0, 'nothing from tomorrow')
    assert.equal((await receiptsOf(kai, `?to=${sgDay(-1)}`)).total, 0, 'nothing up to yesterday')
    await expectStatus(await harness.app.request('/api/v1/me/receipts?from=yesterday', { headers: kai.headers }), 400)
  })
})

/** `R-000123` → 123. */
function sequenceOf(number: string): number {
  const match = /^R-(\d{6})$/.exec(number)
  assert.ok(match, `a receipt number: ${number}`)
  return Number(match[1])
}
