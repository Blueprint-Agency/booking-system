/**
 * A read that failed with nothing to show, as the page that asked may draw it
 * (#250). Never as a value: a failed `/me/packages` drawn as 0 credits, or a
 * failed timetable drawn as "No classes", tells a member something false. A
 * failure no relay answers is thrown during render, to the route's error
 * boundary (`app/error.tsx`).
 *
 * A 404 is not a failure but an answer: the read settles with nothing and its
 * error, and the page draws its own not-found state ("Workshop not found").
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

export function afterFailedRead(
  err: unknown,
  { optional = false }: { optional?: boolean } = {},
): { data: null; loading: boolean } {
  const answer = statusOf(err);
  if (answer?.status === 404) return { data: null, loading: false };
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
