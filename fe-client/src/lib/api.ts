"use client";

/**
 * Thin fetch wrapper for the member-facing backend.
 *
 * Auth: a `getToken` callback is invoked on every request, and the member's
 * session token it returns (`lib/member-auth.ts`) is sent as
 * `Authorization: Bearer ...`. Public endpoints pass one that returns null.
 *
 * Errors: non-2xx responses throw an `ApiError` that carries `status` plus the
 * parsed JSON body (if any) so callers can render structured copy. A 401 on a
 * call that sent a token also signs the member out (`lib/session-expiry.ts`).
 *
 * Deadline and failure reporting: `lib/api-request.ts`. Pass `signal` to set
 * your own deadline in place of the default.
 */
import { sendApiRequest } from "@/lib/api-request";
import { getApiBaseUrl } from "@/lib/api-url";
import { getMemberToken } from "@/lib/member-auth";
import { reportError } from "@/lib/report-error";
import { noteSessionExpiry } from "@/lib/session-expiry";
import { tenantRequestHeaders } from "@/lib/tenant-host";
import { currentImpersonationGrant, IMPERSONATION_GRANT_HEADER } from "@/lib/impersonation-handoff";

export type TokenGetter = () => Promise<string | null>;

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** The `error` code a refusal's body carries, or "" for anything else. */
export function apiErrorCode(err: unknown): string {
  return err instanceof ApiError &&
    err.body &&
    typeof err.body === "object" &&
    "error" in err.body
    ? String((err.body as { error: unknown }).error)
    : "";
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(
    `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`,
  );
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.append(k, String(v));
    }
  }
  return url.toString();
}

export async function apiFetch<T = unknown>(
  path: string,
  getToken: TokenGetter,
  opts: RequestOptions = {},
): Promise<T> {
  const token = await getToken();
  // The API hostname carries no tenancy — one backend serves every studio — so
  // every call names its own Tenant, read off the page's host.
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...tenantRequestHeaders(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const impGrant = currentImpersonationGrant();
  if (impGrant) headers[IMPERSONATION_GRANT_HEADER] = impGrant;

  const answer = await sendApiRequest(
    buildUrl(path, opts.query),
    {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    },
    { report: reportError, label: "Client API" },
  );
  if (!answer.ok) {
    // Only a call that actually sent `Authorization` (an empty token sends none).
    noteSessionExpiry(answer.status, Boolean(token), token || undefined);
    throw new ApiError(answer.status, answer.body);
  }
  return answer.body as T;
}

export function makeApi(getToken: TokenGetter) {
  return {
    get: <T>(path: string, query?: RequestOptions["query"]) =>
      apiFetch<T>(path, getToken, { method: "GET", query }),
    post: <T>(path: string, body?: unknown) =>
      apiFetch<T>(path, getToken, { method: "POST", body }),
    patch: <T>(path: string, body?: unknown) =>
      apiFetch<T>(path, getToken, { method: "PATCH", body }),
    del: <T>(path: string) =>
      apiFetch<T>(path, getToken, { method: "DELETE" }),
  };
}

export type Api = ReturnType<typeof makeApi>;

/**
 * The member's API client, bound to this hostname's session token. One
 * instance: the token is read on every call, so there is nothing to rebind
 * when the session changes.
 */
const memberApi: Api = makeApi(getMemberToken);

export function useApi(): Api {
  return memberApi;
}

/** Anonymous API client — for /public endpoints. */
export const publicApi: Api = makeApi(async () => null);
