/**
 * The one place a Stripe Checkout session is built. Every purchase — a plan, a
 * standalone Cross-Location Add-On, a workshop — is the same session with
 * different lines, so the currency, the line copy, the Hold expiry and the
 * one-quantity-per-line shape are settled here rather than three times over.
 *
 * What a purchase *costs* is not decided here: the caller's service prices it
 * and hands the lines over already priced.
 */
import type Stripe from 'stripe'
import { statementDescriptorSuffix, stripeForTenant } from '../../lib/stripe'
import { outbound } from '../../lib/outbound'
import { tenantDisplayName } from '../tenants/mail-identity'
import { BadRequestError } from '../../shared/errors'
import { attachCheckoutSession, openPurchase, type PurchaseKind } from './purchases'
import { partPaymentEnabled } from '../policy/update'
import { chargeableCents, refusePartPaymentWhenDisabled } from './part-payment'

export interface CheckoutLine {
  name: string
  description: string
  amountCents: number
}

/**
 * The line copy every product carries, and the code that cut it.
 *
 * The studio's name, not the platform's: this is what a member reads on the
 * checkout page and later on a card statement, and a charge from a name they
 * have never heard of is a chargeback. The caller passes the name because it
 * already knows its tenant — see `tenantDisplayName`.
 */
export const saleDescription = (studioName: string, promoCode?: string | null): string =>
  `${studioName}${promoCode ? ` · promo ${promoCode} applied` : ''}`

/**
 * Nothing left to charge: the purchase skips the payment provider entirely and
 * is granted immediately (§10) — a zeroing discount, or a product that was free
 * to begin with. One reading of it, because a second one is exactly what drifts
 * between the paths that grant a package and the ones that book a workshop.
 */
export const grantsWithoutPaying = (totalCents: number): boolean => totalCents <= 0

/** What a checkout service answers: grant it now, or charge these lines. */
export type CheckoutQuote<Granted> =
  | ({ outcome: 'granted' } & Granted)
  | {
      outcome: 'checkout'
      lines: CheckoutLine[]
      expiresAt: Date | null
      metadata: Record<string, string>
    }

export interface CheckoutSessionInput {
  /**
   * The studio the sale belongs to. Stamped on the session, the payment intent
   * and so the charge, because every studio sells on the one Stripe account:
   * without it the dashboard, an export and a future move to Stripe Connect
   * cannot tell one studio's money from another's. The webhook does not read
   * it — it routes on `client_id` through the owner-owned resolver (migration
   * 0034), which cannot be forged by anyone who can edit metadata.
   */
  tenantId: string
  email: string
  lines: CheckoutLine[]
  /**
   * When a capped Promo Code's Hold lapses — the session dies at the same
   * moment, so a member can never pay for a place that has already gone back in
   * the pool. Null keeps Stripe's standard 24 hours.
   */
  expiresAt: Date | null
  /** Read back by the webhook — it is the only record of what was bought. */
  metadata: Record<string, string>
  successUrl: string
  cancelUrl: string
  /**
   * Charge this much of the Purchase instead of the whole of it (#93).
   *
   * Null — the default, and every sale before this existed — charges the lines
   * as they stand. A number replaces them with **one** line naming the part
   * payment, because a split across four line items is arithmetic the member
   * would have to do on a Stripe page to check we had not made it up. What was
   * bought is still on the Purchase, and the member reads it on the page they
   * came from and on the one they land on.
   *
   * The caller has already put this through `chargeableCents` against a Balance
   * read from the database. Nothing here re-decides it.
   */
  partPaymentCents?: number | null
}

/**
 * The one line a part payment charges, and the sentence under it.
 *
 * Says three things the member cannot get anywhere else on a Stripe page: what
 * this instalment is towards, what will still be owed afterwards, and that
 * nothing is granted until that reaches zero. The last one is why a workshop
 * place is not held — see the account page, which says the same thing in the
 * place a member goes back to.
 */
export function partPaymentLine(
  lines: CheckoutLine[],
  chargeCents: number,
  outstandingAfterCents: number,
): CheckoutLine {
  const item = lines.length === 1 ? lines[0]!.name : 'your purchase'
  return {
    name: `Part payment towards ${item}`,
    description:
      outstandingAfterCents > 0
        ? `S$${(outstandingAfterCents / 100).toFixed(2)} will still be owed afterwards. Nothing is granted, and no place is held, until the balance reaches zero.`
        : 'This settles the balance in full.',
    amountCents: chargeCents,
  }
}

/**
 * The session Stripe is asked for, given the studio's name.
 *
 * Split out from the call so the shape of a checkout — its metadata, its
 * descriptor, its lines, its expiry — can be asserted without a provider and
 * without a database. The name is passed in because reading it is the caller's
 * database round trip, not a rule of the session.
 */
export function checkoutSessionParams(
  input: CheckoutSessionInput,
  studioName: string,
): Stripe.Checkout.SessionCreateParams {
  const suffix = statementDescriptorSuffix(studioName)
  const tenantMetadata = { tenant_id: input.tenantId, client_id: input.metadata.client_id ?? '' }
  const part = input.partPaymentCents ?? null
  // A part payment is one line for the instalment, not the shopping list: the
  // lines the caller passed describe what is still owed, and the difference
  // between that and the charge is what will be owed after this card.
  const lines =
    part == null
      ? input.lines
      : [partPaymentLine(input.lines, part, totalCents(input.lines) - part)]
  return {
    mode: 'payment',
    customer_email: input.email,
    // **Cards only on a part payment.** PayNow and the other one-shot methods
    // settle outside the session and can arrive minutes later or not at all; a
    // Balance being closed by a second instalment cannot wait on that, and a
    // member who has already paid once should not discover the rest of their
    // money is in limbo. The checkout page says so in words before they get here.
    ...(part == null ? {} : { payment_method_types: ['card' as const] }),
    // Metadata does not flow from a session to its intent on its own, and the
    // intent is what a refund, a dispute and a bank statement point at. The
    // studio's name on the statement is the same reason `saleDescription`
    // carries it: a charge from a name the member has never heard of is a
    // chargeback.
    payment_intent_data: {
      metadata: tenantMetadata,
      ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
    },
    line_items: lines.map(line => ({
      price_data: {
        currency: 'sgd' as const,
        unit_amount: line.amountCents,
        product_data: { name: line.name, description: line.description },
      },
      quantity: 1,
    })),
    ...(input.expiresAt
      ? { expires_at: Math.floor(input.expiresAt.getTime() / 1000) }
      : {}),
    metadata: { ...input.metadata, tenant_id: input.tenantId },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  }
}

/**
 * Which kind of Purchase a set of checkout metadata describes.
 *
 * Read off `kind`, the same field the webhook dispatches on, so the record and
 * the grant can never disagree about what was sold. A `kind` this does not
 * recognise is a checkout nothing could grant anyway, and is refused here
 * rather than becoming a Purchase with no meaning.
 */
export function purchaseKindFor(metadata: Record<string, string>): PurchaseKind {
  const kind = metadata.kind
  if (
    kind === 'class_package' ||
    kind === 'pt_package' ||
    kind === 'workshop' ||
    kind === 'merch' ||
    kind === 'cross_location_add_on'
  ) {
    return kind
  }
  throw new BadRequestError('checkout_kind_unknown', { kind: kind ?? null })
}

/** What the lines add up to — the Purchase's total, frozen at this moment. */
export const totalCents = (lines: CheckoutLine[]): number =>
  lines.reduce((sum, line) => sum + line.amountCents, 0)

/**
 * What to call this sale in one phrase, for a screen that has only the Purchase.
 *
 * The first line names the thing bought; the rest are extras attached to it — a
 * Cross-Location Add-On beside a plan — and "Unlimited 6 months + 1 more" is
 * what a member would say about it themselves.
 */
export const itemName = (lines: CheckoutLine[]): string => {
  const first = lines[0]?.name ?? 'Purchase'
  return lines.length > 1 ? `${first} + ${lines.length - 1} more` : first
}

/**
 * Who is buying. Refused here rather than left to become a foreign-key error
 * two statements later: every checkout service puts `client_id` on its
 * metadata, and a session without one is a sale with no buyer — which the
 * webhook would drop on the floor anyway, having nobody to grant to.
 */
export function buyerFor(metadata: Record<string, string>): string {
  const clientId = metadata.client_id
  if (!clientId) throw new BadRequestError('checkout_client_missing')
  return clientId
}

/**
 * Open the Purchase, then ask the provider for the session that pays it.
 *
 * In that order, and never the other way round: the Purchase is the record of
 * what is owed, and a session created before it could take money this system
 * has nowhere to put. `purchase_id` rides along in the metadata because the
 * webhook has nothing else to find the sale by — it is handed a session and an
 * intent, and every other route to the Purchase would be a guess.
 */
export async function createCheckoutSession(
  input: CheckoutSessionInput & {
    /**
     * What the member typed into the Part Payment box, in cents (#93), or null
     * for the ordinary whole-price checkout every sale before this took.
     *
     * Validated **here**, against the total these lines add up to, and refused
     * outright when the studio has Part Payment switched off — a route hands
     * the number over without opinions, and the browser is never the authority
     * on what may be charged.
     */
    requestedPartPaymentCents?: number | null
  },
): Promise<string | null> {
  const studioName = await tenantDisplayName(input.tenantId)
  const requested = input.requestedPartPaymentCents ?? null
  if (requested != null && !(await partPaymentEnabled(input.tenantId))) {
    refusePartPaymentWhenDisabled(requested)
  }
  const charge = requested == null ? null : chargeableCents(totalCents(input.lines), requested)
  const purchase = await openPurchase({
    tenantId: input.tenantId,
    clientId: buyerFor(input.metadata),
    kind: purchaseKindFor(input.metadata),
    // The whole price, always — never the part being charged now. The Purchase
    // is what is owed; a part payment is one card's worth of paying it.
    totalCents: totalCents(input.lines),
    // `item_name` is frozen here rather than asked of the catalogue later: the
    // account page and the portal both have to name an unfinished Purchase, and
    // a plan renamed or deleted in between would otherwise leave a member
    // looking at a debt for something with no name (#93).
    metadata: { ...input.metadata, item_name: itemName(input.lines) },
  })

  const stripe = await stripeForTenant(input.tenantId)
  const session = await outbound('stripe', 'checkout.sessions.create', () =>
    stripe.checkout.sessions.create(
      checkoutSessionParams(
        {
          ...input,
          metadata: { ...input.metadata, purchase_id: purchase.id },
          partPaymentCents: charge,
        },
        studioName,
      ),
    ),
  )
  await attachCheckoutSession(input.tenantId, purchase.id, session.id)
  return session.url
}
