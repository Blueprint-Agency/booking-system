/**
 * Stripe webhook entry. Routes checkout.session.completed and charge.refunded events.
 *
 * checkout.session.completed:
 *   - insert stripe_payments row (pending → succeeded)
 *   - grant client_package (class or pt) OR insert workshop booking
 *   - trigger referral conversion check if applicable
 *
 * charge.refunded:
 *   - mark stripe_payments.status='refunded', refunded_at
 */
import Stripe from 'stripe'
import { db } from '../../db'
import { stripePayments } from '../../db/schema/ledger'
import { eq } from 'drizzle-orm'
import { grantPackage } from '../packages/purchase'
import { bookWorkshopPaid } from '../workshops/book'

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const meta = session.metadata ?? {}
    const kind = meta.kind as string | undefined
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.id  // fallback to checkout session ID if PI not yet resolved

    if (kind === 'class_package' || kind === 'pt_package') {
      const packageId = meta.package_id
      const clientId = meta.client_id
      if (!packageId || !clientId) return

      const amountSgd = meta.amount_sgd ?? String(((session.amount_total ?? 0) / 100).toFixed(2))

      // Idempotency — skip if we already processed this payment intent
      const [existing] = await db.select({ status: stripePayments.status })
        .from(stripePayments)
        .where(eq(stripePayments.paymentIntentId, paymentIntentId))
        .limit(1)
      if (existing?.status === 'succeeded') return

      // Insert the stripe_payments row (we now have the confirmed PaymentIntent ID)
      if (!existing) {
        await db.insert(stripePayments).values({
          paymentIntentId,
          amountSgd,
          kind: kind === 'class_package' ? 'class_package' : 'pt_package',
          clientId,
          status: 'pending',
        }).onConflictDoNothing()
      }

      const granted = await grantPackage({
        clientId,
        paymentIntentId,
        amountSgd,
        packageKind: kind === 'class_package' ? 'class' : 'pt',
        packageId,
      })

      // Mark the payment succeeded + link the granted package so a second
      // delivery (webhook AND sync-session both fire in local dev) short-circuits
      // at the `status === 'succeeded'` guard above instead of double-granting.
      await db
        .update(stripePayments)
        .set({ status: 'succeeded', clientPackageId: granted.clientPackageId })
        .where(eq(stripePayments.paymentIntentId, paymentIntentId))
      return
    }

    if (kind === 'workshop') {
      const workshopId = meta.workshop_id
      const workshopTierId = meta.workshop_tier_id
      const clientId = meta.client_id
      if (!workshopId || !workshopTierId || !clientId) return

      const amountSgd = meta.amount_sgd ?? String(((session.amount_total ?? 0) / 100).toFixed(2))
      const appliedPromotionId = meta.applied_promotion_id || null

      // Idempotency — skip if we already processed this payment intent
      const [existing] = await db
        .select({ status: stripePayments.status })
        .from(stripePayments)
        .where(eq(stripePayments.paymentIntentId, paymentIntentId))
        .limit(1)
      if (existing?.status === 'succeeded') return

      if (!existing) {
        await db
          .insert(stripePayments)
          .values({
            paymentIntentId,
            amountSgd,
            kind: 'workshop',
            clientId,
            status: 'pending',
          })
          .onConflictDoNothing()
      }

      await bookWorkshopPaid({
        clientId,
        workshopId,
        workshopTierId,
        paymentIntentId,
        amountSgd,
        appliedPromotionId,
      })
      return
    }
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge
    const paymentIntentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : null
    if (!paymentIntentId) return

    // Only flip the payment to 'refunded' on a FULL refund. A partial refund (e.g. a
    // manual goodwill refund issued from the Stripe dashboard while automated refunds
    // are still deferred) must not mark the whole payment refunded.
    // TODO(refunds slice): record partial refund amounts once the ledger supports it.
    const captured = charge.amount_captured ?? charge.amount ?? 0
    const fullyRefunded = captured > 0 && (charge.amount_refunded ?? 0) >= captured
    if (!fullyRefunded) return

    await db.update(stripePayments)
      .set({ status: 'refunded', refundedAt: new Date() })
      .where(eq(stripePayments.paymentIntentId, paymentIntentId))
  }
}
