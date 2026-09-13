import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { bearer, emailOTP, twoFactor } from 'better-auth/plugins'
import { currentTenantId, db } from '../../db'
import * as schema from '../../db/schema/auth'
import { env } from '../../env'
import { originAllowed } from '../../lib/allowed-origins'
import { PLATFORM_MAIL_FROM_NAME } from '../../lib/mailer'
import { authAudit } from './auth-events'
import { authRateLimit } from './rate-limit'
import { twoFactorChallengeHeader } from './two-factor-challenge'
import {
  mailClientCode,
  mailPlatformPasswordReset,
  mailPlatformTwoFactorCode,
  mailStaffPasswordReset,
  mailStaffTwoFactorCode,
} from './sign-in-mail'

/**
 * Self-hosted auth (Better Auth), running beside Clerk while #106 swaps it in.
 * The staff and member middlewares accept either a session from here or a Clerk
 * JWT (`readPoolSession`); the super portal's gate reads only a `platform`
 * session (#116).
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
 * **A studio-pool session carries its Tenant.** `client` and `staff` sign in on a
 * studio's hostname, inside the Tenant context `resolveTenant` opened, and the
 * session-create hook below writes that Tenant onto the row as its claim. The
 * middlewares refuse a session whose claim is not the Tenant the request
 * resolved to (`services/tenants/session-claim.ts`), so a session issued at
 * studio A is worthless at studio B. `platform` sessions carry no Tenant.
 *
 * **Bearer, not cookies.** The API and the frontends are on different hosts,
 * so a session travels as `Authorization: Bearer <token>`, held per origin by
 * the browser; the token is returned in the `set-auth-token` header.
 */

export type { AuthPool } from '../../db/enums'
import type { AuthPool } from '../../db/enums'

export const AUTH_BASE_PATH: Record<AuthPool, string> = {
  client: '/api/v1/auth/client',
  staff: '/api/v1/auth/staff',
  platform: '/api/v1/auth/platform',
}

/**
 * The claim, as Better Auth sees it: a session field the caller cannot set
 * (`input: false`), stored in `claimed_tenant_id` — see `db/schema/auth.ts` for
 * why the column is not named `tenant_id`.
 */
const tenantClaimField = {
  claimedTenantId: { type: 'string', required: false, input: false },
} as const

/**
 * Stamp the resolved Tenant onto every session a studio pool creates.
 *
 * The Tenant is the one whose context is open, which on `/api/v1/auth/{client,
 * staff}/*` is the one the request's hostname named. No context means a sign-in
 * that named no studio — `resolveTenant` already refuses those with
 * `tenant_required`, so this is the backstop for a path someone later exempts:
 * a session with no claim would be refused at every tenant route anyway, and it
 * is better never written.
 */
const stampTenantClaim = {
  session: {
    create: {
      before: async (session: Record<string, unknown>) => {
        const tenantId = currentTenantId()
        if (!tenantId) throw new APIError('FORBIDDEN', { message: 'tenant_required' })
        return { data: { ...session, claimedTenantId: tenantId } as never }
      },
    },
  },
} satisfies BetterAuthOptions['databaseHooks']

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
    // Code requests and sign-in attempts, per address per window (#114).
    rateLimit: authRateLimit(),
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
  session: { modelName: 'clientAuthSessions', additionalFields: tenantClaimField },
  databaseHooks: stampTenantClaim,
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
    authAudit('client'),
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
  // The super portal signs in on no studio, so its sessions carry no claim.
  const studioPool = pool === 'staff'
  return betterAuth({
    ...shared(pool),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: Object.fromEntries(
        (Object.keys(tables) as Array<keyof typeof tables>).map(key => [model(key), tables[key]]),
      ),
    }),
    user: { modelName: model('users') },
    session: {
      modelName: model('sessions'),
      ...(studioPool ? { additionalFields: tenantClaimField } : {}),
    },
    ...(studioPool ? { databaseHooks: stampTenantClaim } : {}),
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
      // The portals send no cookies, so the second-factor challenge rides a header
      // too. After the two-factor plugin, whose after-hook is what sets the cookie.
      twoFactorChallengeHeader(),
      // Last: it has to see the session the two-factor plugin leaves, not the one it deletes.
      authAudit(pool),
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
 * declaration file. The one other thing a caller needs, reading a session, is
 * `readPoolSession` below.
 */
export type AuthPoolHandler = { handler: (request: Request) => Promise<Response> }

export const authPools: Record<AuthPool, AuthPoolHandler> = {
  client: clientAuth,
  staff: staffAuth,
  platform: platformAuth,
}

/** A signed-in session, as a middleware needs it. */
export type PoolSession = {
  sessionId: string
  userId: string
  email: string
  /** The Tenant the session was signed in on; always null on `platform`. */
  claimedTenantId: string | null
}

type SessionReader = (input: { headers: Headers }) => Promise<{
  session: { id: string; claimedTenantId?: string | null }
  user: { id: string; email: string }
} | null>

const sessionReaders: Record<AuthPool, SessionReader> = {
  client: clientAuth.api.getSession as unknown as SessionReader,
  staff: staffAuth.api.getSession as unknown as SessionReader,
  platform: platformAuth.api.getSession as unknown as SessionReader,
}

/**
 * Is this bearer token a Better Auth session token rather than a Clerk JWT?
 *
 * The shapes cannot be confused: a Better Auth bearer token is the session token
 * and its signature (`token.sig`, one dot), a JWT is three segments. So a
 * middleware routes by shape and asks exactly one issuer — no session lookup on
 * every Clerk request, no call to Clerk on every Better Auth one. Goes with the
 * Clerk path (#106).
 */
export function isPoolSessionToken(token: string): boolean {
  return token.split('.').length !== 3
}

/**
 * The session a bearer token names in this pool, or null.
 *
 * Null for a token another pool issued, too: the pools share a signing secret
 * but not a table, so the signature checks out and the lookup finds nothing.
 *
 * Only the `Authorization` header is handed over. Given the whole request,
 * Better Auth falls back to a session cookie when the bearer token fails its
 * signature — so `Bearer junk` beside a stray cookie would still sign someone
 * in, and "sessions travel as bearer tokens" would be half true.
 */
export async function readPoolSession(pool: AuthPool, bearerToken: string): Promise<PoolSession | null> {
  const headers = new Headers({ authorization: `Bearer ${bearerToken}` })
  const found = await sessionReaders[pool]({ headers })
  if (!found) return null
  return {
    sessionId: found.session.id,
    userId: found.user.id,
    email: found.user.email,
    claimedTenantId: found.session.claimedTenantId ?? null,
  }
}
