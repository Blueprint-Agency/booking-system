/**
 * The number of PT sessions a request consumes from the debited package.
 * 1-on-1 costs 1; 2-on-1 costs 2 (one per attendee) — see be-client.md §4d.5
 * and be-portal.md §3c. Single source of truth so the submit debit and the
 * cancel refund can never drift apart.
 */
export function ptSessionCost(sessionType: '1on1' | '2on1'): number {
  return sessionType === '2on1' ? 2 : 1
}
