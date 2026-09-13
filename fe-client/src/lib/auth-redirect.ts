/**
 * Where a member moves between the auth pages and the rest of the app.
 *
 * Both directions are asked on the client. The session is a bearer token in the
 * page's own storage (`lib/member-auth.ts`), which the edge never sees, so the
 * pages are the whole of the guard:
 *
 *  - a signed-in member landing on /login or /register is sent where they were
 *    headed (`signedInRedirectTarget`); and
 *  - a signed-out visitor to a member page is sent to /login with that page as
 *    its `next` (`signInPathFor`).
 *
 * `next` is only honoured for internal paths that aren't themselves auth pages,
 * so a crafted ?next= can't open-redirect or loop.
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
  return safeNextPath(params) ?? "/";
}

/** The sign-in page for a signed-out visitor to `pathname` (with its `search`). */
export function signInPathFor(pathname: string, search: string): string {
  const params = new URLSearchParams({ next: `${pathname}${search}` });
  return `/login?${params.toString()}`;
}
