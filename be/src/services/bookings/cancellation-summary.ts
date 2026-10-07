/**
 * What a cancelled booking says of its cancellation, read the same way
 * wherever it is shown (#349, #352): **when** it was cancelled, **who**
 * cancelled, and **where the credit went**. Built only from what the cancel
 * recorded: the booking's `refund_outcome` and credits spent, and its
 * `cancellations` row. Pure, so the member's Cancelled tab and the staff reads
 * (the profile's Cancelled tab, the roster's Cancelled section) cannot word
 * the same cancel two ways.
 *
 *   - Who, as the member reads it: a `cancellations` row with
 *     `source='client'` is the member's own. Anything else — a staff cancel, a
 *     whole-class cancel, a Void, a Package rule change, or no row at all (an
 *     unknown actor) — is the studio's.
 *   - Who, as staff read it (`actor`): the member; the named staff member
 *     (`source` admin or instructor, `cancelled_by_staff_id` set); automatic —
 *     the studio's machinery (`source` system: a Void, a Remove, a Package
 *     rule change, a PT request's expiry); or the studio, unnamed, for a row
 *     written before #350 or none at all.
 *   - Late: a member's cancel inside the Cancellation Window (a **Late
 *     cancel**). A studio cancel is never the member's late cancel.
 *   - Outcome: the credit came back (`credit_returned`; a private session's
 *     session counts as its credit); money was refunded (`refunded`, a
 *     workshop); nothing was spent, or there is nowhere to return it
 *     (`nothing_to_return`); otherwise the credit was kept — because the
 *     member cancelled late, over their Cancellation Cap, or because staff
 *     chose Keep credit.
 */
export type CancelledBy = 'member' | 'studio'

export type CancelActor = 'member' | 'staff' | 'automatic' | 'studio'

export type CancellationOutcome =
  | 'credit_returned'
  | 'credit_kept_late'
  | 'credit_kept_over_cap'
  | 'credit_kept'
  | 'refunded'
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
    /** The staff member `cancelled_by_staff_id` names, by name. */
    staffName?: string | null
  } | null
}

export interface CancellationSummary {
  cancelledAt: Date | null
  cancelledBy: CancelledBy
  /** Who cancelled, as staff read it. */
  actor: CancelActor
  /** The staff member's name when `actor` is `staff`; null otherwise. */
  staffName: string | null
  late: boolean
  outcome: CancellationOutcome
}

export function summarizeCancellation(f: CancellationFacts): CancellationSummary {
  // A member who cancelled before the studio cancelled the whole class keeps
  // their own row: a whole-class cancel touches only confirmed bookings.
  const byMember = f.record?.source === 'client'
  const late = byMember && !f.record!.wasWithinWindow
  let outcome: CancellationOutcome
  if (f.refundOutcome === 'credit_returned' || f.refundOutcome === 'session_returned') outcome = 'credit_returned'
  else if (f.refundOutcome === 'stripe_refunded') outcome = 'refunded'
  else if (f.refundOutcome === 'n_a' || f.creditsUsed === 0) outcome = 'nothing_to_return'
  else if (late) outcome = 'credit_kept_late'
  else if (byMember && !f.record!.wasWithinCap) outcome = 'credit_kept_over_cap'
  else outcome = 'credit_kept'
  const staffName = f.record?.staffName ?? null
  const actor: CancelActor = byMember
    ? 'member'
    : f.record?.source === 'system'
      ? 'automatic'
      : staffName
        ? 'staff'
        : 'studio'
  return {
    cancelledAt: f.record?.cancelledAt ?? f.bookingCancelledAt,
    cancelledBy: byMember ? 'member' : 'studio',
    actor,
    staffName: actor === 'staff' ? staffName : null,
    late,
    outcome,
  }
}

/**
 * A cancellation as the portal's reads send it — the profile's Cancelled tab
 * and the roster's Cancelled section alike, so staff read one shape.
 */
export function staffCancellationJson(s: CancellationSummary) {
  return {
    cancelled_at: s.cancelledAt?.toISOString() ?? null,
    cancelled_by: s.actor,
    cancelled_by_name: s.staffName,
    late: s.late,
    outcome: s.outcome,
  }
}
