/**
 * Stripe webhook entry. Routes checkout.session.completed and charge.refunded events.
 *
 * checkout.session.completed:
 *   - insert stripe_payments row (pending → succeeded)
 *   - grant client_package (class or pt) OR insert workshop booking
 *   - trigger referral conversion check if applicable
 *
 * charge.refunded (full refunds only — see §14 on partials):
 *   - the entire unwind, in ./refunds.ts
 */
import Stripe from 'stripe'
import { db } from '../../db'
import { stripePayments } from '../../db/schema/ledger'
import { eq } from 'drizzle-orm'
import { stripe } from '../../lib/stripe'
import { applyCrossLocationAddOn, grantPackage } from '../packages/purchase'
import { consumePromoCodeHold } from '../packages/promo-redemption'
import { unwindRefund } from './refunds'
import { bookWorkshopPaid } from '../workshops/book'
import { recordMerchOrder } from '../catalog/merch-orders'
import {
  sendPackagePurchaseEmail,
  sendWorkshopPurchaseEmail,
} from '../notifications/send-purchase-email'
import { reportError } from '../../shared/logger'

/**
 * The provider's own receipt for a payment (§13). `checkout.session.completed`
 * carries no charge object, so the intent is retrieved with its latest charge
 * expanded — that is the only place the receipt URL exists.
 *
 * Returns null rather than throwing: the confirmation email falls back to the
 * account page, and a receipt lookup must never fail a delivered purchase.
 */
async function receiptUrlPatch(
  paymentIntentId: string,
): Promise<{ receiptUrl?: string }> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    })
    const charge = intent.latest_charge
    const url = typeof charge === 'object' && charge !== null ? charge.receipt_url : null
    // Absent rather than null, so a redelivery that comes back empty leaves the
    // receipt an earlier delivery already wrote.
    return url ? { receiptUrl: url } : {}
  } catch (err) {
    reportError(err, 'receipt url lookup failed', { scope: 'billing-webhook', paymentIntentId })
    return {}
  }
}

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
      // The Add-On bought in the same session (§5): its own money, written into
      // its own column on the plan in the same insert. The plan's amount and the
      // Add-On's amount together are the charge, with no overlap.
      const crossLocationSgd = meta.cross_location_sgd || null
      const chargedSgd = (
        (Math.round(Number(amountSgd) * 100) + Math.round(Number(crossLocationSgd ?? 0) * 100)) /
        100
      ).toFixed(2)

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
          // The ledger records what was charged; the split lives on the plan.
          amountSgd: chargedSgd,
          kind: kind === 'class_package' ? 'class_package' : 'pt_package',
          clientId,
          status: 'pending',
        }).onConflictDoNothing()
      }

      // Payment succeeded, so the Hold becomes a Consumed Redemption, stamped
      // with the moment and the payment intent (§10 step 3).
      const promoCodeId = meta.promo_code_id || null
      if (promoCodeId) {
        await consumePromoCodeHold({ promoCodeId, clientId, paymentIntentId })
      }

      const granted = await grantPackage({
        clientId,
        paymentIntentId,
        amountSgd,
        packageKind: kind === 'class_package' ? 'class' : 'pt',
        packageId,
        appliedPromotionId: meta.applied_promotion_id || null,
        appliedPromoCodeId: promoCodeId,
        // Home Location for an Unlimited Plan (§1). The checkout that puts it on
        // the session is #23; this only carries it through.
        locationId: meta.location_id || null,
        crossLocationPaidSgd: crossLocationSgd,
      })

      // Mark the payment succeeded + link the granted package so a second
      // delivery (webhook AND sync-session both fire in local dev) short-circuits
      // at the `status === 'succeeded'` guard above instead of double-granting.
      // The receipt URL lands in the same write — the column the confirmation
      // email reads (§13).
      const receipt = await receiptUrlPatch(paymentIntentId)
      await db
        .update(stripePayments)
        .set({ status: 'succeeded', clientPackageId: granted.clientPackageId, ...receipt })
        .where(eq(stripePayments.paymentIntentId, paymentIntentId))

      // One confirmation per purchase, however many times the provider retries:
      // only the delivery that inserted the row sends. The helper cannot throw.
      if (granted.created) await sendPackagePurchaseEmail(granted.clientPackageId)
      return
    }

    // A Cross-Location Add-On bought on its own, against a plan the member
    // already holds (§5). No package is granted: the money fills a column on the
    // named plan. The plan's `stripe_payment_intent_id` is already taken by the
    // plan's own purchase, so this payment sits in the ledger pointing at the
    // plan instead — `client_package_id` is what makes it findable.
    if (kind === 'cross_location_add_on') {
      const clientPackageId = meta.client_package_id
      const clientId = meta.client_id
      if (!clientPackageId || !clientId) return

      const amountSgd = meta.amount_sgd ?? String(((session.amount_total ?? 0) / 100).toFixed(2))

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
            // The Add-On extends an Unlimited Plan, which is a class package.
            // The enum gains no fourth arm for it — Add-On revenue is read off
            // `client_packages.cross_location_paid_sgd`, not off this row (§15).
            kind: 'class_package',
            clientId,
            clientPackageId,
            status: 'pending',
          })
          .onConflictDoNothing()
      }

      const applied = await applyCrossLocationAddOn(clientId, clientPackageId, amountSgd)
      if (!applied) {
        // The plan already carried an Add-On by the time this payment landed —
        // two sessions were open at once and this one lost. The money was taken
        // and nothing was delivered, so it is named here rather than swallowed.
        // ponytail: still a log line. §14's refunds are admin-issued — the
        // button calls the provider and the webhook only unwinds — so an
        // automatic refund from inside this handler is a different decision
        // from the one that ticket made, and it is not one of its acceptance
        // criteria. Upgrade path: a follow-up that lets the webhook issue the
        // provider call for a payment that delivered nothing.
        console.error(
          `[billing] duplicate cross-location add-on payment ${paymentIntentId} on plan ${clientPackageId} — refund owed`,
        )
      }

      const receipt = await receiptUrlPatch(paymentIntentId)
      await db
        .update(stripePayments)
        .set({ status: 'succeeded', clientPackageId, ...receipt })
        .where(eq(stripePayments.paymentIntentId, paymentIntentId))
      // No confirmation email: an Add-On grants no package, and §13 names four
      // sending paths, none of them this one.
      return
    }

    // Merch. Nothing is granted and nothing is booked: the money is recorded and
    // the order becomes the line in the member's purchase history that the studio
    // hands the item over against.
    if (kind === 'merch') {
      const merchId = meta.merch_id
      const clientId = meta.client_id
      if (!merchId || !clientId) return

      const amountSgd = meta.amount_sgd ?? String(((session.amount_total ?? 0) / 100).toFixed(2))

      const [existing] = await db
        .select({ status: stripePayments.status })
        .from(stripePayments)
        .where(eq(stripePayments.paymentIntentId, paymentIntentId))
        .limit(1)
      if (existing?.status === 'succeeded') return

      if (!existing) {
        await db
          .insert(stripePayments)
          .values({ paymentIntentId, amountSgd, kind: 'merch', clientId, status: 'pending' })
          .onConflictDoNothing()
      }

      await recordMerchOrder({
        clientId,
        merchId,
        title: meta.merch_title || 'Merch',
        amountSgd,
        paymentIntentId,
      })

      const receipt = await receiptUrlPatch(paymentIntentId)
      await db
        .update(stripePayments)
        .set({ status: 'succeeded', ...receipt })
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

      const promoCodeId = meta.promo_code_id || null
      if (promoCodeId) {
        await consumePromoCodeHold({ promoCodeId, clientId, paymentIntentId })
      }

      const booked = await bookWorkshopPaid({
        clientId,
        workshopId,
        workshopTierId,
        paymentIntentId,
        amountSgd,
        appliedPromotionId,
        appliedPromoCodeId: promoCodeId,
      })

      // Written before the email is composed — it is where `receipt_url` comes
      // from (§13).
      const receipt = await receiptUrlPatch(paymentIntentId)
      if (receipt.receiptUrl) {
        await db
          .update(stripePayments)
          .set(receipt)
          .where(eq(stripePayments.paymentIntentId, paymentIntentId))
      }

      if (booked.created) await sendWorkshopPurchaseEmail(booked.bookingId)
      return
    }
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge
    const paymentIntentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : null
    if (!paymentIntentId) return

    // Partials are ignored, and that is **settled, not deferred** (§14). There is
    // no partial refund as a concept: a part-refund issued from the dashboard is
    // a pure money event that touches no entitlement — the member's plan keeps
    // running and their bookings stand — so there is nothing here to unwind and
    // no amount to record. Only a full refund voids anything.
    const captured = charge.amount_captured ?? charge.amount ?? 0
    const fullyRefunded = captured > 0 && (charge.amount_refunded ?? 0) >= captured
    if (!fullyRefunded) return

    // The whole unwind lives on this event, so a refund issued from the portal
    // and one issued from the provider's dashboard are the same operation. It is
    // idempotent — the provider retries.
    await unwindRefund(paymentIntentId)
  }
}
