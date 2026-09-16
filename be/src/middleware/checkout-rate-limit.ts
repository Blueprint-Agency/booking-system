import type { MiddlewareHandler } from 'hono'
import { rateLimiter } from 'hono-rate-limiter'

/**
 * Checkout's own budget (#142): every `/api/v1/me/checkout/*` call opens or
 * syncs a payment session with the provider, so it gets far less room than the
 * general signed-in budget in `app.ts`, which it still also counts against.
 */
export const CHECKOUT_RATE_LIMIT = { windowMs: 60_000, limit: 10 } as const

/**
 * Keyed on the signed-in member, so it must run after `clientAuth` — the app's
 * limiters run before any auth and only ever see the address. Members on one
 * studio's wifi share an address; they do not share this budget. The tenant is
 * in the key because a member id is only an id inside its own studio.
 */
export const checkoutRateLimit: MiddlewareHandler = rateLimiter({
  ...CHECKOUT_RATE_LIMIT,
  keyGenerator: c => `${c.get('tenantId')}:${c.get('clientId')}`,
  handler: c => c.json({ error: 'rate_limited' }, 429),
})
