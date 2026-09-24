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

/**
 * The payments the provider is still holding — what a Refund has left to give
 * back, and what an issued Refund has to call the provider about.
 *
 * **`pending` counts as held**, which is the one thing here that is not
 * obvious. A payment row is only ever inserted once the provider has confirmed
 * the money; the flip to `succeeded` waits for the grant on purpose, so a row
 * stuck `pending` is a delivery that died between the two — real money, sitting
 * at the provider. Leaving it out would let the unwind void a plan the studio
 * has been paid for, and would refuse a Refund an admin could have issued
 * before this record existed. Only `refunded` (already back) and `failed`
 * (never taken) are out.
 *
 * That makes this a deliberately *wider* set than the one `amountPaidCents`
 * counts, and the asymmetry runs the safe way on both sides: money is credited
 * only once it is certain, and given back whenever it might still be there.
 *
 * **A Refund is complete only when this is empty.** A Purchase with some
 * payments returned and some not is a half-done Refund, and unwinding there
 * would take a member's plan away while the studio still held part of their
 * money.
 */
export function heldPayments<T extends { status: PaymentEvidence['status'] }>(
  payments: T[],
): T[] {
  return payments.filter(p => p.status === 'succeeded' || p.status === 'pending')
}

/**
 * How far a Refund has got, read off the Purchase's payments (#275).
 *
 * `processing` — the provider has been asked for every payment still held, and
 * the `charge.refunded` that finishes it has not arrived. There is nothing left
 * to ask for, so the portal withholds the Refund. `incomplete` — some of the
 * Purchase's money has gone back (or been asked for) and some is still held
 * with nobody asking: the provider refused a payment part-way through, and a
 * second press returns the rest. It is still one Refund of the whole — just not
 * finished. `none` — nothing is in flight.
 */
export type RefundProgress = 'none' | 'processing' | 'incomplete'

export interface RefundProgressCounts {
  /** Payments still at the provider — `succeeded` or `pending`. */
  held: number
  /** Of those, how many a Refund has asked for, recently enough to be believed. */
  heldRequested: number
  /** Payments already back — `refunded`. */
  refunded: number
}

export function refundProgress(c: RefundProgressCounts): RefundProgress {
  if (c.held === 0) return 'none'
  if (c.heldRequested >= c.held) return 'processing'
  return c.heldRequested > 0 || c.refunded > 0 ? 'incomplete' : 'none'
}

/**
 * How long a Refund the provider accepted counts as on its way.
 *
 * `charge.refunded` normally lands within seconds. A stamp older than this means
 * the Refund failed at the provider afterwards, or its webhook was lost — and
 * left alone it would read "Refund processing" and refuse every retry forever.
 * So it stops counting: the Refund is offered again, and the provider's own
 * idempotency key (which lives for 24 hours) has expired by then, so a retry is
 * a fresh request rather than a replay.
 */
export const REFUND_IN_FLIGHT_MS = 24 * 60 * 60 * 1000

export function refundInFlight(requestedAt: Date | null, now: Date = new Date()): boolean {
  return requestedAt != null && now.getTime() - requestedAt.getTime() < REFUND_IN_FLIGHT_MS
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
