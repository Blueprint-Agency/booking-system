import type Stripe from 'stripe'
import { stripeForTenant } from '../../lib/stripe'
import { loadProviderCredentials } from './provider-credentials'

/**
 * Is this delivery really from *this* studio's payment account?
 *
 * A studio charging on its own account (#100) signs its deliveries with its own
 * signing secret, which inverts the order the shared endpoint works in. There,
 * one secret verifies everything and the studio is worked out afterwards, from
 * the signed body. Here the studio has to be settled *first*, because it is what
 * selects the secret — and the body is exactly what cannot be trusted yet.
 *
 * The studio comes from the URL the delivery arrived on, which is fixed when the
 * endpoint is registered on that studio's account and is the only part of a
 * delivery that is not the body.
 *
 * One secret is tried, and only one. A delivery signed by another studio's
 * account does not fall through to a second attempt, or to the platform's
 * secret, or to a scan of every studio — it fails, and is refused. That is what
 * makes a cross-studio delivery impossible rather than merely unlikely, and it
 * is the reason this returns a flat `null` for all three of "no such studio's
 * credentials", "bad signature" and "malformed body": an endpoint that
 * distinguished them would let anyone holding a URL learn which studios take
 * their own money.
 */
export async function verifyTenantDelivery(
  tenantId: string,
  body: string,
  signature: string,
): Promise<Stripe.Event | null> {
  // No credentials means this studio's deliveries belong on the platform's
  // shared endpoint, and this one has nothing to check them against. It must
  // not fall back to the platform's secret: a second secret tried against a
  // delivery is the whole thing this function exists to prevent.
  const credentials = await loadProviderCredentials(tenantId)
  if (!credentials) return null

  try {
    const stripe = await stripeForTenant(tenantId)
    return stripe.webhooks.constructEvent(body, signature, credentials.webhookSecret)
  } catch {
    return null
  }
}
