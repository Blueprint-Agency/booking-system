/**
 * What the portal hands the member app when a studio admin impersonates a member
 * (#118): `/impersonate#token=…&grant=…`.
 *
 * - `token` is a real session in the backend's `client` pool, opened for the
 *   member. It becomes this hostname's member session, like any sign-in.
 * - `grant` is the backend-signed proof that a studio admin is behind it. It is
 *   kept in a cookie so the server layout can show the banner, and sent on every
 *   member API call as `x-impersonation-grant` — by both `lib/api.ts` and
 *   `fetchApi` (`lib/api-url.ts`). The backend refuses an impersonation
 *   session's call without it (401), and a 401 signs the member out.
 *
 * In the fragment because a fragment never leaves the browser: the session
 * token reaches no server log, proxy or `Referer`.
 *
 * Pure, so it is testable without a browser.
 */

export const IMPERSONATION_GRANT_COOKIE = "__imp_grant";
export const IMPERSONATION_GRANT_HEADER = "x-impersonation-grant";

/** The grant this browser holds, read from a `document.cookie` string; null when none. */
export function readImpersonationGrant(cookie: string): string | null {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${IMPERSONATION_GRANT_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

/** The grant this page holds; null on the server or when not impersonating. */
export function currentImpersonationGrant(): string | null {
  return typeof document === "undefined" ? null : readImpersonationGrant(document.cookie);
}

/** The grant's own life (`be/src/lib/impersonation-grant.ts`). */
const GRANT_TTL_SECONDS = 60 * 60;

export function readImpersonationHandoff(hash: string): { token: string; grant: string } | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const token = params.get("token");
  const grant = params.get("grant");
  if (!token || !grant) return null;
  return { token, grant };
}

/**
 * The `document.cookie` assignment that keeps the grant. Readable by script on
 * purpose: the API client sends it as a header.
 */
export function grantCookie(grant: string, protocol: string): string {
  const parts = [
    `${IMPERSONATION_GRANT_COOKIE}=${encodeURIComponent(grant)}`,
    "path=/",
    `max-age=${GRANT_TTL_SECONDS}`,
    "samesite=lax",
  ];
  if (protocol === "https:") parts.push("secure");
  return parts.join("; ");
}
