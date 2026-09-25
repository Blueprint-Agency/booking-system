import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import type * as Schema from '../db/schema'
import { inTenantContext, type TestApp } from './harness'
import type { StripeFake } from './stripe-fake'

/**
 * A paid checkout, delivered the way the payment provider delivers it: a
 * `checkout.session.completed` event handed to the webhook entry — the handler
 * the webhook route and the confirmation page's fallback both call — with the
 * Stripe fake answering the one call it makes back, the intent retrieve.
 *
 * For any test about what happens when a payment succeeds. Everything it makes
 * is named under one run, and `cleanup` takes it out again.
 *
 * Needs the fake installed before the first delivery (`installStripeFake`), and
 * the harness started before this is called.
 */

/** What the provider's charge says about how it was paid — `payment_method_details`. */
export type PaymentDetails = Partial<Stripe.Charge.PaymentMethodDetails> & { type: string }

export const cardPaid = (brand: string, last4: string, wallet?: string): PaymentDetails => ({
  type: 'card',
  card: {
    brand,
    last4,
    wallet: wallet ? ({ type: wallet } as Stripe.Charge.PaymentMethodDetails.Card.Wallet) : null,
  } as Stripe.Charge.PaymentMethodDetails.Card,
})

export const paidWith = (type: string): PaymentDetails => ({ type })

export function checkoutWebhook(harness: TestApp, schema: typeof Schema, fake: StripeFake) {
  const run = randomUUID().slice(0, 8)
  const tenantId = harness.tenants.one.id
  // The studio sells on its own account (#293): the one that signs the delivery
  // and that each payment is recorded against.
  const { accountId } = fake.ownAccount(harness.tenants.one)
  const clientIds: string[] = []
  const catalogueIds: string[] = []

  /**
   * What the provider says about each intent when it is retrieved: how it was
   * paid, or an Error for a retrieve that fails. An intent not named answers
   * with a charge that says nothing about its method.
   */
  const charges = new Map<string, PaymentDetails | Error>()
  fake.reply('paymentIntents.retrieve', (intentId: unknown) => {
    const details = charges.get(String(intentId))
    if (details instanceof Error) throw details
    return {
      id: intentId,
      latest_charge: {
        id: `ch_${String(intentId)}`,
        receipt_url: `https://pay.example.test/r/${String(intentId)}`,
        payment_method_details: details ?? null,
      },
    }
  })

  /** A member of the studio. `group` goes into their name, for a name search to find a set of them. */
  const member = async (group = ''): Promise<string> => {
    const [client] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId,
        email: `member-${clientIds.length + 1}@checkout-${run}.test`,
        name: `Member checkout-${run}${group ? ` ${group}` : ''} ${clientIds.length + 1}`,
        phone: '+6580000000',
        authUserId: `auth_checkout_${run}_${clientIds.length + 1}`,
      })
      .returning()
    clientIds.push(client!.id)
    return client!.id
  }

  /** A Credit Bundle in the catalogue, at `priceSgd`. */
  const bundle = async (priceSgd = '200.00'): Promise<string> => {
    const packages = inTenantContext(await import('../services/packages/class-packages'))
    const row = await packages.createClassPackage(tenantId, {
      name: `checkout-${run} Bundle ${catalogueIds.length + 1}`,
      kind: 'credit_bundle',
      credits: 5,
      validityDays: 30,
      priceSgd,
    })
    catalogueIds.push(row.id)
    return row.id
  }

  /** A Purchase opened ahead of its payments — what checkout does for a Part Payment. */
  const openPurchase = async (clientId: string, packageId: string, totalCents: number): Promise<string> => {
    const purchases = inTenantContext(await import('../services/billing/purchases'))
    const row = await purchases.openPurchase({
      tenantId,
      clientId,
      kind: 'class_package',
      totalCents,
      metadata: { kind: 'class_package', client_id: clientId, package_id: packageId },
    })
    return row.id
  }

  /**
   * One checkout session completing: `amountCents` captured on `intentId`,
   * paid the way `paid` says. `purchaseId` names the sale it pays part of;
   * without it the webhook opens one for the whole price.
   */
  const deliver = async (input: {
    clientId: string
    packageId: string
    intentId: string
    amountCents: number
    paid: PaymentDetails | Error
    purchaseId?: string
    priceSgd?: string
  }): Promise<void> => {
    charges.set(input.intentId, input.paid)
    const { handleStripeEvent } = await import('../services/billing/webhook-handler')
    const metadata: Record<string, string> = {
      kind: 'class_package',
      client_id: input.clientId,
      package_id: input.packageId,
      amount_sgd: input.priceSgd ?? (input.amountCents / 100).toFixed(2),
      tenant_id: tenantId,
    }
    if (input.purchaseId) metadata.purchase_id = input.purchaseId
    const event = {
      id: `evt_${input.intentId}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${input.intentId}`,
          object: 'checkout.session',
          payment_intent: input.intentId,
          amount_total: input.amountCents,
          metadata,
        },
      },
    } as unknown as Stripe.Event
    await handleStripeEvent(event, tenantId, accountId)
  }

  /** A fresh intent id, unique across runs. */
  const intent = (label: string) => `pi_${run}_${label}`

  const cleanup = async () => {
    if (clientIds.length > 0) {
      const clients = sql.join(clientIds.map(id => sql`${id}::uuid`), sql`, `)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE id IN (${clients})`)
    }
    for (const id of catalogueIds) {
      await harness.db.execute(sql`DELETE FROM class_packages WHERE id = ${id}::uuid`)
    }
  }

  /** The payment row the webhook wrote for an intent. */
  const payment = async (intentId: string) => {
    const [row] = await harness.db.execute<Record<string, unknown>>(
      sql`SELECT * FROM stripe_payments WHERE tenant_id = ${tenantId}::uuid AND payment_intent_id = ${intentId}`,
    )
    assert.ok(row, `no payment was recorded for ${intentId}`)
    return row
  }

  return {
    tenantId,
    accountId,
    /** This run's name. Every member made carries it, so a name search finds only them. */
    runName: `checkout-${run}`,
    /** How each intent was paid, as the next retrieve will say. Change it to change the answer. */
    charges,
    member,
    bundle,
    openPurchase,
    deliver,
    intent,
    payment,
    cleanup,
  }
}
