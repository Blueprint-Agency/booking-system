import type { BetterAuthPlugin, BetterAuthRateLimitOptions } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'

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

const CODE_REQUEST_PATHS = ['/email-otp/send-verification-otp', '/two-factor/send-otp', '/request-password-reset']
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

/**
 * The member pool's budgets per **email** (#173), on top of the per-address
 * ones above. An address budget stops one machine; it does nothing against
 * guesses at one member's password spread over many addresses, or against a
 * flood of set-password links to one inbox. These do.
 *
 * Kept small for links — a member needs one, and a second when the first went
 * astray — and as generous as the address budget for passwords, so a member
 * who mistypes a few times is not locked out of their own account.
 */
export const AUTH_EMAIL_RATE_LIMITS = {
  /** A set-password link mailed, whether asked for by the email step, "forgot password" or an admin. */
  linkRequest: { window: 15 * 60, max: 3 },
  /** A password offered for one email. */
  signInAttempt: { window: 5 * 60, max: 10 },
  /** The email step asked about one email — it says whether that email has a password. */
  signInStep: { window: 5 * 60, max: 10 },
} as const satisfies Record<string, Rule>

/**
 * The email step's per-address budget. It is our route, not a pool endpoint,
 * so Better Auth's limiter never sees the answers that say `password`; this
 * one does. Roomier than a code request, as a whole class signs in from the
 * studio's wifi.
 */
export const SIGN_IN_STEP_ADDRESS_LIMIT: Rule = { window: 60, max: 20 }

const signInStepStorage = authRateLimitStorage()

/**
 * Spend the email step's budgets — per address and per email. False when
 * either is gone. Without an address every caller shares one bucket, which
 * throttles rather than exempts, as the pools' own limiter does.
 */
export async function spendSignInStepBudget(email: string, address: string | null): Promise<boolean> {
  const byAddress = await signInStepStorage.consume(`address|${address ?? ''}`, SIGN_IN_STEP_ADDRESS_LIMIT)
  if (!byAddress.allowed) return false
  const byEmail = await signInStepStorage.consume(
    `email|${email.trim().toLowerCase()}`,
    AUTH_EMAIL_RATE_LIMITS.signInStep,
  )
  return byEmail.allowed
}

const EMAIL_BUDGETED_PATHS: Record<string, Rule> = {
  '/request-password-reset': AUTH_EMAIL_RATE_LIMITS.linkRequest,
  '/sign-in/email': AUTH_EMAIL_RATE_LIMITS.signInAttempt,
}

/** Which per-email budget a request spends, if any: keyed on the path and the case-folded email. */
export function emailBudget(path: string, body: unknown): { key: string; rule: Rule } | null {
  const rule = EMAIL_BUDGETED_PATHS[path]
  const email = (body as { email?: unknown } | null)?.email
  if (!rule || typeof email !== 'string' || !email.trim()) return null
  return { key: `${path}|${email.trim().toLowerCase()}`, rule }
}

/**
 * The per-email budgets as a Better Auth plugin: a before-hook, so it runs
 * after the per-address limiter has let the request through and before the
 * endpoint does any work. Its own store, for the reason `authRateLimitStorage`
 * gives — one per pool.
 */
export function emailRateLimit(now: () => number = () => Date.now()) {
  const storage = authRateLimitStorage(now)
  return {
    id: 'email-rate-limit',
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) => Boolean(ctx.path && ctx.path in EMAIL_BUDGETED_PATHS),
          handler: createAuthMiddleware(async ctx => {
            const budget = emailBudget(ctx.path, ctx.body)
            if (!budget) return
            const { allowed, retryAfter } = await storage.consume(budget.key, budget.rule)
            if (allowed) return
            throw new APIError(
              'TOO_MANY_REQUESTS',
              { message: 'too_many_requests' },
              retryAfter ? { 'X-Retry-After': String(retryAfter) } : undefined,
            )
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin
}
