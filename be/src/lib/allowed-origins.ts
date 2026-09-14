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
 * One source, deliberately shared rather than one per consumer: CORS, the auth
 * pools' trusted origins and the public-route slug validation must agree about
 * which origins are ours, or one of them becomes the hole in the other two.
 *
 * `TENANT_ORIGIN_PATTERNS` — the tenant subdomain wildcards, one per environment
 * (`https://*.reservetoday.app`, `https://*.portal.dev.…`, …), plus any exact
 * origin that names no tenant, such as the bare local `http://localhost:3000`.
 *
 * `PORTAL_ORIGIN` and `CLIENT_ORIGIN` used to be a third source. They named one
 * studio's two apps, which the wildcards already cover, and they were read
 * elsewhere as link bases — which is how a studio's identity got into platform
 * configuration and out again into other studios' emails. An environment that
 * really does need an extra exact origin puts it in `TENANT_ORIGIN_PATTERNS`,
 * which has always accepted one.
 */
export const allowedOriginPatterns = parseOriginPatterns(env.TENANT_ORIGIN_PATTERNS)

/**
 * Both apps must be expressible, or the process does not start.
 *
 * `env.ts` can only check that the variable is non-empty, and non-empty is not
 * the requirement: a list carrying only the client wildcard — an easy slip while
 * migrating off the two deleted single-valued origins — satisfies the schema,
 * boots, serves traffic, and then throws on the first staff invitation, the
 * first checkout and halfway through provisioning the next studio. Those are
 * failures in front of a member or a new studio's owner, hours after the deploy
 * that caused them.
 *
 * Deriving a link is now as load-bearing as accepting an origin, so it is
 * checked at the same moment: once, at boot, while an operator is still
 * watching. The slug is a placeholder — what is being asserted is that a
 * wildcard for each app exists at all, not anything about a tenant.
 */
for (const app of ['client', 'portal'] as const) {
  if (!tenantOriginFor(app, 'any-slug', allowedOriginPatterns)) {
    throw new Error(
      `TENANT_ORIGIN_PATTERNS configures no ${app} wildcard, so no studio's ${app} URL ` +
        'can be derived and every link the backend mails would fail. Add one, with the ' +
        `wildcard as the leftmost label (${
          app === 'portal' ? 'https://*.portal.example.com' : 'https://*.example.com'
        }).`,
    )
  }
}

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
