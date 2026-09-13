import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, emailOTP, twoFactor } from 'better-auth/plugins'
import { db } from '../../db'
import * as schema from '../../db/schema/auth'
import { env } from '../../env'
import { originAllowed } from '../../lib/allowed-origins'
import { PLATFORM_MAIL_FROM_NAME } from '../../lib/mailer'
import {
  mailClientCode,
  mailPlatformPasswordReset,
  mailPlatformTwoFactorCode,
  mailStaffPasswordReset,
  mailStaffTwoFactorCode,
} from './sign-in-mail'

/**
 * Self-hosted auth (Better Auth), running beside Clerk while #106 swaps it in.
 * Nothing reads these sessions to authorise a request yet; every Clerk path is
 * unchanged.
 *
 * **Three instances, not one.** Separate user pools are the property being
 * kept from the three Clerk applications: a member must never be able to sign
 * into a portal, and a studio superadmin's credentials must not exist in the
 * pool the super portal reads. So each pool is its own instance over its own
 * tables (`db/schema/auth.ts`) on its own base path, and a token one pool
 * issued is a row the other two have never seen.
 *
 *   - `client`   — members, `/api/v1/auth/client`. Email one-time code, sign-up
 *                  allowed: the first code a new address asks for creates it.
 *   - `staff`    — studio portals, `/api/v1/auth/staff`. Email + password, with
 *                  TOTP, backup codes or an emailed code as the second factor.
 *                  No self sign-up: accounts are seeded or invited.
 *   - `platform` — the super portal, `/api/v1/auth/platform`. As staff, but on
 *                  a pool no studio can write to, and with no Tenant at all.
 *
 * **Bearer, not cookies.** The API and the frontends are on different hosts,
 * so a session travels as `Authorization: Bearer <token>`, held per origin by
 * the browser; the token is returned in the `set-auth-token` header.
 */

export type AuthPool = 'client' | 'staff' | 'platform'

export const AUTH_BASE_PATH: Record<AuthPool, string> = {
  client: '/api/v1/auth/client',
  staff: '/api/v1/auth/staff',
  platform: '/api/v1/auth/platform',
}

/** Five minutes and six digits, for every emailed code on every pool. */
const CODE_TTL_SECONDS = 5 * 60
const CODE_DIGITS = 6

/**
 * The origins a request may name, in a redirect or in its `Origin` — the same
 * allowlist CORS reads (`TENANT_ORIGIN_PATTERNS`).
 *
 * Handed over as a function returning concrete origins rather than as the
 * wildcard strings: Better Auth's own `*` also matches across dots, so
 * `https://*.example.app` would admit `https://a.b.example.app`, where ours
 * covers exactly one label (`lib/origin.ts`). Checking each candidate with
 * `originAllowed` keeps one definition of "ours". The candidates are the ones
 * a request carries outside its body — its `Origin` and a redirect in its query
 * string, which is where the password-reset link carries one.
 */
async function trustedOrigins(request?: Request): Promise<string[]> {
  if (!request) return []
  const url = new URL(request.url)
  const candidates = [
    request.headers.get('origin'),
    url.searchParams.get('callbackURL'),
    url.searchParams.get('redirectTo'),
  ]
  const origins = new Set<string>()
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const origin = new URL(candidate).origin
      if (originAllowed(origin)) origins.add(origin)
    } catch {
      // A relative redirect names no origin; Better Auth judges those itself.
    }
  }
  return [...origins]
}

/** What every pool shares: the secret, the host, the origins, bearer tokens. */
function shared(pool: AuthPool) {
  return {
    appName: PLATFORM_MAIL_FROM_NAME,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH[pool],
    trustedOrigins,
    telemetry: { enabled: false },
    // Distinct cookie names per pool, so a browser that does hold a cookie from
    // one never presents it to another under the same name.
    advanced: {
      cookiePrefix: `rt-${pool}`,
      // Said out loud because Better Auth's default is `NODE_ENV === 'test'`:
      // left alone, the origin and redirect checks are on in production and off
      // under every test, so the suite would prove nothing about them.
      disableOriginCheck: false,
    },
  } satisfies Partial<BetterAuthOptions>
}

const clientAuth = betterAuth({
  ...shared('client'),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      clientAuthUsers: schema.clientAuthUsers,
      clientAuthSessions: schema.clientAuthSessions,
      clientAuthAccounts: schema.clientAuthAccounts,
      clientAuthVerifications: schema.clientAuthVerifications,
    },
  }),
  user: { modelName: 'clientAuthUsers' },
  session: { modelName: 'clientAuthSessions' },
  account: { modelName: 'clientAuthAccounts' },
  verification: { modelName: 'clientAuthVerifications' },
  plugins: [
    bearer(),
    emailOTP({
      otpLength: CODE_DIGITS,
      expiresIn: CODE_TTL_SECONDS,
      storeOTP: 'hashed',
      disableSignUp: false,
      sendVerificationOTP: async ({ email, otp }) => mailClientCode(email, otp),
    }),
  ],
})

/**
 * The staff and platform pools differ only in their tables and in who words
 * their mail, so they are built by one function.
 */
function passwordPool(
  pool: 'staff' | 'platform',
  tables: {
    users: typeof schema.staffAuthUsers | typeof schema.platformAuthUsers
    sessions: typeof schema.staffAuthSessions | typeof schema.platformAuthSessions
    accounts: typeof schema.staffAuthAccounts | typeof schema.platformAuthAccounts
    verifications: typeof schema.staffAuthVerifications | typeof schema.platformAuthVerifications
    twoFactors: typeof schema.staffAuthTwoFactors | typeof schema.platformAuthTwoFactors
  },
  mail: {
    twoFactorCode: (user: { email: string; name: string }, code: string) => Promise<void>
    passwordReset: (user: { email: string; name: string }, url: string) => Promise<void>
  },
) {
  const model = (table: keyof typeof tables) => `${pool}Auth${table[0]!.toUpperCase()}${table.slice(1)}`
  return betterAuth({
    ...shared(pool),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: Object.fromEntries(
        (Object.keys(tables) as Array<keyof typeof tables>).map(key => [model(key), tables[key]]),
      ),
    }),
    user: { modelName: model('users') },
    session: { modelName: model('sessions') },
    account: { modelName: model('accounts') },
    verification: { modelName: model('verifications') },
    emailAndPassword: {
      enabled: true,
      // Invitation-only (#106): an account exists because a seed or an
      // invitation made it, and its first password is set through the reset.
      disableSignUp: true,
      sendResetPassword: async ({ user, url }) => mail.passwordReset(user, url),
    },
    plugins: [
      bearer(),
      withTwoFactorTable(
        twoFactor({
          issuer: PLATFORM_MAIL_FROM_NAME,
          otpOptions: {
            digits: CODE_DIGITS,
            period: CODE_TTL_SECONDS / 60,
            storeOTP: 'hashed',
            sendOTP: async ({ user, otp }) => mail.twoFactorCode(user, otp),
          },
        }),
        model('twoFactors'),
      ),
    ],
  })
}

/**
 * Point one instance's two-factor plugin at its own table.
 *
 * Not through the plugin's `schema` option, which is the documented way and is
 * wrong for more than one instance: the option is merged by *mutating* the
 * plugin's module-level schema object (`mergeSchema` in better-auth 1.7), so
 * the last instance built renames the table for every instance — the staff pool
 * would read the platform pool's second factors. A fresh schema object per
 * plugin keeps each instance's model name its own.
 */
function withTwoFactorTable<P extends ReturnType<typeof twoFactor>>(plugin: P, modelName: string): P {
  const twoFactorModel = { ...plugin.schema.twoFactor, modelName }
  plugin.schema = { ...plugin.schema, twoFactor: twoFactorModel as typeof plugin.schema.twoFactor }
  return plugin
}

const staffAuth = passwordPool(
  'staff',
  {
    users: schema.staffAuthUsers,
    sessions: schema.staffAuthSessions,
    accounts: schema.staffAuthAccounts,
    verifications: schema.staffAuthVerifications,
    twoFactors: schema.staffAuthTwoFactors,
  },
  { twoFactorCode: mailStaffTwoFactorCode, passwordReset: mailStaffPasswordReset },
)

const platformAuth = passwordPool(
  'platform',
  {
    users: schema.platformAuthUsers,
    sessions: schema.platformAuthSessions,
    accounts: schema.platformAuthAccounts,
    verifications: schema.platformAuthVerifications,
    twoFactors: schema.platformAuthTwoFactors,
  },
  { twoFactorCode: mailPlatformTwoFactorCode, passwordReset: mailPlatformPasswordReset },
)

/**
 * What the rest of the backend sees of a pool: its request handler. Narrowed on
 * purpose — Better Auth's inferred instance type cannot be named in a
 * declaration file, and nothing outside this module should be calling its
 * server API yet.
 */
export type AuthPoolHandler = { handler: (request: Request) => Promise<Response> }

export const authPools: Record<AuthPool, AuthPoolHandler> = {
  client: clientAuth,
  staff: staffAuth,
  platform: platformAuth,
}
