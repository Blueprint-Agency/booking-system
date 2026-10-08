import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.receipt-backfill.test`

/**
 * Receipts for the sales made before Receipts existed (#394): the one-off CLI
 * `npm run receipts:backfill`, called here through its exported entry
 * function exactly as `main` calls it, against the test database.
 *
 * A sale from before the feature is a Purchase row as the code of the day
 * wrote it — paid, its payment banked, no lines and no Receipt — so that is
 * what the fixtures write. Every timestamp they carry is a fixed one in the
 * past, and the assertions compare against those literals, never against
 * this process's clock.
 *
 * What the backfill did is read where a member reads it, `/me/receipts`, and
 * in the mail capture. Each test has studios of its own, so the numbers it
 * reads are the whole of that studio's sequence. Written from the INV rows of
 * the Scenario Inventory (`docs/md/test-scenarios.md`).
 */
describe('the Receipt backfill', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let backfillReceipts!: typeof import('../services/receipts/backfill-cli').backfillReceipts

  type Studio = { id: string; slug: string }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as Record<string, any>) : {}
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  const studios: Studio[] = []
  async function newStudio(): Promise<Studio> {
    const slug = `backfill-${studios.length}-${run}`
    const [row] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO tenants (slug, name, timezone, status)
      VALUES (${slug}, ${`Backfill studio ${studios.length}`}, 'Asia/Singapore', 'active')
      RETURNING id
    `)
    const studio = { id: row!.id, slug }
    studios.push(studio)
    return studio
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
      .values({ tenantId: at.id, email, name: 'Mia Tan', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  type Payment = { amountSgd: string; at: string; refundedAt?: string; last4?: string }

  /**
   * A sale as it was recorded before Receipts: a Purchase opened at
   * `createdAt`, settled at `settledAt` (null on the oldest rows, which never
   * stamped it), with no lines, and its card payments — by default one
   * banked for the whole total when it was paid. A payment with `refundedAt`
   * went back to the card then.
   */
  async function earlierSale(
    at: Studio,
    who: Member,
    sale: {
      itemName: string
      totalSgd: string
      createdAt: string
      settledAt: string | null
      status?: 'paid' | 'open' | 'abandoned' | 'refunded'
      sourceSaleId?: string
      payments?: Payment[]
    },
  ): Promise<string> {
    const status = sale.status ?? 'paid'
    const payments = sale.payments ?? (status === 'paid' ? [{ amountSgd: sale.totalSgd, at: sale.settledAt ?? sale.createdAt }] : [])
    const held = status === 'paid' ? sale.totalSgd : status === 'open' ? (payments[0]?.amountSgd ?? '0.00') : '0.00'
    const [purchase] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO purchases (tenant_id, client_id, kind, total_sgd, amount_paid_sgd, status, metadata, created_at, settled_at, source_sale_id)
      VALUES (${at.id}, ${who.clientId}, 'class_package', ${sale.totalSgd}, ${held}, ${status},
              ${JSON.stringify({ item_name: sale.itemName })}::jsonb, ${sale.createdAt}, ${sale.settledAt}, ${sale.sourceSaleId ?? null})
      RETURNING id`)
    for (const p of payments) {
      await harness.db.execute(sql`
        INSERT INTO stripe_payments (tenant_id, purchase_id, client_id, payment_intent_id, amount_sgd, kind, status,
                                     method, card_brand, card_last4, created_at, refunded_at)
        VALUES (${at.id}, ${purchase!.id}, ${who.clientId}, ${`pi_backfill_${randomUUID().slice(0, 12)}`}, ${p.amountSgd},
                'class_package', ${p.refundedAt ? 'refunded' : 'succeeded'}, 'card', 'visa', ${p.last4 ?? '4242'},
                ${p.at}, ${p.refundedAt ?? null})`)
    }
    return purchase!.id
  }

  /** A studio Trial Pass at S$0.00, which a member takes on the spot: a sale made live, after Receipts exist. */
  let trials = 0
  async function freeTrial(at: Studio): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: at.id, name: `Free trial ${trials++}`, kind: 'trial', status: 'active', credits: 1, validityDays: 14, priceSgd: '0.00' })
      .returning({ id: schema.classPackages.id })
    return row!.id
  }

  async function takeLive(who: Member, packageId: string): Promise<void> {
    const res = await harness.app.request('/api/v1/me/checkout/package', {
      method: 'POST',
      headers: { ...who.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ package_kind: 'class', package_id: packageId }),
    })
    assert.equal((await expectStatus(res, 201)).outcome, 'granted')
  }

  /** Everything the member can read of their Receipts: the list and each one whole. */
  async function everythingOf(who: Member): Promise<unknown> {
    const listed = await receiptsOf(who)
    return { listed, receipts: await Promise.all(listed.map(r => receiptOf(who, r.id))) }
  }

  /* ── what the member sees ───────────────────────────────────────────── */

  const receiptsOf = async (who: Member) =>
    (await expectStatus(await harness.app.request('/api/v1/me/receipts', { headers: who.headers }), 200)).receipts as any[]

  const receiptOf = async (who: Member, id: string) =>
    expectStatus(await harness.app.request(`/api/v1/me/receipts/${id}`, { headers: who.headers }), 200)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ backfillReceipts } = await import('../services/receipts/backfill-cli'))
  })

  after(async () => {
    if (!harness) return
    try {
      const { deleteTenant } = await import('../services/tenants/delete')
      for (const studio of studios) {
        await harness.db.execute(sql`UPDATE tenants SET status = 'suspended' WHERE id = ${studio.id}`)
        await deleteTenant({ tenantId: studio.id, confirmSlug: studio.slug })
      }
    } finally {
      await harness.close()
    }
  })

  test('INV-47 a studio whose sales predate Receipts gets one each, numbered from R-000001 in the order they were paid, dated when paid, one line for the whole sale', async () => {
    const studio = await newStudio()
    const mia = await member(studio)
    // Opened in one order, paid in another; the oldest never stamped when it was settled.
    await earlierSale(studio, mia, { itemName: 'Ten pack', totalSgd: '150.00', createdAt: '2025-03-01T02:00:00Z', settledAt: '2025-03-20T02:00:00Z' })
    await earlierSale(studio, mia, { itemName: 'Five pack', totalSgd: '80.00', createdAt: '2025-03-05T02:00:00Z', settledAt: '2025-03-06T02:00:00Z' })
    await earlierSale(studio, mia, { itemName: 'Trial pass', totalSgd: '25.00', createdAt: '2025-01-10T02:00:00Z', settledAt: null })

    await backfillReceipts(studio.slug)

    const listed = await receiptsOf(mia)
    assert.deepEqual(
      listed.map(r => [r.number, r.item, r.issued_at, r.total_sgd, r.status]),
      [
        ['R-000003', 'Ten pack', '2025-03-20T02:00:00.000Z', '150.00', 'issued'],
        ['R-000002', 'Five pack', '2025-03-06T02:00:00.000Z', '80.00', 'issued'],
        ['R-000001', 'Trial pass', '2025-01-10T02:00:00.000Z', '25.00', 'issued'],
      ],
    )
    const ten = await receiptOf(mia, listed[0].id)
    assert.deepEqual(ten.lines, [
      { description: 'Ten pack', quantity: 1, list_price_sgd: '150.00', discount_sgd: '0.00', discounts: [], amount_sgd: '150.00' },
    ])
    assert.deepEqual([ten.subtotal_sgd, ten.discount_sgd, ten.total_sgd], ['150.00', '0.00', '150.00'])
    assert.deepEqual(ten.buyer, { name: 'Mia Tan', email: mia.email })
    assert.deepEqual(
      ten.payments.map((p: any) => [p.method, p.card_brand, p.card_last4, p.amount_sgd, p.paid_at]),
      [['card', 'visa', '4242', '150.00', '2025-03-20T02:00:00.000Z']],
    )
  })

  test('INV-48 run after Receipts went live, the backfill numbers on after the Receipts already issued, leaves them as they were, and a live sale afterwards takes the next number', async () => {
    const studio = await newStudio()
    const trial = await freeTrial(studio)
    const ana = await member(studio)
    const ben = await member(studio)
    await takeLive(ana, trial)
    const live = await everythingOf(ana)
    assert.deepEqual((live as any).listed.map((r: any) => r.number), ['R-000001'])

    // Both paid long before the live sale, and numbered after it all the same.
    await earlierSale(studio, ben, { itemName: 'Ten pack', totalSgd: '150.00', createdAt: '2025-06-01T02:00:00Z', settledAt: '2025-06-01T02:05:00Z' })
    await earlierSale(studio, ben, { itemName: 'Five pack', totalSgd: '80.00', createdAt: '2025-05-01T02:00:00Z', settledAt: '2025-05-01T02:05:00Z' })
    await backfillReceipts(studio.slug)

    assert.deepEqual(await everythingOf(ana), live, 'the Receipt already issued is untouched')
    assert.deepEqual(
      (await receiptsOf(ben)).map(r => [r.number, r.item]),
      [
        ['R-000003', 'Ten pack'],
        ['R-000002', 'Five pack'],
      ],
    )

    const cy = await member(studio)
    await takeLive(cy, trial)
    assert.deepEqual((await receiptsOf(cy)).map(r => r.number), ['R-000004'], 'the live sale continues the sequence')
  })

  test('INV-49 the backfill issues no Receipt for a migrated Purchase, an Open Purchase or an Abandoned Purchase', async () => {
    const studio = await newStudio()
    const dee = await member(studio)
    await earlierSale(studio, dee, {
      itemName: 'Migrated ten pack',
      totalSgd: '150.00',
      createdAt: '2024-11-01T02:00:00Z',
      settledAt: '2024-11-01T02:00:00Z',
      sourceSaleId: 'sale-1001',
      payments: [],
    })
    await earlierSale(studio, dee, {
      itemName: 'Part-paid pack',
      totalSgd: '200.00',
      createdAt: '2025-02-01T02:00:00Z',
      settledAt: null,
      status: 'open',
      payments: [{ amountSgd: '50.00', at: '2025-02-01T02:05:00Z' }],
    })
    await earlierSale(studio, dee, {
      itemName: 'Abandoned pack',
      totalSgd: '200.00',
      createdAt: '2025-02-02T02:00:00Z',
      settledAt: null,
      status: 'abandoned',
      payments: [{ amountSgd: '50.00', at: '2025-02-02T02:05:00Z', refundedAt: '2025-02-03T02:00:00Z' }],
    })
    await earlierSale(studio, dee, { itemName: 'Five pack', totalSgd: '80.00', createdAt: '2025-03-01T02:00:00Z', settledAt: '2025-03-01T02:05:00Z' })

    await backfillReceipts(studio.slug)

    assert.deepEqual(
      (await receiptsOf(dee)).map(r => [r.number, r.item]),
      [['R-000001', 'Five pack']],
      'only the sale paid here, numbered as if the others were not there',
    )
  })

  test('INV-50 a refunded sale gets its Receipt, as paid and stamped refunded on the day the last of its money went back', async () => {
    const studio = await newStudio()
    const eli = await member(studio)
    await earlierSale(studio, eli, {
      itemName: 'Twenty pack',
      totalSgd: '300.00',
      createdAt: '2025-04-01T02:00:00Z',
      settledAt: '2025-04-03T02:00:00Z',
      status: 'refunded',
      payments: [
        { amountSgd: '100.00', at: '2025-04-01T02:05:00Z', refundedAt: '2025-05-10T04:00:00Z', last4: '4242' },
        { amountSgd: '200.00', at: '2025-04-03T02:00:00Z', refundedAt: '2025-05-12T04:00:00Z', last4: '5555' },
      ],
    })

    await backfillReceipts(studio.slug)

    const [listed] = await receiptsOf(eli)
    assert.deepEqual([listed.number, listed.status], ['R-000001', 'refunded'])
    const receipt = await receiptOf(eli, listed.id)
    assert.equal(receipt.refunded_at, '2025-05-12T04:00:00.000Z')
    assert.equal(receipt.issued_at, '2025-04-03T02:00:00.000Z')
    assert.equal(receipt.total_sgd, '300.00')
    assert.deepEqual(
      receipt.payments.map((p: any) => [p.card_last4, p.amount_sgd]),
      [
        ['4242', '100.00'],
        ['5555', '200.00'],
      ],
      'both payments, as they were made',
    )
  })

  test('INV-51 the backfill sends no email', async () => {
    const { discardedMail } = await import('../lib/mailer')
    const studio = await newStudio()
    const fay = await member(studio)
    await earlierSale(studio, fay, { itemName: 'Ten pack', totalSgd: '150.00', createdAt: '2025-03-01T02:00:00Z', settledAt: '2025-03-01T02:05:00Z' })
    await earlierSale(studio, fay, {
      itemName: 'Five pack',
      totalSgd: '80.00',
      createdAt: '2025-03-02T02:00:00Z',
      settledAt: '2025-03-02T02:05:00Z',
      status: 'refunded',
      payments: [{ amountSgd: '80.00', at: '2025-03-02T02:05:00Z', refundedAt: '2025-03-09T02:00:00Z' }],
    })
    const mailBefore = discardedMail.length

    await backfillReceipts(studio.slug)

    assert.equal((await receiptsOf(fay)).length, 2, 'both were issued')
    assert.deepEqual(discardedMail.slice(mailBefore), [], 'nothing was sent')
    const logged = await harness.db.select().from(schema.emailLog).where(eq(schema.emailLog.recipientEmail, fay.email))
    assert.deepEqual(logged, [], 'nothing was logged as sent')
  })

  test('INV-52 a second run issues nothing and changes nothing', async () => {
    const studio = await newStudio()
    const gus = await member(studio)
    await earlierSale(studio, gus, { itemName: 'Ten pack', totalSgd: '150.00', createdAt: '2025-03-01T02:00:00Z', settledAt: '2025-03-01T02:05:00Z' })
    await earlierSale(studio, gus, {
      itemName: 'Five pack',
      totalSgd: '80.00',
      createdAt: '2025-03-02T02:00:00Z',
      settledAt: '2025-03-02T02:05:00Z',
      status: 'refunded',
      payments: [{ amountSgd: '80.00', at: '2025-03-02T02:05:00Z', refundedAt: '2025-03-09T02:00:00Z' }],
    })

    assert.deepEqual(await backfillReceipts(studio.slug), [{ slug: studio.slug, issued: 2, refunded: 1 }])
    const first = await everythingOf(gus)

    assert.deepEqual(await backfillReceipts(studio.slug), [{ slug: studio.slug, issued: 0, refunded: 0 }])
    assert.deepEqual(await everythingOf(gus), first)

    const trial = await freeTrial(studio)
    const hal = await member(studio)
    await takeLive(hal, trial)
    assert.deepEqual((await receiptsOf(hal)).map(r => r.number), ['R-000003'], 'the second run took no number')
  })

  test('INV-53 each studio is backfilled in its own Tenant context and its own sequence: a run naming one studio leaves another\'s sales as they were', async () => {
    const north = await newStudio()
    const south = await newStudio()
    const ida = await member(north)
    const jo = await member(south)
    await earlierSale(north, ida, { itemName: 'North ten pack', totalSgd: '150.00', createdAt: '2025-03-01T02:00:00Z', settledAt: '2025-03-01T02:05:00Z' })
    await earlierSale(south, jo, { itemName: 'South trial', totalSgd: '25.00', createdAt: '2025-01-01T02:00:00Z', settledAt: '2025-01-01T02:05:00Z' })
    await earlierSale(south, jo, { itemName: 'South five pack', totalSgd: '80.00', createdAt: '2025-04-01T02:00:00Z', settledAt: '2025-04-01T02:05:00Z' })

    assert.deepEqual(await backfillReceipts(north.slug), [{ slug: north.slug, issued: 1, refunded: 0 }])
    assert.deepEqual((await receiptsOf(ida)).map(r => [r.number, r.item]), [['R-000001', 'North ten pack']])
    assert.deepEqual(await receiptsOf(jo), [], 'the other studio is not touched')

    await backfillReceipts(south.slug)
    assert.deepEqual(
      (await receiptsOf(jo)).map(r => [r.number, r.item]),
      [
        ['R-000002', 'South five pack'],
        ['R-000001', 'South trial'],
      ],
      'its own sequence, from 1',
    )
    assert.deepEqual((await receiptsOf(ida)).map(r => r.number), ['R-000001'])
  })

  test('INV-54 a run naming a studio that does not exist is refused', async () => {
    await assert.rejects(backfillReceipts(`no-such-studio-${run}`), /no studio with slug/)
  })
})
