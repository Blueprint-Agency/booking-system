import { DEFAULT_API_TIMEOUT_MS } from "@/lib/api-request";
import { currentImpersonationGrant, IMPERSONATION_GRANT_HEADER } from "@/lib/impersonation-handoff";
import { bearerToken, noteSessionExpiry } from "@/lib/session-expiry";
import { tenantRequestHeaders } from "@/lib/tenant-host";

/** Backend API base URL, always ending with `/api/v1`. */
export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const trimmed = raw.replace(/\/$/, "");
  if (trimmed.endsWith("/api/v1")) return trimmed;
  return `${trimmed}/api/v1`;
}

/**
 * `fetch` against the backend, taking a path relative to `/api/v1`.
 *
 * The one place raw backend calls carry Tenant context: the API hostname never
 * contains the Tenant (one backend serves every studio), so `X-Tenant-Slug` has
 * to travel on the call itself. Routing every raw fetch through here is what
 * makes "on every API call" a property of the code rather than a rule someone
 * has to remember at the next call site. The `api.ts` client does the same for
 * everything that goes through it.
 *
 * It carries the same default deadline as `api.ts` (`lib/api-request.ts`), so a
 * hung backend ends in an error rather than a spinner; pass `signal` to set your own.
 *
 * A 401 on a call that sent a bearer token signs the member out here
 * (`lib/session-expiry.ts`), so no call site has to remember to.
 */
export async function fetchApi(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(tenantRequestHeaders())) headers.set(name, value);
  // An impersonation session is refused (401) on any call without its grant —
  // which would then sign the member out — so a signed-in call carries it here
  // exactly as `api.ts` does (`lib/impersonation-handoff.ts`).
  const impGrant = currentImpersonationGrant();
  if (impGrant && bearerToken(headers)) headers.set(IMPERSONATION_GRANT_HEADER, impGrant);
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(DEFAULT_API_TIMEOUT_MS),
  });
  const sent = bearerToken(headers);
  noteSessionExpiry(res.status, sent !== undefined, sent);
  return res;
}
