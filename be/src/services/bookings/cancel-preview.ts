/**
 * What a member's cancel of one class booking would do, asked before they
 * confirm it (#318) — the `cancel_preview` their cancel dialog reads.
 *
 * The same evaluation and the same settlement `cancelBooking` runs, without
 * writing: whether it would be a Late cancel, and whether the credit would come
 * back. So the dialog says what the cancel then does, the cap included.
 */
import { now as clockNow } from '../../lib/clock'
import { evaluateCancellation } from '../policy/evaluate-cancellation'
import type { ClassBookingRow } from './list'
import { settleCancel } from './refund-outcome'

export interface CancelPreview {
  /** Inside the class's window: a Late cancel, the credit kept. */
  late: boolean
  /** Whether the credits spent come back to the package. */
  creditBack: boolean
  /** Credits the booking spent — 0 on an Unlimited Plan. */
  credits: number
  /** Paid for by an Unlimited Plan: nothing to return either way. */
  unlimited: boolean
}

/**
 * Null when the member could not cancel this booking now: it is not confirmed,
 * it was attended, or its class has started.
 */
export async function previewMemberClassCancel(
  tenantId: string,
  clientId: string,
  booking: ClassBookingRow,
): Promise<CancelPreview | null> {
  const now = clockNow()
  if (booking.state !== 'confirmed' || booking.checkInState === 'attended' || now >= booking.startsAt) {
    return null
  }
  const evaluation = await evaluateCancellation({
    tenantId,
    clientId,
    kind: 'class',
    sessionStartsAt: booking.startsAt,
    classOwnWindowHours: booking.cancelWindowHours,
    now,
  })
  const { refundFired } = settleCancel({
    kind: 'class',
    source: 'client',
    evaluation,
    used: booking.creditsUsed,
    returnable: booking.clientPackageId !== null,
  })
  return {
    late: !evaluation.wasWithinWindow,
    creditBack: refundFired,
    credits: booking.creditsUsed,
    unlimited: booking.wasUnlimited,
  }
}
