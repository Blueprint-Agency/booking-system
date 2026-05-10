/**
 * Stripe refund issuance. v1: synchronous from refund-fanout.
 * Future: BullMQ worker handler keyed by booking_id for idempotent retry.
 */
export async function issueStripeRefund(
  _paymentIntentId: string,
  _bookingId: string,
): Promise<{ refundId: string }> {
  throw new Error('not implemented')
}
