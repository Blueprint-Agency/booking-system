import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import type * as Schema from '../db/schema'
import { inTenantContext, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'

/**
 * A Corporate Request, made the only way a member can make one (#374): by paying
 * for a corporate package. The provider's `checkout.session.completed` for the
 * sale, delivered to the studio's own webhook endpoint, with the Stripe fake
 * standing in for the provider.
 *
 * For any test that needs a pending Corporate Request as its starting point.
 * Tests of the purchase itself are in `corporate-checkout.test.ts`.
 */

/** What the fake accepts as a valid provider signature. Anything else fails verification. */
export const PROVIDER_SIGNATURE = 't=1,v1=corporate-purchase'

/**
 * The fake provider, ready to sell: both fixture studios on accounts of their
 * own (#293), a Customer for whoever asks, a session for every checkout, and a
 * signature check that passes `PROVIDER_SIGNATURE` alone.
 */
export async function sellingFake(harness: TestApp): Promise<StripeFake> {
  const fake = (await import('./stripe-fake')).installStripeFake()
  fake.ownAccount(harness.tenants.one)
  fake.ownAccount(harness.tenants.two)
  fake.reply('customers.create', () => ({ id: `cus_${randomUUID().slice(0, 8)}` }))
  fake.reply('checkout.sessions.create', () => {
    const id = `cs_${randomUUID()}`
    return { id, url: `https://pay.example.test/${id}` }
  })
  fake.reply('webhooks.constructEvent', (body: unknown, signature: unknown) => {
    if (signature !== PROVIDER_SIGNATURE) throw new Error('No signatures found matching the expected signature for payload')
    return JSON.parse(String(body))
  })
  fake.reply('paymentIntents.retrieve', (id: unknown) => ({ id, latest_charge: { id: `ch_${String(id)}`, receipt_url: null } }))
  return fake
}

/** The session the last checkout asked the provider for. */
export function lastCheckoutSession(fake: StripeFake): {
  account: string | null
  params: { metadata: Record<string, string>; line_items: any[]; payment_method_types?: string[] }
} {
  const call = fake.callsTo('checkout.sessions.create').at(-1)
  assert.ok(call, 'no checkout session was created')
  return { account: call.account, params: call.args[0] as any }
}

/** What a session's lines add up to, in cents. */
export const sessionTotal = (params: { line_items: any[] }): number =>
  params.line_items.reduce((n: number, l: any) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0)

/** The provider's `checkout.session.completed` for a session, paid in full. */
export function completedEvent(
  params: { metadata: Record<string, string>; line_items: any[] },
  intent = `pi_${randomUUID()}`,
): { id: string; type: string; data: { object: Record<string, unknown> } } {
  return {
    id: `evt_${randomUUID()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${randomUUID()}`,
        payment_intent: intent,
        payment_status: 'paid',
        amount_total: sessionTotal(params),
        metadata: params.metadata,
      },
    },
  }
}

/** The provider's `charge.refunded` for a payment, returned in full (its dashboard or our own call). */
export function refundedEvent(intent: string, cents: number): { id: string; type: string; data: { object: Record<string, unknown> } } {
  return {
    id: `evt_${randomUUID()}`,
    type: 'charge.refunded',
    data: {
      object: {
        id: `ch_${randomUUID().slice(0, 12)}`,
        payment_intent: intent,
        amount: cents,
        amount_captured: cents,
        amount_refunded: cents,
        metadata: {},
      },
    },
  }
}

/** Deliver an event to a studio's own webhook endpoint, signed as the provider would. */
export const deliverTo = (harness: TestApp, slug: string, event: unknown, signature = PROVIDER_SIGNATURE) =>
  Promise.resolve(
    harness.app.request(stripeWebhookPath(slug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
      body: JSON.stringify(event),
    }),
  )

/**
 * Buy a corporate package and hand back the Corporate Request the payment made.
 *
 * The sale is priced and named by the real checkout service, and its payment
 * delivered over HTTP to the studio's own webhook endpoint — the path that
 * makes the request. The checkout route itself is skipped: it is rate-limited
 * per member (#142), and a file that needs a dozen requests for one member
 * would run out. `corporate-checkout.test.ts` covers the route.
 *
 * Installs the fake for the purchase and puts the real provider back after,
 * unless a fake is passed in, which is then used and left installed.
 */
export async function buyCorporatePackage(
  harness: TestApp,
  schema: typeof Schema,
  who: { clientId: string },
  tenant: { id: string; slug: string },
  packageId: string,
  existing?: StripeFake,
): Promise<string> {
  const fake = existing ?? (await sellingFake(harness))
  try {
    const requestsOf = async () =>
      new Set(
        (
          await harness.db
            .select({ id: schema.corporateRequests.id })
            .from(schema.corporateRequests)
            .where(and(eq(schema.corporateRequests.clientId, who.clientId), eq(schema.corporateRequests.corporatePackageId, packageId)))
        ).map(r => r.id),
      )
    const before = await requestsOf()

    const checkout = inTenantContext(await import('../services/corporate/checkout'))
    const quote = await checkout.beginCorporateCheckout(tenant.id, who.clientId, packageId)
    assert.equal(quote.outcome, 'checkout', 'the corporate package has a price to pay')
    if (quote.outcome !== 'checkout') throw new Error('unreachable')
    const params = {
      metadata: { ...quote.metadata, tenant_id: tenant.id },
      line_items: quote.lines.map(l => ({ price_data: { unit_amount: l.amountCents }, quantity: 1 })),
    }

    const delivered = await deliverTo(harness, tenant.slug, completedEvent(params))
    assert.equal(delivered.status, 200, `corporate payment delivery: ${await delivered.text()}`)

    const made = [...(await requestsOf())].filter(id => !before.has(id))
    assert.equal(made.length, 1, 'the payment made exactly one Corporate Request')
    return made[0]!
  } finally {
    if (!existing) fake.restore()
  }
}

/**
 * What a corporate purchase leaves behind besides the request — the payment,
 * the Purchase, the member as a provider Customer — for a file's cleanup to run
 * before it deletes the members. `clientIds` is a subquery naming them.
 */
export async function forgetPurchases(harness: TestApp, clientIds: SQL): Promise<void> {
  await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clientIds})`)
  await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clientIds})`)
  await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clientIds})`)
}
