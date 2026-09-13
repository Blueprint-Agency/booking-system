import { ROOT_DOMAIN, isSuperPortalHost } from "./tenant-host";

/**
 * Which Better Auth pool a fe-portal page signs in on, by hostname (#116).
 *
 * One deployment serves two products (`lib/super-portal.ts`), and each has its
 * own pool on the backend (`be/src/services/auth/better-auth.ts`):
 *
 *   - `staff`    — `{slug}.portal.…`, every studio's portal.
 *   - `platform` — `admin.portal.…`, the super portal. Its users are rows no
 *                  studio can write, so a studio superadmin's email and password
 *                  are refused there with no session issued.
 *
 * Separate sessions in one browser follow from the bearer tokens being kept in
 * each hostname's own storage (`lib/portal-auth.ts`), not from anything here:
 * this only decides which pool that storage's token belongs to.
 *
 * Pure, and `host` is passed in, so it is testable without a browser. It holds
 * no secret, so client code may import it.
 */
export type PortalAuthPool = "staff" | "platform";

export function portalAuthPool(
  host: string | null | undefined,
  rootDomain: string = ROOT_DOMAIN,
): PortalAuthPool {
  return isSuperPortalHost(host, rootDomain) ? "platform" : "staff";
}

/** The pool's base path under the API base URL (`getApiBaseUrl()`). */
export function portalAuthBasePath(
  host: string | null | undefined,
  rootDomain: string = ROOT_DOMAIN,
): string {
  return `/auth/${portalAuthPool(host, rootDomain)}`;
}
