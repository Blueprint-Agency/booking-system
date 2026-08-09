export type PtSessionType = '1on1' | '2on1'

/**
 * The number of PT sessions a request consumes from the debited package.
 * 1-on-1 costs 1; 2-on-1 costs 2 (one per attendee) — see be-client.md §4d.5
 * and be-portal.md §3c. Single source of truth so the submit debit and the
 * cancel refund can never drift apart.
 */
export function ptSessionCost(sessionType: PtSessionType): number {
  return sessionType === '2on1' ? 2 : 1
}

export interface PtTypeChangePlan {
  /** Signed credits, same convention as packages/validity.ts:applyMovement — <0 debits, >0 refunds. */
  delta: number
  /** What has to happen to the 2on1 partner's attendee row + booking. */
  partner: 'add' | 'remove' | 'none'
  /** Set when the debit the change implies is more than the package holds. */
  refusal: 'insufficient_credits' | null
}

/**
 * The whole decision for switching a SCHEDULED PT session between 1on1 and 2on1,
 * as a pure function — services/pt-sessions/schedule.ts is the only thing that
 * writes the result. Same shape as applyMovement: the refusal is returned rather
 * than thrown, and the caller maps it to the project's typed error.
 *
 * Changing the type to what it already is is a no-op (delta 0, no partner move).
 */
export function planPtTypeChange(
  from: PtSessionType,
  to: PtSessionType,
  remaining: number | null,
): PtTypeChangePlan {
  const delta = ptSessionCost(from) - ptSessionCost(to)
  const partner = from === to ? 'none' : to === '2on1' ? 'add' : 'remove'
  // A PT package is a session bundle, so it always carries a real balance. If a
  // null ever reaches here, treating it as 0 refuses the upgrade — the ledger
  // would refuse it too, as `unlimited_has_no_balance`.
  const short = delta < 0 && (remaining ?? 0) + delta < 0
  return { delta, partner, refusal: short ? 'insufficient_credits' : null }
}
