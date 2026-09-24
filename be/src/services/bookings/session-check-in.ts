/**
 * A session's check-in state (admin-restructure.md §11): `pending` while any
 * roster row is still undecided, `completed` once every row is marked
 * `attended` or `no-show`.
 *
 * Derived, never stored: it follows the rows, so undoing a tick reopens it. And
 * nothing flips a row by itself — there is no automatic no-show — so a session
 * nobody finished stays `pending` for as long as it takes someone to decide.
 */
export type SessionCheckInState = 'pending' | 'completed'

/** A roster row's own check-in state; null for a PT attendee with no booking row. */
type RowCheckInState = 'pending' | 'attended' | 'no_show' | 'n_a' | null

export function sessionCheckInState(rows: readonly RowCheckInState[]): SessionCheckInState {
  // A PT attendee with no booking row was never ticked either way.
  return rows.some(state => state === 'pending' || state === null) ? 'pending' : 'completed'
}
