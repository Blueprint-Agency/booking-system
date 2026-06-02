import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { ptRequests } from '../../db/schema/schedule'
import { clientPackages } from '../../db/schema/packages'
import { ConflictError, NotFoundError } from '../../shared/errors'
import { computeActive } from '../packages/validity'

/**
 * Cancel a PT request, branching on its current status:
 *
 *   pending   → status := cancelled_before_scheduled
 *               REFUND: credit the package back 1 session to the exact debited package.
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
  ptRequestId: string,
  source: 'client' | 'admin',
  actorStaffId?: string,
): Promise<void> {
  await db.transaction(async tx => {
    const [req] = await tx
      .select()
      .from(ptRequests)
      .where(eq(ptRequests.id, ptRequestId))
      .for('update')
      .limit(1)
    if (!req) throw new NotFoundError('pt_request_not_found')

    // Terminal states → idempotent no-op.
    if (
      req.status === 'cancelled_before_scheduled' ||
      req.status === 'cancelled_after_scheduled' ||
      req.status === 'attended'
    ) {
      return
    }
    // Scheduled-request cancellation (with its no-refund + session cascade) is out of
    // scope for this change — admin scheduling itself isn't built yet.
    if (req.status !== 'pending') throw new ConflictError('cannot_cancel_non_pending')

    // Refund 1 to the exact debited package.
    if (req.debitedClientPackageId) {
      const [pkg] = await tx
        .select({
          kind: clientPackages.kind,
          expiresAt: clientPackages.expiresAt,
          remaining: clientPackages.creditsOrSessionsRemaining,
        })
        .from(clientPackages)
        .where(eq(clientPackages.id, req.debitedClientPackageId))
        .for('update')
        .limit(1)
      if (pkg) {
        const newRemaining = (pkg.remaining ?? 0) + 1
        await tx
          .update(clientPackages)
          .set({
            creditsOrSessionsRemaining: newRemaining,
            active: computeActive({ kind: pkg.kind, expiresAt: pkg.expiresAt, creditsOrSessionsRemaining: newRemaining }),
          })
          .where(eq(clientPackages.id, req.debitedClientPackageId))
      }
    }

    await tx
      .update(ptRequests)
      .set({
        status: 'cancelled_before_scheduled',
        resolvedAt: new Date(),
        resolvedByStaffId: source === 'admin' ? (actorStaffId ?? null) : null,
      })
      .where(eq(ptRequests.id, ptRequestId))
  })
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
