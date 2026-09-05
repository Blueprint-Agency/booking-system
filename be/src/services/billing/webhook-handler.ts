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
import { db, withTenant } from '../../db'
import { tenantForClient as routeToTenant } from '../../db/routing'
import { stripePayments } from '../../db/schema/ledger'
import { clients } from '../../db/schema/identity'
import { and, eq } from 'drizzle-orm'
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
import { NotFoundError } from '../../shared/errors'

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

/**
 * Which Tenant a completed checkout belongs to.
 *
 * Read off the buyer, not off the session metadata. The provider calls this
 * endpoint with no tenant header and no way to be given one — its own hostname
 * carries none either — and a member belongs to exactly one studio, so the
 * `clients` row is the honest answer. It also survives sessions created before
 * this shipped, which metadata would not.
 *
 * **Throws** when the id names nobody, rather than returning quietly. By this
 * point money has been captured, and a silent return would leave no payment
 * row, no package, no email and a 200 back to the provider — a charge that
 * simply vanishes. Failing loudly makes the provider retry and puts the event
 * in front of a human. That is the opposite of the missing-metadata case above,
 * which returns silently because it means our own checkout never ran.
 */
async function tenantForClient(clientId: string): Promise<string> {
  const [row] = await db
    .select({ tenantId: clients.tenantId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)
  if (!row?.tenantId) {
    throw new NotFoundError('client_not_found', { clientId })
  }
  return row.tenantId
}

/** The payment this system already recorded for an intent, within its Tenant. */
async function existingPayment(tenantId: string, paymentIntentId: string) {
  const [row] = await db
    .select({ status: stripePayments.status })
    .from(stripePayments)
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        eq(stripePayments.paymentIntentId, paymentIntentId),
      ),
    )
    .limit(1)
  return row
}

/**
 * Route the event to its studio, then handle it.
 *
 * A provider webhook is the one entry point with no tenant to read: one
 * endpoint, a hostname carrying none, and a signed body naming a client and an
 * intent. With the tenant policies live (migration 0033) the handler below
 * cannot find its own way — every query it makes is refused until a context is
 * open — so the single cross-tenant question is asked through the owner-owned
 * resolver and everything else runs inside the answer.
 *
 * `charge.refunded` is deliberately NOT wrapped here: `unwindRefund` routes
 * itself off the payment intent, because the same unwind is reached from the
 * portal's refund button and from the provider's dashboard, and it has to land
 * in the same studio either way.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type !== 'checkout.session.completed') return dispatchStripeEvent(event)

  const session = event.data.object as Stripe.Checkout.Session
  const clientId = (session.metadata ?? {}).client_id
  // No client id means our own checkout never ran — the same silent return the
  // per-kind branches below make on missing metadata.
  if (!clientId) return
  const tenantId = await routeToTenant(clientId)
  // By this point money has been captured. A charge whose member we cannot place
  // must land in front of a human, not vanish — see `tenantForClient` below.
  if (!tenantId) throw new NotFoundError('client_not_found', { clientId })

  await withTenant(tenantId, () => dispatchStripeEvent(event))
}

async function dispatchStripeEvent(event: Stripe.Event): Promise<void> {
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
      const tenantId = await tenantForClient(clientId)

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
      const existing = await existingPayment(tenantId, paymentIntentId)
      if (existing?.status === 'succeeded') return

      // Insert the stripe_payments row (we now have the confirmed PaymentIntent ID)
      if (!existing) {
        await db.insert(stripePayments).values({
          tenantId,
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
        await consumePromoCodeHold({ tenantId, promoCodeId, clientId, paymentIntentId })
      }

      const granted = await grantPackage(tenantId, {
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
        .where(
          and(
            eq(stripePayments.tenantId, tenantId),
            eq(stripePayments.paymentIntentId, paymentIntentId),
          ),
        )

      // One confirmation per purchase, however many times the provider retries:
      // only the delivery that inserted the row sends. The helper cannot throw.
      if (granted.created) await sendPackagePurchaseEmail(tenantId, granted.clientPackageId)
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
      const tenantId = await tenantForClient(clientId)

      const amountSgd = meta.amount_sgd ?? String(((session.amount_total ?? 0) / 100).toFixed(2))

      const existing = await existingPayment(tenantId, paymentIntentId)
      if (existing?.status === 'succeeded') return

      if (!existing) {
        await db
          .insert(stripePayments)
          .values({
            tenantId,
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

      const applied = await applyCrossLocationAddOn(
        tenantId,
        clientId,
        clientPackageId,
        amountSgd,
      )
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
        .where(
          and(
            eq(stripePayments.tenantId, tenantId),
            eq(stripePayments.paymentIntentId, paymentIntentId),
          ),
        )
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
      const tenantId = await tenantForClient(clientId)

      const amountSgd = meta.amount_sgd ?? String(((session.amount_total ?? 0) / 100).toFixed(2))

      const existing = await existingPayment(tenantId, paymentIntentId)
      if (existing?.status === 'succeeded') return

      if (!existing) {
        await db
          .insert(stripePayments)
          .values({
            tenantId,
            paymentIntentId,
            amountSgd,
            kind: 'merch',
            clientId,
            status: 'pending',
          })
          .onConflictDoNothing()
      }

      await recordMerchOrder({
        tenantId,
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
        .where(
          and(
            eq(stripePayments.tenantId, tenantId),
            eq(stripePayments.paymentIntentId, paymentIntentId),
          ),
        )
      return
    }

    if (kind === 'workshop') {
      const workshopId = meta.workshop_id
      const workshopTierId = meta.workshop_tier_id
      const clientId = meta.client_id
      if (!workshopId || !workshopTierId || !clientId) return
      const tenantId = await tenantForClient(clientId)

      const amountSgd = meta.amount_sgd ?? String(((session.amount_total ?? 0) / 100).toFixed(2))
      const appliedPromotionId = meta.applied_promotion_id || null

      // Idempotency — skip if we already processed this payment intent
      const existing = await existingPayment(tenantId, paymentIntentId)
      if (existing?.status === 'succeeded') return

      if (!existing) {
        await db
          .insert(stripePayments)
          .values({
            tenantId,
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
        await consumePromoCodeHold({ tenantId, promoCodeId, clientId, paymentIntentId })
      }

      const booked = await bookWorkshopPaid(tenantId, {
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
          .where(
            and(
              eq(stripePayments.tenantId, tenantId),
              eq(stripePayments.paymentIntentId, paymentIntentId),
            ),
          )
      }

      if (booked.created) await sendWorkshopPurchaseEmail(tenantId, booked.bookingId)
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
    //
    // The charge's own `tenant_id` is passed as a tiebreaker, not as the
    // routing key. One intent can belong to two studios — an archive restored
    // beside its source keeps the intent id in both (migration 0040) — and the
    // resolver cannot pick between them. Stripe copies the intent's metadata
    // onto the charge, and this backend wrote that metadata with its own secret
    // key at checkout, so it is the one statement that says which of the two
    // the money was actually taken for. It is only ever consulted to choose
    // among the tenants the database already named.
    await unwindRefund(paymentIntentId, charge.metadata?.tenant_id ?? null)
  }
}
