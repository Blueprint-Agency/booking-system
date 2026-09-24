import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { eq, inArray, like } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, inTenantContext, SKIP_REASON, type TestApp } from './harness'
import { memberFixtures } from './member-fixtures'
import type { StripeFake } from './stripe-fake'

/**
 * What the portal's Refund screens are told (#275).
 *
 * A Refund lands only when the provider's `charge.refunded` does. Until then the
 * payment row still reads `succeeded`, so the member page showed it as Paid and
 * offered the Refund again. And a Refund over two payments that failed on the
 * second left the first returned with nothing on the page to say so. Against a
 * real database, because both are about what a second read sees after the
 * first request has committed.
 */

const DAY = 24 * 60 * 60 * 1000

describe('the state of a Refund between the button and the webhook', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let tenantId!: string
  let fake!: StripeFake
  let schema: typeof import('../db/schema')
  let refundsSvc: typeof import('../services/billing/refunds')
  let paymentsSvc: typeof import('../services/billing/member-payments')
  let fixtures!: ReturnType<typeof memberFixtures>

  const run = Date.now().toString(36)
  const DOMAIN = `rfdp-${run}.test`
  let staffId!: string
  let n = 0

  /** A member holding one credit bundle, bought through one Purchase settled by `amounts.length` payments. */
  async function paidPackage(
    amounts: string[],
    extra: { crossLocationPaidSgd?: string; promoCodeText?: string } = {},
  ): Promise<{ clientId: string; clientPackageId: string; purchaseId: string; intents: string[] }> {
    n += 1
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId, email: `member-${n}@${DOMAIN}`, name: `Refund Member ${n}`, phone: '+6580000000', authUserId: `auth_rfdp_${run}_${n}` })
      .returning()
    const total = amounts.reduce((sum, a) => sum + Number(a), 0).toFixed(2)
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId, clientId: client!.id, kind: 'class_package', totalSgd: total, amountPaidSgd: total, status: 'paid' })
      .returning({ id: schema.purchases.id })
    const intents = amounts.map((_, i) => `pi_rfdp_${run}_${n}_${i}`)
    for (const [i, amount] of amounts.entries()) {
      await harness.db.insert(schema.stripePayments).values({
        tenantId,
        paymentIntentId: intents[i]!,
        purchaseId: purchase!.id,
        amountSgd: amount,
        kind: 'class_package',
        clientId: client!.id,
        status: 'succeeded',
      })
    }
    const location = extra.crossLocationPaidSgd
      ? (await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenantId)))[0]
      : undefined
    const [pkg] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId,
        clientId: client!.id,
        kind: extra.crossLocationPaidSgd ? 'unlimited' : 'credit_bundle',
        locationId: location?.id ?? null,
        durationMonths: extra.crossLocationPaidSgd ? 3 : null,
        validityDays: extra.crossLocationPaidSgd ? null : 90,
        creditsOrSessionsRemaining: extra.crossLocationPaidSgd ? null : 10,
        crossLocationPaidSgd: extra.crossLocationPaidSgd ?? null,
        amountPaidSgd: total,
        listPriceSgd: total,
        purchaseId: purchase!.id,
      })
      .returning({ id: schema.clientPackages.id })
    if (extra.promoCodeText) {
      const [code] = await harness.db
        .insert(schema.promoCodes)
        .values({ tenantId, code: extra.promoCodeText, label: 'Launch', kind: 'percent', percentOff: 10, createdByStaffId: staffId })
        .returning({ id: schema.promoCodes.id })
      await harness.db.insert(schema.promoCodeRedemptions).values({
        tenantId,
        promoCodeId: code!.id,
        clientId: client!.id,
        status: 'consumed',
        heldUntil: new Date(),
        consumedAt: new Date(),
        stripePaymentIntentId: intents[0]!,
        discountSgd: '10.00',
      })
    }
    return { clientId: client!.id, clientPackageId: pkg!.id, purchaseId: purchase!.id, intents }
  }

  const refund = (m: { clientId: string; clientPackageId: string }) =>
    refundsSvc.issueRefund({ tenantId, clientId: m.clientId, clientPackageId: m.clientPackageId, reason: 'asked', actorStaffId: staffId })

  const stateOf = async (m: { clientId: string; clientPackageId: string }) =>
    (await refundsSvc.refundStatesFor(tenantId, m.clientId))[m.clientPackageId]!

  before(async () => {
    harness = await startTestApp()
    tenantId = harness.tenants.one.id
    schema = await import('../db/schema')
    refundsSvc = inTenantContext(await import('../services/billing/refunds'))
    paymentsSvc = inTenantContext(await import('../services/billing/member-payments'))
    fixtures = memberFixtures(harness, schema, DOMAIN)
    const { installStripeFake } = await import('./stripe-fake')
    fake = installStripeFake()
    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId, email: `admin@${DOMAIN}`, name: 'Refund Admin', role: 'admin', status: 'active', authUserId: `auth_rfdp_${run}_admin` })
      .returning()
    staffId = staff!.id
  })

  beforeEach(() => {
    fake.calls.length = 0
    fake.reply('refunds.create', {})
  })

  after(async () => {
    fake?.restore()
    if (!harness) return
    const clients = await harness.db.select({ id: schema.clients.id }).from(schema.clients).where(like(schema.clients.email, `%@${DOMAIN}`))
    const clientIds = clients.map(c => c.id)
    if (clientIds.length) {
      await harness.db.delete(schema.promoCodeRedemptions).where(inArray(schema.promoCodeRedemptions.clientId, clientIds))
      await harness.db.delete(schema.bookings).where(inArray(schema.bookings.clientId, clientIds))
      await harness.db.delete(schema.stripePayments).where(inArray(schema.stripePayments.clientId, clientIds))
      await harness.db.delete(schema.clientPackages).where(inArray(schema.clientPackages.clientId, clientIds))
      await harness.db.delete(schema.purchases).where(inArray(schema.purchases.clientId, clientIds))
    }
    await harness.db.delete(schema.promoCodes).where(like(schema.promoCodes.code, `RFDP${run.toUpperCase()}%`))
    await harness.db.delete(schema.auditLog).where(eq(schema.auditLog.actorStaffId, staffId))
    await fixtures.cleanup()
    await harness.close()
  })

  test('RFD-10 a Refund issued and not yet confirmed shows as processing and cannot be issued again', async () => {
    const m = await paidPackage(['150.00'])
    assert.strictEqual((await stateOf(m)).progress, 'none')

    const issued = await refund(m)
    assert.strictEqual(issued.complete, true)
    assert.strictEqual(fake.callsTo('refunds.create').length, 1)

    assert.strictEqual((await stateOf(m)).progress, 'processing', 'the package reads as a Refund on its way')
    const [payment] = await paymentsSvc.listMemberPayments(tenantId, m.clientId)
    assert.strictEqual(payment!.status, 'succeeded', 'the money is not back until the provider says so')
    assert.strictEqual(payment!.refundProcessing, true, 'and the payment row says a Refund is on its way')

    await assert.rejects(refund(m), (err: { code?: string }) => err.code === 'refund_processing')
    assert.strictEqual(fake.callsTo('refunds.create').length, 1, 'the provider is not asked twice')

    // The webhook lands: the Refund is done and nothing is processing any more.
    await refundsSvc.unwindRefund(m.intents[0]!, tenantId)
    const done = await stateOf(m)
    assert.strictEqual(done.refundable, false)
    assert.strictEqual(done.progress, 'none')
    const [after] = await paymentsSvc.listMemberPayments(tenantId, m.clientId)
    assert.strictEqual(after!.status, 'refunded')
    assert.strictEqual(after!.refundProcessing, false)
  })

  test('RFD-11 a Refund over two payments that fails on the second says part of it went through, and a retry returns only the rest', async () => {
    const m = await paidPackage(['100.00', '50.00'])
    let calls = 0
    fake.reply('refunds.create', () => {
      calls += 1
      if (calls === 2) throw new Error('card_declined')
      return {}
    })

    const issued = await refund(m)
    assert.strictEqual(issued.complete, false, 'the admin is told the Refund did not finish')
    assert.strictEqual(issued.requestedCount, 1)
    assert.strictEqual(issued.paymentCount, 2)
    assert.strictEqual((await stateOf(m)).progress, 'incomplete', 'and the package keeps saying so')

    // The first payment's `charge.refunded` lands. The Refund is still not
    // finished — one payment is still held and nobody has asked for it — so the
    // flag must survive the webhook rather than vanish with the returned payment.
    await refundsSvc.unwindRefund(m.intents[0]!, tenantId)
    assert.strictEqual((await stateOf(m)).progress, 'incomplete', 'the webhook for the first payment does not hide it')

    fake.reply('refunds.create', {})
    fake.calls.length = 0
    const retried = await refund(m)
    assert.strictEqual(retried.complete, true)
    const asked = fake.callsTo('refunds.create').map(c => (c.args[0] as { payment_intent: string }).payment_intent)
    assert.deepStrictEqual(asked, [m.intents[1]], 'only the payment not yet returned is asked for')
    assert.strictEqual((await stateOf(m)).progress, 'processing')
  })

  test('RFD-14 a Refund Stripe accepted and never confirmed stops blocking the button after a day', async () => {
    const m = await paidPackage(['80.00'])
    await refund(m)
    assert.strictEqual((await stateOf(m)).progress, 'processing')

    // Stripe failed it afterwards, or its webhook was lost: a day on, the ask is
    // no longer believed, and the Refund can be issued again.
    await harness.db
      .update(schema.stripePayments)
      .set({ refundRequestedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(schema.stripePayments.paymentIntentId, m.intents[0]!))
    assert.strictEqual((await stateOf(m)).progress, 'none')
    const [payment] = await paymentsSvc.listMemberPayments(tenantId, m.clientId)
    assert.strictEqual(payment!.refundProcessing, false)

    fake.calls.length = 0
    const again = await refund(m)
    assert.strictEqual(again.complete, true)
    assert.strictEqual(fake.callsTo('refunds.create').length, 1, 'the provider is asked again')
    assert.strictEqual((await stateOf(m)).progress, 'processing', 'and the new ask is timed from now')
  })

  test('RFD-12 the Refund names the amount going back, whether it carries the Add-On, the bookings it cancels and the Promo Code it frees', async () => {
    const m = await paidPackage(['260.00'], { crossLocationPaidSgd: '60.00', promoCodeText: `RFDP${run.toUpperCase()}A` })
    const soon = new Date(Date.now() + 3 * DAY)
    for (const startsAt of [soon, new Date(Date.now() + 5 * DAY)]) {
      const klass = await fixtures.insertRow('classes', tenantId, {
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 3_600_000).toISOString(),
        capacity_online: 5,
      })
      await fixtures.insertRow('bookings', tenantId, {
        kind: 'class',
        class_id: klass.id,
        client_id: m.clientId,
        client_package_id: m.clientPackageId,
        state: 'confirmed',
        check_in_state: 'pending',
      })
    }

    const state = await stateOf(m)
    assert.strictEqual(state.amountSgd, '260.00')
    assert.strictEqual(state.addOnIncluded, true, 'an Add-On bought with the plan was the same charge')
    assert.strictEqual(state.upcomingBookingCount, 2)
    assert.strictEqual(state.promoCode, `RFDP${run.toUpperCase()}A`)

    // An Add-On bought later is a Purchase of its own, and this Refund does not return it.
    const later = await paidPackage(['200.00'], { crossLocationPaidSgd: '60.00' })
    const [addOn] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId, clientId: later.clientId, kind: 'cross_location_add_on', totalSgd: '60.00', amountPaidSgd: '60.00', status: 'paid' })
      .returning({ id: schema.purchases.id })
    await harness.db.insert(schema.stripePayments).values({
      tenantId,
      paymentIntentId: `pi_rfdp_${run}_addon`,
      purchaseId: addOn!.id,
      amountSgd: '60.00',
      kind: 'class_package',
      clientId: later.clientId,
      clientPackageId: later.clientPackageId,
      status: 'succeeded',
    })
    const separate = await stateOf(later)
    assert.strictEqual(separate.addOnIncluded, false)
    assert.strictEqual(separate.upcomingBookingCount, 0)
    assert.strictEqual(separate.promoCode, null)

    const plain = await stateOf(await paidPackage(['90.00']))
    assert.strictEqual(plain.addOnIncluded, null, 'no Add-On, nothing to say about one')
  })
})
