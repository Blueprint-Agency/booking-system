import type { MiddlewareHandler } from 'hono'
import { rateLimiter } from 'hono-rate-limiter'
import { ERROR_CODES } from '../shared/error-codes'

/**
 * Checkout's own budget (#142): a `/api/v1/me/checkout/*` call that opens or
 * syncs a payment session with the provider gets far less room than the
 * general signed-in budget in `app.ts`, which it still also counts against.
 */
export const CHECKOUT_RATE_LIMIT = { windowMs: 60_000, limit: 10 } as const

/**
 * The checkout reads that reach no provider: the review page's options and the
 * Add-On's quote, read on every visit to those pages. Counted here, a member
 * who reloaded the Add-On page a few times ran out of budget and was told the
 * add-on could not be priced. They stay on the general budget.
 */
const READS = new Set(['GET /checkout/options', 'POST /checkout/cross-location/quote'])

/**
 * Keyed on the signed-in member, so it must run after `clientAuth` — the app's
 * limiters run before any auth and only ever see the address. Members on one
 * studio's wifi share an address; they do not share this budget. The tenant is
 * in the key because a member id is only an id inside its own studio.
 */
const limiter: MiddlewareHandler = rateLimiter({
  ...CHECKOUT_RATE_LIMIT,
  keyGenerator: c => `${c.get('tenantId')}:${c.get('clientId')}`,
  handler: c => c.json({ error: ERROR_CODES.rate_limited }, 429),
})

export const checkoutRateLimit: MiddlewareHandler = (c, next) => {
  const path = c.req.path.slice(c.req.path.indexOf('/checkout/'))
  return READS.has(`${c.req.method} ${path}`) ? next() : limiter(c, next)
}
