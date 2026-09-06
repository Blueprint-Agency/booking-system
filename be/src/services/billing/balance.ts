/**
 * What a Purchase still owes, decided without a database.
 *
 * A Purchase owns the money; a payment is evidence of part of it. The rule the
 * whole of #89 rests on — **nothing is granted until the Balance reaches
 * zero** — is one comparison, and it lives here so the webhook, the account
 * page and any later part-payment checkout cannot each carry their own
 * arithmetic and disagree about whether a member has finished paying.
 *
 * Everything is integer cents. `numeric` comes back from Postgres as a string,
 * and summing those as floats is how a purchase ends up one cent short of
 * settled and silently ungranted.
 */
import { toCents } from '../../shared/money'

/** A payment row as this module needs to see it — the ledger's own columns. */
export interface PaymentEvidence {
  paymentIntentId: string
  amountSgd: string
  status: 'pending' | 'succeeded' | 'refunded' | 'failed'
}

/**
 * What has actually been paid towards a Purchase.
 *
 * `creditingIntentId` is the payment the caller is processing right now. The
 * webhook inserts its row as `pending` and only flips it to `succeeded` after
 * the grant lands — that ordering is what lets a redelivery recover from a
 * crash mid-grant, so it is not up for negotiation. The intent being handled
 * has nonetheless been confirmed paid by the provider, so it counts. Naming it
 * explicitly is also what stops it being counted twice on a redelivery that
 * arrives after the flip: it is already in the `succeeded` set, and a set is
 * what this is.
 *
 * A `refunded` or `failed` row counts for nothing.
 */
export function amountPaidCents(
  payments: PaymentEvidence[],
  creditingIntentId?: string | null,
): number {
  const counted = new Map<string, number>()
  for (const payment of payments) {
    const credited =
      payment.status === 'succeeded' ||
      (Boolean(creditingIntentId) && payment.paymentIntentId === creditingIntentId)
    if (!credited) continue
    counted.set(payment.paymentIntentId, toCents(payment.amountSgd))
  }
  let total = 0
  for (const cents of counted.values()) total += cents
  return total
}

/** What is left to pay. Never negative — an overpayment owes nothing, not less than nothing. */
export function outstandingCents(totalCents: number, paidCents: number): number {
  return Math.max(0, totalCents - paidCents)
}

/**
 * The one question the grant depends on. A Purchase paid in full at the first
 * attempt — today's only shape — settles here exactly as it always did, because
 * one payment for the whole total leaves nothing outstanding.
 */
export function isSettled(totalCents: number, paidCents: number): boolean {
  return outstandingCents(totalCents, paidCents) === 0
}

/** Cents back to the `numeric(10,2)` string the ledger stores. */
export const centsToSgd = (cents: number): string => (cents / 100).toFixed(2)
