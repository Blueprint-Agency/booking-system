/**
 * Stripe webhook entry. Routes payment_intent.succeeded and charge.refunded events.
 * On payment_intent.succeeded: grant package OR insert workshop booking, set
 * stripe_payments status + receipt_url, trigger referral conversion check.
 * On charge.refunded: mark stripe_payments status='refunded', refunded_at.
 */
export async function handleStripeEvent(_event: { type: string; data: { object: any } }): Promise<void> {
  throw new Error('not implemented')
}
