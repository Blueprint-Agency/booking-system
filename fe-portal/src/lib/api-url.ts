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
 */
export function fetchApi(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(tenantRequestHeaders())) headers.set(name, value);
  return fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });
}
