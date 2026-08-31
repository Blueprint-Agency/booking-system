/**
 * Single-booking cancellation — both client self-cancel and admin force-cancel.
 * See be-client.md §4c (client) and be-portal.md §3b (admin).
 *
 * Class + PT only (credit/session bookings). Workshops refund via Stripe and are handled
 * elsewhere. Cancellation is ALWAYS allowed; window/cap only gate whether a refund fires.
 *
 *   - Admin source: always full refund (bypasses window/cap).
 *   - Client source: refund only if within window AND within cap (evaluateCancellation).
 *   - Unlimited bookings debited 0 credits → nothing to return; seat is released and the
 *     outcome is recorded as `n_a` (not `credit_returned`).
 *
 * Everything runs in one transaction. The class/PT row is locked FOR UPDATE so a self-cancel
 * can't race an admin bulk class-cancel.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { bookings, cancellations } from '../../db/schema/bookings'
import { classes, ptSessions } from '../../db/schema/schedule'
import { inboxItems } from '../../db/schema/inbox'
import { refundCredits } from '../packages/ledger'
import { decideOutcome, type RefundOutcome } from './refund-outcome'
import { evaluateCancellation } from '../policy/evaluate-cancellation'
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'

export type CancelSource = 'client' | 'admin'

export interface CancelInput {
  bookingId: string
  source: CancelSource
  /** Required for client self-cancel — asserts the booking belongs to this client. */
  clientId?: string
  /** Staff actor for admin cancels (also written to the credit-adjustment ledger). */
  actorStaffId?: string
  /**
   * The package that paid for this booking has been **Voided** by a Refund
   * (§14). The seat is released and the waitlist promotes as usual, but nothing
   * is returned: putting a credit back into a package that no longer exists is
   * meaningless, and a `credit_returned` outcome would falsely read as the
   * member being made whole twice on top of their money back. The outcome is
   * `n_a`, the same one an Unlimited booking already takes.
   */
  packageVoided?: boolean
}

export interface CancelResult {
  refundOutcome: RefundOutcome
  refundFired: boolean
}

export async function cancelBooking(
  tenantId: string,
  input: CancelInput,
): Promise<CancelResult> {
  const { bookingId, source, clientId, actorStaffId, packageVoided } = input

  return db.transaction(async tx => {
    // 1. Lock the booking row.
    const [bk] = await tx
      .select({
        id: bookings.id,
        clientId: bookings.clientId,
        kind: bookings.kind,
        classId: bookings.classId,
        ptSessionId: bookings.ptSessionId,
        clientPackageId: bookings.clientPackageId,
        state: bookings.state,
        checkInState: bookings.checkInState,
        used: bookings.creditsOrSessionsUsed,
      })
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
      .for('update')
      .limit(1)

    if (!bk) throw new NotFoundError('booking_not_found')
    if (source === 'client' && clientId && bk.clientId !== clientId) {
      throw new ForbiddenError('not_your_booking')
    }
    if (bk.state !== 'confirmed') throw new ConflictError('not_cancellable')
    if (bk.kind === 'workshop') throw new BadRequestError('workshop_cancel_unsupported')
    // Attendance keeps state='confirmed', so the check above lets an admin refund
    // someone who was demonstrably in the room. Untick the roster first if the
    // attendance was a mistake — then this cancel is allowed.
    if (bk.checkInState === 'attended') throw new ConflictError('booking_attended')

    const cancelKind: 'class' | 'pt' = bk.kind === 'class' ? 'class' : 'pt'

    // 2. Load + lock the session to read its start time (race-safe vs admin bulk cancel).
    let sessionStartsAt: Date
    if (bk.kind === 'class') {
      const [cls] = await tx
        .select({ startsAt: classes.startsAt })
        .from(classes)
        .where(and(eq(classes.tenantId, tenantId), eq(classes.id, bk.classId!)))
        .for('update')
        .limit(1)
      if (!cls) throw new NotFoundError('class_not_found')
      sessionStartsAt = cls.startsAt
    } else {
      const [pt] = await tx
        .select({ startsAt: ptSessions.startsAt })
        .from(ptSessions)
        .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, bk.ptSessionId!)))
        .for('update')
        .limit(1)
      if (!pt) throw new NotFoundError('pt_session_not_found')
      sessionStartsAt = pt.startsAt
    }

    // 3. Evaluate the refund decision.
    const now = new Date()
    const evaluation =
      source === 'admin'
        ? undefined
        : await evaluateCancellation({
            tenantId,
            clientId: bk.clientId,
            kind: cancelKind,
            sessionStartsAt,
            now,
          })

    // Client self-cancel is a HARD deadline: a member can only cancel up to
    // `windowHours` (24h for classes) before the session starts. Inside that window
    // — or after the session has started — the action is rejected outright (not just
    // forfeited). Admins bypass this and can cancel at any time.
    if (source === 'client' && !evaluation!.wasWithinWindow) {
      throw new AppError(422, 'cancellation_window_passed', {
        window_hours: evaluation!.windowHours,
      })
    }

    const used = bk.used ?? 0
    const wantsRefund = source === 'admin' || evaluation!.refund === 'full'

    // Unlimited bookings used 0 credits → nothing to return; record n_a, not
    // credit_returned. A Voided package takes the same arm for the same reason:
    // there is no longer anything to return the credit to.
    // Nothing here touches `expires_at`: Activation is one-way (§3), from any actor.
    // Staff return a plan to Dormant by hand through the portal expiry dialog.
    let refundOutcome: RefundOutcome
    let refundFired: boolean
    if (wantsRefund && used > 0 && bk.clientPackageId && !packageVoided) {
      refundOutcome = decideOutcome(bk.kind, source, evaluation)
      refundFired = true
    } else if (wantsRefund) {
      refundOutcome = 'n_a' // seat released, no credit/session to return (unlimited)
      refundFired = false
    } else {
      refundOutcome = 'forfeited'
      refundFired = false
    }

    // 4. Return the credit/session to the originating package. The ledger also
    // re-derives `active`, so a bundle emptied to zero becomes spendable again
    // (it used to come back with credits but flagged unusable) — and writes the
    // credit-movement audit row (traceability per backend-architecture §4).
    if (refundFired) {
      await refundCredits(tx, {
        tenantId,
        clientId: bk.clientId,
        clientPackageId: bk.clientPackageId!,
        amount: used,
        reason: source === 'admin' ? 'admin_cancellation_refund' : 'client_cancellation_refund',
        actedByStaffId: actorStaffId ?? null,
      })
    }

    // 5. Record the cancellation (counts toward the client's cap regardless of refund outcome).
    await tx.insert(cancellations).values({
      tenantId,
      bookingId: bk.id,
      clientId: bk.clientId,
      kind: cancelKind,
      source,
      wasWithinWindow: evaluation?.wasWithinWindow ?? true,
      wasWithinCap: evaluation?.wasWithinCap ?? true,
      refundFired,
      cancelledAt: now,
    })

    // 6. Flip the booking.
    await tx
      .update(bookings)
      .set({ state: 'cancelled', refundOutcome, checkInState: 'n_a', cancelledAt: now })
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bk.id)))

    // 7. Admin single-cancel raises an inbox item (client self-cancel also notifies admins).
    await tx.insert(inboxItems).values({
      tenantId,
      type: source === 'admin' ? 'admin_cancel_class_pt' : 'client_cancellation',
      payload: {
        bookingId: bk.id,
        clientId: bk.clientId,
        kind: cancelKind,
        refundOutcome,
        refundFired,
        ...(actorStaffId ? { actorStaffId } : {}),
        at: now.toISOString(),
      },
    })

    return { refundOutcome, refundFired }
  })
}
