/**
 * Thin fetch wrapper for the Yoga Sadhana portal backend.
 *
 * Auth: a `getToken` callback (from Clerk's `useAuth()`) is invoked on every
 * request; the resulting JWT is sent as `Authorization: Bearer ...`.
 *
 * Errors: non-2xx responses throw an `ApiError` that carries `status` plus the
 * parsed JSON body (if any) so callers can render structured copy.
 */
import { reportError } from "@/lib/report-error";

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
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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
  // A FormData body goes as-is: the browser has to set the multipart boundary,
  // so declaring a Content-Type here would break the upload.
  const isFormData = opts.body instanceof FormData;
  if (opts.body !== undefined && !isFormData) headers["Content-Type"] = "application/json";

  const method = opts.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body:
        opts.body === undefined
          ? undefined
          : isFormData
            ? (opts.body as FormData)
            : JSON.stringify(opts.body),
      signal: opts.signal,
      // This is an authenticated API client — auth/role responses must never be
      // served from the HTTP/bfcache. Always hit the network with the live token.
      cache: "no-store",
    });
  } catch (err) {
    reportError(new Error("Portal API network request failed"), {
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
      reportError(new Error(`Portal API returned ${res.status}`), {
        scope: "api-fetch-5xx",
        method,
        status: res.status,
      });
    }
    throw error;
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
    put: <T>(path: string, body?: unknown) =>
      apiFetch<T>(path, getToken, { method: "PUT", body }),
    del: <T>(path: string) =>
      apiFetch<T>(path, getToken, { method: "DELETE" }),
  };
}

export type Api = ReturnType<typeof makeApi>;

/**
 * Open a short-lived signed URL the backend mints on demand (medical
 * Supporting Documents). The tab is opened synchronously so the click's user gesture
 * still counts — a `window.open` after an `await` is what popup blockers eat.
 */
export async function openSignedUrl(api: Api, path: string): Promise<void> {
  const tab = window.open("about:blank", "_blank");
  try {
    const { url } = await api.get<{ url: string }>(path);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (err) {
    tab?.close();
    throw err;
  }
}
