import { portalHomePath } from "./super-portal";
import { isSuperPortalHost } from "./tenant-host";

/**
 * Where a signed-in user landing on /login should be sent instead. Returns
 * null when the request should pass through untouched.
 *
 * `next` is only honoured for internal paths that aren't /login itself, so a
 * crafted ?next= can't open-redirect or loop.
 *
 * The fallback is read from the hostname rather than fixed, because one
 * deployment serves two products: `/admin` does not exist on the super portal's
 * hostname, so defaulting to it there sends the user out of the app they just
 * signed in to.
 */
const LOGIN_PAGE = /^\/login(\/|$)/;

export function signedInRedirectPath(url: URL): string | null {
  if (!LOGIN_PAGE.test(url.pathname)) return null;
  const next = url.searchParams.get("next");
  const safe =
    next && next.startsWith("/") && !next.startsWith("//") && !LOGIN_PAGE.test(next);
  return safe ? next : portalHomePath(isSuperPortalHost(url.host));
}
