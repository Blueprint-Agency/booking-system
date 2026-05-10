/**
 * Cancel a PT session. Source='client' goes through cancellation evaluation
 * post-confirm; source='admin' always full refund.
 */
export async function cancelPtSession(
  _ptSessionId: string,
  _source: 'client' | 'admin',
  _actorStaffId?: string,
): Promise<void> {
  throw new Error('not implemented')
}

/**
 * Daily cron: expire stale pending PT requests past their advance booking window.
 * Replaces the old private-session.service.ts:expireStaleSessions.
 */
export async function expireStaleSessions(): Promise<void> {
  // TODO: UPDATE pt_sessions SET status='cancelled' WHERE status='pending' AND starts_at < now()
}

/**
 * SLA escalation — flag PT requests pending too long.
 * Out of scope for v1 spec; kept as no-op.
 */
export async function escalateSLA(): Promise<void> {}
