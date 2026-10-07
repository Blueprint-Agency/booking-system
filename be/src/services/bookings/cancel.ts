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
 *   - Unlimited bookings debited 0 credits → nothing to return; seat is released and the
 *     outcome is recorded as `n_a` (not `credit_returned`). See `settleCancel`.
 *
 * Everything runs in one transaction. The class/PT row is locked FOR UPDATE so a self-cancel
 * can't race an admin bulk class-cancel. A caller that must commit or roll back
 * with the cancels it causes (a Package rule change) uses `cancelBookingInTx`.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { bookings, cancellations } from '../../db/schema/bookings'
import { classes, ptSessions } from '../../db/schema/schedule'
import { inboxItems } from '../../db/schema/inbox'
import { refundCredits } from '../packages/ledger'
import { reverseActivationOnCancel } from '../packages/activation'
import {
  settleCancel,
  type CancelSource,
  type RefundOutcome,
  type StaffCancelSource,
  type StaffCredit,
} from './refund-outcome'
import { evaluateCancellation, staffCancelInTime } from '../policy/evaluate-cancellation'
import { promoteFromWaitlist, sendPromotionEmails, type Promotion } from '../waitlist/promote'
import { assertMayWorkClass } from '../waitlist/staff'
import type { Tx } from '../schedule/roster'
import { settleSessionAfterBookingCancel } from '../pt-sessions/manual'
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { now as clockNow } from '../../lib/clock'

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

export interface CancelResult {
  refundOutcome: RefundOutcome
  refundFired: boolean
}

export async function cancelBooking(
  tenantId: string,
  input: CancelInput,
): Promise<CancelResult> {
  const { result, promotions } = await db.transaction(tx => cancelBookingInTx(tx, tenantId, input))
  await sendPromotionEmails(tenantId, promotions)
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
  const actorStaffId = input.source === 'client' ? undefined : input.actorStaffId
  const credit = input.source === 'client' ? undefined : input.credit

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
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
    .for('update')
    .limit(1)

  if (!bk) throw new NotFoundError('booking_not_found')
  if (source === 'client' && clientId && bk.clientId !== clientId) {
    throw new ForbiddenError('not_your_booking')
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

  // 2. Load + lock the session to read its start time (race-safe vs admin bulk cancel).
  let sessionStartsAt: Date
  // A class's own Cancellation Window, read now: an edit applies to bookings made before it.
  let classOwnWindowHours: number | null = null
  if (bk.kind === 'class') {
    const [cls] = await tx
      .select({
        startsAt: classes.startsAt,
        cancelWindowHours: classes.cancelWindowHours,
        mainInstructorId: classes.mainInstructorId,
      })
      .from(classes)
      .where(and(eq(classes.tenantId, tenantId), eq(classes.id, bk.classId!)))
      .for('update')
      .limit(1)
    if (!cls) throw new NotFoundError('class_not_found')
    if (source === 'instructor') assertMayWorkClass({ role: 'instructor', staffId: actorStaffId! }, cls)
    sessionStartsAt = cls.startsAt
    classOwnWindowHours = cls.cancelWindowHours
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
  const now = clockNow()
  const evaluation =
    source !== 'client'
      ? undefined
      : await evaluateCancellation({
          tenantId,
          clientId: bk.clientId,
          kind: cancelKind,
          sessionStartsAt,
          classOwnWindowHours,
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
  // there is no longer anything to return the credit to.
  // A class cancel never touches `expires_at`: Activation is one-way (§3), from
  // any actor, and staff return a plan to Dormant by hand through the portal
  // expiry dialog. A PT booking on the session that Activated its package is
  // the one exception (step 4b).
  const { refundOutcome, refundFired } = settleCancel({
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
    evaluation?.wasWithinWindow ?? (await staffCancelInTime(tenantId, cancelKind, sessionStartsAt, classOwnWindowHours, now))

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
      reason: studioReason ? 'package_rule_cancellation_refund' : `${source}_cancellation_refund`,
      actedByStaffId: actorStaffId ?? null,
    })
  }

  // 4b. The private session that Activated the package, its paying seat
  // cancelled in time, returns the package to Dormant (be/docs/adr/0011). Not
  // a Voided package: it has ended, and nothing may make it live again.
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
  if (bk.kind === 'pt') {
    await settleSessionAfterBookingCancel(tx, tenantId, {
      ptSessionId: bk.ptSessionId!,
      clientId: bk.clientId,
      source,
      cancelledByStaffId,
      now,
    })
  }

  // 7. A staff single-cancel raises an inbox item (client self-cancel also notifies admins).
  await tx.insert(inboxItems).values({
    tenantId,
    type: source === 'client' ? 'client_cancellation' : 'admin_cancel_class_pt',
    payload: {
      bookingId: bk.id,
      clientId: bk.clientId,
      kind: cancelKind,
      refundOutcome,
      refundFired,
      ...(source === 'client' ? {} : { source }),
      ...(actorStaffId ? { actorStaffId } : {}),
      ...(studioReason ? { reason: studioReason } : {}),
      at: now.toISOString(),
    },
  })

  // 8. A freed online seat goes to the head of the waitlist, in this
  // transaction and under the class lock taken in step 2 (spec-waitlist.md
  // §5). A buffer or overbook seat is staff's, not the line's, and promotes
  // nobody.
  const promotions =
    bk.kind === 'class' && bk.seat === 'online' ? await promoteFromWaitlist(tx, tenantId, bk.classId!, now) : []

  return { result: { refundOutcome, refundFired }, promotions }
}
