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
import { tenantDisplayName } from '../tenants/mail-identity'
import { BadRequestError } from '../../shared/errors'
import { attachCheckoutSession, openPurchase, type PurchaseKind } from './purchases'

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
  return {
    mode: 'payment',
    customer_email: input.email,
    // Metadata does not flow from a session to its intent on its own, and the
    // intent is what a refund, a dispute and a bank statement point at. The
    // studio's name on the statement is the same reason `saleDescription`
    // carries it: a charge from a name the member has never heard of is a
    // chargeback.
    payment_intent_data: {
      metadata: tenantMetadata,
      ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
    },
    line_items: input.lines.map(line => ({
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
 * Open the Purchase, then ask the provider for the session that pays it.
 *
 * In that order, and never the other way round: the Purchase is the record of
 * what is owed, and a session created before it could take money this system
 * has nowhere to put. `purchase_id` rides along in the metadata because the
 * webhook has nothing else to find the sale by — it is handed a session and an
 * intent, and every other route to the Purchase would be a guess.
 */
export async function createCheckoutSession(input: CheckoutSessionInput): Promise<string | null> {
  const studioName = await tenantDisplayName(input.tenantId)
  const purchase = await openPurchase({
    tenantId: input.tenantId,
    clientId: input.metadata.client_id!,
    kind: purchaseKindFor(input.metadata),
    totalCents: totalCents(input.lines),
    metadata: input.metadata,
  })

  const stripe = await stripeForTenant(input.tenantId)
  const session = await stripe.checkout.sessions.create(
    checkoutSessionParams(
      { ...input, metadata: { ...input.metadata, purchase_id: purchase.id } },
      studioName,
    ),
  )
  await attachCheckoutSession(input.tenantId, purchase.id, session.id)
  return session.url
}
