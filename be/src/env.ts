import './db/url'
import { z } from 'zod'

const booleanEnv = z.preprocess(value => {
  if (value === undefined || value === '') return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  }
  return value
}, z.boolean())

/**
 * Zod-validated env loader. Required vars cover:
 *   - DB connection
 *   - Superadmin bootstrap email (passwordless — see seed/superadmin.ts)
 *   - Clerk staff app (publishable + secret + webhook signing secret)
 *   - CORS origin for fe-portal
 *   - SMTP (staff invitations + outbound transactional email)
 *
 * Anything not in this slice (Stripe, R2, client Clerk app) is *optional* — the
 * relevant lib will fail at use-site if missing rather than blocking boot.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Deployment environment NAME — separate from NODE_ENV (which stays
  // 'production' on any server). Drives the Sentry environment tag + whether
  // Sentry reports. 'staging' now; 'production' once that server exists.
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  ENABLE_JOBS: booleanEnv,

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

  SUPERADMIN_EMAIL: z.string().email('SUPERADMIN_EMAIL must be a valid email'),

  // Comma-separated addresses that may operate the **super portal** —
  // `/api/v1/platform/*`, where studios are created, listed and suspended.
  //
  // Not a role in `staff_users`: that column says what someone may do inside one
  // studio, and a studio's own superadmin must not be able to suspend another
  // studio. This is the *whole* allowlist — `SUPERADMIN_EMAIL` is no longer
  // folded in, because folding a studio's superadmin into the platform gate is
  // exactly that escalation. Unset means a super portal nobody can reach, which
  // is announced at boot. See services/tenants/platform-admin.ts.
  PLATFORM_ADMIN_EMAILS: z.string().optional(),

  CLERK_STAFF_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_STAFF_PUBLISHABLE_KEY is required'),
  CLERK_STAFF_SECRET_KEY: z.string().min(1, 'CLERK_STAFF_SECRET_KEY is required'),
  CLERK_STAFF_WEBHOOK_SECRET: z.string().min(1, 'CLERK_STAFF_WEBHOOK_SECRET is required'),
  IMPERSONATION_SECRET: z
    .string()
    .min(32, 'IMPERSONATION_SECRET must be at least 32 chars (used to sign HS256 grant JWTs)'),
  CLERK_STAFF_AUTHORIZED_PARTIES: z.string().optional(),

  // Comma-separated origin patterns, one line per environment — e.g.
  //   https://*.reservetoday.app,https://*.portal.reservetoday.app
  // A tenant is created by inserting a row, so its origin cannot be enumerated
  // in advance; the wildcard is what makes CORS and the Clerk `azp` check work
  // for a studio that did not exist when the backend was deployed. The `*` must
  // be the leftmost label and covers exactly one label — see lib/origin.ts.
  // Exact origins are accepted too, for a host that names no tenant.
  //
  // Required, and it replaced `PORTAL_ORIGIN` / `CLIENT_ORIGIN`. Those were one
  // value each for the whole platform and could only ever name one studio's
  // apps, which is why every link built from them pointed at Yoga Sadhana
  // whichever studio the code was acting for. This is now the only statement
  // the environment makes about which origins are ours, so an environment that
  // sets none has an empty allowlist and serves nobody — a boot failure is the
  // honest form of that.
  TENANT_ORIGIN_PATTERNS: z
    .string()
    .min(1, 'TENANT_ORIGIN_PATTERNS is required — e.g. https://*.example.app,https://*.portal.example.app'),

  // Optional / deferred — accept anything (or empty string)
  CLERK_CLIENT_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_CLIENT_SECRET_KEY: z.string().optional(),
  CLERK_CLIENT_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /**
   * The fixed half of the card statement descriptor, as set on the Stripe
   * account. Not a secret and not per-tenant: it names the platform, and the
   * studio's name is appended per charge in the 22 characters left after it
   * (`lib/stripe.ts`). Unset means no suffix is sent at all — Stripe refuses one
   * without a prefix — so every studio charges under the account's own name.
   */
  STRIPE_STATEMENT_DESCRIPTOR_PREFIX: z.string().optional(),

  // SMTP — credentials and the platform's envelope identity. Host/port/secure
  // are hardcoded in lib/mailer.ts (Gmail SMTP is fixed for this platform's
  // lifetime). The *tenant* half of the from-identity is not env at all: it is
  // per-studio data on `tenant_settings` (docs/md/mail-identity.md).
  SMTP_USER: z.string().min(1, 'SMTP_USER is required'),
  SMTP_PASSWORD: z.string().min(1, 'SMTP_PASSWORD is required'),
  // The envelope address every tenant's mail leaves on — it must be one the
  // SMTP credentials are authorised for, or the mail fails SPF. Defaults to
  // SMTP_USER, which by construction is.
  //
  // Both are read as "blank means unset": the deploy workflow writes the line
  // unconditionally, so an unset repository variable arrives as an empty string
  // rather than as an absent key, and `.optional()` alone would let that empty
  // string through to `.email()` and fail the boot.
  MAIL_FROM_EMAIL: z
    .string()
    .optional()
    .transform(v => v?.trim() || undefined)
    .pipe(z.string().email('MAIL_FROM_EMAIL must be a valid email').optional()),
  // Shown only when a tenant has no name of its own to put there.
  MAIL_FROM_NAME: z
    .string()
    .optional()
    .transform(v => v?.trim() || 'ReserveToday'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),

  // Error monitoring (optional). Set to a Sentry DSN to turn on error
  // reporting; leave blank and the app no-ops (see src/instrument.ts).
  SENTRY_DSN: z.string().url().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const issues = parsed.error.issues.map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
  console.error('[env] invalid environment:\n' + issues)
  throw new Error('Environment validation failed')
}

export const env = parsed.data
export type Env = typeof env

/*
 * `CLIENT_URL` used to live here — "the one place any link mailed or redirected
 * to a member is built from", built from `CLIENT_ORIGIN`. One place, and one
 * studio: on a platform serving many, it named whichever studio the deployment
 * was configured for, so a member of any other one was mailed and redirected
 * into somebody else's app. A studio's URLs are per studio and are derived from
 * its slug — `services/tenants/urls.ts`. There is no platform-wide equivalent
 * to reach for, deliberately.
 */
