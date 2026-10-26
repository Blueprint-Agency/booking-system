import { checkInUnfinished } from './check-in-unfinished'
import { classpassOverbooked } from './classpass-overbooked'
import { classpassReview } from './classpass-review'
import {
  corporateRefundedStillScheduled,
  corporateRequestPending,
  corporateSessionUnmarked,
} from './corporate-requests'
import { instructorPayMissing } from './instructor-pay-missing'
import { leaveRequestPending } from './leave-request-pending'
import { partPaymentSilent } from './part-payment-silent'
import { ptRequestPending } from './pt-request-pending'
import { refundIncomplete, refundUnconfirmed, workshopCancelledUnrefunded } from './refunds'
import { staffEmailChangeExpired, staffInvitationExpired, staffWithoutEmail } from './staff-logins'
import { paymentsNotConfigured, studioTermEnding } from './studio-account'
import type { AttentionProvider } from './types'

/**
 * Every Attention item kind the portal knows. A new kind is one provider file
 * and one line here; the summary, the panel, the groups and the sidebar badge
 * keys are all built from this list.
 */
export const providers: readonly AttentionProvider[] = [
  ptRequestPending,
  corporateRequestPending,
  corporateSessionUnmarked,
  corporateRefundedStillScheduled,
  leaveRequestPending,
  checkInUnfinished,
  classpassReview,
  classpassOverbooked,
  instructorPayMissing,
  partPaymentSilent,
  refundIncomplete,
  refundUnconfirmed,
  workshopCancelledUnrefunded,
  staffInvitationExpired,
  staffEmailChangeExpired,
  staffWithoutEmail,
  studioTermEnding,
  paymentsNotConfigured,
]
