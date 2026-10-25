/**
 * A read that failed with nothing to show, as the page that asked may draw it
 * (#250). Never as a value: a failed `/me/packages` drawn as 0 credits, or a
 * failed timetable drawn as "No classes", tells a member something false. A
 * failure no relay answers is thrown during render, to the route's error
 * boundary (`app/error.tsx`).
 *
 * No `@/` imports, so `node --test` can load it.
 */
import { maintenanceMessage } from "./maintenance.ts";
import { studioRefusal } from "./studio-refusal.ts";

function answeredElsewhere(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  const { status, body } = err as { status: unknown; body?: unknown };
  if (typeof status !== "number") return false;
  return status === 401 || studioRefusal(status, body) !== null || maintenanceMessage(status, body) !== null;
}

export function afterFailedRead(
  err: unknown,
  { optional = false }: { optional?: boolean } = {},
): { data: null; loading: boolean } {
  if (answeredElsewhere(err)) return { data: null, loading: true };
  if (optional) return { data: null, loading: false };
  throw err;
}
