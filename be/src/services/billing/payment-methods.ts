/**
 * How a payment was paid (#282), as the provider's charge says it.
 *
 * Read off the charge the webhook already retrieves for the receipt URL, so
 * recording the method costs no call of its own, and a payment taken before
 * this shipped is filled in afterwards by `backfillPaymentMethods`.
 */
import type Stripe from 'stripe'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { stripePayments } from '../../db/schema/ledger'
import { providerAccountForTenant, stripeForProviderAccount } from '../../lib/stripe'
import { outbound, type RetryPolicy } from '../../lib/outbound'
import { reportError } from '../../shared/logger'

export type PaymentMethodPatch = Partial<
  Pick<typeof stripePayments.$inferInsert, 'method' | 'cardBrand' | 'cardLast4' | 'wallet'>
>

/**
 * The payment-row columns a charge fills. Empty when the charge says nothing
 * about its method — absent rather than null, so a redelivery that learns less
 * than an earlier one leaves what the earlier one wrote.
 */
export function methodPatch(charge: Stripe.Charge | string | null | undefined): PaymentMethodPatch {
  if (typeof charge !== 'object' || charge === null) return {}
  const details = charge.payment_method_details
  if (!details?.type) return {}
  const card = details.type === 'card' ? details.card : null
  return {
    method: details.type,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
    wallet: card?.wallet?.type ?? null,
  }
}

/**
 * The intent's latest charge, from the account the intent lives on (#97) —
 * null is the platform's. Null rather than throwing on any failure: a receipt
 * or a method is never worth failing a delivered purchase over.
 */
export async function latestCharge(
  tenantId: string,
  paymentIntentId: string,
  providerAccountId: string | null,
  retry?: RetryPolicy,
  /** Who asked, for the log line a failure writes. */
  scope = 'billing-webhook',
): Promise<Stripe.Charge | null> {
  try {
    const stripe = await stripeForProviderAccount(tenantId, providerAccountId)
    const intent = await outbound(
      'stripe',
      'paymentIntents.retrieve',
      () => stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] }),
      { retry },
    )
    const charge = intent.latest_charge
    return typeof charge === 'object' && charge !== null ? charge : null
  } catch (err) {
    reportError(err, 'latest charge lookup failed', { scope, paymentIntentId })
    return null
  }
}

export type MethodBackfillResult = {
  /** Payments whose method was read and written. */
  filled: number
  /**
   * Payments taken on a provider account the studio no longer supplies. Their
   * intents are unreachable with any key the platform holds, so they are left
   * alone and counted, never read with the studio's current key.
   */
  skippedRetiredAccount: number
  /** Payments the provider could not answer for, or answered without a method. */
  unread: number
}

/**
 * Fill the method on this studio's payments that succeeded before capture
 * existed (#282). A one-off, run by an operator — see `method-backfill-cli.ts`.
 *
 * Refunded payments are included: they succeeded first, and a Refund in
 * Finance shows the method of the payment it returned.
 *
 * Each payment is read on the account it was taken on. The platform's own
 * account (null) is always reachable; any other must be the studio's current
 * one, and a payment on an account it has since replaced is skipped.
 *
 * Runs inside the studio's Tenant context. Safe to run again: it only reads
 * payments that still have no method.
 */
export async function backfillPaymentMethods(
  tenantId: string,
  retry?: RetryPolicy,
): Promise<MethodBackfillResult> {
  const current = (await providerAccountForTenant(tenantId))?.accountId ?? null
  const rows = await db
    .select({
      id: stripePayments.id,
      paymentIntentId: stripePayments.paymentIntentId,
      providerAccountId: stripePayments.providerAccountId,
    })
    .from(stripePayments)
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        inArray(stripePayments.status, ['succeeded', 'refunded']),
        isNull(stripePayments.method),
      ),
    )

  const result: MethodBackfillResult = { filled: 0, skippedRetiredAccount: 0, unread: 0 }
  for (const row of rows) {
    if (row.providerAccountId != null && row.providerAccountId !== current) {
      result.skippedRetiredAccount += 1
      continue
    }
    const patch = methodPatch(
      await latestCharge(tenantId, row.paymentIntentId, row.providerAccountId, retry, 'billing-method-backfill'),
    )
    if (!patch.method) {
      result.unread += 1
      continue
    }
    await db
      .update(stripePayments)
      .set(patch)
      .where(and(eq(stripePayments.tenantId, tenantId), eq(stripePayments.id, row.id)))
    result.filled += 1
  }
  return result
}
