/**
 * Single-booking cancellation — client self-cancel and staff cancel.
 * See be-client.md §4c (client) and be-portal.md §3b (staff).
 *
 * Class + PT only (credit/session bookings). Workshops refund via Stripe and are handled
 * elsewhere.
 *
 *   - Staff source (#320): an admin, on any booking, or an instructor, on a class
 *     they may work (`not_your_session` otherwise). Staff choose the credit every
 *     time — `return` puts it back, `keep` moves nothing (`forfeited`). The window
 *     and the cap never decide it, and a staff cancel never counts toward the cap;
 *     the window is still recorded, truthfully, on the cancellations row.
 *   - Client source, class: allowed until the class starts (`class_started` after).
 *     Inside the window it is a Late cancel — the credit is kept. In time, the credit
 *     comes back while the member is under the cap, or always with the cap off
 *     (evaluateCancellation).
 *   - Client source, PT: refused inside the PT window (`cancellation_window_passed`).
 *   - Staff source, PT: refused once the session has started (`session_already_started`).
 *   - Unlimited bookings debited 0 credits → nothing to return; seat is released and the
 *     outcome is recorded as `n_a` (not `credit_returned`). See `settleCancel`.
 *
 * Everything runs in one transaction. The class/PT row is locked FOR UPDATE so a self-cancel
 * can't race an admin bulk class-cancel. A caller that must commit or roll back
 * with the cancels it causes (a Package rule change) uses `cancelBookingInTx`.
 */
import { and, eq } from 'drizzle-orm'
import { afterCommit, retryingTransaction } from '../../db'
import { bookings, cancellations } from '../../db/schema/bookings'
import { classes, ptRequests, ptSessions } from '../../db/schema/schedule'
import { actorOfSource, keepCredit, refundCredits } from '../packages/ledger'
import { reverseActivationOnCancel } from '../packages/activation'
import {
  settleCancel,
  type CancelSource,
  type RefundOutcome,
  type StaffCancelSource,
  type StaffCredit,
} from './refund-outcome'
import { lockMemberAndEvaluateCancellation, staffCancelInTime } from '../policy/evaluate-cancellation'
import { lockPromotionHead, promoteFromWaitlist, sendPromotionEmails, type Promotion } from '../waitlist/promote'
import { assertMayWorkClass } from '../waitlist/staff'
import type { Tx } from '../schedule/roster'
import { settleSessionAfterBookingCancel, type LockedSessionRequest } from '../pt-sessions/manual'
import { refuseOnceStarted } from '../pt-sessions/started'
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { now as clockNow } from '../../lib/clock'
import { sendMemberCancelReturnedEmail } from '../notifications/send-booking-email'
import { recordPtSessionCancelled } from '../attention/session-updates'

export type { CancelSource, StaffCancelSource, StaffCredit }

interface CancelBase {
  bookingId: string
  /**
   * The package that paid for this booking has been **Voided** by a Refund
   * (§14). The seat is released as usual (and promotes from the waitlist like any other), but nothing
   * is returned: putting a credit back into a package that no longer exists is
   * meaningless, and a `credit_returned` outcome would falsely read as the
   * member being made whole twice on top of their money back. The outcome is
   * `n_a`, the same one an Unlimited booking already takes.
   */
  packageVoided?: boolean
  /**
   * Why the studio cancelled, when it was not a person cancelling this one
   * booking: the class's Package rule changed and no longer accepts the package
   * that paid (services/schedule/package-rules.ts). System source only, with
   * `credit: 'return'`. The booking is refunded and the seat back-filled exactly
   * as an admin cancel does — and, like one, it never counts against the
   * member's cancellations.
   */
  studioReason?: 'package_rule_changed'
}

export type CancelInput =
  | (CancelBase & {
      source: 'client'
      /** Asserts the booking belongs to this client. */
      clientId?: string
    })
  | (CancelBase & {
      source: 'admin'
      /** The admin cancelling: on the cancellation and the credit-adjustment ledger. */
      actorStaffId?: string
      credit: StaffCredit
    })
  | (CancelBase & {
      /**
       * The studio's machinery, not a person (#350): a Refund's Void, a
       * Complimentary Package's Remove, a Package rule change. Settles as a
       * staff cancel does and records no staff member on the cancellation.
       */
      source: 'system'
      /** Whose act set it off (a rule change's editor), for the credit ledger only. */
      actorStaffId?: string
      credit: StaffCredit
    })
  | (CancelBase & {
      source: 'instructor'
      /** The instructor cancelling — who the class must be led by. */
      actorStaffId: string
      credit: StaffCredit
    })
  | (CancelBase & {
      /**
       * The member cancelled on ClassPass, and ClassPass's email said so
       * (#412). A ClassPass booking spent nothing, so there is nothing to
       * return or keep: `n_a`. Not the member's own cancel here, so never a
       * Late cancel and never toward the Cancellation Cap.
       */
      source: 'classpass'
    })

export interface CancelResult {
  refundOutcome: RefundOutcome
  refundFired: boolean
}

export async function cancelBooking(
  tenantId: string,
  input: CancelInput,
): Promise<CancelResult> {
  // A promotion locks the head of the line's time and packages, and an Admin
  // act already holding the canceller's package can reach the same head
  // further on (#439): Postgres aborts one of the two, and it runs again.
  const { result, promotions } = await retryingTransaction('booking cancel', tx => cancelBookingInTx(tx, tenantId, input))
  // Once the request's transaction has committed (`afterCommit`), never inside it.
  if (promotions.length) afterCommit(() => sendPromotionEmails(tenantId, promotions))
  // NTF-09: a member who cancelled in time is told what came back. Never throws.
  if (input.source === 'client' && result.refundFired) {
    afterCommit(() => sendMemberCancelReturnedEmail(tenantId, input.bookingId))
  }
  return result
}

/**
 * `cancelBooking` inside a transaction the caller owns, for a change that must
 * commit or roll back with the cancels it causes (a Package rule change). The
 * promotions it made are returned for the caller to email once it has committed.
 */
export async function cancelBookingInTx(
  tx: Tx,
  tenantId: string,
  input: CancelInput,
): Promise<{ result: CancelResult; promotions: Promotion[] }> {
  const { bookingId, source, packageVoided, studioReason } = input
  const clientId = input.source === 'client' ? input.clientId : undefined
  const actorStaffId = 'actorStaffId' in input ? input.actorStaffId : undefined
  const credit = 'credit' in input ? input.credit : undefined

  const parent = await lockParentOf(tx, tenantId, bookingId)

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
      seat: bookings.seat,
      used: bookings.creditsOrSessionsUsed,
      bookedVia: bookings.source,
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
    .for('update')
    .limit(1)

  if (!bk) throw new NotFoundError('booking_not_found')
  if (source === 'client' && clientId && bk.clientId !== clientId) {
    throw new ForbiddenError('not_your_booking')
  }
  // A ClassPass booking is the member's to cancel on ClassPass, whose
  // cancellation email cancels it here (#412); staff can still cancel it.
  if (source === 'client' && bk.bookedVia === 'classpass') {
    throw new ConflictError('classpass_booking_cancel_on_classpass', {
      message: 'This booking was made on ClassPass. Cancel it in the ClassPass app.',
    })
  }
  // An instructor cancels on the classes they lead; a private session's
  // booking is cancelled as a PT request, not here.
  if (source === 'instructor' && bk.kind !== 'class') {
    throw new ForbiddenError('not_your_session', { message: 'This booking is for a session you are not teaching.' })
  }
  if (bk.state !== 'confirmed') throw new ConflictError('not_cancellable')
  if (bk.kind === 'workshop') throw new BadRequestError('workshop_cancel_unsupported')
  // Attendance keeps state='confirmed', so the check above lets an admin refund
  // someone who was demonstrably in the room. Untick the roster first if the
  // attendance was a mistake — then this cancel is allowed.
  if (bk.checkInState === 'attended') throw new ConflictError('booking_attended')

  const cancelKind: 'class' | 'pt' = bk.kind === 'class' ? 'class' : 'pt'

  if (parent?.kind !== bk.kind) throw new NotFoundError(bk.kind === 'class' ? 'class_not_found' : 'pt_session_not_found')
  if (source === 'instructor' && parent.kind === 'class') {
    assertMayWorkClass({ role: 'instructor', staffId: actorStaffId! }, parent)
  }
  const sessionStartsAt = parent.startsAt

  // 3. Evaluate the refund decision.
  const now = clockNow()
  if (cancelKind === 'pt' && source === 'admin') refuseOnceStarted(sessionStartsAt, now)
  const evaluation =
    source !== 'client'
      ? undefined
      : await lockMemberAndEvaluateCancellation({
          tenantId,
          clientId: bk.clientId,
          kind: cancelKind,
          sessionStartsAt,
          now,
        })

  // A member's PT session is a HARD deadline: inside its window — or after it
  // has started — the cancel is rejected outright. A class is not (#318): inside
  // its window it goes through as a Late cancel, and only a class that has
  // started is refused, by the evaluation above. Staff bypass both.
  if (source === 'client' && cancelKind === 'pt' && !evaluation!.wasWithinWindow) {
    throw new AppError(422, 'cancellation_window_passed', {
      window_hours: evaluation!.windowHours,
    })
  }

  const used = bk.used ?? 0
  // Unlimited bookings used 0 credits → nothing to return; record n_a, not
  // credit_returned. A Voided package takes the same arm for the same reason:
  // there is no longer anything to return the credit to. A Refund's own unwind
  // says so up front (`packageVoided`); a booking the Void left standing (its
  // class already running) and cancelled later is found out by the ledger when
  // it holds the package (step 4), never by a read made before.
  // A class cancel never touches `expires_at`: Activation is one-way (§3), from
  // any actor, and staff return a plan to Dormant by hand through the portal
  // expiry dialog. A PT booking on the session that Activated its package is
  // the one exception (step 4b).
  let { refundOutcome, refundFired } = settleCancel({
    kind: cancelKind,
    source,
    evaluation,
    credit,
    used,
    returnable: bk.clientPackageId !== null && !packageVoided,
  })

  // Whether the cancel came in time, judged against the same window a
  // member's would be. A staff cancel's is recorded, never acted on.
  const wasWithinWindow =
    evaluation?.wasWithinWindow ?? (await staffCancelInTime(tenantId, cancelKind, sessionStartsAt, now))

  const freesOnlineSeat = bk.kind === 'class' && bk.seat === 'online'
  if (freesOnlineSeat) await lockPromotionHead(tx, tenantId, bk.classId!, bk.clientPackageId, now)

  // 4. Return the credit/session to the originating package. The ledger also
  // re-derives `active`, so a bundle emptied to zero becomes spendable again
  // (it used to come back with credits but flagged unusable) — and writes the
  // credit-movement audit row (traceability per backend-architecture §4).
  if (refundFired) {
    const { landed } = await refundCredits(tx, {
      tenantId,
      clientId: bk.clientId,
      clientPackageId: bk.clientPackageId!,
      amount: used,
      reason: studioReason ? 'package_rule_cancellation_refund' : `${source}_cancellation_refund`,
      cause: 'returned',
      bookingId: bk.id,
      actor: actorOfSource(source),
      actedByStaffId: actorStaffId ?? null,
    })
    // The package was Voided while this cancel waited for it: nothing came back.
    if (!landed) {
      refundFired = false
      refundOutcome = 'n_a'
    }
  } else if (refundOutcome === 'forfeited' && used > 0 && bk.clientPackageId) {
    // A Late cancel, an over-cap one or a staff Keep credit: the balance stays
    // as it is, and the history says where the credit went. A Voided package
    // has none to keep, so the cancel settles `n_a`.
    const kept = await keepCredit(tx, {
      tenantId,
      clientId: bk.clientId,
      clientPackageId: bk.clientPackageId,
      bookingId: bk.id,
      actor: actorOfSource(source),
      actedByStaffId: actorStaffId ?? null,
    })
    if (!kept) refundOutcome = 'n_a'
  }

  // 4b. The private session that Activated the package, its paying seat
  // cancelled in time, returns the package to Dormant (be/docs/adr/0011). Not
  // a Voided package: it has ended, and nothing may make it live again. A
  // Refund's own unwind says so up front; the reversal reads the rest under
  // the package lock.
  if (bk.kind === 'pt' && bk.clientPackageId && !packageVoided) {
    await reverseActivationOnCancel(tx, {
      tenantId,
      clientId: bk.clientId,
      clientPackageId: bk.clientPackageId,
      ptSessionId: bk.ptSessionId!,
      late: !wasWithinWindow,
      actedByStaffId: actorStaffId ?? null,
    })
  }

  // 5. Record the cancellation. Only `source='client'` rows count toward the
  // member's cap, whatever the refund outcome; a staff row never does.
  const cancelledByStaffId = source === 'admin' || source === 'instructor' ? (actorStaffId ?? null) : null
  await tx.insert(cancellations).values({
    tenantId,
    bookingId: bk.id,
    clientId: bk.clientId,
    kind: cancelKind,
    source,
    cancelledByStaffId,
    wasWithinWindow,
    wasWithinCap: evaluation?.wasWithinCap ?? true,
    refundFired,
    cancelledAt: now,
  })

  // 6. Flip the booking.
  await tx
    .update(bookings)
    .set({ state: 'cancelled', refundOutcome, checkInState: 'n_a', cancelledAt: now })
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bk.id)))

  // 6b. A private session's request and session follow the booking, as a
  // cancel of the request leaves them — never scheduled with nobody paying,
  // nor completed as attended once its time passes (#350).
  if (parent?.kind === 'pt') {
    await settleSessionAfterBookingCancel(tx, tenantId, {
      req: parent.req,
      ptSessionId: bk.ptSessionId!,
      clientId: bk.clientId,
      source,
      cancelledByStaffId,
      now,
    })
    // The session's instructors: told when a member left or an admin ended the session (#493).
    await recordPtSessionCancelled(tenantId, {
      ptSessionId: bk.ptSessionId!,
      source,
      actorStaffId: cancelledByStaffId,
      memberClientId: bk.clientId,
    })
  }

  const promotions = freesOnlineSeat ? await promoteFromWaitlist(tx, tenantId, bk.classId!, now) : []

  return { result: { refundOutcome, refundFired }, promotions }
}

type LockedParent =
  | { kind: 'class'; startsAt: Date; mainInstructorId: string }
  | { kind: 'pt'; startsAt: Date; req: LockedSessionRequest | undefined }

async function lockParentOf(tx: Tx, tenantId: string, bookingId: string): Promise<LockedParent | undefined> {
  const [target] = await tx
    .select({
      kind: bookings.kind,
      classId: bookings.classId,
      ptSessionId: bookings.ptSessionId,
      ptRequestId: ptSessions.ptRequestId,
    })
    .from(bookings)
    .leftJoin(ptSessions, and(eq(ptSessions.tenantId, bookings.tenantId), eq(ptSessions.id, bookings.ptSessionId)))
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
    .limit(1)
  if (target?.kind === 'class' && target.classId) {
    const [cls] = await tx
      .select({ startsAt: classes.startsAt, mainInstructorId: classes.mainInstructorId })
      .from(classes)
      .where(and(eq(classes.tenantId, tenantId), eq(classes.id, target.classId)))
      .for('update')
      .limit(1)
    return cls && { kind: 'class', ...cls }
  }
  if (target?.kind === 'pt' && target.ptSessionId) {
    const [req] = target.ptRequestId
      ? await tx
          .select({
            id: ptRequests.id,
            origin: ptRequests.origin,
            status: ptRequests.status,
            clientId: ptRequests.clientId,
            coClientId: ptRequests.coClientId,
          })
          .from(ptRequests)
          .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, target.ptRequestId)))
          .for('update')
          .limit(1)
      : []
    const [session] = await tx
      .select({ startsAt: ptSessions.startsAt })
      .from(ptSessions)
      .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, target.ptSessionId)))
      .for('update')
      .limit(1)
    return session && { kind: 'pt', startsAt: session.startsAt, req }
  }
  return undefined
}
