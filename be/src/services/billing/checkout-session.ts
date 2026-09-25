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
import { requireProviderAccount, stripeForTenant } from '../../lib/stripe'
import { outbound } from '../../lib/outbound'
import { BadRequestError } from '../../shared/errors'
import { attachCheckoutSession, openPurchase, type PurchaseKind } from './purchases'
import { partPaymentEnabled } from '../policy/update'
import { chargeableCents, refusePartPaymentWhenDisabled } from './part-payment'
import { createSessionSurvivingStaleCustomer, providerCustomerFor } from './payment-customers'

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
   * and so the charge — still stamped now that every studio charges on its own
   * account (#293), because the payments recorded on the platform's shared one
   * before that are told apart by nothing else, and a dispute or an export is
   * easier to read when every charge names its studio. The webhook does not read
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
  /**
   * The member as a Customer on the provider account this charge is on (#185),
   * or null where they are not one yet.
   *
   * It is what makes a second card unnecessary: a session carrying a Customer
   * lists that Customer's saved cards on the hosted page for the member to pick
   * from, and a session carrying only an email cannot, because there is nothing
   * for a card to have been saved against.
   *
   * **Per account, never per member alone.** A Customer id is meaningless on an
   * account other than the one it was made on, so which id this is depends on
   * where the studio sells today (#100) — see `providerCustomerFor`, which is
   * the only thing allowed to answer that.
   */
  customerId?: string | null
  /**
   * Did the member tick "save this card"? (#185)
   *
   * Consent, carried from our own checkout page rather than assumed. This API
   * version has no checkbox of Stripe's own — `saved_payment_method_options`
   * arrived after it — so the box is ours, and this is what it said. False, and
   * the card pays and is forgotten.
   */
  saveCard?: boolean
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
 * The provider's session parameters, plus `adaptive_pricing`, which the Stripe
 * API accepts but this SDK version's types do not yet declare.
 */
export type CheckoutSessionParams = Stripe.Checkout.SessionCreateParams & {
  adaptive_pricing?: { enabled: boolean }
}

/**
 * The session Stripe is asked for.
 *
 * Split out from the call so the shape of a checkout — its metadata, its
 * lines, its expiry — can be asserted without a provider and without a
 * database.
 *
 * No statement descriptor suffix (#293). Every charge is on the studio's own
 * account, whose statement already carries the studio's name, and the
 * 22-character limit would be measured against that account's prefix — which
 * this platform does not know. A suffix could only ever cost a refused charge.
 */
export function checkoutSessionParams(
  input: CheckoutSessionInput,
): CheckoutSessionParams {
  const tenantMetadata = { tenant_id: input.tenantId, client_id: input.metadata.client_id ?? '' }
  const part = input.partPaymentCents ?? null
  // A part payment is one line for the instalment, not the shopping list: the
  // lines the caller passed describe what is still owed, and the difference
  // between that and the charge is what will be owed after this card.
  const lines =
    part == null
      ? input.lines
      : [partPaymentLine(input.lines, part, totalCents(input.lines) - part)]
  const customer = input.customerId ?? null
  // Keeping the card needs somewhere to keep it. Without a Customer there is
  // nothing for the provider to attach a payment method to, so consent given on
  // a session that carries no Customer is consent to nothing — and asking for
  // it anyway is how a checkout fails at the provider for a reason the member
  // cannot possibly act on.
  const keepCard = Boolean(input.saveCard) && customer !== null
  /**
   * **Cards only on a session that keeps the card**, said out loud rather than
   * left to the provider.
   *
   * `setup_future_usage` makes the provider drop every method it cannot save,
   * so ticking "save this card" would quietly take PayNow off a full-price
   * checkout — a member losing the method they came to use, with no sentence
   * anywhere explaining why. Pinning it here makes that a stated rule with a
   * matching sentence on our own page, and stops the provider reshaping the
   * page behind us; on an account with an explicit method configuration it is
   * also the difference between a narrowed page and a refused session.
   *
   * PayNow on a *full* payment is untouched wherever the box is not ticked,
   * which is the default and every checkout before this existed.
   */
  const cardsOnly = part != null || keepCard
  return {
    mode: 'payment',
    // **SGD only.** Adaptive Pricing is on by default for a Stripe account, and
    // it offers a foreign card its home currency at Stripe's exchange rate — a
    // Malaysian card is shown an MYR price beside the SGD one. Every price, total,
    // refund and Balance on this platform is in SGD, so a member paying in another
    // currency would be charged a number no screen of ours ever showed them.
    adaptive_pricing: { enabled: false },
    // A Customer **instead of** an email, never beside it: the provider refuses
    // a session carrying both. The member's address is already on the Customer,
    // which is where it came from.
    ...(customer ? { customer } : { customer_email: input.email }),
    // **Cards only on a part payment.** PayNow and the other one-shot methods
    // settle outside the session and can arrive minutes later or not at all; a
    // Balance being closed by a second instalment cannot wait on that, and a
    // member who has already paid once should not discover the rest of their
    // money is in limbo. The checkout page says so in words before they get here.
    // A session that keeps the card is cards-only too — see `cardsOnly`.
    ...(cardsOnly ? { payment_method_types: ['card' as const] } : {}),
    // Metadata does not flow from a session to its intent on its own, and the
    // intent is what a refund, a dispute and a bank statement point at.
    payment_intent_data: {
      metadata: tenantMetadata,
      // `on_session`, not `off_session` (#185). This platform never charges a
      // saved card with nobody watching — the member picks it on the provider's
      // own page, every time — so the bank is told to authenticate then rather
      // than up front, which is one less challenge on the card that is paying
      // now. Saying `off_session` would be claiming a power this has not built.
      ...(keepCard ? { setup_future_usage: 'on_session' as const } : {}),
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
  // First, before a Purchase is opened: a studio with no account of its own
  // takes no card payments (#293), and a refused checkout must leave nothing
  // behind that reads as a sale in progress.
  await requireProviderAccount(input.tenantId)
  const requested = input.requestedPartPaymentCents ?? null
  if (requested != null && !(await partPaymentEnabled(input.tenantId))) {
    refusePartPaymentWhenDisabled(requested)
  }
  const charge = requested == null ? null : chargeableCents(totalCents(input.lines), requested)
  const buyer = buyerFor(input.metadata)
  const purchase = await openPurchase({
    tenantId: input.tenantId,
    clientId: buyer,
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

  const [stripe, customerId] = await Promise.all([
    stripeForTenant(input.tenantId),
    // Made if they are not one yet, and null if the provider would not (#185).
    // Null is not a failure here: the session falls back to `customer_email`,
    // which is the shape every sale took before saved cards existed.
    input.customerId === undefined
      ? providerCustomerFor({
          tenantId: input.tenantId,
          clientId: buyer,
          email: input.email,
        })
      : input.customerId,
  ])
  // A Customer the provider has forgotten would otherwise fail every future
  // checkout for this member; this drops the dead pointer and pays without it.
  const session = await createSessionSurvivingStaleCustomer(
    { tenantId: input.tenantId, clientId: buyer, customerId },
    customer =>
      outbound('stripe', 'checkout.sessions.create', () =>
        stripe.checkout.sessions.create(
          checkoutSessionParams(
            {
              ...input,
              metadata: { ...input.metadata, purchase_id: purchase.id },
              partPaymentCents: charge,
              customerId: customer,
            },
          ),
        ),
      ),
  )
  await attachCheckoutSession(input.tenantId, purchase.id, session.id)
  return session.url
}
