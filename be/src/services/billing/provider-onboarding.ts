import type Stripe from 'stripe'
import { currentEnv } from '../../env'
import { providerAccountForKey, STRIPE_API_VERSION, stripeForKey } from '../../lib/stripe'
import { outbound } from '../../lib/outbound'
import { secretKeyProblem } from '../../lib/secret-box'
import { logger } from '../../shared/logger'
import { loadTenantById } from '../tenants/tenants'
import {
  expectedKeyPrefix,
  keyModeMatches,
  PROVIDER_WEBHOOK_EVENTS,
  providerWebhookUrl,
} from './provider-setup'
import {
  clearProviderCredentials,
  loadProviderCredentials,
  saveProviderCredentials,
  storedWebhookEndpointId,
  type ProviderAccountStatus,
} from './provider-credentials'

/**
 * Moving a studio onto its own payment account — the rule, in one place.
 *
 * It lives here rather than in the route because it is a domain rule and not a
 * response shape: what has to be true before a studio's credentials may be
 * stored, in what order, and what is allowed to be said about a failure. A
 * route that held it would be the second place that rule lived the moment
 * anything else needed to configure a studio.
 *
 * It also cannot live in `provider-credentials.ts`, which is the store: that
 * module is imported by `lib/stripe.ts`, and validating a key needs a provider
 * client from exactly there. This file is where the two meet.
 *
 * Since #294 the studio supplies its secret key and nothing else. The webhook
 * endpoint on its account is the platform's to create, keep and delete, so the
 * mistake that used to be silent — an endpoint made by hand at the wrong URL,
 * or for the wrong events, and members charged with nothing granted — has no
 * one left to make it.
 */

/**
 * Why a studio could not be moved onto its own account, in the kinds a caller
 * has to tell apart.
 *
 * `storage_unavailable` is the operator's environment — nothing was attempted,
 * and nothing is wrong with what they typed. `key_wrong_mode` is a key of the
 * wrong kind for this environment (a live key on staging, a test key on
 * production). `key_rejected` is a key the provider refused.
 * `key_lacks_webhook_permission` is a restricted key the provider accepted but
 * which may not manage webhook endpoints, so the platform cannot set one up.
 * `webhook_refused` is the provider refusing the endpoint itself — most often
 * a URL it cannot reach, which is every development URL.
 */
export type OnboardingFailure =
  | 'storage_unavailable'
  | 'key_wrong_mode'
  | 'key_rejected'
  | 'key_lacks_webhook_permission'
  | 'webhook_refused'

/**
 * The permission a restricted key needs for the platform to set up its
 * webhook, named as the provider's dashboard names it.
 */
export const WEBHOOK_PERMISSION = 'Webhook Endpoints: Write'

export class ProviderOnboardingError extends Error {
  constructor(readonly reason: OnboardingFailure, message: string) {
    super(message)
    this.name = 'ProviderOnboardingError'
  }
}

export type ConfiguredAccount = ProviderAccountStatus & {
  accountId: string
  /** The endpoint set up on the studio's account — where, and for what. */
  webhook: { url: string; events: readonly string[] }
}

/** What the provider says when a key may not do what was asked of it. */
function isPermissionError(err: unknown): boolean {
  const e = err as { type?: unknown; statusCode?: unknown } | null
  return e?.type === 'StripePermissionError' || e?.statusCode === 403
}

/** The provider refusing the request itself (a 4xx), rather than failing to answer. */
function isRefusal(err: unknown): boolean {
  const status = (err as { statusCode?: unknown } | null)?.statusCode
  return typeof status === 'number' && status >= 400 && status < 500
}

/**
 * Validate a studio's secret key against the provider, create the webhook
 * endpoint on its account, then store both.
 *
 * In that order, and the order is the point. The key is proved before anything
 * is sealed, so a typo is caught here — at a form, by a person who can still
 * fix it — rather than at a member's checkout weeks later, against a key nobody
 * can read back to see what went wrong.
 *
 * The account id is the provider's own answer, not the operator's claim, which
 * is what makes "these credentials belong to acct_xxx" a fact rather than a
 * label. The signing secret is the provider's answer too: it is returned once,
 * when the endpoint is created, and this is the only moment it can be kept.
 *
 * Replacing a key creates and stores the new endpoint before the old one is
 * deleted, so there is never a moment with no working endpoint. A save that
 * fails after the endpoint was created deletes it again, so a retry cannot
 * leave two endpoints delivering to the same URL.
 */
export async function configureProviderAccount(
  tenantId: string,
  input: { secretKey: string },
): Promise<ConfiguredAccount> {
  // Said before anything is attempted, because the failure is the operator's
  // environment and not their input — and because the alternative is a studio's
  // live key travelling to a server that cannot seal it.
  const problem = secretKeyProblem(currentEnv('PAYMENT_CREDENTIALS_KEY'))
  if (problem) {
    logger.error({ tenantId }, `payment credentials cannot be stored — ${problem}`)
    throw new ProviderOnboardingError('storage_unavailable', problem)
  }

  // Before the provider is asked and before anything is stored. The provider
  // would accept either kind of key — this is the environment's rule, not the
  // provider's: a live key on staging takes testers' real money, and a test key
  // on production takes members' "payments" that never arrive.
  if (!keyModeMatches(input.secretKey, currentEnv('APP_ENV'))) {
    logger.warn({ tenantId, appEnv: currentEnv('APP_ENV') }, 'payment credentials refused — wrong key mode')
    throw new ProviderOnboardingError(
      'key_wrong_mode',
      `this environment accepts only ${expectedKeyPrefix(currentEnv('APP_ENV'))} keys`,
    )
  }

  let accountId: string
  try {
    accountId = await providerAccountForKey(input.secretKey)
  } catch (err) {
    // The provider's own words are deliberately not carried forward. An error
    // raised by a bad key can echo the key back, and the caller's next move is
    // to put this in front of a person.
    logger.warn({ tenantId }, 'payment credentials rejected by the provider')
    void err
    throw new ProviderOnboardingError(
      'key_rejected',
      'the payment provider did not accept that secret key',
    )
  }

  const url = await webhookUrlFor(tenantId)
  const stripe = stripeForKey({ accountId, secretKey: input.secretKey })

  // What is there before this save: the studio's previous account and the
  // endpoint this platform created on it, and anything at the studio's URL on
  // the new account (an endpoint made by hand before #294, or one a failed
  // cleanup left behind). All of it is replaced, never added to.
  const previous = await previousAccount(tenantId)
  const atUrl = await asOnboardingRefusal(tenantId, url, () => endpointsAt(stripe, url))

  const created = await asOnboardingRefusal(tenantId, url, () =>
    outbound('stripe', 'webhookEndpoints.create', () =>
      stripe.webhookEndpoints.create({
        url,
        enabled_events: [...PROVIDER_WEBHOOK_EVENTS],
        // Pinned to the version this code reads events in, rather than the
        // account's default — which is whatever the studio's account happens
        // to have been created on.
        api_version: STRIPE_API_VERSION,
        description: 'Payments for this studio’s bookings. Managed by the booking platform; replaced or removed with the studio’s key.',
        metadata: { tenant_id: tenantId },
      }),
    ),
  )

  let status: ProviderAccountStatus
  try {
    if (!created.secret) throw new Error('the provider created an endpoint but returned no signing secret')
    status = await saveProviderCredentials(tenantId, {
      accountId,
      secretKey: input.secretKey,
      webhookSecret: created.secret,
      webhookEndpointId: created.id,
    })
  } catch (err) {
    await deleteEndpoint(stripe, { tenantId, accountId, endpointId: created.id }, 'an endpoint whose save failed')
    throw err
  }

  // Only now that the new endpoint is stored and working.
  for (const endpoint of atUrl) {
    await deleteEndpoint(stripe, { tenantId, accountId, endpointId: endpoint.id }, 'a replaced endpoint')
  }
  if (previous) {
    const sameAccount = previous.accountId === accountId
    await retireEndpoints(previous, {
      tenantId,
      url,
      // On the same account the sweep above has already been at the URL.
      sweepUrl: !sameAccount,
      skip: new Set([created.id, ...atUrl.map(endpoint => endpoint.id)]),
      what: 'the previous key’s endpoint',
    })
  }

  logger.info({ tenantId, accountId, webhookEndpointId: created.id }, 'payment webhook endpoint created')
  return { ...status, accountId, webhook: { url, events: PROVIDER_WEBHOOK_EVENTS } }
}

/**
 * Take a studio off its own account, and delete the webhook endpoint the
 * platform created there.
 *
 * The only way out of credentials that turn out to be wrong, because the way
 * that would seem obvious — look at what is stored — does not exist by design.
 *
 * The credentials go first and the endpoint after, on a best-effort basis: a
 * provider that cannot be reached must not keep a studio on credentials its
 * operator asked to remove. What could not be deleted is logged with the ids
 * needed to finish by hand.
 */
export async function releaseProviderAccount(tenantId: string): Promise<ProviderAccountStatus> {
  const previous = await previousAccount(tenantId)
  const status = await clearProviderCredentials(tenantId)
  if (previous) {
    await retireEndpoints(previous, {
      tenantId,
      url: await webhookUrlFor(tenantId),
      sweepUrl: true,
      skip: new Set(),
      what: 'the endpoint of removed credentials',
    })
  }
  return status
}

/** The studio's own webhook URL, from its slug. */
async function webhookUrlFor(tenantId: string): Promise<string> {
  const tenant = await loadTenantById(tenantId)
  if (!tenant) throw new Error(`no studio ${tenantId} to set up payments for`)
  return providerWebhookUrl(currentEnv('BETTER_AUTH_URL'), tenant.slug, currentEnv('APP_ENV'))
}

type PreviousAccount = { accountId: string; secretKey: string; endpointId: string | null }

/**
 * The account the studio's stored credentials open, the key that opens it and
 * the endpoint the platform created there — or null when there is nothing to
 * clean up after: no credentials, or credentials that can no longer be opened.
 * `endpointId` is null for credentials saved before #294, whose endpoint was
 * made by hand and is found by its URL instead.
 */
async function previousAccount(tenantId: string): Promise<PreviousAccount | null> {
  const endpointId = await storedWebhookEndpointId(tenantId)
  try {
    const credentials = await loadProviderCredentials(tenantId)
    if (!credentials) return null
    return { accountId: credentials.accountId, secretKey: credentials.secretKey, endpointId }
  } catch (err) {
    // A rotated sealing key: the stored key cannot be opened, so the endpoint
    // cannot be reached with it. Replacing or removing the credentials still
    // has to work — that is the way out of exactly this state.
    logger.error(
      { err, tenantId, webhookEndpointId: endpointId },
      'payment webhook endpoint left in place — stored credentials cannot be opened; delete it by hand in the studio’s Stripe dashboard',
    )
    return null
  }
}

/**
 * Delete the endpoints on a studio's previous account: the one the platform
 * stored, and — when `sweepUrl` — any other at the studio's URL. Best effort:
 * what cannot be listed or deleted is logged, never thrown, because the
 * credentials change it follows has already happened.
 */
async function retireEndpoints(
  previous: PreviousAccount,
  options: { tenantId: string; url: string; sweepUrl: boolean; skip: Set<string>; what: string },
): Promise<void> {
  const stripe = stripeForKey(previous)
  const ids = new Set<string>()
  if (previous.endpointId) ids.add(previous.endpointId)
  if (options.sweepUrl) {
    try {
      for (const endpoint of await endpointsAt(stripe, options.url)) ids.add(endpoint.id)
    } catch (err) {
      logger.error(
        { err, tenantId: options.tenantId, accountId: previous.accountId, url: options.url },
        `payment webhook endpoints not listed (${options.what}) — check the studio’s Stripe dashboard for endpoints at this URL`,
      )
    }
  }
  for (const endpointId of ids) {
    if (options.skip.has(endpointId)) continue
    await deleteEndpoint(stripe, { tenantId: options.tenantId, accountId: previous.accountId, endpointId }, options.what)
  }
}

/** Every endpoint on the account delivering to `url`. */
async function endpointsAt(stripe: Stripe, url: string): Promise<Array<{ id: string }>> {
  const found: Array<{ id: string }> = []
  for await (const endpoint of listEndpoints(stripe)) {
    if (endpoint.url === url) found.push({ id: endpoint.id })
  }
  return found
}

async function* listEndpoints(stripe: Stripe): AsyncGenerator<Stripe.WebhookEndpoint> {
  let startingAfter: string | undefined
  for (;;) {
    const page = await outbound('stripe', 'webhookEndpoints.list', () =>
      stripe.webhookEndpoints.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) }),
    )
    yield* page.data
    const last = page.data[page.data.length - 1]
    if (!page.has_more || !last) return
    startingAfter = last.id
  }
}

/**
 * Run a webhook-endpoint call, turning the provider's refusals into ones the
 * form can say something useful about: "this key may not do that", named with
 * the permission, or "the provider will not create that endpoint", named with
 * the URL. Anything else — a timeout, a 5xx — is the provider failing to
 * answer, and is thrown as it is.
 */
async function asOnboardingRefusal<T>(tenantId: string, url: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (isPermissionError(err)) {
      logger.warn({ tenantId }, 'payment credentials refused — key cannot manage webhook endpoints')
      throw new ProviderOnboardingError(
        'key_lacks_webhook_permission',
        `the key needs the "${WEBHOOK_PERMISSION}" permission so the platform can set up its webhook`,
      )
    }
    if (isRefusal(err)) {
      // The provider's message is logged, not returned: it is about the URL
      // here, but it is still the provider's words about a request made with
      // the studio's key.
      logger.warn({ err, tenantId, url }, 'payment credentials refused — the provider would not create the webhook endpoint')
      throw new ProviderOnboardingError('webhook_refused', `the payment provider would not create a webhook endpoint at ${url}`)
    }
    throw err
  }
}

/**
 * Delete one endpoint, never throwing. A failure is logged with the account and
 * endpoint ids, which is everything needed to delete it by hand.
 */
async function deleteEndpoint(
  stripe: Stripe,
  ids: { tenantId: string; accountId: string; endpointId: string },
  what: string,
): Promise<void> {
  try {
    await outbound('stripe', 'webhookEndpoints.del', () => stripe.webhookEndpoints.del(ids.endpointId))
  } catch (err) {
    logger.error(
      { err, tenantId: ids.tenantId, accountId: ids.accountId, webhookEndpointId: ids.endpointId },
      `payment webhook endpoint not deleted (${what}) — delete it by hand in the studio’s Stripe dashboard`,
    )
  }
}
