/**
 * The one place a Stripe Checkout session is built. Every purchase — a plan, a
 * standalone Cross-Location Add-On, a workshop — is the same session with
 * different lines, so the currency, the GST copy, the Hold expiry and the
 * one-quantity-per-line shape are settled here rather than three times over.
 *
 * What a purchase *costs* is not decided here: the caller's service prices it
 * and hands the lines over already priced.
 */
import { stripe } from '../../lib/stripe'

/**
 * Catalogue prices are GST-inclusive (SG consumer pricing / IRAS). The amount
 * charged IS the listed price; this line reflects the embedded GST rather than
 * adding it on top.
 */
export const GST_NOTE = 'includes 9% GST'

export interface CheckoutLine {
  name: string
  description: string
  amountCents: number
}

/** The line copy every Yoga Sadhana product carries, and the code that cut it. */
export const saleDescription = (promoCode?: string | null): string =>
  `Yoga Sadhana · ${GST_NOTE}${promoCode ? ` · promo ${promoCode} applied` : ''}`

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

export async function createCheckoutSession(input: CheckoutSessionInput): Promise<string | null> {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: input.email,
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
    metadata: input.metadata,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  })
  return session.url
}
