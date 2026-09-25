import './db/url'
import { z } from 'zod'
import { stripeEndpoint } from './lib/stripe-endpoint'

/**
 * Zod-validated env loader. Required vars cover:
 *   - DB connection
 *   - Better Auth (session signing secret + the backend's own origin)
 *   - Tenant origin patterns (CORS, links)
 *   - Resend (staff invitations + outbound transactional email)
 *
 * Anything not in this slice (Stripe, R2) is *optional* — the relevant lib
 * will fail at use-site if missing rather than blocking boot.
 */
const fields = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Deployment environment NAME — separate from NODE_ENV (which stays
  // 'production' on any server). 'staging' now; 'production' once that server
  // exists.
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Pino's level. Unset means `info` in production and `debug` everywhere else
  // (src/shared/logger.ts). Blank counts as unset: the deploy writes the line
  // whether or not the GitHub variable exists.
  LOG_LEVEL: z.preprocess(
    v => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),

  // Two connection strings to the same database, on purpose. DATABASE_URL is the
  // owner — migrations and seeds only. DATABASE_APP_URL is the `booking_app`
  // role the server actually runs as; it owns nothing and is not a superuser,
  // which is what makes the Row-Level Security policies in migration 0033 apply
  // rather than being bypassed. See src/db/roles.ts.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_APP_URL: z.string().min(1, 'DATABASE_APP_URL is required'),
  // Declared here because it is a BE env var and this file is the list, but
  // optional: only `npm run db:migrate` reads it (to provision the role), and
  // the server is handed the finished DATABASE_APP_URL above. Locally it is
  // where that URL's password comes from — see src/db/url.ts.
  DB_APP_PASSWORD: z.string().optional(),

  // Comma-separated addresses that may operate the **super portal** —
  // `/api/v1/platform/*`, where studios are created, listed and suspended.
  //
  // Not a role in `staff_users`: that column says what someone may do inside one
  // studio, and a studio's own admin must not be able to suspend another
  // studio. This is the *whole* allowlist — no studio staff account is folded
  // in, because folding one into the platform gate is exactly that escalation.
  // Unset means a super portal nobody can reach, which
  // is announced at boot. See services/tenants/platform-admin.ts.
  PLATFORM_ADMIN_EMAIL: z.string().optional(),

  IMPERSONATION_SECRET: z
    .string()
    .min(32, 'IMPERSONATION_SECRET must be at least 32 chars (used to sign HS256 grant JWTs)'),

  // Better Auth (self-hosted). One secret signs the session tokens and encrypts
  // the second-factor secrets of all three pools (services/auth/better-auth.ts);
  // rotating it signs everyone out.
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 chars (signs sessions and encrypts 2FA secrets)'),
  // The backend's own public origin — `https://api.reservetoday.app`. Every
  // link Better Auth builds (a password reset, above all) starts here, under
  // the pool's base path `/api/v1/auth/{client,staff,platform}`.
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be the backend origin, e.g. https://api.example.app'),

  // Comma-separated origin patterns for the tenant subdomains, one line per
  // environment — e.g.
  //   https://*.reservetoday.app,https://*.portal.reservetoday.app
  // A tenant is created by inserting a row, so its origin cannot be enumerated
  // in advance; the wildcard is what makes CORS and the auth pools' trusted
  // origins work for a studio that did not exist when the backend was deployed. The `*` must
  // be the leftmost label and covers exactly one label — see lib/origin.ts.
  // Exact origins are accepted too, for a host that names no tenant.
  //
  // Required, and it replaced `PORTAL_ORIGIN` / `CLIENT_ORIGIN`. Those were one
  // value each for the whole platform and could only ever name one studio's
  // apps, which is why every link built from them pointed at the first studio
  // whichever studio the code was acting for. This is now the only statement
  // the environment makes about which origins are ours, so an environment that
  // sets none has an empty allowlist and serves nobody — a boot failure is the
  // honest form of that.
  FRONTEND_URLS: z
    .string()
    .min(1, 'FRONTEND_URLS is required — e.g. https://*.example.app,https://*.portal.example.app'),

  // Optional / deferred — accept anything (or empty string)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /**
   * A stand-in for Stripe's API, as an origin — `http://127.0.0.1:12111` — for
   * the browser journeys a pull request runs on the CI runner (#207), so they
   * reach no real Stripe. Unset (every deployment) is Stripe itself. Refused
   * on production at boot — see `lib/stripe-endpoint.ts`.
   */
  STRIPE_API_URL: z.string().optional(),
  /**
   * The fixed half of the card statement descriptor, as set on the Stripe
   * account. Not a secret and not per-tenant: it names the platform, and the
   * studio's name is appended per charge in the 22 characters left after it
   * (`lib/stripe.ts`). Unset means no suffix is sent at all — Stripe refuses one
   * without a prefix — so every studio charges under the account's own name.
   */
  STRIPE_STATEMENT_DESCRIPTOR_PREFIX: z.string().optional(),
  /**
   * The key that seals a Tenant's own payment-provider credentials (#100).
   *
   * Base64, decoding to exactly 32 bytes — `openssl rand -base64 32`. It is not
   * validated here beyond being a string, because an environment that never
   * onboards a studio onto its own account needs none, and a boot failure for a
   * feature nobody has turned on is the wrong trade. The shape is checked at the
   * one moment it matters — when the super portal tries to save a studio's
   * credentials, which refuses rather than storing them in the clear
   * (`lib/secret-box.ts`).
   *
   * Rotating it orphans every sealed value, so a rotation means re-entering
   * each studio's credentials. There is deliberately no second key to fall back
   * to — a decryption that quietly succeeds under an old key is how a rotation
   * gets abandoned half-done.
   */
  PAYMENT_CREDENTIALS_KEY: z.string().optional(),

  // Mail — one Resend API key. The platform's envelope address and name are
  // constants in lib/mailer.ts; the *tenant* half of the from-identity is
  // per-studio data on `tenant_settings` (docs/md/mail-identity.md).
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  // Signing secret (`whsec_…`) of the Resend webhook that reports delivery,
  // bounce and complaint outcomes. Unset, that route answers "not configured".
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
})

const schema = fields.superRefine((e, ctx) => {
  try {
    stripeEndpoint(e.STRIPE_API_URL, e.APP_ENV)
  } catch (err) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_API_URL'], message: (err as Error).message })
  }
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const issues = parsed.error.issues.map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
  console.error('[env] invalid environment:\n' + issues)
  // Invariant: boot-time configuration — the process does not start on a bad environment.
  throw new Error('Environment validation failed')
}

export const env = parsed.data
export type Env = typeof env

/**
 * One setting as the environment holds it *now*, validated by that field's own
 * rule in the schema above (not the cross-field checks, which boot has run).
 *
 * `env` is a snapshot taken at boot. A handful of settings are read through this
 * instead, at the moment they are used: the platform-admin allowlist, the R2
 * bucket and its public host and keys, the statement descriptor prefix and the
 * credentials key. On a server the two are the same value, since nothing writes
 * the environment after boot. A test run is different: every backend test file
 * shares one process, the app is imported once, and a file that needs its own
 * value for one of these sets it in its `before` and restores it in its `after`.
 */
export function currentEnv<K extends keyof Env>(name: K): Env[K] {
  return fields.shape[name].parse(process.env[name]) as Env[K]
}

/*
 * `CLIENT_URL` used to live here — "the one place any link mailed or redirected
 * to a member is built from", built from `CLIENT_ORIGIN`. One place, and one
 * studio: on a platform serving many, it named whichever studio the deployment
 * was configured for, so a member of any other one was mailed and redirected
 * into somebody else's app. A studio's URLs are per studio and are derived from
 * its slug — `services/tenants/urls.ts`. There is no platform-wide equivalent
 * to reach for, deliberately.
 */
