/**
 * Where the payment provider is reached: Stripe itself, or — for the browser
 * journeys on a pull request (#207) — a stand-in on the CI runner, so a run
 * makes no call to real Stripe and needs no Stripe key.
 *
 * `STRIPE_API_URL` is an origin (`http://127.0.0.1:12111`), handed to the SDK
 * as its host, port and scheme. Unset is Stripe.
 *
 * Production refuses one outright. There a checkout must take real money, and a
 * stand-in would "grant" every plan it is asked about. Its own file, with no
 * imports, so `src/env.ts` can refuse it at boot without a cycle.
 */
export type StripeEndpoint = { host?: string; port?: number; protocol?: 'http' | 'https' }

export function stripeEndpoint(url: string | undefined, appEnv: string): StripeEndpoint {
  if (!url) return {}
  if (appEnv === 'production') {
    throw new Error('STRIPE_API_URL is set on production — a checkout there must reach Stripe itself')
  }
  const parsed = URL.canParse(url) ? new URL(url) : null
  const protocol = parsed?.protocol.slice(0, -1)
  if (!parsed || (protocol !== 'http' && protocol !== 'https') || parsed.pathname !== '/' || !parsed.hostname) {
    throw new Error(`STRIPE_API_URL must be an origin such as http://127.0.0.1:12111, not "${url}"`)
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : protocol === 'https' ? 443 : 80,
    protocol,
  }
}
