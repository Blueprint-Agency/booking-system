/**
 * A read that failed, as a screen may draw it. A failed read is never drawn as
 * data: a failed bookings list drawn as "No bookings", or a failed count drawn
 * as 0, tells a staff member something false. A screen holds each read as a
 * `ReadState`: loading, loaded with its data, or failed, and draws "Couldn't
 * load …" with Try again for the last (`components/ui/load-failure.tsx`).
 *
 * A failure that something else answers keeps the screen waiting instead of
 * drawing a failure beneath it: a `401` is the workspace signing the person out
 * (`workspace-context.tsx`), and a `503` maintenance answer is the maintenance
 * screen (`maintenance-gate.tsx`).
 *
 * Pure, so `node --test` loads it. fe-client has its own copy of the idea; the
 * apps share no code.
 */
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
 * What a screen drawn from several reads shows: `failed` when any failed (it
 * names what it lacks, never an empty state), else `loading` while any is
 * still on its way, else `loaded`.
 */
export function combineReads(
  ...reads: ReadState<unknown>[]
): "loading" | "failed" | "loaded" {
  if (reads.some((r) => r.status === "failed")) return "failed";
  if (reads.some((r) => r.status === "loading")) return "loading";
  return "loaded";
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

/** Whether a list may say it is empty: only a read that loaded and found nothing. */
export function mayDrawEmpty(read: ReadState<readonly unknown[]>): boolean {
  return read.status === "loaded" && read.data.length === 0;
}

/**
 * A count a screen may print: the number once it loaded, else null (draw
 * nothing, or a dash). Never 0 for a read that has no answer.
 */
export function countOf(read: ReadState<readonly unknown[]>): number | null {
  return read.status === "loaded" ? read.data.length : null;
}
