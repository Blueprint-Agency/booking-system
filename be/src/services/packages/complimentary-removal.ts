/**
 * When a **Complimentary Package** may still be taken back (#176).
 *
 * A comp is removed, not refunded: no money moved, so there is nothing to give
 * back and the row itself goes. That is only honest while the package is
 * **Untouched** — the same fold the Refund notice uses (`billing/refund-notice`),
 * read here as a gate rather than a warning, because an admin who removes a
 * package a member has already spent is rewriting what happened in the room.
 *
 * Two things make a comp Touched:
 *
 *   - a class or session it paid for was **attended or no-showed** — the seat
 *     was held either way, and a no-show that stayed removable would make "don't
 *     turn up" the way to hand a comp back;
 *   - a class or session it paid for has **already started** and is still
 *     confirmed. Its attendance has not been marked yet, but the class ran; the
 *     roster decides what it was, and until then the package is not ours to
 *     delete. This is the one place the rule is stricter than the Refund notice,
 *     which only ever warns.
 *
 * Pure, so the rule is checkable without a database and the service below has
 * one query and no arithmetic.
 */

export type ComplimentaryBooking = {
  state: 'confirmed' | 'cancelled' | 'no_show'
  checkInState: 'pending' | 'attended' | 'no_show' | 'n_a'
  /** When the class or PT session starts. Null where the booking has neither. */
  startsAt: Date | null
}

export type RemovalRefusal = 'package_touched'

/**
 * Null when the package may be removed, otherwise the refusal code. `now` is
 * passed in rather than read, so "already started" is testable.
 */
export function removalRefusal(
  bookings: readonly ComplimentaryBooking[],
  now: Date,
): RemovalRefusal | null {
  for (const b of bookings) {
    if (b.checkInState === 'attended' || b.checkInState === 'no_show') return 'package_touched'
    if (b.state === 'confirmed' && b.startsAt !== null && b.startsAt <= now) {
      return 'package_touched'
    }
  }
  return null
}
