import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.receipt-refund.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `Refunded receipt ${run}`

/** The words a PDF shows, as a reader copying them out of it would get them. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })
  return text
}

/** A moment as the studio's calendar names its day: `9 Oct 2026`. */
const studioDay = (at: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(at))

/**
 * A Refund stamps the Purchase's Receipt **Refunded on {date}** (#392), in the
 * transaction that marks the Purchase refunded, and changes none of its
 * figures. An Abandoned Purchase never had a Receipt, so nothing is stamped.
 *
 * Everything is asked over HTTP: the checkout, the provider's deliveries to
 * the studio's own webhook endpoint (the Stripe fake stands in for the
 * provider), the admin's Refund, and the member's `/me/receipts`. Written from
 * the INV rows of the Scenario Inventory (`docs/md/test-scenarios.md`).
 */
describe('a Refund stamps the Receipt refunded, over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake

  type Member = { clientId: string; email: string; headers: Record<string, string> }
  type Event = { id: string; type: string; data: { object: Record<string, any> } }
  let studio!: { id: string; slug: string; admin: { headers: Record<string, string> } }
  let partPaymentBefore = true

  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as Record<string, any>) : {}
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  let products = 0
  async function tenPack(priceSgd: string): Promise<{ id: string; name: string }> {
    const name = `${NAME} ten pack ${products++}`
    const [row] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: studio.id, name, kind: 'credit_bundle', status: 'active', credits: 10, validityDays: 90, priceSgd })
      .returning({ id: schema.classPackages.id })
    return { id: row!.id, name }
  }

  let members = 0
  async function member(): Promise<Member> {
    const email = `member-${members++}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, studio)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, studio.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name: 'Mia Tan', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  const post = (headers: Record<string, string>, path: string, body: unknown) =>
    harness.app.request(path, { method: 'POST', headers: { ...headers, ...json }, body: JSON.stringify(body) })

  /** How each intent was paid, as the provider will say when it is retrieved. */
  const cards = new Map<string, { brand: string; last4: string }>()

  /** The provider's delivery saying the last checkout's session was paid, on a fresh intent. */
  function paidEvent(card = { brand: 'visa', last4: '4242' }): Event {
    const params = fake.callsTo('checkout.sessions.create').at(-1)!.args[0] as { metadata: Record<string, string>; line_items: any[] }
    const intent = `pi_refunded_${randomUUID().slice(0, 12)}`
    const cents = params.line_items.reduce((n, l) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0)
    cards.set(intent, card)
    charged.set(intent, cents)
    return {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_refunded_${randomUUID().slice(0, 12)}`,
          payment_intent: intent,
          payment_status: 'paid',
          amount_total: cents,
          metadata: params.metadata,
        },
      },
    }
  }

  /** What each intent charged, in cents. */
  const charged = new Map<string, number>()

  /** The provider's delivery saying the whole of an intent's charge went back. */
  const refundedEvent = (intent: string): Event => {
    const cents = charged.get(intent)!
    return {
      id: `evt_${randomUUID()}`,
      type: 'charge.refunded',
      data: {
        object: { id: `ch_${randomUUID().slice(0, 12)}`, payment_intent: intent, amount: cents, amount_captured: cents, amount_refunded: cents, metadata: {} },
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

  /** The member buys the pack and the provider says it was paid by `card`. */
  async function buyAndPay(who: Member, packageId: string, card = { brand: 'visa', last4: '4242' }): Promise<void> {
    await expectStatus(await post(who.headers, '/api/v1/me/checkout/package', { package_kind: 'class', package_id: packageId }), 200)
    await deliver(paidEvent(card))
  }

  /**
   * The admin refunds the member's one package from their detail page; the
   * provider is asked once per payment. The provider's confirmations, one
   * `charge.refunded` per payment, not yet sent.
   */
  async function refund(who: Member): Promise<Event[]> {
    const detail = await expectStatus(await harness.app.request(`/api/v1/portal/admin/clients/${who.clientId}`, { headers: studio.admin.headers }), 200)
    assert.equal(detail.packages.length, 1, `one package to refund: ${JSON.stringify(detail.packages)}`)
    const before = fake.callsTo('refunds.create').length
    await expectStatus(
      await post(studio.admin.headers, `/api/v1/portal/admin/clients/${who.clientId}/packages/${detail.packages[0].id}/refund`, {
        reason: 'Member moved away',
      }),
      200,
    )
    return fake
      .callsTo('refunds.create')
      .slice(before)
      .map(call => refundedEvent((call.args[0] as { payment_intent: string }).payment_intent))
  }

  const receiptsOf = async (who: Member) =>
    (await expectStatus(await harness.app.request('/api/v1/me/receipts', { headers: who.headers }), 200)).receipts as any[]

  /** The member's one Receipt, read whole. */
  async function onlyReceipt(who: Member): Promise<Record<string, any>> {
    const listed = await receiptsOf(who)
    assert.equal(listed.length, 1, `exactly one Receipt: ${JSON.stringify(listed)}`)
    return expectStatus(await harness.app.request(`/api/v1/me/receipts/${listed[0].id}`, { headers: who.headers }), 200)
  }

  /**
   * The database's clock now, in epoch milliseconds, rounded `down` or `up` to
   * the millisecond the API's timestamps are written to.
   */
  const databaseNow = async (round: 'down' | 'up'): Promise<number> => {
    const [row] = await harness.db.execute<{ ms: string }>(sql`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::text AS ms`)
    return (round === 'down' ? Math.floor : Math.ceil)(Number(row!.ms))
  }

  /** What a Receipt says about money: its lines, totals and payments, which a Refund never changes. */
  const figuresOf = (r: Record<string, any>) => ({
    number: r.number,
    issued_at: r.issued_at,
    lines: r.lines,
    subtotal_sgd: r.subtotal_sgd,
    discount_sgd: r.discount_sgd,
    total_sgd: r.total_sgd,
    payments: r.payments,
  })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')

    fake = (await import('./stripe-fake')).installStripeFake()
    fake.reply('customers.create', () => ({ id: `cus_refunded_${randomUUID().slice(0, 8)}` }))
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
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, tenant.id))
    assert.ok(policy, 'a seeded policy')
    partPaymentBefore = policy.partPaymentEnabled
    await harness.db.update(schema.globalPolicy).set({ partPaymentEnabled: true }).where(eq(schema.globalPolicy.tenantId, tenant.id))

    const adminEmail = `admin@${DOMAIN}`
    const headers = await harness.signInAs('staff', adminEmail, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, adminEmail), eq(schema.staffAuthUsers.tenantId, tenant.id)))
    await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email: adminEmail, name: 'Admin', role: 'admin', status: 'active', authUserId: user!.id })
    studio = { ...tenant, admin: { headers } }
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    try {
      if (studio) {
        await harness.db
          .update(schema.globalPolicy)
          .set({ partPaymentEnabled: partPaymentBefore })
          .where(eq(schema.globalPolicy.tenantId, studio.id))
      }
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM promo_code_redemptions WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test('INV-35 a Refund stamps the Receipt refunded on the day it landed, in the list and the Receipt, and changes none of its figures', async () => {
    const ten = await tenPack('150.00')
    const mia = await member()
    await buyAndPay(mia, ten.id)
    const issued = await onlyReceipt(mia)
    assert.equal(issued.status, 'issued')
    assert.equal(issued.refunded_at, null)

    // Bounded by the database's own clock, the one that dates the stamp, so a
    // skew between it and this process's clock cannot move the window.
    const landedFrom = await databaseNow('down')
    for (const confirmed of await refund(mia)) await deliver(confirmed)
    const landedBy = await databaseNow('up')

    const [listed] = await receiptsOf(mia)
    assert.equal(listed.status, 'refunded', 'the list says it was refunded')
    const stamped = await onlyReceipt(mia)
    assert.equal(stamped.id, issued.id, 'the same Receipt')
    assert.equal(stamped.status, 'refunded')
    const at = new Date(stamped.refunded_at).getTime()
    assert.ok(at >= landedFrom && at <= landedBy, `stamped when the Refund landed: ${stamped.refunded_at}`)
    assert.deepEqual(figuresOf(stamped), figuresOf(issued), 'the figures are as issued')
  })

  /** The member puts `sgd` down on the pack by `card`, leaving the Purchase Open; its id. */
  async function partPay(who: Member, packageId: string, sgd: number, card: { brand: string; last4: string }): Promise<string> {
    await expectStatus(await post(who.headers, '/api/v1/me/checkout/package', { package_kind: 'class', package_id: packageId, part_payment_sgd: sgd }), 200)
    await deliver(paidEvent(card))
    const open = (await expectStatus(await harness.app.request('/api/v1/me/purchases/open', { headers: who.headers }), 200)).purchases as any[]
    assert.equal(open.length, 1, 'the Purchase is left open')
    return open[0].id
  }

  test('INV-36 a Purchase paid across two cards is refunded across both, and its one Receipt is stamped once both are back', async () => {
    const ten = await tenPack('200.00')
    const pia = await member()
    const purchaseId = await partPay(pia, ten.id, 80, { brand: 'visa', last4: '4242' })
    await expectStatus(await post(pia.headers, `/api/v1/me/purchases/${purchaseId}/resume`, {}), 200)
    await deliver(paidEvent({ brand: 'mastercard', last4: '5555' }))
    const issued = await onlyReceipt(pia)
    assert.equal(issued.payments.length, 2, 'both cards paid it')

    const confirmations = await refund(pia)
    assert.equal(confirmations.length, 2, 'each card is refunded')
    await deliver(confirmations[0]!)
    assert.equal((await onlyReceipt(pia)).status, 'issued', 'not refunded while one card still holds the money')
    await deliver(confirmations[1]!)

    const stamped = await onlyReceipt(pia)
    assert.equal(stamped.id, issued.id, 'the one Receipt')
    assert.equal(stamped.status, 'refunded')
    assert.ok(stamped.refunded_at, 'stamped with its date')
    assert.deepEqual(figuresOf(stamped), figuresOf(issued), 'both payments as issued')
  })

  test('INV-37 a refunded Receipt as a PDF is stamped Refunded on the day the Refund landed', async () => {
    const ten = await tenPack('150.00')
    const ivy = await member()
    await buyAndPay(ivy, ten.id)
    const issued = await onlyReceipt(ivy)
    const before = await pdfText(new Uint8Array(await (await harness.app.request(`/api/v1/me/receipts/${issued.id}/pdf`, { headers: ivy.headers })).arrayBuffer()))
    assert.ok(!before.includes('Refunded on'), 'no stamp before the Refund')

    for (const confirmed of await refund(ivy)) await deliver(confirmed)
    const stamped = await onlyReceipt(ivy)
    const res = await harness.app.request(`/api/v1/me/receipts/${issued.id}/pdf`, { headers: ivy.headers })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/pdf')
    const text = await pdfText(new Uint8Array(await res.arrayBuffer()))
    assert.ok(text.includes(`Refunded on ${studioDay(stamped.refunded_at)}`), text)
    assert.ok(text.includes('S$150.00'), 'the figures are still printed')
  })

  test('INV-38 the provider redelivering the Refund leaves the stamp at the date it first landed', async () => {
    const ten = await tenPack('150.00')
    const max = await member()
    await buyAndPay(max, ten.id)
    const confirmations = await refund(max)
    for (const confirmed of confirmations) await deliver(confirmed)
    const first = await onlyReceipt(max)
    assert.equal(first.status, 'refunded')

    // The same deliveries again, and the same news under fresh event ids.
    for (const confirmed of confirmations) await deliver(confirmed)
    for (const confirmed of confirmations) await deliver(refundedEvent(confirmed.data.object.payment_intent))
    const again = await onlyReceipt(max)
    assert.equal(again.status, 'refunded')
    assert.equal(again.refunded_at, first.refunded_at, 'the same date')
  })

  test('INV-39 abandoning an Open Purchase issues no Receipt and stamps none of the member\'s others', async () => {
    const ten = await tenPack('150.00')
    const twenty = await tenPack('300.00')
    const oli = await member()
    await buyAndPay(oli, ten.id)
    const paid = await onlyReceipt(oli)

    const openId = await partPay(oli, twenty.id, 50, { brand: 'visa', last4: '4242' })
    const before = fake.callsTo('refunds.create').length
    await expectStatus(await post(studio.admin.headers, `/api/v1/portal/admin/purchases/${openId}/refund`, { reason: 'Member moved away' }), 200)
    const [returned] = fake.callsTo('refunds.create').slice(before)
    assert.ok(returned, 'the payment was sent back')
    await deliver(refundedEvent((returned.args[0] as { payment_intent: string }).payment_intent))
    const stillOpen = (await expectStatus(await harness.app.request('/api/v1/me/purchases/open', { headers: oli.headers }), 200)).purchases as any[]
    assert.deepEqual(stillOpen, [], 'the Purchase is Abandoned')

    const after = await onlyReceipt(oli)
    assert.equal(after.id, paid.id, 'still only the paid Purchase\'s Receipt')
    assert.equal(after.status, 'issued')
    assert.equal(after.refunded_at, null)
  })
})
