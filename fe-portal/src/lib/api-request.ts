/**
 * One round trip to the backend: send, read the body, and report what went
 * wrong on the backend's side. `api.ts` builds the request and turns the answer
 * into data or an `ApiError`; this is the part that has to be right for a hung
 * or failing backend to show up anywhere but a spinner. fe-client has its own
 * copy — the apps share no code.
 *
 *  - **A deadline.** Every request is aborted after `timeoutMs` unless the
 *    caller passes its own `signal`, in which case the caller decides when to
 *    give up. A timed-out request rejects with a `TimeoutError`.
 *  - **Reported: 5xx and network failures**, timeouts included, with the status
 *    and — when the body carries one — the backend's `requestId`, so a frontend
 *    event can be joined to its backend log line. A 4xx is the caller's to
 *    handle, and a caller's own abort is not a failure.
 *
 * The reporter is passed in, so the tests need no browser and no telemetry.
 */

/** How long a request may take before it is abandoned, when the caller sets no signal. */
export const DEFAULT_API_TIMEOUT_MS = 15_000;

/**
 * The deadline for a `FormData` upload. A studio import carries a whole studio's
 * archive, and abandoning it in the browser while the backend carries on would
 * leave the admin retrying into a studio that is no longer empty.
 */
export const UPLOAD_TIMEOUT_MS = 10 * 60_000;

export type ErrorReporter = (error: unknown, context?: Record<string, unknown>) => void;

export interface ApiRequestOptions {
  report: ErrorReporter;
  /** Names the app in the reported message, e.g. "Portal API". */
  label: string;
  timeoutMs?: number;
}

export interface ApiAnswer {
  ok: boolean;
  status: number;
  /** Parsed JSON, the raw text when it isn't JSON, or null when empty. */
  body: unknown;
}

function requestIdOf(body: unknown): string | undefined {
  if (body && typeof body === "object" && "requestId" in body) {
    const id = (body as { requestId: unknown }).requestId;
    if (typeof id === "string") return id;
  }
  return undefined;
}

export async function sendApiRequest(
  url: string,
  init: RequestInit,
  { report, label, timeoutMs = DEFAULT_API_TIMEOUT_MS }: ApiRequestOptions,
): Promise<ApiAnswer> {
  const method = init.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const callerAborted = init.signal?.aborted === true && err === init.signal.reason;
    if (!callerAborted) {
      report(new Error(`${label} network request failed`), {
        scope: "api-fetch-network",
        method,
        errorType: err instanceof Error ? err.name : typeof err,
      });
    }
    throw err;
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (res.status >= 500) {
    report(new Error(`${label} returned ${res.status}`), {
      scope: "api-fetch-5xx",
      method,
      status: res.status,
      requestId: requestIdOf(body),
    });
  }
  return { ok: res.ok, status: res.status, body };
}
