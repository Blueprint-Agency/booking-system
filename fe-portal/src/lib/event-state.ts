import type { EventState, Lifecycle } from "@/types";

/**
 * Compute the event state on read, per backend-architecture.md §4e + §7c.
 * Storage holds only `lifecycle`; state is time-derived so the timetable
 * reflects reality immediately rather than waiting on a cron.
 */
export function computeEventState(args: {
  startsAt: string;
  endsAt: string;
  lifecycle: Lifecycle;
  now?: Date;
}): EventState {
  const { startsAt, endsAt, lifecycle } = args;
  if (lifecycle === "cancelled") return "cancelled";
  const now = args.now ?? new Date();
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const t = now.getTime();
  if (t < start) return "scheduled";
  if (t <= end) return "ongoing";
  return "completed";
}
