import { portalHomePath } from "./super-portal";
import { isSuperPortalHost } from "./tenant-host";

/**
 * Where a signed-in user landing on /login should be sent instead. Returns
 * null when the page should be left alone.
 *
 * `next` is only honoured for internal paths that aren't /login itself, so a
 * crafted ?next= can't open-redirect or loop.
 *
 * The fallback is read from the hostname rather than fixed, because one
 * deployment serves two products: `/admin` does not exist on the super portal's
 * hostname, so defaulting to it there sends the user out of the app they just
 * signed in to.
 *
 * Two callers, one rule. On a **studio's** portal only the login page can ask:
 * the staff session is a bearer token in the page's own storage, which the edge
 * never sees, so the client form below is the whole of the guard there. The
 * **super portal** still signs in through Clerk, whose cookie the edge does see,
 * so `lib/platform-proxy.ts` asks at the edge with a whole URL as well. Where
 * both ask they must agree — a client guard that redirected where the edge
 * would not (or a `next` the edge would refuse) is a loop between the two.
 */
const LOGIN_PAGE = /^\/login(\/|$)/;

/** The `?next=` on the login page, when it is safe to send someone to it. */
export function safeNextPath(params: URLSearchParams): string | null {
  const next = params.get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !LOGIN_PAGE.test(next)
    ? next
    : null;
}

/**
 * The rule, for a client component that holds `pathname` and `searchParams`.
 *
 * `superPortal` is passed rather than read, because the hostname is the one
 * input a client component cannot have during the server render.
 */
export function signedInRedirectTarget(
  pathname: string,
  params: URLSearchParams,
  superPortal: boolean,
): string | null {
  if (!LOGIN_PAGE.test(pathname)) return null;
  return safeNextPath(params) ?? portalHomePath(superPortal);
}

/** The rule, for the edge, which holds a whole URL — the super portal's proxy. */
export function signedInRedirectPath(url: URL): string | null {
  return signedInRedirectTarget(
    url.pathname,
    url.searchParams,
    isSuperPortalHost(url.host),
  );
}
