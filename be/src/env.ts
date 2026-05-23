import 'dotenv/config'
import { z } from 'zod'

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
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  SUPERADMIN_EMAIL: z.string().email('SUPERADMIN_EMAIL must be a valid email'),

  CLERK_STAFF_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_STAFF_PUBLISHABLE_KEY is required'),
  CLERK_STAFF_SECRET_KEY: z.string().min(1, 'CLERK_STAFF_SECRET_KEY is required'),
  CLERK_STAFF_WEBHOOK_SECRET: z.string().min(1, 'CLERK_STAFF_WEBHOOK_SECRET is required'),
  CLERK_STAFF_AUTHORIZED_PARTIES: z.string().optional(),

  PORTAL_ORIGIN: z.string().url('PORTAL_ORIGIN must be a full URL like http://localhost:3001'),
  CLIENT_ORIGIN: z
    .string()
    .url('CLIENT_ORIGIN must be a full URL like http://localhost:3000')
    .optional(),

  // Optional / deferred — accept anything (or empty string)
  CLERK_CLIENT_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_CLIENT_SECRET_KEY: z.string().optional(),
  CLERK_CLIENT_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // SMTP — only credentials live in env. Host/port/secure/from are hardcoded
  // in lib/mailer.ts (Gmail SMTP is fixed for this project's lifetime).
  SMTP_USER: z.string().min(1, 'SMTP_USER is required'),
  SMTP_PASSWORD: z.string().min(1, 'SMTP_PASSWORD is required'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const issues = parsed.error.issues.map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
  console.error('[env] invalid environment:\n' + issues)
  throw new Error('Environment validation failed')
}

export const env = parsed.data
export type Env = typeof env
