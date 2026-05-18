/**
 * Thin fetch wrapper for the Yoga Sadhana portal backend.
 *
 * Auth: a `getToken` callback (from Clerk's `useAuth()`) is invoked on every
 * request; the resulting JWT is sent as `Authorization: Bearer ...`.
 *
 * Errors: non-2xx responses throw an `ApiError` that carries `status` plus the
 * parsed JSON body (if any) so callers can render structured copy.
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
    path.startsWith("/") ? `/api/v1${path}` : `/api/v1/${path}`,
    BASE_URL,
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
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

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
    throw new ApiError(res.status, parsed);
  }
  return parsed as T;
}

/**
 * Convenience: bind a `getToken` once and get an `api.{get,post,patch,del}`
 * surface for the lifetime of a component.
 */
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
