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
import { tenantForClient as routeToTenant, tenantForPaymentIntent } from '../../db/routing'
import { stripePayments } from '../../db/schema/ledger'
import { clients } from '../../db/schema/identity'
import { and, eq, ne } from 'drizzle-orm'
import { stripeForProviderAccount } from '../../lib/stripe'
import { outbound, type RetryPolicy } from '../../lib/outbound'
import { applyCrossLocationAddOn, grantPackage } from '../packages/purchase'
import { consumePromoCodeHold } from '../packages/promo-redemption'
import { unwindRefund } from './refunds'
import { openPurchase, purchaseById, recomputeBalance, type PurchaseRow } from './purchases'
import { purchaseKindFor } from './checkout-session'
import { toCents } from '../../shared/money'
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
export async function receiptUrlPatch(
  tenantId: string,
  paymentIntentId: string,
  /**
   * The account the intent lives on; null is the platform's (#97). Retrieved
   * from *there* rather than from wherever the studio sells today — a member
   * finishing a checkout begun before their studio moved holds an intent the
   * studio's new key cannot see.
   */
  providerAccountId: string | null,
  retry?: RetryPolicy,
): Promise<{ receiptUrl?: string }> {
  try {
    const stripe = await stripeForProviderAccount(tenantId, providerAccountId)
    const intent = await outbound(
      'stripe',
      'paymentIntents.retrieve',
      () => stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] }),
      { retry },
    )
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
 * What **this session** actually captured, which since #93 is not always the
 * price of what was bought.
 *
 * The ledger records money, and a part payment is one card's worth of it; the
 * Purchase is what says the sale cost more. Writing the full price on a payment
 * row that took half of it would make the Balance read as settled on the first
 * card, and the grant would fire against money the studio does not have.
 *
 * `amount_total` is the provider's own figure for the session and needs no
 * trusting — it is what the charge was, not what our metadata hoped it would
 * be. On every whole-price sale it equals the fallback exactly, which is why
 * this is safe to apply to sessions created long before part payment existed.
 */
const capturedSgd = (session: Stripe.Checkout.Session, fallbackSgd: string): string =>
  session.amount_total == null ? fallbackSgd : (session.amount_total / 100).toFixed(2)

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

/**
 * Which Purchase this payment is evidence of part of. **Never null**: since #92
 * the payment row's `purchase_id` is the only route from money to what the
 * money bought, so there is no shape of this that a payment may take.
 *
 * The session metadata is the normal answer. The payment row is the next one,
 * and it is not merely defensive: a checkout session created before Purchases
 * existed carries no `purchase_id`, but its payment row was given one by the
 * backfill (migration 0063), and without this that Purchase would sit `open`
 * with nothing paid while its payment succeeded — the one disagreement between
 * `amount_paid_sgd` and the ledger that this record exists to prevent.
 *
 * Failing both, one is opened here and closed by the recompute a moment later.
 * That is a session created before #91 shipped and completed after #92 did: one
 * payment for the whole sale, the only shape this system has ever taken, and
 * the same Purchase the backfill would have given it.
 *
 * A `purchase_id` that names nothing is the one case that does **not** get
 * that: it is far likelier to be a routing bug — the wrong Tenant's context —
 * than a legacy session, and minting a second sale record for money that
 * already has one is worse than failing. It throws, so the provider retries and
 * a human sees it.
 */
async function purchaseForPayment(
  tenantId: string,
  meta: Record<string, string>,
  paymentIntentId: string,
  fallback: { clientId: string; amountSgd: string },
): Promise<PurchaseRow> {
  if (meta.purchase_id) {
    const named = await purchaseById(tenantId, meta.purchase_id)
    if (!named) throw new NotFoundError('purchase_not_found', { purchaseId: meta.purchase_id })
    return named
  }
  const [row] = await db
    .select({ purchaseId: stripePayments.purchaseId })
    .from(stripePayments)
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        eq(stripePayments.paymentIntentId, paymentIntentId),
      ),
    )
    .limit(1)
  if (row?.purchaseId) {
    const recorded = await purchaseById(tenantId, row.purchaseId)
    if (recorded) return recorded
  }
  return openPurchase({
    tenantId,
    clientId: fallback.clientId,
    kind: purchaseKindFor(meta),
    totalCents: toCents(fallback.amountSgd),
    metadata: meta,
  })
}

/**
 * Write this payment against its Purchase, and say whether the grant may go on.
 *
 * It answers a question and it writes — deliberately, and in that order: the
 * amount paid is recomputed from the payment rows (never added to, which a
 * provider redelivery would double), and only then is the Balance compared with
 * zero. Every branch below asks exactly this before it delivers anything, so
 * **nothing is granted while a Balance is outstanding** is one call rather than
 * a rule each of the four product kinds has to remember.
 *
 * When it answers false the payment is banked here rather than after a grant,
 * because no grant is coming — and a row left `pending` forever would be money
 * the next recompute could not see. On the settling payment the flip stays
 * where it was, after the grant, which is what makes a crash between the two
 * recoverable by the provider's next redelivery.
 */
async function settleAndMayGrant(
  tenantId: string,
  purchase: PurchaseRow,
  paymentIntentId: string,
  providerAccountId: string | null,
): Promise<boolean> {
  const { settled } = await recomputeBalance(tenantId, purchase, paymentIntentId)
  if (settled) return true

  await bankPayment(
    tenantId,
    paymentIntentId,
    await receiptUrlPatch(tenantId, paymentIntentId, providerAccountId),
  )
  return false
}

/**
 * Bank the payment: mark it `succeeded` and write whatever the caller learned
 * along the way — the receipt URL, the package or booking it delivered.
 *
 * **Never over a refund.** The provider redelivers `checkout.session.completed`
 * for days, and the confirmation page's `sync-session` fallback replays it by
 * hand; a session whose charge was refunded still reports itself paid. Without
 * the predicate that replay would flip a refunded payment back to `succeeded`,
 * which since #92 is the column that says what a Refund still has to return —
 * so a refunded plan would offer its Refund button again and reach the provider
 * for money already given back.
 */
async function bankPayment(
  tenantId: string,
  paymentIntentId: string,
  patch: Partial<typeof stripePayments.$inferInsert> = {},
): Promise<void> {
  await db
    .update(stripePayments)
    .set({ status: 'succeeded', ...patch })
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        eq(stripePayments.paymentIntentId, paymentIntentId),
        ne(stripePayments.status, 'refunded'),
      ),
    )
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
 *
 * `retry` is for vendor calls made while handling the event. The webhook passes
 * one; the member's confirmation page, which reaches here on a request, does not.
 */
/**
 * Which studio does this event's body name, or null when it names none this
 * system can place.
 *
 * Every routing key the handler below uses, asked once and in one place, so the
 * ownership check and the work cannot disagree about whose event this is. Both
 * questions go through the owner-owned resolvers (migrations 0034 and 0043),
 * because a webhook has no Tenant context to read across.
 */
async function tenantNamedByEvent(event: Stripe.Event): Promise<string | null> {
  if (event.type === 'checkout.session.completed') {
    const clientId = (event.data.object as Stripe.Checkout.Session).metadata?.client_id
    return clientId ? routeToTenant(clientId) : null
  }
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge
    const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null
    return intentId ? tenantForPaymentIntent(intentId, charge.metadata?.tenant_id ?? null) : null
  }
  return null
}

/**
 * Refuse an event that arrived on one studio's endpoint and names another.
 *
 * The signature already established which studio sent this; this establishes
 * that the body agrees. They can only disagree if a studio's own endpoint
 * received an event belonging to somebody else's members — which, since a
 * studio holds its own signing secret, is a delivery it could have minted
 * itself. Without this, one studio's secret would be enough to unwind a
 * *different* studio's purchase, refund row and entitlements.
 *
 * A `null` name is not a mismatch: it is an event this system cannot place at
 * all, which the handlers below already treat as a silent no-op or a loud
 * `client_not_found`. Refusing it here would only change which error a human
 * reads.
 */
export function refuseWrongTenant(
  named: string | null,
  expectedTenantId: string | undefined,
  context: Record<string, unknown>,
): void {
  if (!expectedTenantId || !named || named === expectedTenantId) return
  throw new NotFoundError('webhook_tenant_mismatch', { ...context, expectedTenantId, named })
}

export async function handleStripeEvent(
  event: Stripe.Event,
  /**
   * The studio whose endpoint this delivery arrived on, when it arrived on one
   * (#100). A studio charging on its own account has its own webhook URL and
   * its own signing secret, so by this point the provider has already proved
   * *whose* delivery this is — and a body that routes to a different studio is
   * not a delivery this endpoint may act on.
   *
   * Absent for the platform account's shared endpoint, which is what a studio
   * that has supplied no credentials still uses, and where the body is the only
   * thing that names a studio.
   */
  expectedTenantId?: string,
  /**
   * The account that **signed** this delivery, which is the account the money
   * in it is on (#97). Null is the platform's own, and it is what the shared
   * endpoint passes.
   *
   * It comes from the signature check rather than from a fresh reading of the
   * studio's credentials, because the signature is where it was proved: the
   * secret that verified this body is that account's secret. Reading the
   * credentials here instead would be an unproved second answer to a question
   * already settled, and it would stamp the wrong account on a payment made
   * while credentials were being changed — leaving money nobody can refund.
   */
  providerAccountId: string | null = null,
  /**
   * `retry` is for vendor calls made while handling the event. The webhook
   * passes one; the member's confirmation page, which reaches here on a
   * request, does not.
   */
  { retry }: { retry?: RetryPolicy } = {},
): Promise<void> {
  // Every event type, not merely the one that grants: a refund unwinds a
  // purchase, and a studio able to unwind its neighbour's is the same breach
  // read backwards.
  const named = await tenantNamedByEvent(event)
  refuseWrongTenant(named, expectedTenantId, { eventId: event.id, eventType: event.type })

  if (event.type !== 'checkout.session.completed') {
    return dispatchStripeEvent(event, expectedTenantId, providerAccountId, retry)
  }

  const session = event.data.object as Stripe.Checkout.Session
  const clientId = (session.metadata ?? {}).client_id
  // No client id means our own checkout never ran — the same silent return the
  // per-kind branches below make on missing metadata.
  if (!clientId) return
  // By this point money has been captured. A charge whose member we cannot place
  // must land in front of a human, not vanish — see `tenantForClient` below.
  if (!named) throw new NotFoundError('client_not_found', { clientId })

  await withTenant(named, () =>
    dispatchStripeEvent(event, expectedTenantId, providerAccountId, retry),
  )
}

async function dispatchStripeEvent(
  event: Stripe.Event,
  expectedTenantId: string | undefined,
  providerAccountId: string | null,
  retry: RetryPolicy | undefined,
): Promise<void> {
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

      const purchase = await purchaseForPayment(tenantId, meta, paymentIntentId, {
        clientId,
        amountSgd: chargedSgd,
      })

      // Insert the stripe_payments row (we now have the confirmed PaymentIntent ID)
      if (!existing) {
        await db.insert(stripePayments).values({
          tenantId,
          paymentIntentId,
          purchaseId: purchase.id,
          // The ledger records what THIS session charged; the split across the
          // plan and its Add-On lives on the plan, and the price of the whole
          // sale lives on the Purchase.
          amountSgd: capturedSgd(session, chargedSgd),
          kind: kind === 'class_package' ? 'class_package' : 'pt_package',
          clientId,
          providerAccountId,
          status: 'pending',
        }).onConflictDoNothing()
      }

      // Payment succeeded, so the Hold becomes a Consumed Redemption, stamped
      // with the moment and the payment intent (§10 step 3).
      //
      // **At the FIRST payment, not at settlement** (#93). The price a Promo
      // Code cut is already frozen on the Purchase, so a member paying with two
      // cards is paying the discounted price whatever happens next; leaving the
      // Redemption Held until the second card would let its Hold lapse and put
      // a capped code's place back in the pool while somebody was mid-purchase
      // at the discounted price. It only ever touches a Held row, so the second
      // payment's delivery finds nothing to do.
      const promoCodeId = meta.promo_code_id || null
      if (promoCodeId) {
        await consumePromoCodeHold({ tenantId, promoCodeId, clientId, paymentIntentId })
      }

      // A sale paid in full at the first attempt — every sale before #93 — clears
      // here and carries on exactly as it did before Purchases existed. A part
      // payment stops, having banked its money and granted nothing.
      if (!(await settleAndMayGrant(tenantId, purchase, paymentIntentId, providerAccountId))) return

      const granted = await grantPackage(tenantId, {
        clientId,
        purchaseId: purchase.id,
        amountSgd,
        packageKind: kind === 'class_package' ? 'class' : 'pt',
        packageId,
        appliedPromotionId: meta.applied_promotion_id || null,
        appliedPromoCodeId: promoCodeId,
        // Home Location for an Unlimited Plan (§1). The checkout that puts it on
        // the session is #23; this only carries it through.
        locationId: meta.location_id || null,
        // The instructor the member picked for an Instructor-Bound PT package
        // (#109). Checkout put it on the session and refused the purchase if it
        // was wrong; this only carries it through.
        instructorId: meta.instructor_id || null,
        crossLocationPaidSgd: crossLocationSgd,
      })

      // Mark the payment succeeded + link the granted package so a second
      // delivery (webhook AND sync-session both fire in local dev) short-circuits
      // at the `status === 'succeeded'` guard above instead of double-granting.
      // The receipt URL lands in the same write — the column the confirmation
      // email reads (§13).
      await bankPayment(tenantId, paymentIntentId, {
        clientPackageId: granted.clientPackageId,
        ...(await receiptUrlPatch(tenantId, paymentIntentId, providerAccountId, retry)),
      })

      // One confirmation per purchase, however many times the provider retries:
      // only the delivery that inserted the row sends. The helper cannot throw.
      if (granted.created) await sendPackagePurchaseEmail(tenantId, granted.clientPackageId)
      return
    }

    // A Cross-Location Add-On bought on its own, against a plan the member
    // already holds (§5). No package is granted: the money fills a column on the
    // named plan. The plan's `purchase_id` is already taken by the plan's own
    // sale, so this payment sits in the ledger under a Purchase of its own,
    // pointing at the plan — `client_package_id` is what makes it findable.
    if (kind === 'cross_location_add_on') {
      const clientPackageId = meta.client_package_id
      const clientId = meta.client_id
      if (!clientPackageId || !clientId) return
      const tenantId = await tenantForClient(clientId)

      const amountSgd = meta.amount_sgd ?? String(((session.amount_total ?? 0) / 100).toFixed(2))

      const existing = await existingPayment(tenantId, paymentIntentId)
      if (existing?.status === 'succeeded') return

      const purchase = await purchaseForPayment(tenantId, meta, paymentIntentId, {
        clientId,
        amountSgd,
      })

      if (!existing) {
        await db
          .insert(stripePayments)
          .values({
            tenantId,
            paymentIntentId,
            purchaseId: purchase.id,
            amountSgd: capturedSgd(session, amountSgd),
            // The Add-On extends an Unlimited Plan, which is a class package.
            // The enum gains no fourth arm for it — Add-On revenue is read off
            // `client_packages.cross_location_paid_sgd`, not off this row (§15).
            kind: 'class_package',
            clientId,
            clientPackageId,
            providerAccountId,
            status: 'pending',
          })
          .onConflictDoNothing()
      }

      if (!(await settleAndMayGrant(tenantId, purchase, paymentIntentId, providerAccountId))) return

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

      await bankPayment(tenantId, paymentIntentId, {
        clientPackageId,
        ...(await receiptUrlPatch(tenantId, paymentIntentId, providerAccountId, retry)),
      })
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

      const purchase = await purchaseForPayment(tenantId, meta, paymentIntentId, {
        clientId,
        amountSgd,
      })

      if (!existing) {
        await db
          .insert(stripePayments)
          .values({
            tenantId,
            paymentIntentId,
            purchaseId: purchase.id,
            amountSgd: capturedSgd(session, amountSgd),
            kind: 'merch',
            clientId,
            providerAccountId,
            status: 'pending',
          })
          .onConflictDoNothing()
      }

      if (!(await settleAndMayGrant(tenantId, purchase, paymentIntentId, providerAccountId))) return

      await recordMerchOrder({
        tenantId,
        clientId,
        merchId,
        title: meta.merch_title || 'Merch',
        amountSgd,
        paymentIntentId,
      })

      await bankPayment(
        tenantId,
        paymentIntentId,
        await receiptUrlPatch(tenantId, paymentIntentId, providerAccountId, retry),
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

      const purchase = await purchaseForPayment(tenantId, meta, paymentIntentId, {
        clientId,
        amountSgd,
      })

      if (!existing) {
        await db
          .insert(stripePayments)
          .values({
            tenantId,
            paymentIntentId,
            purchaseId: purchase.id,
            amountSgd: capturedSgd(session, amountSgd),
            kind: 'workshop',
            clientId,
            providerAccountId,
            status: 'pending',
          })
          .onConflictDoNothing()
      }

      // Consumed at the first payment and the price locks with it — see the
      // package branch above for why it cannot wait for settlement.
      const promoCodeId = meta.promo_code_id || null
      if (promoCodeId) {
        await consumePromoCodeHold({ tenantId, promoCodeId, clientId, paymentIntentId })
      }

      // A workshop place is not held until the Balance reaches zero — the
      // booking is the grant, and it is not made while anything is outstanding.
      // The member is told so at checkout and again on their account page.
      //
      // ponytail: capacity is checked when checkout starts, and `bookWorkshopPaid`
      // deliberately does not re-check it — for a sale paid in one go the money is
      // already captured and the gap is seconds. A part payment stretches that gap
      // to however long the member takes to come back, so a Balance settled weeks
      // later can book past a workshop that has since filled, silently. #93's
      // acceptance criteria say only that no place is held and that the member is
      // told so, which is what ships here. Upgrade path: a capacity check on the
      // settling payment that refuses the booking and flags the Purchase for the
      // studio to refund — which needs a way to refund a Purchase that granted
      // nothing, and there is none yet (see `refundStatesFor`).
      if (!(await settleAndMayGrant(tenantId, purchase, paymentIntentId, providerAccountId))) return

      const booked = await bookWorkshopPaid(tenantId, {
        clientId,
        workshopId,
        workshopTierId,
        paymentIntentId,
        purchaseId: purchase.id,
        amountSgd,
        appliedPromotionId,
        appliedPromoCodeId: promoCodeId,
      })

      // Written before the email is composed — it is where `receipt_url` comes
      // from (§13).
      const receipt = await receiptUrlPatch(tenantId, paymentIntentId, providerAccountId, retry)
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
    //
    // A delivery that arrived on a studio's OWN endpoint carries a stronger
    // statement than the metadata does: the studio proved itself with its own
    // signing secret, which no metadata can. So it is preferred as the
    // tiebreaker — and, like the metadata, it can only ever choose among the
    // tenants the database already named, so it cannot route money into a
    // studio that holds no row for the intent.
    await unwindRefund(paymentIntentId, expectedTenantId ?? charge.metadata?.tenant_id ?? null)
  }
}
