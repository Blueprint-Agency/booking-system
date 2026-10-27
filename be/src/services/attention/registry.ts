import { checkInUnfinished } from './check-in-unfinished'
import { classpassOverbooked } from './classpass-overbooked'
import { classpassReview } from './classpass-review'
import {
  corporateRefundedStillScheduled,
  corporateRequestPending,
  corporateSessionUnmarked,
} from './corporate-requests'
import { emailBouncing, membersWithoutEmail } from './email-delivery'
import { instructorPayMissing } from './instructor-pay-missing'
import { leaveRequestPending } from './leave-request-pending'
import { partPaymentSilent } from './part-payment-silent'
import { ptRequestPending } from './pt-request-pending'
import { refundIncomplete, refundUnconfirmed, workshopCancelledUnrefunded } from './refunds'
import { staffEmailChangeExpired, staffInvitationExpired, staffWithoutEmail } from './staff-logins'
import { paymentsNotConfigured, studioTermEnding } from './studio-account'
import { seriesEnding, seriesEndedClassKept } from './series-follow-ups'
import type { AttentionKind, AttentionProvider } from './types'
import { waitlistSeatFree } from './waitlist-seat-free'

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
  waitlistSeatFree,
  seriesEnding,
  seriesEndedClassKept,
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
  membersWithoutEmail,
  emailBouncing,
  studioTermEnding,
  paymentsNotConfigured,
]

/**
 * Every kind in the registry, as the non-empty tuple `z.enum` takes: the route
 * validates a dismissal's `kind` against it, so a kind added above is known to
 * the API without a second list.
 */
export const attentionKinds = providers.map(p => p.kind) as [AttentionKind, ...AttentionKind[]]
