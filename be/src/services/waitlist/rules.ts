/**
 * The class waitlist's rules, over rows (spec-waitlist.md §3–§5). Pure: no
 * database, no clock of its own. `./line`, `./entries` and `./promote` load the
 * rows, lock them, and write what these decide.
 *
 * The line is a class's `waiting` entries ordered by `(joined_at, id)`. A
 * position is counted, never stored, so leaving or being promoted moves
 * everyone behind up without a write.
 */
import type { SelectionRefusal } from '../packages/selection'

const HOUR_MS = 3_600_000

export interface LineEntry {
  id: string
  clientId: string
  joinedAt: Date
}

/** The line in queue order: earliest join first, ties broken by id. */
export function inLine<T extends LineEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** Each entry's 1-based place in its line. Pass one class's `waiting` entries. */
export function positions(entries: readonly LineEntry[]): Map<string, number> {
  return new Map(inLine(entries).map((e, i) => [e.id, i + 1]))
}

/**
 * What happened to an entry tried in one promotion pass: booked, or the reason
 * its package could not pay. A refused entry stays `waiting` (§5) — it is only
 * skipped for the rest of this pass.
 */
export type PromotionOutcome = 'promoted' | SelectionRefusal | 'already_booked'

/**
 * The next entry to try for a freed online seat: the first in queue order not
 * yet tried in this pass. Null when the line is exhausted.
 */
export function nextToPromote<T extends LineEntry>(
  entries: readonly T[],
  outcomes: ReadonlyMap<string, PromotionOutcome>,
): T | null {
  return inLine(entries).find(e => !outcomes.has(e.id)) ?? null
}

/**
 * The moment the waitlist closes: when the class's Cancellation Window opens.
 * Whoever is promoted must always still be able to cancel free (§4), so nobody
 * joins, and nobody is promoted automatically, from here on.
 */
export function waitlistClosesAt(startsAt: Date, windowHours: number): Date {
  return new Date(startsAt.getTime() - windowHours * HOUR_MS)
}

/** Before the window: a join is allowed and a freed seat promotes. */
export function beforeWindow(startsAt: Date, windowHours: number, now: Date): boolean {
  return now < waitlistClosesAt(startsAt, windowHours)
}

export interface OpenInput {
  /** The studio's `waitlist_enabled` switch. */
  enabled: boolean
  lifecycle: string
  startsAt: Date
  windowHours: number
  waiting: number
  capacityWaitlist: number
  now: Date
}

/** "Waitlist open" (§1): a member could join right now if the class were full. */
export function waitlistOpen(input: OpenInput): boolean {
  return (
    input.enabled &&
    input.lifecycle === 'active' &&
    beforeWindow(input.startsAt, input.windowHours, input.now) &&
    input.waiting < input.capacityWaitlist
  )
}

/** Everything a join is judged on except whether a package can pay. */
export interface JoinFacts {
  enabled: boolean
  classActive: boolean
  /** The Cancellation Window has opened (or the class has started). */
  closed: boolean
  alreadyBooked: boolean
  alreadyWaiting: boolean
  /** Every online seat is taken. */
  onlineFull: boolean
  waiting: number
  capacityWaitlist: number
}

export type JoinRefusal =
  | 'waitlist_disabled'
  | 'class_not_found'
  | 'waitlist_closed'
  | 'already_booked'
  | 'already_waitlisted'
  | 'class_not_full'
  | 'waitlist_full'

/**
 * Why a member may not join, in the order §4 lists the checks, or null. Package
 * selection is the last check and runs only once this has passed.
 */
export function joinRefusal(f: JoinFacts): JoinRefusal | null {
  if (!f.enabled) return 'waitlist_disabled'
  if (!f.classActive) return 'class_not_found'
  if (f.closed) return 'waitlist_closed'
  if (f.alreadyBooked) return 'already_booked'
  if (f.alreadyWaiting) return 'already_waitlisted'
  if (!f.onlineFull) return 'class_not_full'
  if (f.waiting >= f.capacityWaitlist) return 'waitlist_full'
  return null
}
