import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { cardPaid, checkoutWebhook, paidWith } from './checkout-webhook'
import type { StripeFake } from './stripe-fake'

/**
 * How each payment was paid (#282): copied off the provider's charge when the
 * payment succeeds, backfilled for payments taken before that, and shown,
 * filtered and exported by Finance.
 */
describe('payment method', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let fake!: StripeFake
  let checkout!: ReturnType<typeof checkoutWebhook>
  let financeSvc!: typeof import('../services/finance/list')
  let csv!: typeof import('../services/finance/csv')
  let backfill!: typeof import('../services/billing/payment-methods')
  let staffId: string | null = null

  before(async () => {
    harness = await startTestApp()
    fake = (await import('./stripe-fake')).installStripeFake()
    const schema = await import('../db/schema')
    checkout = checkoutWebhook(harness, schema, fake)
    financeSvc = inTenantContext(await import('../services/finance/list'))
    csv = await import('../services/finance/csv')
    backfill = inTenantContext(await import('../services/billing/payment-methods'))
  })

  after(async () => {
    if (!harness) return
    fake.restore()
    if (staffId) {
      await harness.db.execute(sql`DELETE FROM manual_payroll_entries WHERE instructor_id = ${staffId}::uuid`)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE acted_by_staff_id = ${staffId}::uuid`)
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id = ${staffId}::uuid`)
    }
    await checkout.cleanup()
    if (staffId) {
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id = ${staffId}::uuid`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}::uuid`)
    }
    await harness.close()
  })

  /** One member buying one Credit Bundle in one payment, paid as `paid` says. */
  const buy = async (label: string, paid: Parameters<typeof checkout.deliver>[0]['paid'], group = '') => {
    const clientId = await checkout.member(group)
    const packageId = await checkout.bundle('200.00')
    const intentId = checkout.intent(label)
    await checkout.deliver({ clientId, packageId, intentId, amountCents: 20000, paid })
    return { clientId, packageId, intentId }
  }

  describe('recorded when the payment succeeds', () => {
    test('PAY-19 a card payment records card, its brand and its last four', async () => {
      const { intentId } = await buy('card', cardPaid('visa', '4242'))
      const row = await checkout.payment(intentId)
      assert.equal(row.status, 'succeeded')
      assert.equal(row.method, 'card')
      assert.equal(row.card_brand, 'visa')
      assert.equal(row.card_last4, '4242')
      assert.equal(row.wallet, null)
      assert.ok(row.receipt_url, 'the receipt still comes off the same charge')
    })

    test('PAY-20 a PayNow payment records paynow and no card', async () => {
      const { intentId } = await buy('paynow', paidWith('paynow'))
      const row = await checkout.payment(intentId)
      assert.equal(row.method, 'paynow')
      assert.equal(row.card_brand, null)
      assert.equal(row.card_last4, null)
    })

    test('PAY-21 a wallet payment records the wallet and the card brand behind it', async () => {
      const { intentId } = await buy('wallet', cardPaid('mastercard', '4444', 'apple_pay'))
      const row = await checkout.payment(intentId)
      assert.equal(row.method, 'card')
      assert.equal(row.wallet, 'apple_pay')
      assert.equal(row.card_brand, 'mastercard')
    })

    test('PAY-22 a failed retrieve still records the payment and grants, with no method', async () => {
      const { intentId, clientId } = await buy('down', new Error('provider down'))
      const row = await checkout.payment(intentId)
      assert.equal(row.status, 'succeeded', 'the payment is banked all the same')
      assert.equal(row.method, null)
      assert.ok(row.client_package_id, 'and what it bought was granted')
      const [plan] = await harness.db.execute<{ client_id: string }>(
        sql`SELECT client_id FROM client_packages WHERE id = ${String(row.client_package_id)}::uuid`,
      )
      assert.equal(plan?.client_id, clientId)
    })

    test('PAY-23 a Part Payment paid two ways records each method on its own payment', async () => {
      const clientId = await checkout.member()
      const packageId = await checkout.bundle('200.00')
      const purchaseId = await checkout.openPurchase(clientId, packageId, 20000)
      const first = checkout.intent('part-card')
      const second = checkout.intent('part-paynow')
      const part = { clientId, packageId, purchaseId, amountCents: 10000, priceSgd: '200.00' }
      await checkout.deliver({ ...part, intentId: first, paid: cardPaid('visa', '1111') })
      await checkout.deliver({ ...part, intentId: second, paid: paidWith('paynow') })

      const a = await checkout.payment(first)
      const b = await checkout.payment(second)
      assert.deepEqual([a.status, a.method, a.card_last4], ['succeeded', 'card', '1111'])
      assert.deepEqual([b.status, b.method, b.card_last4], ['succeeded', 'paynow', null])
    })
  })

  describe('Finance', () => {
    let window!: { from: Date; to: Date }
    let run!: string
    // Everyone this block makes is named in this group, and every read searches
    // for it — so the sales the tests above made are not in the answer.
    const FIN = 'fin'

    before(async () => {
      const from = new Date(Date.now() - 60_000)
      // A card sale, a PayNow sale and a Part Payment paid by card and PayNow.
      await buy('fin-card', cardPaid('visa', '4242'), FIN)
      await buy('fin-paynow', paidWith('paynow'), FIN)
      const clientId = await checkout.member(FIN)
      const packageId = await checkout.bundle('200.00')
      const purchaseId = await checkout.openPurchase(clientId, packageId, 20000)
      const part = { clientId, packageId, purchaseId, amountCents: 10000, priceSgd: '200.00' }
      await checkout.deliver({ ...part, intentId: checkout.intent('fin-part-1'), paid: cardPaid('visa', '5556') })
      await checkout.deliver({ ...part, intentId: checkout.intent('fin-part-2'), paid: paidWith('paynow') })

      // Money out, and a package nobody paid for.
      const [staff] = await harness.db.execute<{ id: string }>(sql`
        INSERT INTO staff_users (tenant_id, email, name, role, status, auth_user_id)
        VALUES (${checkout.tenantId}::uuid, ${`instructor@${checkout.runName}.test`}, ${`Instructor ${checkout.runName} ${FIN}`},
                'instructor', 'active', ${`auth_${checkout.runName}_instructor`})
        RETURNING id`)
      staffId = staff!.id
      await harness.db.execute(
        sql`INSERT INTO instructors (tenant_id, staff_user_id) VALUES (${checkout.tenantId}::uuid, ${staffId}::uuid)`,
      )
      const payroll = inTenantContext(await import('../services/payroll/list'))
      await payroll.createManualPayroll(
        checkout.tenantId,
        { instructorId: staffId, amountSgd: 40, label: 'Bonus', entryDate: new Date() },
        staffId,
      )
      const comp = inTenantContext(await import('../services/packages/complimentary'))
      await comp.giveComplimentaryPackage(checkout.tenantId, {
        clientId: await checkout.member(FIN),
        packageKind: 'class',
        packageId: await checkout.bundle('200.00'),
        reason: 'a class was cancelled at short notice',
        actedByStaffId: staffId,
      })
      window = { from, to: new Date(Date.now() + 60_000) }
      run = `${checkout.runName} ${FIN}`
    })

    const read = (filter: Parameters<typeof financeSvc.getFinance>[1] = {}) =>
      financeSvc.getFinance(checkout.tenantId, { ...window, q: run, ...filter })

    test('FIN-51 each money-in event lists its methods; money out and a Complimentary Package list none', async () => {
      const { rows } = await read()
      const sales = rows.filter(r => r.kind === 'purchase' && !r.complimentary)
      assert.equal(sales.length, 3)
      const labels = sales.map(r => r.method_label).sort()
      assert.deepEqual(labels, ['PayNow', 'Visa ··4242', 'Visa ··5556 + PayNow'])
      for (const r of sales) assert.ok(r.methods.length > 0)

      const partPaid = sales.find(r => r.methods.length === 2)!
      assert.deepEqual(partPaid.methods.map(m => m.category).sort(), ['card', 'paynow'])

      const given = rows.find(r => r.complimentary)
      assert.ok(given, 'the comp is listed')
      assert.deepEqual(given.methods, [])
      assert.equal(given.method_label, null)

      const out = rows.find(r => r.kind === 'manual')
      assert.ok(out, 'the Manual Entry is listed')
      assert.deepEqual(out.methods, [])
      assert.equal(out.method_label, null)
    })

    test('FIN-52 filtering by card returns only card-paid events, and a Part Payment matches either of its methods', async () => {
      const card = await read({ methods: ['card'] })
      assert.deepEqual(card.rows.map(r => r.method_label).sort(), ['Visa ··4242', 'Visa ··5556 + PayNow'])
      assert.ok(card.rows.every(r => r.methods.some(m => m.category === 'card')))

      const paynow = await read({ methods: ['paynow'] })
      assert.deepEqual(paynow.rows.map(r => r.method_label).sort(), ['PayNow', 'Visa ··5556 + PayNow'])

      const cash = await read({ methods: ['cash'] })
      assert.deepEqual(cash.rows, [], 'nothing was paid in cash, and money out never matches a method')
    })

    test('FIN-53 the CSV carries a Method column', async () => {
      const file = csv.financeCsv(await read())
      const [header, ...lines] = file.split('\r\n')
      const at = header!.split(',').indexOf('method')
      assert.ok(at >= 0, header)
      assert.ok(lines.some(l => l.includes('Visa ··4242')), file)
      assert.ok(lines.some(l => l.includes('Visa ··5556 + PayNow')), file)
    })

    test('FIN-54 a Refund carries the method of the payment it returned', async () => {
      const { intentId } = await buy('fin-refund', cardPaid('amex', '0005'), FIN)
      const { handleStripeEvent } = await import('../services/billing/webhook-handler')
      await handleStripeEvent({
        id: `evt_refund_${intentId}`,
        type: 'charge.refunded',
        data: {
          object: {
            id: `ch_${intentId}`,
            object: 'charge',
            payment_intent: intentId,
            amount: 20000,
            amount_captured: 20000,
            amount_refunded: 20000,
            metadata: { tenant_id: checkout.tenantId },
          },
        },
      } as unknown as Stripe.Event, checkout.tenantId, checkout.accountId)

      const { rows } = await financeSvc.getFinance(checkout.tenantId, {
        from: window.from,
        to: new Date(Date.now() + 60_000),
        q: run,
        types: ['refund'],
      })
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.method_label, 'Amex ··0005')
      assert.deepEqual(rows[0]!.methods.map(m => m.category), ['card'])
    })
  })

  describe('a sale no provider took', () => {
    test('FIN-55 a migrated Refund carries its Purchase’s offline method, with the old system’s name for it', async () => {
      const clientId = await checkout.member('offline')
      const refundedAt = new Date().toISOString()
      await harness.db.execute(sql`
        INSERT INTO purchases (tenant_id, client_id, kind, total_sgd, amount_paid_sgd, status,
                               settled_at, refunded_at, offline_method, offline_method_label, source_sale_id)
        VALUES (${checkout.tenantId}::uuid, ${clientId}::uuid, 'class_package', '120.00', '0.00', 'refunded',
                ${refundedAt}::timestamptz, ${refundedAt}::timestamptz, 'paynow', 'PayNow QR', '100234')`)

      const { rows } = await financeSvc.getFinance(checkout.tenantId, {
        q: `${checkout.runName} offline`,
        types: ['refund'],
      })
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.method_label, 'PayNow (PayNow QR)')
      assert.deepEqual(
        rows[0]!.methods.map(m => [m.category, m.label]),
        [['paynow', 'PayNow QR']],
      )

      const paynow = await financeSvc.getFinance(checkout.tenantId, {
        q: `${checkout.runName} offline`,
        methods: ['paynow'],
      })
      assert.equal(paynow.rows.length, 1, 'and the Method filter finds it')
    })
  })

  describe('backfill', () => {
    test('PAY-24 fills a past payment from its own account, and skips and counts one on a retired account', async () => {
      // Two payments taken before capture existed: neither has a method.
      const past = await buy('past', new Error('not read yet'))
      const retired = await buy('retired', new Error('not read yet'))
      assert.equal((await checkout.payment(past.intentId)).method, null)
      await harness.db.execute(
        sql`UPDATE stripe_payments SET provider_account_id = 'acct_retired' WHERE payment_intent_id = ${retired.intentId}`,
      )
      // The studio has since moved onto an account of its own, and the
      // platform's still holds the first payment.
      fake.credentials(checkout.tenantId, { accountId: 'acct_current' })
      checkout.charges.set(past.intentId, cardPaid('visa', '3000'))
      checkout.charges.set(retired.intentId, cardPaid('visa', '9999'))
      fake.calls.length = 0

      const result = await backfill.backfillPaymentMethods(checkout.tenantId)

      const filled = await checkout.payment(past.intentId)
      assert.deepEqual([filled.method, filled.card_brand, filled.card_last4], ['card', 'visa', '3000'])
      const pastCall = fake.callsTo('paymentIntents.retrieve').find(c => c.args[0] === past.intentId)
      assert.equal(pastCall?.account, null, "read on the platform's account, where it was taken")

      assert.equal((await checkout.payment(retired.intentId)).method, null)
      assert.ok(
        !fake.callsTo('paymentIntents.retrieve').some(c => c.args[0] === retired.intentId),
        'a payment on an account the studio no longer supplies is never asked for',
      )
      assert.ok(result.filled >= 1)
      assert.ok(result.skippedRetiredAccount >= 1)
    })
  })
})
