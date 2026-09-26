/**
 * A class's Cancellation Window: the hours before it starts inside which a
 * member's cancel no longer returns the credit, the waitlist is closed and
 * nobody is promoted automatically (be/CONTEXT.md § Cancellation Window).
 *
 * A class may carry its own (`classes.cancel_window_hours`). Left blank it
 * follows the studio's class window on Global Policy — live, so a change on the
 * Policy page reaches every class without one. Every reader of "the class
 * window" for a specific class asks here, at the time of the action, so an
 * edited window applies to members who booked before the edit.
 *
 * The PT window is not per-session and does not come through here.
 */
import { readCancellationPolicy } from './evaluate-cancellation'

/** What the window of a class depends on: its own hours, or null for the studio's. */
export interface HasCancelWindow {
  cancelWindowHours: number | null
}

/** The class's own hours, else the studio's class window. */
export function effectiveCancelWindow(own: number | null, studioHours: number): number {
  return own ?? studioHours
}

/**
 * Reads the studio's class window once and resolves any number of classes
 * against it — a catalogue page, a member's bookings.
 */
export async function cancelWindowResolver(tenantId: string): Promise<(cls: HasCancelWindow) => number> {
  const { classWindowHours } = await readCancellationPolicy(tenantId)
  return cls => effectiveCancelWindow(cls.cancelWindowHours, classWindowHours)
}

/** One class's effective window, in hours. */
export async function classCancelWindow(tenantId: string, cls: HasCancelWindow): Promise<number> {
  return (await cancelWindowResolver(tenantId))(cls)
}
