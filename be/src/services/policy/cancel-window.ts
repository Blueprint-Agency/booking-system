/**
 * The class Cancellation Window: the hours before a class starts inside which a
 * member's cancel no longer returns the credit, the waitlist is closed and
 * nobody is promoted automatically (be/CONTEXT.md § Cancellation Window).
 *
 * There is one, the studio's class window on Global Policy
 * (`global_policy.class_window_hours`); a class carries none of its own. Every
 * reader of "the class window" asks here, at the time of the action, so an
 * edited window applies to members who booked before the edit.
 *
 * The PT window is not per-session and does not come through here.
 */
import { readCancellationPolicy } from './evaluate-cancellation'

/**
 * Whether a cancel at `now` falls inside the window — later than `windowHours`
 * before the start. For a member's cancel that is a Late cancel; a staff cancel
 * only has it recorded and shown.
 */
export function insideCancelWindow(startsAt: Date, windowHours: number, now: Date): boolean {
  return now.getTime() > startsAt.getTime() - windowHours * 3_600_000
}

/** The studio's class Cancellation Window, in hours, read now. */
export async function classCancelWindow(tenantId: string): Promise<number> {
  return (await readCancellationPolicy(tenantId)).classWindowHours
}
