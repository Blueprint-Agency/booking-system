/**
 * One body, one class at a time: a member may not hold two bookings whose
 * times overlap. The server decides (`be/src/services/bookings/member-time.ts`)
 * and says which booking stands in the way — on each class card as `clash`,
 * and on a refused booking or waitlist join as `409 time_clash { clash }`.
 * This file only words it. Pure, so each line can be tested. Times are read on
 * the studio's clock, so each wording takes the studio's zone.
 */
import { formatClassTime } from "./studio-time.ts";

/** The member's own booking that a class overlaps. */
export interface ApiClash {
  booking_id: string;
  kind: "class" | "pt" | "workshop";
  title: string;
  starts_at: string;
  ends_at: string;
  location_name: string | null;
}

/** The row's button in place of Book: short enough for a phone. */
export function clashButton(clash: ApiClash, timezone: string): string {
  return `Clashes · ${formatClassTime(clash.starts_at, timezone)}`;
}

/** What the member is booked into at the time: "Inversion at 4:00 pm (Riverside)". */
export function clashWhat(clash: ApiClash, timezone: string): string {
  const place = clash.location_name ? ` (${clash.location_name})` : "";
  return `${clash.title} at ${formatClassTime(clash.starts_at, timezone)}${place}`;
}

/** The note under the row, and in the class detail. */
export function clashNote(clash: ApiClash, timezone: string): string {
  return `You're booked into ${clashWhat(clash, timezone)}, which overlaps this class. Cancel that booking to book this one.`;
}

/** A booking or join refused `time_clash`, in the member's words. */
export function clashRefusal(clash: ApiClash | null, timezone: string): string {
  return clash
    ? `You're already booked into ${clashWhat(clash, timezone)} at the same time. You can only be in one class at a time.`
    : "You're already booked into another class at the same time. You can only be in one class at a time.";
}

/** The `clash` a `time_clash` refusal carries, or null when the body has none. */
export function clashFromBody(body: unknown): ApiClash | null {
  if (!body || typeof body !== "object") return null;
  const clash = (body as { clash?: unknown }).clash;
  if (!clash || typeof clash !== "object") return null;
  const c = clash as Partial<ApiClash>;
  return typeof c.booking_id === "string" && typeof c.title === "string" && typeof c.starts_at === "string"
    ? (c as ApiClash)
    : null;
}
