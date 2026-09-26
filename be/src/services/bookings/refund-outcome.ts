import type { EvaluateResult } from '../policy/evaluate-cancellation'

export type RefundOutcome =
  | 'credit_returned'
  | 'session_returned'
  | 'stripe_refunded'
  | 'forfeited'
  | 'n_a'

/** Who cancelled: the member, or a staff member from the portal (#320). */
export type StaffCancelSource = 'admin' | 'instructor'
export type CancelSource = 'client' | StaffCancelSource

/**
 * A staff cancel's answer to "Return 1 credit" or "Keep the credit" (#320):
 * staff choose every time; the window and the cap never choose for them.
 */
export type StaffCredit = 'return' | 'keep'

/**
 * Decides which refund_outcome to record on a booking based on kind + evaluation.
 *
 * NOTE: workshop bookings never reach this function — `cancelBooking` rejects them
 * (`workshop_cancel_unsupported`) and workshop admin-cancel goes through
 * services/workshops/cancel.ts, which refunds nobody automatically (#272). A
 * workshop booking is only ever labelled `stripe_refunded` by the refund unwind
 * (`unwindRefund`), once the money has actually gone back, so the branch below is
 * unreachable and no booking is ever falsely labelled refunded.
 */
export function decideOutcome(
  kind: 'class' | 'workshop' | 'pt',
  source: CancelSource,
  evaluation?: EvaluateResult,
): RefundOutcome {
  if (source !== 'client') {
    if (kind === 'workshop') return 'stripe_refunded'
    if (kind === 'class') return 'credit_returned'
    return 'session_returned'
  }
  if (kind === 'workshop') return 'forfeited'
  if (!evaluation) return 'forfeited'
  if (evaluation.refund === 'forfeit') return 'forfeited'
  return kind === 'class' ? 'credit_returned' : 'session_returned'
}

export interface SettleInput {
  kind: 'class' | 'pt'
  source: CancelSource
  /** The member's evaluation; absent for a staff cancel, which `credit` decides. */
  evaluation?: EvaluateResult
  /** A staff cancel's choice; ignored for a member's. */
  credit?: StaffCredit
  /** Credits or sessions the booking spent — 0 on an Unlimited Plan. */
  used: number
  /** Whether a package is there to return them to: not once it is Voided (§14). */
  returnable: boolean
}

export interface Settlement {
  refundOutcome: RefundOutcome
  /** Whether credits or sessions actually go back to the package. */
  refundFired: boolean
}

/**
 * What cancelling a booking does with what it spent. Pure, so a member's cancel
 * and the preview their cancel dialog reads (`cancel_preview`) are one decision.
 *
 *   - A cancel that returns, with something spent and somewhere to put it:
 *     returned. A member's returns when the evaluation says so; a staff
 *     member's when they chose Return credit.
 *   - Nothing spent (an Unlimited Plan) or nowhere to put it (a Voided
 *     package), on a cancel that would have returned it, on a **Late cancel**
 *     or on any staff cancel: `n_a` — the place is freed and there is nothing
 *     to keep.
 *   - Otherwise — a late or over-cap cancel that spent something, a staff Keep
 *     credit, and a member's over-cap one that spent nothing, as it always has
 *     been — `forfeited`.
 */
export function settleCancel({ kind, source, evaluation, credit, used, returnable }: SettleInput): Settlement {
  const staff = source !== 'client'
  const wantsRefund = staff ? credit === 'return' : evaluation?.refund === 'full'
  const nothingToReturn = used === 0 || !returnable
  if (wantsRefund && !nothingToReturn) {
    return { refundOutcome: decideOutcome(kind, source, evaluation), refundFired: true }
  }
  const late = evaluation !== undefined && !evaluation.wasWithinWindow
  if (nothingToReturn && (staff || wantsRefund || late)) return { refundOutcome: 'n_a', refundFired: false }
  return { refundOutcome: 'forfeited', refundFired: false }
}
