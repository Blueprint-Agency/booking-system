import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getIP } from 'better-auth/api'
import { hashPassword } from 'better-auth/crypto'
import { bearer, emailOTP, twoFactor } from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { currentTenantId, db } from '../../db'
import * as schema from '../../db/schema/auth'
import { clients } from '../../db/schema/identity'
import { env } from '../../env'
import { originAllowed } from '../../lib/allowed-origins'
import { GRANT_TTL_SECONDS } from '../../lib/impersonation-grant'
import { BadRequestError, ForbiddenError } from '../../shared/errors'
import { PLATFORM_MAIL_FROM_NAME } from '../../lib/mailer'
import { authAudit, recordAuthEvent } from './auth-events'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './auth-users'
import { acceptInvitationOnPasswordReset } from './invitations'
import { verifyPoolPassword } from './password-hash'
import { authRateLimit, emailRateLimit } from './rate-limit'
import { twoFactorChallengeHeader } from './two-factor-challenge'
import {
  mailClientCode,
  mailClientPasswordReset,
  mailPlatformPasswordReset,
  mailPlatformTwoFactorCode,
  mailStaffPasswordReset,
  mailStaffTwoFactorCode,
} from './sign-in-mail'

/**
 * Self-hosted auth (Better Auth) — the only issuer. The staff and member
 * middlewares read a `staff` or `client` session from here (`readPoolSession`);
 * the super portal's gate reads a `platform` session (#116). See
 * docs/adr/0004-self-hosted-auth-with-better-auth.md.
 *
 * **Three instances, not one.** Separate user pools are the property being
 * kept: a member must never be able to sign
 * into a portal, and a studio admin's credentials must not exist in the
 * pool the super portal reads. So each pool is its own instance over its own
 * tables (`db/schema/auth.ts`) on its own base path, and a token one pool
 * issued is a row the other two have never seen.
 *
 *   - `client`   — members, `/api/v1/auth/client`. Email + password (#173);
 *                  the first password is set through a mailed link. An emailed
 *                  code only proves an address at registration.
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

/**
 * The client pool's hook: the claim, and one refusal before it is written — a
 * member this studio has blocked gets no session here (#117).
 *
 * Asked of the `clients` row at the Tenant the sign-in named, not of the auth
 * user, because a block is one studio's decision about its own member: the same
 * person may be a member in good standing at another studio, on the same auth
 * user. No row at all is not refused — the harness and the register flow both
 * sign in before or alongside writing one, and a session with no row reaches
 * nothing (`client_not_found` at every member route).
 */
const memberSessionHooks = {
  session: {
    create: {
      before: async (session: Record<string, unknown>) => {
        const tenantId = currentTenantId()
        if (tenantId) {
          const [member] = await db
            .select({ deletedAt: clients.deletedAt })
            .from(clients)
            .where(and(eq(clients.tenantId, tenantId), eq(clients.authUserId, String(session.userId))))
            .limit(1)
          if (member?.deletedAt) throw new APIError('FORBIDDEN', { message: 'client_blocked' })
        }
        return stampTenantClaim.session.create.before(session)
      },
    },
  },
} satisfies BetterAuthOptions['databaseHooks']

/** Five minutes and six digits, for every emailed code on every pool. */
const CODE_TTL_SECONDS = 5 * 60
const CODE_DIGITS = 6

/** How long a member's set-password link works: short, and once (#173). */
export const MEMBER_LINK_TTL_SECONDS = 30 * 60

/**
 * Impersonation opens a real member session (#118), so without this the admin
 * holding it could change the member's password — taking over the account
 * they were only meant to act in. A session with `impersonatedBy` is refused
 * the one endpoint that replaces a password; the reset link is not a session
 * act, and goes to the member's inbox.
 */
function impersonationKeepsPassword() {
  return {
    id: 'impersonation-keeps-password',
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) => ctx.path === '/change-password',
          handler: createAuthMiddleware(async ctx => {
            // Read through `readPoolSession`, not `getSessionFromCtx`: the bearer
            // plugin's before-hook has not yet turned the token into a session
            // cookie for the hooks that run beside it, so from here the request
            // would look signed out.
            const token = ctx.headers?.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
            const session = token ? await readPoolSession('client', token) : null
            if (session?.impersonatedBy) throw new APIError('FORBIDDEN', { message: 'impersonation_forbidden' })
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin
}

/**
 * The origins a request may name, in a redirect or in its `Origin` — the same
 * allowlist CORS reads (`FRONTEND_URLS`).
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
  session: {
    modelName: 'clientAuthSessions',
    additionalFields: {
      ...tenantClaimField,
      // Who opened this session as the member, when a studio admin did (#118).
      impersonatedBy: { type: 'string', required: false, input: false },
    },
  },
  databaseHooks: memberSessionHooks,
  account: { modelName: 'clientAuthAccounts' },
  verification: { modelName: 'clientAuthVerifications' },
  emailAndPassword: {
    enabled: true,
    // An account is made by registration (`services/clients/register.ts`),
    // which proves the email with a code first, or by an admin or an import.
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
    password: { hash: hashPassword, verify: verifyPoolPassword },
    resetPasswordTokenExpiresIn: MEMBER_LINK_TTL_SECONDS,
    sendResetPassword: async ({ user, url }) => mailClientPasswordReset(user, url),
  },
  // The emailed code only proves an address at registration now (#173): it no
  // longer signs anyone in, and the plugin's own password reset and email
  // change by code are not ours — a member's password is set through the link.
  disabledPaths: [
    '/sign-in/email-otp',
    '/email-otp/verify-email',
    '/email-otp/request-password-reset',
    '/forget-password/email-otp',
    '/email-otp/reset-password',
    '/email-otp/request-email-change',
    '/email-otp/change-email',
  ],
  plugins: [
    bearer(),
    emailOTP({
      otpLength: CODE_DIGITS,
      expiresIn: CODE_TTL_SECONDS,
      storeOTP: 'hashed',
      // Off, so a code is mailed to an address with no account yet — that is
      // exactly the registration a code is for. It signs nobody up by itself:
      // its sign-in endpoint is disabled above.
      disableSignUp: false,
      sendVerificationOTP: async ({ email, otp }) => mailClientCode(email, otp),
    }),
    emailRateLimit(currentTenantId),
    impersonationKeepsPassword(),
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
      // Better Auth's hash for every new password; a bcrypt digest carried over
      // by the user import still verifies, so migrated staff keep theirs (#120).
      password: { hash: hashPassword, verify: verifyPoolPassword },
      sendResetPassword: async ({ user, url }) => mail.passwordReset(user, url),
      // A reset on a studio's portal where this person is still pending accepts
      // their invitation there — the link proved the inbox the invitation went to.
      ...(studioPool
        ? {
            onPasswordReset: async ({ user }: { user: { id: string } }) => {
              const tenantId = currentTenantId()
              if (tenantId) await acceptInvitationOnPasswordReset(tenantId, user.id)
            },
          }
        : {}),
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
  /** The staff auth user who opened this session as the member; `client` only (#118). */
  impersonatedBy: string | null
}

type SessionReader = (input: { headers: Headers }) => Promise<{
  session: { id: string; claimedTenantId?: string | null; impersonatedBy?: string | null }
  user: { id: string; email: string }
} | null>

const sessionReaders: Record<AuthPool, SessionReader> = {
  client: clientAuth.api.getSession as unknown as SessionReader,
  staff: staffAuth.api.getSession as unknown as SessionReader,
  platform: platformAuth.api.getSession as unknown as SessionReader,
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
    impersonatedBy: found.session.impersonatedBy ?? null,
  }
}

/**
 * Open a real `client` pool session for a member on a studio admin's behalf, log
 * its start, and return its bearer token (#118).
 *
 * The admin plugin's impersonation, minus its endpoint: that endpoint wants the
 * caller signed into the *same* pool with an admin role, and nobody in the member
 * pool is, or ever should be, an admin. The studio admin is in the staff pool, so
 * the session is created the way the plugin creates it — through the pool's
 * internal adapter, which runs the pool's session hooks — with `impersonatedBy`
 * set, living exactly as long as the grant that goes with it.
 *
 * Inside the caller's Tenant context, so the session is stamped with that
 * Tenant's claim, and a member the studio has blocked gets no session
 * (`client_blocked`), exactly as for their own sign-in.
 *
 * The start is logged here because no endpoint ran for the auth-audit plugin
 * to see; the end is the plugin's, when the session is signed out. `from` is the
 * studio admin's request, whose address and user agent the row records.
 */
export async function openImpersonationSession(input: {
  memberAuthUserId: string
  staffAuthUserId: string
  from: Headers
}): Promise<{ token: string }> {
  const context = await clientAuth.$context
  let session: { token: string } | null
  try {
    session = await context.internalAdapter.createSession(
      input.memberAuthUserId,
      true,
      {
        impersonatedBy: input.staffAuthUserId,
        expiresAt: new Date(Date.now() + GRANT_TTL_SECONDS * 1000),
      },
      true,
    )
  } catch (err) {
    if (err instanceof APIError && err.message === 'client_blocked') throw new BadRequestError('client_blocked')
    throw err
  }
  // Invariant: `createSession` returns the row it wrote or throws — never nothing.
  if (!session) throw new Error('openImpersonationSession: the client pool created no session')

  await recordAuthEvent({
    pool: 'staff',
    kind: 'impersonation_started',
    actorUserId: input.staffAuthUserId,
    subjectUserId: input.memberAuthUserId,
    ip: getIP(input.from, context.options),
    userAgent: input.from.get('user-agent'),
  })
  return { token: session.token }
}

/**
 * The address and user agent a request came from, read the way the pools read
 * them for their own audit rows — for an act logged outside an auth endpoint.
 */
export async function requestAddress(from: Headers): Promise<{ ip: string | null; userAgent: string | null }> {
  const context = await staffAuth.$context
  return { ip: getIP(from, context.options), userAgent: from.get('user-agent') }
}

/**
 * Mail a staff member the link that sets their password, at the request of an
 * admin (#119) — Better Auth's own reset, which creates the credential when the
 * account has none.
 *
 * Through the pool's handler, as `mailMemberSetPasswordLink` is, so the origin check
 * and the pool's mail hook are the ones a person asking for it meets. The
 * request is made as from the studio's own portal (`portalUrl`), which is where
 * the link lands, inside the caller's Tenant context, which is whose copy words
 * the mail. The admin's address and user agent go with it.
 */
export async function mailStaffSetPasswordLink(from: Headers, email: string, portalUrl: string): Promise<void> {
  const origin = new URL(portalUrl).origin
  const headers = new Headers({ 'content-type': 'application/json', origin })
  // The admin's address and agent; not their Origin or Tenant header, which the portal URL stands in for.
  for (const name of FORWARDED_HEADERS.filter(h => h === 'x-forwarded-for' || h === 'user-agent')) {
    const value = from.get(name)
    if (value) headers.set(name, value)
  }
  const res = await staffAuth.handler(
    new Request(`${env.BETTER_AUTH_URL}${AUTH_BASE_PATH.staff}/request-password-reset`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, redirectTo: `${origin}/login` }),
    }),
  )
  if (!res.ok) await refusePasswordLink('staff', res)
}

/**
 * A set-password request the pool turned down. A refusal a person can meet — a
 * rate limit, an origin it would not trust — is named; anything else means we
 * built the request wrong, or the pool crashed, and stays a 500.
 */
async function refusePasswordLink(pool: 'staff' | 'platform', res: Response): Promise<never> {
  const detail = await res.text()
  if (res.status === 429 || res.status === 403) {
    throw new ForbiddenError('password_link_refused', { status: res.status })
  }
  // Invariant: the request above is well-formed and the pool does not crash on one — anything else is our bug.
  throw new Error(`${pool} pool failed a set-password request (${res.status}): ${detail}`)
}

/**
 * Mail a super portal operator the link that sets their password — the platform
 * pool's own reset, which creates the credential when the account has none.
 *
 * Through the pool's handler, as `mailStaffSetPasswordLink` is, so the origin
 * check, the rate limit and the mail hook are the ones "Forgot password" meets.
 * `origin` is the super portal page that asked, and where the link lands.
 */
export async function mailPlatformSetPasswordLink(from: Headers, email: string, origin: string): Promise<void> {
  const headers = new Headers({ 'content-type': 'application/json', origin })
  for (const name of FORWARDED_HEADERS.filter(h => h === 'x-forwarded-for' || h === 'user-agent')) {
    const value = from.get(name)
    if (value) headers.set(name, value)
  }
  const res = await platformAuth.handler(
    new Request(`${env.BETTER_AUTH_URL}${AUTH_BASE_PATH.platform}/request-password-reset`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, redirectTo: `${origin}/login` }),
    }),
  )
  if (!res.ok) await refusePasswordLink('platform', res)
}

/** Why a member's emailed code was not accepted — Better Auth's own codes. */
export type MemberCodeRefusal = 'INVALID_OTP' | 'OTP_EXPIRED' | 'TOO_MANY_ATTEMPTS'

/**
 * Is this the code mailed to `email` for signing in? Checked, not spent: the
 * code stays usable for the sign-in that follows, and a wrong guess still
 * counts against the address's attempts.
 *
 * "User not found" is a yes. Better Auth checks the code first and the user
 * second, and a code for an address with no account yet is exactly what
 * registration holds.
 */
export async function checkMemberCode(email: string, otp: string): Promise<MemberCodeRefusal | null> {
  try {
    await clientAuth.api.checkVerificationOTP({ body: { email, otp, type: 'sign-in' } })
    return null
  } catch (err) {
    const code = err instanceof APIError ? (err.body as { code?: string } | undefined)?.code : undefined
    if (code === 'USER_NOT_FOUND') return null
    if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED' || code === 'TOO_MANY_ATTEMPTS') return code
    throw err
  }
}

/** The request headers a sign-in made on a member's behalf carries over from theirs. */
const FORWARDED_HEADERS = ['origin', 'x-tenant-slug', 'x-forwarded-for', 'user-agent'] as const

/**
 * Spend a member's registration code, once the account it proves is written:
 * it has done its one job, and must not be offered again. The code no longer
 * signs anyone in (`disabledPaths`), so nothing else would spend it.
 */
export async function spendMemberCode(email: string): Promise<void> {
  const context = await clientAuth.$context
  await context.internalAdapter.deleteVerificationByIdentifier(`sign-in-otp-${email.trim().toLowerCase()}`)
}

/** A refused call to the member pool: its status and its body, as the browser would have had them. */
export type MemberAuthRefusal = { status: number; body: unknown }

/**
 * Call the member pool's handler in-process, as if the member's browser had.
 *
 * Through the handler rather than `clientAuth.api.*`, so the call meets
 * everything a real one does — the origin check, the rate limits, the audit
 * row and the session hooks above. `headers` says who it comes from.
 */
async function callMemberPool(path: string, headers: Headers, body: unknown): Promise<Response> {
  headers.set('content-type', 'application/json')
  return clientAuth.handler(
    new Request(`${env.BETTER_AUTH_URL}${AUTH_BASE_PATH.client}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

/** The caller's `Origin`, Tenant and address — or just `names` of them — for a call made on their behalf. */
function forwardedFrom(from: Headers, names: readonly string[] = FORWARDED_HEADERS): Headers {
  const headers = new Headers()
  for (const name of names) {
    const value = from.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

async function refusal(res: Response): Promise<MemberAuthRefusal> {
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // Not JSON; the text is the body.
  }
  return { status: res.status, body }
}

/** Sign a member in with their password, in-process, on the caller's behalf. */
export async function signInMemberWithPassword(
  from: Headers,
  email: string,
  password: string,
): Promise<{ token: string } | MemberAuthRefusal> {
  const res = await callMemberPool('/sign-in/email', forwardedFrom(from), { email, password })
  const token = res.headers.get('set-auth-token')
  if (res.ok && token) return { token }
  return refusal(res)
}

/**
 * Does this address have a member password? The one thing the email step of
 * the sign-in form reveals (#173) — and so, that an account exists somewhere
 * on the platform, the accepted cost of an email-first form (ADR 0005). It says
 * nothing about whether the address is a member of the studio asking.
 */
export async function memberHasPassword(email: string): Promise<boolean> {
  const context = await clientAuth.$context
  const found = await context.internalAdapter.findUserByEmail(email.trim().toLowerCase(), { includeAccounts: true })
  return Boolean(found?.accounts.some(account => account.providerId === 'credential' && account.password))
}

/**
 * Does this address have a staff password, at any studio? What the portal's
 * email step reveals (`staff-sign-in-step.ts`), as `memberHasPassword` is for
 * the member form.
 */
export async function staffHasPassword(email: string): Promise<boolean> {
  const context = await staffAuth.$context
  const found = await context.internalAdapter.findUserByEmail(email.trim().toLowerCase(), { includeAccounts: true })
  return Boolean(found?.accounts.some(account => account.providerId === 'credential' && account.password))
}

/**
 * Ask the member pool to mail a set-password link (#173) — Better Auth's own
 * reset, which creates the credential when there is none and replaces it when
 * there is. Whether anything is mailed is `mailClientPasswordReset`'s call:
 * only a member of the studio in context gets one.
 *
 * The link lands on `appUrl`'s `/set-password`, the studio's member app. The
 * request is made as from that app, with the caller's address and user agent,
 * so the per-address and per-email budgets are the ones the caller spends.
 */
export async function mailMemberSetPasswordLink(
  from: Headers,
  email: string,
  appUrl: string,
): Promise<'requested' | 'rate_limited'> {
  const origin = new URL(appUrl).origin
  const headers = forwardedFrom(from, ['x-forwarded-for', 'user-agent'])
  headers.set('origin', origin)
  const res = await callMemberPool('/request-password-reset', headers, {
    email: email.trim().toLowerCase(),
    redirectTo: `${origin}/set-password`,
  })
  if (res.status === 429) return 'rate_limited'
  if (!res.ok) throw new Error(`mailMemberSetPasswordLink: the client pool refused (${res.status}): ${await res.text()}`)
  return 'requested'
}

/** Why a set-password link was not accepted. */
export type SetPasswordRefusal = 'invalid_token' | 'password_too_short' | 'password_too_long'

/**
 * Whose set-password link this is, or null for one that is used, expired or
 * never existed. Read without spending it, so the caller can decide whether
 * this studio may use it before anything changes.
 */
export async function memberLinkOwner(token: string): Promise<{ id: string; email: string } | null> {
  const context = await clientAuth.$context
  const verification = await context.internalAdapter.findVerificationValue(`reset-password:${token}`)
  if (!verification || verification.expiresAt < new Date()) return null
  const user = await context.internalAdapter.findUserById(verification.value)
  return user ? { id: user.id, email: user.email } : null
}

/**
 * Set a member's password from the mailed link and sign them in (#173): the
 * link's first use is their first sign-in, so it ends in a session at the
 * studio the page is on, stamped with its claim like any other. Better Auth's
 * reset spends the token, and refuses a used or expired one. `email` is the
 * owner's, from `memberLinkOwner`, for the sign-in that follows.
 */
export async function setMemberPasswordFromLink(
  from: Headers,
  token: string,
  password: string,
  email: string,
): Promise<{ token: string } | SetPasswordRefusal | MemberAuthRefusal> {
  const reset = await callMemberPool('/reset-password', forwardedFrom(from), { token, newPassword: password })
  if (!reset.ok) {
    const refused = await refusal(reset)
    const code = (refused.body as { code?: string } | null)?.code
    if (code === 'INVALID_TOKEN') return 'invalid_token'
    if (code === 'PASSWORD_TOO_SHORT') return 'password_too_short'
    if (code === 'PASSWORD_TOO_LONG') return 'password_too_long'
    return refused
  }
  return signInMemberWithPassword(from, email, password)
}
