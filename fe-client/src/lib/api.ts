"use client";

/**
 * Thin fetch wrapper for the Yoga Sadhana client backend.
 *
 * Auth: a `getToken` callback (from Clerk's `useAuth()`) is invoked on every
 * request; the resulting JWT is sent as `Authorization: Bearer ...`. Public
 * endpoints can pass a getToken that always returns null.
 *
 * Errors: non-2xx responses throw an `ApiError` that carries `status` plus the
 * parsed JSON body (if any) so callers can render structured copy.
 */
import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";
import { getApiBaseUrl } from "@/lib/api-url";
import { reportError } from "@/lib/report-error";
import { tenantRequestHeaders } from "@/lib/tenant-host";

function readImpGrant(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)__imp_grant=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

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

  const impGrant = readImpGrant();
  if (impGrant) headers["x-impersonation-grant"] = impGrant;

  const method = opts.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    reportError(new Error("Client API network request failed"), {
      scope: "api-fetch-network",
      method,
      errorType: err instanceof Error ? err.name : typeof err,
    });
    throw err;
  }

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const error = new ApiError(res.status, parsed);
    if (res.status >= 500) {
      reportError(new Error(`Client API returned ${res.status}`), {
        scope: "api-fetch-5xx",
        method,
        status: res.status,
      });
    }
    throw error;
  }
  return parsed as T;
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

/** Authed API client bound to the current Clerk session. */
export function useApi(): Api {
  const { getToken } = useAuth();
  return useMemo(() => makeApi(() => getToken()), [getToken]);
}

/** Anonymous API client — for /public endpoints. */
export const publicApi: Api = makeApi(async () => null);
