/**
 * Where a signed-in user landing on an auth page (/login, /register) should be
 * sent instead. Returns null when the request should pass through untouched.
 *
 * Exceptions:
 *  - `__clerk_ticket` (impersonation): /login must stay reachable so the page
 *    can swap the existing session for the ticket's session.
 *  - `next` is only honoured for internal paths that aren't themselves auth
 *    pages, so a crafted ?next= can't open-redirect or loop.
 */
const AUTH_PAGE = /^\/(login|register)(\/|$)/;

export function signedInRedirectPath(url: URL): string | null {
  if (!AUTH_PAGE.test(url.pathname)) return null;
  if (url.searchParams.has("__clerk_ticket")) return null;
  const next = url.searchParams.get("next");
  const safe =
    next && next.startsWith("/") && !next.startsWith("//") && !AUTH_PAGE.test(next);
  return safe ? next : "/";
}
