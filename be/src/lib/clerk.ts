import { createClerkClient, verifyToken, type ClerkClient } from '@clerk/backend'
import { env } from '../env'
import { authorizedPartyAllowed } from './allowed-origins'

/**
 * Two Clerk applications per spec §6a — separate publishable + secret keys,
 * separate JWT issuers, separate user pools. Cross-app tokens are rejected by
 * the respective middleware verifiers.
 *
 * Staff app is wired now; client app is lazy + deferred until the client slice
 * lands so v0 can boot without CLERK_CLIENT_SECRET_KEY set.
 */
export const clerkStaffApp: ClerkClient = createClerkClient({
  secretKey: env.CLERK_STAFF_SECRET_KEY,
  publishableKey: env.CLERK_STAFF_PUBLISHABLE_KEY,
})

let _clerkClientApp: ClerkClient | null = null
export function getClerkClientApp(): ClerkClient {
  if (_clerkClientApp) return _clerkClientApp
  if (!env.CLERK_CLIENT_SECRET_KEY) {
    throw new Error('CLERK_CLIENT_SECRET_KEY is not set — client app is deferred to the next slice')
  }
  _clerkClientApp = createClerkClient({
    secretKey: env.CLERK_CLIENT_SECRET_KEY,
    publishableKey: env.CLERK_CLIENT_PUBLISHABLE_KEY,
  })
  return _clerkClientApp
}

/**
 * Third Clerk application, backing the super portal alone.
 *
 * Lazy and optional in the same shape as the client app, but for a different
 * reason: unset here does not mean "deferred", it means "the super portal
 * shares the staff app's session", which is what shipped before this and stays
 * the fallback so an environment that has not created the third Clerk
 * application keeps working. `isPlatformAppConfigured()` is the one place that
 * distinguishes the two, so callers never have to re-derive it.
 */
export function isPlatformAppConfigured(): boolean {
  // Both halves, matching fe-portal's `platformKeys()`. The two sides have to
  // agree about what "configured" means or they disagree about which instance
  // signs a token: `deploy-be.yml` writes both lines unconditionally, so an
  // unset `CLERK_PLATFORM_PUBLISHABLE_KEY` secret leaves the publishable key
  // blank and the secret set. Keying off the secret alone, the backend would
  // then verify against the platform instance while the frontend — which
  // requires both — kept minting staff-app tokens, and every
  // `/api/v1/platform/*` call would 404 on a signature failure with the boot
  // warning below staying silent because the backend believed it was set up.
  return Boolean(env.CLERK_PLATFORM_SECRET_KEY && env.CLERK_PLATFORM_PUBLISHABLE_KEY)
}

let _clerkPlatformApp: ClerkClient | null = null
export function getClerkPlatformApp(): ClerkClient {
  if (!isPlatformAppConfigured()) return clerkStaffApp
  if (_clerkPlatformApp) return _clerkPlatformApp
  _clerkPlatformApp = createClerkClient({
    secretKey: env.CLERK_PLATFORM_SECRET_KEY,
    publishableKey: env.CLERK_PLATFORM_PUBLISHABLE_KEY,
  })
  return _clerkPlatformApp
}

/**
 * The authorized-parties gate, applied by us rather than by Clerk.
 *
 * Clerk's own `authorizedParties` option is an exact-match list of origins, and
 * under multi-tenancy the set of valid origins is `{slug}.portal.…` for every
 * slug that exists — a list that changes whenever a studio is created. So the
 * claim is checked here against the wildcard allowlist instead, which is the
 * same one CORS uses.
 *
 * `CLERK_STAFF_AUTHORIZED_PARTIES` still contributes: it is folded into that
 * allowlist as extra exact origins (see lib/allowed-origins.ts callers), so an
 * environment that pins specific parties keeps doing so.
 */
function assertAuthorizedParty(claims: Record<string, unknown>): void {
  if (!authorizedPartyAllowed(claims.azp)) {
    throw new Error('unauthorized_party')
  }
}

/**
 * Verifies a staff Clerk JWT. Returns the decoded claims (subject = clerk user id).
 * Throws if signature/issuer/expiry checks fail — caller maps to 401.
 */
export async function verifyStaffToken(token: string): Promise<{ sub: string; [k: string]: unknown }> {
  const claims = await verifyToken(token, {
    secretKey: env.CLERK_STAFF_SECRET_KEY,
  })
  assertAuthorizedParty(claims as Record<string, unknown>)
  return claims as { sub: string; [k: string]: unknown }
}

/**
 * Verifies a super portal Clerk JWT.
 *
 * Routes through the PLATFORM Clerk app when one is configured, and through the
 * staff app when none is — so this is where "the super portal has its own user
 * pool" actually becomes true. With the platform app configured, a studio
 * superadmin's staff token does not reach the `PLATFORM_ADMIN_EMAILS` check at
 * all: it was signed by a different Clerk instance and fails verification here.
 */
export async function verifyPlatformToken(
  token: string,
): Promise<{ sub: string; [k: string]: unknown }> {
  if (!isPlatformAppConfigured()) return verifyStaffToken(token)
  const claims = await verifyToken(token, {
    secretKey: env.CLERK_PLATFORM_SECRET_KEY!,
  })
  assertAuthorizedParty(claims as Record<string, unknown>)
  return claims as { sub: string; [k: string]: unknown }
}

/**
 * Verifies a client (member-facing) Clerk JWT. Mirrors verifyStaffToken but
 * routes through the dedicated CLIENT Clerk app — cross-app tokens MUST be
 * rejected per spec §6a. Throws if CLERK_CLIENT_SECRET_KEY is unset (caller
 * should map to 500) or if signature/issuer/expiry checks fail (caller maps
 * to 401).
 */
export async function verifyClientToken(token: string): Promise<{ sub: string; [k: string]: unknown }> {
  if (!env.CLERK_CLIENT_SECRET_KEY) {
    throw new Error('CLERK_CLIENT_SECRET_KEY is not set — client Clerk app not configured')
  }
  const claims = await verifyToken(token, {
    secretKey: env.CLERK_CLIENT_SECRET_KEY,
  })
  assertAuthorizedParty(claims as Record<string, unknown>)
  return claims as { sub: string; [k: string]: unknown }
}
