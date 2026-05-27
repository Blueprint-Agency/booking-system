/**
 * Cancel a PT request, branching on its current status:
 *
 *   pending   → status := cancelled_before_scheduled
 *               REFUND: credit the package back 1 (1on1) or 2 (2on1) sessions.
 *               No pt_session row exists yet, so no booking-level work.
 *
 *   scheduled → status := cancelled_after_scheduled
 *               NO REFUND in v1 (policy decision — see docs/md/be-portal.md §PT).
 *               Cascade-cancel the linked pt_sessions row (lifecycle='cancelled')
 *               and every booking on it (state='cancelled', refund_outcome='forfeited').
 *
 * Both client and admin can hit this. Source is recorded on the cancellations row.
 * Calling cancel on a request already in a terminal state is a no-op (idempotent).
 */
export async function cancelPtRequest(
  _ptRequestId: string,
  _source: 'client' | 'admin',
  _actorStaffId?: string,
): Promise<void> {
  throw new Error('not implemented')
}

/**
 * Daily cron: expire stale pending PT requests past their advance booking window.
 * Cascades the same refund path as a client/admin cancel on a `pending` row, with
 * source='system'. Replaces the old private-session.service.ts:expireStaleSessions.
 */
export async function expireStaleSessions(): Promise<void> {
  // TODO: SELECT pt_requests WHERE status='pending' AND expires_at < now()
  //       For each: refund credits, set status='cancelled_before_scheduled',
  //                 resolved_at=now(), resolved_by_staff_id=NULL.
}
