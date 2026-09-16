/**
 * What the portal hands the member app when a studio admin impersonates a member
 * (#118): `/impersonate#token=…&grant=…`.
 *
 * - `token` is a real session in the backend's `client` pool, opened for the
 *   member. It becomes this hostname's member session, like any sign-in.
 * - `grant` is the backend-signed proof that a studio admin is behind it. It is
 *   kept in a cookie so the server layout can show the banner, and sent on every
 *   member API call as `x-impersonation-grant` (`lib/api.ts`).
 *
 * In the fragment because a fragment never leaves the browser: the session
 * token reaches no server log, proxy or `Referer`.
 *
 * Pure, so it is testable without a browser.
 */

export const IMPERSONATION_GRANT_COOKIE = "__imp_grant";

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
