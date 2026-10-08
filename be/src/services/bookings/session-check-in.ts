/**
 * A session's check-in state (admin-restructure.md §11): `pending` while any
 * roster row is still undecided, `completed` once every row is marked
 * `attended` or `no-show`.
 *
 * Derived, never stored: it follows the rows, so undoing a tick reopens it. And
 * nothing flips a row by itself — there is no automatic no-show — so a session
 * nobody finished stays `pending` for as long as it takes someone to decide.
 *
 * The one definition of "undecided": the check-in desk (services/schedule/
 * detail.ts) and the check-in nag (./check-in-nag.ts) both read it from here,
 * so the nag can never count a session differently from the desk it links to.
 */
export type SessionCheckInState = 'pending' | 'completed'

/** A roster row's own check-in state; null for a PT attendee with no booking row. */
export type RowCheckInState = 'pending' | 'attended' | 'no_show' | 'n_a' | null

/** A PT attendee with no booking row was never ticked either way. */
const undecided = (state: RowCheckInState) => state === 'pending' || state === null

/** How many roster rows are still undecided. */
export function pendingCheckIns(rows: readonly RowCheckInState[]): number {
  return rows.filter(undecided).length
}

export function sessionCheckInState(rows: readonly RowCheckInState[]): SessionCheckInState {
  return pendingCheckIns(rows) > 0 ? 'pending' : 'completed'
}

/**
 * A private session's roster: one row per member on it (`pt_session_clients`),
 * each joined to their booking on the session, if any. A manual session's
 * member removed and added back holds a cancelled booking and a confirmed one:
 * the confirmed one is their seat, else the latest. A member with no booking
 * at all keeps their row, its state null.
 */
export function ptSeats<T extends { state: string | null; bookedAt: Date | null }>(
  rows: readonly T[],
  memberOf: (row: T) => string,
): T[] {
  const outranks = (a: T, b: T) =>
    a.state === 'confirmed' && b.state !== 'confirmed'
      ? true
      : a.state !== 'confirmed' && b.state === 'confirmed'
        ? false
        : (a.bookedAt?.getTime() ?? 0) > (b.bookedAt?.getTime() ?? 0)
  const seatOf = new Map<string, T>()
  for (const row of rows) {
    const held = seatOf.get(memberOf(row))
    if (!held || outranks(row, held)) seatOf.set(memberOf(row), row)
  }
  return [...seatOf.values()]
}
