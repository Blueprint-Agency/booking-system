/**
 * The **Check-in Window** (#192): when a booking may be checked in.
 *
 * Opens the studio's `check_in_opens_minutes_before` ahead of the start, so a
 * member who arrives early is ticked at the door rather than asked to wait.
 * For a scan it closes at the end of the session's own day, in the studio's
 * timezone — a code shown at the desk tomorrow is not an arrival for
 * yesterday's class. A manual tick has no close: cleaning up a roster after
 * the class is what the tick is for.
 *
 * Pure: no database, no clock. See check-in-window.test.ts.
 */
import { localDateOf } from '../schedule/series-dates'

export type CheckInWindow = 'open' | 'not_open' | 'closed'

export function checkInOpensAt(startsAt: Date, minutesBefore: number): Date {
  return new Date(startsAt.getTime() - minutesBefore * 60_000)
}

export function checkInWindow(opts: {
  now: Date
  startsAt: Date
  minutesBefore: number
  timezone: string
  /** A scan closes with the session's day; a tick never does. */
  closesWithTheDay: boolean
}): CheckInWindow {
  const { now, startsAt, minutesBefore, timezone, closesWithTheDay } = opts
  if (now < checkInOpensAt(startsAt, minutesBefore)) return 'not_open'
  if (closesWithTheDay && localDateOf(now, timezone) > localDateOf(startsAt, timezone)) return 'closed'
  return 'open'
}
