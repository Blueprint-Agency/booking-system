import type Stripe from 'stripe'
import { stripeForTenant } from '../../lib/stripe'
import { loadProviderCredentials } from './provider-credentials'

/**
 * Is this delivery really from *this* studio's payment account?
 *
 * Every studio charges on its own account (#100, #293) and signs its deliveries
 * with its own signing secret, so the studio has to be settled *first*, because
 * it is what selects the secret — and the body is exactly what cannot be trusted
 * yet.
 *
 * The studio comes from the URL the delivery arrived on, which is fixed when the
 * endpoint is registered on that studio's account and is the only part of a
 * delivery that is not the body.
 *
 * One secret is tried, and only one. A delivery signed by another studio's
 * account does not fall through to a second attempt, or to a scan of every
 * studio — it fails, and is refused. That is what
 * makes a cross-studio delivery impossible rather than merely unlikely, and it
 * is the reason this returns a flat `null` for all three of "no such studio's
 * credentials", "bad signature" and "malformed body": an endpoint that
 * distinguished them would let anyone holding a URL learn which studios take
 * their own money.
 */
export type VerifiedDelivery = {
  event: Stripe.Event
  /**
   * The account that signed this delivery — which is the account the money in
   * it is on (#97).
   *
   * It is returned from here rather than looked up again later because *here*
   * is where it was proved. The secret that verified the signature is this
   * account's secret; a lookup afterwards would be a second, unproved reading
   * of a row that can be replaced while a delivery is in flight, and would
   * stamp the wrong account on a payment nobody would then be able to refund.
   */
  accountId: string
}

export async function verifyTenantDelivery(
  tenantId: string,
  body: string,
  signature: string,
): Promise<VerifiedDelivery | null> {
  // No credentials means this studio takes no online payments (#293), so there
  // is nothing to check a delivery against. There is no platform secret to fall
  // back to either — and a second secret tried against a delivery is the whole
  // thing this function exists to prevent.
  const credentials = await loadProviderCredentials(tenantId)
  if (!credentials) return null

  try {
    const stripe = await stripeForTenant(tenantId)
    const event = stripe.webhooks.constructEvent(body, signature, credentials.webhookSecret)
    return { event, accountId: credentials.accountId }
  } catch {
    return null
  }
}
