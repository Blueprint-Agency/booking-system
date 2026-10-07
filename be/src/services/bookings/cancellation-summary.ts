/**
 * What a cancelled class booking says of its cancellation, read the same way
 * wherever it is shown (#349): **when** it was cancelled, **who** cancelled —
 * the member, or the studio — and **where the credit went**. Built only from
 * what the cancel recorded: the booking's `refund_outcome` and credits spent,
 * and its `cancellations` row. Pure, so the member's Cancelled tab and the
 * staff reads cannot word the same cancel two ways.
 *
 *   - Who: a `cancellations` row with `source='client'` is the member's own.
 *     Anything else — a staff cancel, a whole-class cancel (the class's
 *     `lifecycle` turns `cancelled`), a Void, a Package rule change, or no row
 *     at all (an unknown actor) — is the studio's.
 *   - Late: a member's cancel inside the Cancellation Window (a **Late
 *     cancel**). A studio cancel is never the member's late cancel.
 *   - Outcome: the credit came back (`credit_returned`); nothing was spent, or
 *     there is nowhere to return it (`nothing_to_return`); otherwise the
 *     credit was kept — because the member cancelled late, over their
 *     Cancellation Cap, or because staff chose Keep credit.
 */
export type CancelledBy = 'member' | 'studio'

export type CancellationOutcome =
  | 'credit_returned'
  | 'credit_kept_late'
  | 'credit_kept_over_cap'
  | 'credit_kept'
  | 'nothing_to_return'

export interface CancellationFacts {
  refundOutcome: string | null
  creditsUsed: number
  /** The booking's own cancel time. */
  bookingCancelledAt: Date | null
  /** Its `cancellations` row, when there is one. */
  record: {
    source: string
    wasWithinWindow: boolean
    wasWithinCap: boolean
    cancelledAt: Date
  } | null
}

export interface CancellationSummary {
  cancelledAt: Date | null
  cancelledBy: CancelledBy
  late: boolean
  outcome: CancellationOutcome
}

export function summarizeCancellation(f: CancellationFacts): CancellationSummary {
  // A member who cancelled before the studio cancelled the whole class keeps
  // their own row: a whole-class cancel touches only confirmed bookings.
  const byMember = f.record?.source === 'client'
  const late = byMember && !f.record!.wasWithinWindow
  let outcome: CancellationOutcome
  if (f.refundOutcome === 'credit_returned') outcome = 'credit_returned'
  else if (f.refundOutcome === 'n_a' || f.creditsUsed === 0) outcome = 'nothing_to_return'
  else if (late) outcome = 'credit_kept_late'
  else if (byMember && !f.record!.wasWithinCap) outcome = 'credit_kept_over_cap'
  else outcome = 'credit_kept'
  return {
    cancelledAt: f.record?.cancelledAt ?? f.bookingCancelledAt,
    cancelledBy: byMember ? 'member' : 'studio',
    late,
    outcome,
  }
}
