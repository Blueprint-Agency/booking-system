/**
 * Where a signed-in user landing on an auth page (/login, /register) should be
 * sent instead. Returns null when the page should be left alone.
 *
 * Exceptions:
 *  - `__clerk_ticket` (impersonation): the auth pages must stay reachable so
 *    the page can swap the existing session for the ticket's session.
 *  - `next` is only honoured for internal paths that aren't themselves auth
 *    pages, so a crafted ?next= can't open-redirect or loop.
 *
 * Two callers, one rule. `proxy.ts` asks at the edge with a whole URL; the
 * pages ask again on the client, where a `router.push("/login")` from inside
 * the app can put a live session on the form without the edge ever seeing it.
 * They must agree — a client guard that redirected where the edge would not
 * (or a `next` the edge would refuse) is a loop between the two of them.
 */
const AUTH_PAGE = /^\/(login|register)(\/|$)/;

/** The `?next=` on an auth page, when it is safe to send someone to it. */
export function safeNextPath(params: URLSearchParams): string | null {
  const next = params.get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !AUTH_PAGE.test(next)
    ? next
    : null;
}

/** The rule, for a client component that holds `pathname` and `searchParams`. */
export function signedInRedirectTarget(
  pathname: string,
  params: URLSearchParams,
): string | null {
  if (!AUTH_PAGE.test(pathname)) return null;
  if (params.has("__clerk_ticket")) return null;
  return safeNextPath(params) ?? "/";
}

/** The rule, for the edge, which holds a whole URL. */
export function signedInRedirectPath(url: URL): string | null {
  return signedInRedirectTarget(url.pathname, url.searchParams);
}
