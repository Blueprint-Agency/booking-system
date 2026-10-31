/**
 * A read that failed, as a screen may draw it. A failed read is never drawn as
 * data: a failed bookings list drawn as "No bookings", or a failed count drawn
 * as 0, tells a staff member something false. A screen holds each read as a
 * `ReadState`: loading, loaded with its data, or failed, and draws "Couldn't
 * load …" with Try again for the last (`components/ui/load-failure.tsx`).
 *
 * A failure that something else answers draws no failure of its own: a `401`
 * on a call that sent a token ends the session (`session-expiry.ts`, wired in
 * `api.ts`), and both shells then send the person to sign in; a `503`
 * maintenance answer puts up the maintenance screen (`maintenance-gate.tsx`).
 *
 * Pure, so `node --test` loads it. fe-client has its own copy of the idea; the
 * apps share no code.
 */
import { permissionRefusal } from "./access-refusal";
import { maintenanceMessage } from "./maintenance";

export type ReadState<T> =
  | { status: "loading" }
  | { status: "loaded"; data: T }
  | { status: "failed" };

export const READ_LOADING: ReadState<never> = { status: "loading" };

export function readLoaded<T>(data: T): ReadState<T> {
  return { status: "loaded", data };
}

function statusOf(err: unknown): { status: number; body: unknown } | null {
  if (!err || typeof err !== "object" || !("status" in err)) return null;
  const { status, body } = err as { status: unknown; body?: unknown };
  return typeof status === "number" ? { status, body } : null;
}

/** Whether something else already answers this failure: a `401`, or maintenance. */
export function answeredElsewhere(err: unknown): boolean {
  const answer = statusOf(err);
  if (!answer) return false;
  return answer.status === 401 || maintenanceMessage(answer.status, answer.body) !== null;
}

/**
 * The state a read settles in after it threw. A failure answered elsewhere
 * keeps waiting; any other is failed, a `404` and a network error included.
 */
export function afterFailedRead<T>(err: unknown): ReadState<T> {
  return answeredElsewhere(err) ? READ_LOADING : { status: "failed" };
}

/**
 * Whether a failed read still needs reporting. `sendApiRequest` already reports
 * a 5xx and a network failure or timeout (`lib/api-request.ts`), and a `401` or
 * maintenance answer is no fault of the screen's. What is left is a 4xx the
 * request does not report, and an error the screen itself threw.
 */
export function reportableFailure(err: unknown): boolean {
  if (answeredElsewhere(err)) return false;
  const answer = statusOf(err);
  if (answer) return answer.status < 500;
  if (err instanceof Error || (typeof DOMException !== "undefined" && err instanceof DOMException)) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return false;
    if (err instanceof TypeError && /fetch|network/i.test(err.message)) return false;
  }
  return true;
}

/**
 * The reason to print beside "Couldn't load …", or undefined: a switch an
 * Admin turned off, or a 4xx refusal that came with words. A server fault has
 * none worth printing, and the line says only that it couldn't load.
 */
export function failureDetail(err: unknown): string | undefined {
  const refused = permissionRefusal(err);
  if (refused) return refused;
  const answer = statusOf(err);
  if (!answer || answer.status >= 500 || !answer.body || typeof answer.body !== "object") return undefined;
  const { message } = answer.body as { message?: unknown };
  return typeof message === "string" && message.trim() ? message : undefined;
}

/** A screen's failed list read: it failed, and perhaps why. Held in place of an error string. */
export interface LoadError {
  detail: string | undefined;
}

export function loadError(err: unknown): LoadError {
  return { detail: failureDetail(err) };
}

/** "Couldn't load the studio list." */
export function loadFailureSentence(what: string): string {
  return `Couldn't load ${what}.`;
}

/**
 * The rows a list draws: the loaded ones, or none while loading or failed. An
 * empty state is only for `data.length === 0` on a loaded read.
 */
export function rowsOf<T>(read: ReadState<readonly T[]>): readonly T[] {
  return read.status === "loaded" ? read.data : [];
}
