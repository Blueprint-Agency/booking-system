import { createHash } from 'node:crypto'
import Stripe from 'stripe'
import { env } from '../env'
import { ConflictError } from '../shared/errors'
import { VENDOR_DEADLINE_MS } from './outbound'
import { stripeEndpoint } from './stripe-endpoint'
import {
  loadProviderCredentials,
  providerCredentials,
  type TenantProviderCredentials,
} from '../services/billing/provider-credentials'

/**
 * The one way into the payment provider.
 *
 * There is deliberately **no exported client**. Every call is made through
 * `stripeForTenant`, which binds the client to the studio whose money is
 * moving, so the question "which account is this charge on?" is answered in
 * exactly one place — `providerAccountForTenant` below.
 *
 * That answer is the studio's *own* account, and nothing else (#293). Not a
 * connected account: Stripe Connect is unavailable to this platform, so there
 * is no `Stripe-Account` header and no platform account in the middle. A
 * studio's credentials are a whole different API key, and the client is built
 * with it — which is why the account is bound to the client rather than passed
 * per call. A studio that has supplied none takes no online payments at all:
 * there is no platform key to fall back to, and no client can be built without
 * a studio's.
 *
 * It is also the seam a test substitutes: `setStripeFactory` swaps in a fake
 * client, so checkout, the webhook and refunds can be exercised without a
 * network or a Stripe key.
 */
export const STRIPE_API_VERSION = '2023-10-16'

/** The provider account a call is made against — always a studio's own. */
export type ProviderAccount = TenantProviderCredentials

export type StripeFactory = (account: ProviderAccount) => Stripe

/**
 * Every network call on a client built here goes through `outbound`
 * (`./outbound.ts`). The SDK's own timeout matches the wrapper's deadline, and
 * it never retries on its own: a retry inside the SDK would run past that
 * deadline unseen. Where a retry is wanted — webhooks and cron, never a route —
 * the wrapper does it.
 *
 * Reached at Stripe, or at the stand-in `STRIPE_API_URL` names for a pull
 * request's browser journeys (`./stripe-endpoint.ts`).
 */
function realClient(account: ProviderAccount): Stripe {
  // The studio's own key, and only ever that. An account is a key here, not a
  // header, so a call cannot half-belong to a studio.
  return new Stripe(account.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: VENDOR_DEADLINE_MS.stripe,
    maxNetworkRetries: 0,
    ...stripeEndpoint(env.STRIPE_API_URL, env.APP_ENV),
  })
}

let factory: StripeFactory = realClient
/**
 * Keyed by account, so the ordinary path builds one client per process.
 *
 * The key carries a digest of the secret as well as the account id, because a
 * studio that rotates its key keeps the same account — and a cache keyed on the
 * account alone would go on charging with the revoked key until the process
 * restarted. The digest, not the key: this map is in memory, but a secret used
 * as a map key is a secret one heap dump away from being read.
 */
const clients = new Map<string, Stripe>()

/**
 * Substitute the client every accessor hands out — the test seam. Pass `null`
 * to restore the real one. Clears the cache both ways, so a fake can never
 * outlive the test that installed it.
 */
export function setStripeFactory(next: StripeFactory | null): void {
  factory = next ?? realClient
  clients.clear()
}

function cacheKey(account: ProviderAccount): string {
  const digest = createHash('sha256').update(account.secretKey).digest('hex').slice(0, 16)
  return `${account.accountId}:${digest}`
}

function clientFor(account: ProviderAccount): Stripe {
  const key = cacheKey(account)
  const cached = clients.get(key)
  if (cached) return cached
  const client = factory(account)
  clients.set(key, client)
  return client
}

/**
 * How a Tenant maps to a provider account — the single fact this module owns.
 *
 * A studio that has supplied its own credentials maps to them; one that has not
 * maps to `null`, which means it takes no online payments (#293). There is no
 * platform account behind it any more: `stripeForTenant` refuses rather than
 * build a client for nobody.
 *
 * It **throws** when a studio has credentials that cannot be opened. Treating
 * that as "no credentials" would quietly switch a selling studio's payments off
 * — and before #293 it would have meant taking its members' money onto the
 * platform's account, which is why this was never a fallback.
 */
export async function providerAccountForTenant(tenantId: string): Promise<ProviderAccount | null> {
  return loadProviderCredentials(tenantId)
}

/**
 * Can this studio take a card payment at all? False until it has supplied its
 * own credentials. The member app asks before it offers a buy button, and the
 * answer is the same lookup a charge makes.
 */
export async function takesOnlinePayments(tenantId: string): Promise<boolean> {
  return (await providerAccountForTenant(tenantId)) !== null
}

/**
 * A studio's own account, or the refusal every caller shares when it has none:
 * `409 payments_not_configured`. A checkout, a resumed payment and a Refund all
 * say the same thing, because they have the same cause.
 */
export async function requireProviderAccount(tenantId: string): Promise<ProviderAccount> {
  const account = await providerAccountForTenant(tenantId)
  if (!account) throw paymentsNotConfigured()
  return account
}

const paymentsNotConfigured = () =>
  new ConflictError('payments_not_configured', {
    message: "This studio isn't taking online payments yet.",
  })

/** The provider, bound to the studio whose money is moving. */
export async function stripeForTenant(tenantId: string): Promise<Stripe> {
  return clientFor(await requireProviderAccount(tenantId))
}

/**
 * The provider, bound to the account a *particular payment* was taken on (#97).
 *
 * `stripeForTenant` answers "where does this studio sell today?", which is the
 * right question for a charge and the wrong one for a Refund. Money goes back
 * on the account it came in on — no provider will hand a payment intent across
 * accounts — so the account comes off the payment row, not off the Tenant.
 *
 * `null` on the row is a payment taken on the platform's own account, before
 * studios sold on theirs. This platform holds no key for that account any more
 * (#293), so such a payment cannot be returned from here, and the refusal says
 * where it can: the Stripe dashboard. `409 payment_on_platform_account`, not a
 * provider error naming an intent that looks perfectly correct.
 *
 * A studio that has removed its credentials is refused as it would be at
 * checkout — `payments_not_configured` — since nothing it holds can be reached.
 *
 * It **throws** for an account this platform holds no key for, which is a
 * studio whose credentials were replaced with a different account's after money
 * was taken. There is nothing sensible to do there: no key this platform holds
 * can reach that intent, and a refund silently not happening is worse than one
 * that says so.
 */
export async function stripeForProviderAccount(
  tenantId: string,
  accountId: string | null,
): Promise<Stripe> {
  if (!accountId) throw paymentOnPlatformAccount()
  const current = await requireProviderAccount(tenantId)
  if (current.accountId === accountId) return clientFor(current)
  throw new Error(
    `no credentials held for provider account ${accountId} — this payment was taken on an account this studio no longer supplies`,
  )
}

/**
 * The refusal for a payment recorded against the platform account. Exported so
 * a Refund can refuse up front, before it has returned any of a Purchase's other
 * payments — a Refund that stops half-way is worse than one that never starts.
 */
export const paymentOnPlatformAccount = () =>
  new ConflictError('payment_on_platform_account', {
    message:
      "This payment was taken before the studio had its own Stripe account, so it can't be refunded here. Refund it from the Stripe dashboard.",
  })

/**
 * Is this key real, and whose account is it?
 *
 * Called once, when the super portal saves a studio's credentials, and it is
 * the reason a wrong key is a message on that form rather than a member's
 * checkout failing weeks later — by which point nobody can look at the stored
 * key to see what went wrong, because nobody can look at it at all.
 *
 * It answers with the account id the provider itself reports, which is then
 * what gets stored and shown. Taking it from the provider rather than from the
 * person pasting the key means the super portal's "these credentials belong to
 * acct_xxx" is a fact and not a label.
 *
 * The client here is built and thrown away rather than cached: a key that turns
 * out to be wrong must leave nothing behind.
 */
export async function providerAccountForKey(secretKey: string): Promise<string> {
  // Built through `providerCredentials`, not as a literal: that is what makes
  // the secret non-enumerable, and a probe object assembled by hand would be
  // the one credentials object on this platform that a log line or a Sentry
  // event could serialise. The two empty strings are honest here — the account
  // is what this call is about to find out, and a probe verifies no webhook.
  const probe = factory(providerCredentials({ accountId: '', secretKey, webhookSecret: '' }))
  const account = await probe.accounts.retrieve()
  if (!account?.id) throw new Error('the provider returned no account for that key')
  return account.id
}
