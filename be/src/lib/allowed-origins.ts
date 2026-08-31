import { env } from '../env'
import {
  parseOriginPatterns,
  isAllowedOrigin,
  tenantOriginFor,
  tenantSlugFromOrigin,
} from './origin'

/**
 * The allowlist, assembled once from the environment.
 *
 * Three sources, deliberately kept together rather than one per consumer: CORS,
 * the Clerk `azp` check and the public-route slug validation must agree about
 * which origins are ours, or one of them becomes the hole in the other two.
 *
 * - `TENANT_ORIGIN_PATTERNS` — the tenant subdomain wildcards, one per
 *   environment (`https://*.reservetoday.app`, `https://*.portal.dev.…`, …).
 * - `PORTAL_ORIGIN` / `CLIENT_ORIGIN` — the single-valued origins that predate
 *   tenancy. Still load-bearing: `PORTAL_ORIGIN` is also the base for
 *   invitation links, and the bare local `http://localhost:3000` names no
 *   tenant at all.
 * - `CLERK_STAFF_AUTHORIZED_PARTIES` — any extra parties an environment pins by
 *   hand. They join the same list rather than getting their own.
 */
export const allowedOriginPatterns = parseOriginPatterns(
  env.TENANT_ORIGIN_PATTERNS,
  env.PORTAL_ORIGIN,
  env.CLIENT_ORIGIN,
  env.CLERK_STAFF_AUTHORIZED_PARTIES,
)

export function originAllowed(origin: string): boolean {
  return isAllowedOrigin(origin, allowedOriginPatterns)
}

/** The tenant slug an `Origin` names, or null when it names none. */
export function originTenantSlug(origin: string): string | null {
  return tenantSlugFromOrigin(origin, allowedOriginPatterns)
}

/**
 * The URL a given tenant is served at, derived from the same wildcards CORS
 * accepts — so the link the super portal hands out and the origin the backend
 * trusts cannot drift apart. Null when this environment configures no wildcard
 * for that app.
 */
export function tenantOrigin(app: 'client' | 'portal', slug: string): string | null {
  return tenantOriginFor(app, slug, allowedOriginPatterns)
}

/**
 * Is a Clerk token's `azp` claim one of our own front ends?
 *
 * Clerk's own `authorizedParties` option is an exact-match list, which cannot
 * express `https://*.portal.reservetoday.app` — every tenant would need its own
 * entry, added by hand, and a tenant created at 2am would sign staff out. So the
 * verifiers do this check instead, against the same patterns CORS uses.
 *
 * A token with no `azp` passes, matching Clerk's behaviour: the claim is only
 * present on tokens minted by a front end that sets it, and refusing its absence
 * would reject the machine-to-machine tokens that never carry one.
 */
export function authorizedPartyAllowed(azp: unknown): boolean {
  if (typeof azp !== 'string' || !azp.trim()) return true
  return originAllowed(azp.trim())
}
