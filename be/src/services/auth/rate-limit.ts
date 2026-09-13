import type { BetterAuthRateLimitOptions } from 'better-auth'

type RateLimitStorage = NonNullable<BetterAuthRateLimitOptions['customStorage']>
type Rule = { window: number; max: number }

/**
 * The two budgets #114 puts on sign-in, per client address, per pool. Windows
 * are in seconds, as Better Auth reads them.
 *
 * Sized for a studio's front desk, not for one person: members arriving for a
 * class share the studio's wifi and so its address, and each of them asks for a
 * code. A bot rotating through addresses is not what this stops; a bot
 * hammering from one is.
 */
export const AUTH_RATE_LIMITS = {
  /** A code mailed: the member's sign-in code, or a staff second factor. */
  codeRequest: { window: 60, max: 5 },
  /** A password, a sign-in code or a second factor offered for checking. */
  signInAttempt: { window: 60, max: 10 },
} as const satisfies Record<string, Rule>

const CODE_REQUEST_PATHS = ['/email-otp/send-verification-otp', '/two-factor/send-otp']
const SIGN_IN_ATTEMPT_PATHS = [
  '/sign-in/email',
  '/sign-in/email-otp',
  '/email-otp/check-verification-otp',
  '/email-otp/verify-email',
  '/two-factor/verify-otp',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
]

/**
 * Where one pool's request counts are kept: this process's memory.
 *
 * One backend process serves every studio (`docs/md/deployment.md`), so memory
 * is the whole count; a restart forgives everyone, which is the right way for a
 * limiter to fail. Not Better Auth's own memory store, because that one is a
 * single module-level map keyed on `ip|path`, with the path relative to each
 * pool's base path — so the staff and platform pools' `/sign-in/email` would
 * share one budget. Each pool builds its own store, and so its own map.
 *
 * Fixed windows: the first request opens one, the budget refills when it
 * closes, and refused requests do not push it out. `now` is for tests.
 */
export function authRateLimitStorage(now: () => number = () => Date.now()): RateLimitStorage {
  const windows = new Map<string, { count: number; closesAt: number }>()
  return {
    async consume(key, rule) {
      const at = now()
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (at >= w.closesAt) windows.delete(k)
      }
      const open = windows.get(key)
      if (!open || at >= open.closesAt) {
        windows.set(key, { count: 1, closesAt: at + rule.window * 1000 })
        return { allowed: true, retryAfter: null }
      }
      if (open.count >= rule.max) {
        return { allowed: false, retryAfter: Math.ceil((open.closesAt - at) / 1000) }
      }
      open.count += 1
      return { allowed: true, retryAfter: null }
    },
  }
}

/**
 * Better Auth's limiter for one pool, on in every environment — its default is
 * production only, which would leave the tests proving nothing about it.
 *
 * The client address is Better Auth's reading of a single-valued
 * `X-Forwarded-For` (what Traefik sets); with none, every such request shares
 * one bucket per path, which throttles rather than exempts. Paths not named
 * here keep Better Auth's own budgets. The app's `hono-rate-limiter` stack
 * (`app.ts`) does not cover the auth paths and is untouched.
 */
export function authRateLimit() {
  return {
    enabled: true,
    customStorage: authRateLimitStorage(),
    customRules: Object.fromEntries([
      ...CODE_REQUEST_PATHS.map(path => [path, AUTH_RATE_LIMITS.codeRequest]),
      ...SIGN_IN_ATTEMPT_PATHS.map(path => [path, AUTH_RATE_LIMITS.signInAttempt]),
    ]) as Record<string, Rule>,
  } satisfies BetterAuthRateLimitOptions
}
