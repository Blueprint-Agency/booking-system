import { ApiError } from "./api";
import { scheduleErrorMessage } from "./schedule";

function bookingCount(n: number): string {
  return `${n} confirmed booking${n === 1 ? "" : "s"}`;
}

/**
 * A refused workshop save, in words. The server's own sentence when it sends
 * one; a booked day's refusal carries none yet, so its sentence is drawn here
 * from the count it does send.
 */
export function workshopSaveError(err: unknown): string {
  const body = err instanceof ApiError ? (err.body as { error?: unknown; message?: unknown; bookings?: unknown } | null) : null;
  if (body?.error === "workshop_day_has_bookings" && !body.message && typeof body.bookings === "number") {
    return `This day has ${bookingCount(body.bookings)}, so it can't be removed.`;
  }
  return scheduleErrorMessage(err);
}
