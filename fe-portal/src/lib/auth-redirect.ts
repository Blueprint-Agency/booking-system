import { portalHomePath } from "./super-portal";

/**
 * Where a signed-in user landing on /login should be sent instead. Returns
 * null when the page should be left alone.
 *
 * `next` is only honoured for internal paths that aren't /login itself, so a
 * crafted ?next= can't open-redirect or loop.
 *
 * The fallback depends on the hostname rather than being fixed, because one
 * deployment serves two products: `/admin` does not exist on the super portal's
 * hostname, so defaulting to it there sends the user out of the app they just
 * signed in to.
 *
 * One caller: the login form. On both products the session is a bearer token in
 * the page's own storage (`lib/portal-auth.ts`), which the edge never sees, so
 * the form is the whole of this guard.
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
