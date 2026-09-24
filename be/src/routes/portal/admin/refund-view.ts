import type { IssuedRefund } from '../../../services/billing/refunds'

/**
 * What one press of a Refund button did (#275), in the same words from every
 * route that issues one. `complete` false means the provider refused a payment
 * after an earlier one went back — the admin is told part of the money moved,
 * rather than shown an error that reads as though nothing did.
 */
export function issuedRefundView(r: IssuedRefund) {
  return {
    complete: r.complete,
    requested_count: r.requestedCount,
    covered_payment_count: r.paymentCount,
  }
}
