/**
 * A read that failed with nothing to show, as the page that asked may draw it.
 * Never as a value: a failed `/me/packages` drawn as 0 credits, or a
 * failed timetable drawn as "No classes", tells a member something false. A
 * failure no relay answers is thrown during render, to the route's error
 * boundary (`app/error.tsx`).
 *
 * A 404 is a failure too, unless the read has a not-found state of its own and
 * says so (`notFound: "answer"`, the workshop detail): then it settles with
 * nothing and the page draws "Workshop not found". A list or a balance has no
 * such state, so a 404 there would be drawn as an empty list or a zero.
 *
 * No `@/` imports, so `node --test` can load it.
 */
import { maintenanceMessage } from "./maintenance.ts";
import { studioRefusal } from "./studio-refusal.ts";

function statusOf(err: unknown): { status: number; body: unknown } | null {
  if (!err || typeof err !== "object" || !("status" in err)) return null;
  const { status, body } = err as { status: unknown; body?: unknown };
  return typeof status === "number" ? { status, body } : null;
}

export type FailedReadOptions = { optional?: boolean; notFound?: "answer" };

export function afterFailedRead(
  err: unknown,
  { optional = false, notFound }: FailedReadOptions = {},
): { data: null; loading: boolean } {
  const answer = statusOf(err);
  if (answer?.status === 404 && notFound === "answer") return { data: null, loading: false };
  if (
    answer &&
    (answer.status === 401 ||
      studioRefusal(answer.status, answer.body) !== null ||
      maintenanceMessage(answer.status, answer.body) !== null)
  ) {
    return { data: null, loading: true };
  }
  if (optional) return { data: null, loading: false };
  throw err;
}
