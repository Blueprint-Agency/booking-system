/**
 * What an operator needs to know *before* moving a studio onto its own payment
 * account (#276): which kind of key this environment takes, where the studio's
 * webhook has to point, and which events it has to send.
 *
 * All three depend only on the environment and the studio's Slug, so they can
 * be shown before anything is saved. Pure functions of their arguments: the
 * caller passes the environment in, which is what lets the tests cover staging
 * and production from one process.
 */

type AppEnv = 'development' | 'staging' | 'production'

/**
 * The events the studio's endpoint has to subscribe to — exactly the two the
 * webhook handler acts on (`webhook-handler.ts`). Anything else is delivered,
 * verified and ignored, so subscribing to more only adds noise.
 */
export const PROVIDER_WEBHOOK_EVENTS = ['checkout.session.completed', 'charge.refunded'] as const

/**
 * The secret-key prefix this environment accepts.
 *
 * Production takes only live keys: a test key there means members "pay" and no
 * money arrives. Everywhere else takes only test keys: a live key on staging
 * means testers take real money. Development counts as "everywhere else" for
 * the same reason.
 */
export function expectedKeyPrefix(appEnv: AppEnv): 'sk_live_' | 'sk_test_' {
  return appEnv === 'production' ? 'sk_live_' : 'sk_test_'
}

/**
 * Whether a secret key is of the mode this environment takes. A restricted key
 * (`rk_live_…` / `rk_test_…`) is a secret key too, of the same mode as its
 * `sk_` twin; whether it may do enough is the provider's to say (#294).
 */
export function keyModeMatches(secretKey: string, appEnv: AppEnv): boolean {
  const mode = expectedKeyPrefix(appEnv).slice('sk_'.length)
  return secretKey.startsWith(`sk_${mode}`) || secretKey.startsWith(`rk_${mode}`)
}

/**
 * The URL a studio's own account has to deliver its webhooks to.
 *
 * Built from the backend's configured public origin (`BETTER_AUTH_URL`) rather
 * than from the request: behind the TLS-terminating proxy the request arrives
 * as `http`, and the provider refuses a live endpoint that is not HTTPS. The
 * configured origin is per environment, so it still cannot name an environment
 * other than the one being configured. Outside development the scheme is forced
 * to `https` in case the configuration ever says otherwise.
 */
export function providerWebhookUrl(apiOrigin: string, slug: string, appEnv: AppEnv): string {
  const url = new URL(apiOrigin)
  if (appEnv !== 'development') url.protocol = 'https:'
  return `${url.origin}/api/v1/webhooks/stripe/${encodeURIComponent(slug)}`
}
