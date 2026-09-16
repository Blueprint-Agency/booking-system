/**
 * Which app a request to fe-portal is asking for.
 *
 * One deployment serves two different products. `{slug}.portal.…` is a studio's
 * staff portal; `admin.portal.…` is the super portal, where the dev team creates
 * and manages studios. They share a Clerk application and a codebase, and are
 * told apart by hostname alone.
 *
 * Keeping that split as a pure function, rather than a handful of checks spread
 * through `proxy.ts`, is what makes the two rules testable — and they are rules
 * worth testing, because between them they are the reason a studio's staff never
 * see the super portal's routes at all:
 *
 *  1. `/platform/*` on a studio's hostname does not exist. Not "is refused" —
 *     does not exist, byte-identical to any other unknown path, so the section
 *     cannot be discovered by trying URLs.
 *  2. Everything else on the super portal's hostname belongs to `/platform`. The
 *     studio routes (`/admin/schedule`, `/instructor/roster`) have no data to
 *     render there — the super portal carries no Tenant context — so landing on
 *     one is a wrong turn, not a page.
 *
 * None of this is authorisation. The backend's `requirePlatformAdmin` is, and it
 * answers `404` to everyone who is not on the platform allowlist, including a
 * studio's own superadmin. This only decides which UI a hostname gets.
 */

/** Where the super portal's own pages live in the `app/` tree. */
export const PLATFORM_PREFIX = "/platform";

/** Where a studio's staff portal starts. */
export const STUDIO_PREFIX = "/admin";

/** Routes that belong to neither product and must work on both hostnames. */
const SHARED_PREFIXES = ["/login", "/signup", "/api/", "/_next/"];

/**
 * Where a signed-in user belongs on this hostname.
 *
 * The two products do not share a home. `/admin` is a studio route and the
 * super portal has no Tenant to render it for, so sending someone there after
 * sign-in is sending them somewhere that does not exist on their hostname —
 * `portalRouting` bounces it straight back out. The destination has to be
 * decided by the same rule that decided which product they are in.
 */
export function portalHomePath(superPortal: boolean): string {
  return superPortal ? PLATFORM_PREFIX : STUDIO_PREFIX;
}

export type PortalRouting =
  /** Serve the request as-is. */
  | { kind: "pass" }
  /** The path is not part of this hostname's app. */
  | { kind: "not-found" }
  /** Send the caller to the super portal's home. */
  | { kind: "redirect"; to: string };

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function portalRouting(pathname: string, superPortal: boolean): PortalRouting {
  if (SHARED_PREFIXES.some(prefix => pathname.startsWith(prefix))) return { kind: "pass" };

  if (!superPortal) {
    return isUnder(pathname, PLATFORM_PREFIX) ? { kind: "not-found" } : { kind: "pass" };
  }

  return isUnder(pathname, PLATFORM_PREFIX)
    ? { kind: "pass" }
    : { kind: "redirect", to: PLATFORM_PREFIX };
}
