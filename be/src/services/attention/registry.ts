import { checkInUnfinished } from './check-in-unfinished'
import { leaveRequestPending } from './leave-request-pending'
import { ptRequestPending } from './pt-request-pending'
import { staffEmailChangeExpired, staffInvitationExpired, staffWithoutEmail } from './staff-logins'
import type { AttentionProvider } from './types'

/**
 * Every Attention item kind the portal knows. A new kind is one provider file
 * and one line here; the summary, the panel, the groups and the sidebar badge
 * keys are all built from this list.
 */
export const providers: readonly AttentionProvider[] = [
  ptRequestPending,
  leaveRequestPending,
  checkInUnfinished,
  staffInvitationExpired,
  staffEmailChangeExpired,
  staffWithoutEmail,
]
