import { and, eq, inArray, lt } from 'drizzle-orm'
import { afterCommit, db } from '../../db'
import { ptRequests, ptSessions } from '../../db/schema/schedule'
import { bookings, cancellations } from '../../db/schema/bookings'
import { inboxItems } from '../../db/schema/inbox'
import { evaluateCancellation, staffCancelInTime } from '../policy/evaluate-cancellation'
import { actorOfSource, recordMovement, refundCredits } from '../packages/ledger'
import { reverseActivationOnCancel } from '../packages/activation'
import { ptSessionCost } from './cost'
import { cancelManualSessionInTx } from './manual'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { now as clockNow } from '../../lib/clock'
import { emptyPtCancelMail, sendPtCancelMail, type PtCancelMail } from '../notifications/send-booking-email'

/**
 * Cancel a PT request, branching on its current status. Single entry point for
 * client self-cancel (`/me/pt-sessions/:id/cancel`), admin cancel
 * (`/pt-requests|pt-sessions/:id/cancel`), and the expiry cron.
 *
 *   pending   → cancelled_before_scheduled
 *               Always refund the debit (1 for 1on1 / 2 for 2on1) to the exact
 *               package recorded at submit. No pt_session exists yet.
 *
 *   scheduled → cancelled_after_scheduled
 *               Cascade-cancel the linked pt_sessions row + its bookings.
 *               Refund decision (be-portal.md §3c, superseding the old v1
 *               "always forfeit"): admin → always full refund; client → routed
 *               through evaluateCancellation(kind='pt') so a cancel within the
 *               configured PT window + cap returns the session(s), otherwise the
 *               action is rejected outright (hard deadline, mirroring classes).
 *               If this session Activated the package and the cancel is not
 *               late, the package returns to Dormant (be/docs/adr/0011).
 *               A manual session (`origin = 'portal'`) is settled seat by
 *               seat instead — staff cancel it whole, each booking refunded to
 *               its own package; a member cancels only their own seat
 *               (./manual.ts:cancelManualSessionInTx).
 *
 * Terminal states are an idempotent no-op. Credit movements write a
 * manual_adjustments ledger row for traceability/parity with the class path.
 */
/**
 * Who cancelled (#350): the member, an admin, the session's instructor, or the
 * studio's machinery — an expiry, a Complimentary Package's Remove. Every
 * source but the member's settles as a staff cancel.
 */
export type CancelPtSource = 'client' | 'admin' | 'instructor' | 'system'

export interface CancelPtRequestInput {
  ptRequestId: string
  source: CancelPtSource
  /** Required for source='client' — asserts the request belongs to this client. */
  clientId?: string
  /**
   * Staff actor for a staff cancel (recorded on the request + ledger, and on
   * the cancellation for admin or instructor), or whose act set off a system one.
   */
  actorStaffId?: string
  /** The expiry cron: a pending request's debit comes back as an expiry refund. */
  expired?: boolean
  /**
   * When set (instructor-initiated cancel), restricts the action to a SCHEDULED
   * session the instructor personally runs. Instructors cannot cancel pending
   * (un-triaged) requests, nor sessions assigned to another instructor.
   */
  requireOwnInstructorId?: string
  /**
   * Why staff cancelled, shown to the member on their booking. Optional, and
   * recorded only for an admin or instructor cancel: a member's own cancel and
   * a system one carry none.
   */
  note?: string | null
}

export interface CancelPtRequestResult {
  /** `seat_cancelled`: a member left a manual session that goes on without them. */
  status: 'cancelled_before_scheduled' | 'cancelled_after_scheduled' | 'seat_cancelled' | 'noop'
  refundedSessions: number
  refundOutcome: 'session_returned' | 'forfeited' | 'n_a'
}

export async function cancelPtRequest(
  tenantId: string,
  input: CancelPtRequestInput,
): Promise<CancelPtRequestResult> {
  // The emails this cancel owes are gathered inside the transaction and sent
  // only once the request's transaction has committed (`afterCommit`; NTF-09,
  // NTF-10, NTF-11). Sending never throws.
  const mail = emptyPtCancelMail()
  const result = await cancelPtRequestInTx(tenantId, input, mail)
  if (mail.studio.length || mail.memberReturned.length || mail.request.length) {
    afterCommit(() => sendPtCancelMail(tenantId, mail))
  }
  return result
}

async function cancelPtRequestInTx(
  tenantId: string,
  input: CancelPtRequestInput,
  mail: PtCancelMail,
): Promise<CancelPtRequestResult> {
  const { ptRequestId, source, clientId, actorStaffId } = input

  return db.transaction(async tx => {
    const [req] = await tx
      .select()
      .from(ptRequests)
      .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, ptRequestId)))
      .for('update')
      .limit(1)
    if (!req) throw new NotFoundError('pt_request_not_found')

    // Ownership: a client may only cancel their own request — or, on a manual
    // session, where each attendee holds a seat of their own, their own seat.
    const mayCancel = req.clientId === clientId || (req.origin === 'portal' && req.coClientId === clientId)
    if (source === 'client' && clientId && !mayCancel) {
      throw new ForbiddenError('not_your_request')
    }

    // Terminal states → idempotent no-op.
    if (
      req.status === 'cancelled_before_scheduled' ||
      req.status === 'cancelled_after_scheduled' ||
      req.status === 'attended'
    ) {
      return { status: 'noop', refundedSessions: 0, refundOutcome: 'n_a' }
    }

    // Instructors may only cancel sessions they run, and only once scheduled —
    // triage (pending) is an admin responsibility.
    if (input.requireOwnInstructorId && req.status !== 'scheduled') {
      throw new ForbiddenError('not_your_session')
    }

    const cost = ptSessionCost(req.sessionType)
    const staff = source !== 'client'
    const byPerson = source === 'admin' || source === 'instructor'
    const resolvedByStaffId = staff ? (actorStaffId ?? null) : null

    // Written first, in this transaction, so every branch below — the manual
    // session's included — carries it, and a refused cancel rolls it back.
    const cancelNote = byPerson ? input.note?.trim() || null : null
    if (cancelNote) {
      await tx
        .update(ptRequests)
        .set({ cancelNote })
        .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, ptRequestId)))
    }

    // Refund `n` sessions to the exact debited package (ledger locks the row,
    // re-derives `active` and writes the audit entry).
    const refundToPackage = async (n: number, reason: string, bookingId: string | null = null) => {
      if (n <= 0 || !req.debitedClientPackageId) return
      await refundCredits(tx, {
        tenantId,
        clientId: req.clientId,
        clientPackageId: req.debitedClientPackageId,
        amount: n,
        reason,
        // A pending request has no booking: its debit comes back as the request's.
        cause: bookingId ? 'returned' : 'pt_returned',
        bookingId,
        actor: actorOfSource(source),
        actedByStaffId: resolvedByStaffId,
      })
    }

    // ---- pending → cancelled_before_scheduled (always refund) -------------
    if (req.status === 'pending') {
      await refundToPackage(
        cost,
        input.expired ? 'pt_request_expiry_refund' : 'pt_request_cancel_refund',
      )
      await tx
        .update(ptRequests)
        // The source is the request's only record of who ended it: a Remove
        // names the admin who took the package back, yet it is no staff cancel.
        // On the app clock: the member's history reads an expiry off it
        // (`resolvedAt >= expiresAt`, bookings/cancellation-summary.ts).
        .set({ status: 'cancelled_before_scheduled', resolvedAt: clockNow(), resolvedByStaffId, cancelSource: source })
        .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, ptRequestId)))
      // NTF-11. An expiry or a Remove is the studio's machinery, not a cancel
      // anyone made, and tells the member its own way.
      if (source !== 'system') {
        mail.request.push({ clientId: req.clientId, sessionsReturned: req.debitedClientPackageId ? cost : 0, ptSessionId: null })
      }
      return {
        status: 'cancelled_before_scheduled',
        refundedSessions: cost,
        refundOutcome: 'session_returned',
      }
    }

    // ---- scheduled → cancelled_after_scheduled (cascade) ------------------
    if (req.status !== 'scheduled') throw new ConflictError('cannot_cancel')

    const [session] = await tx
      .select({
        id: ptSessions.id,
        startsAt: ptSessions.startsAt,
        lifecycle: ptSessions.lifecycle,
        instructorId: ptSessions.instructorId,
      })
      .from(ptSessions)
      .where(
        and(
          eq(ptSessions.tenantId, tenantId),
          eq(ptSessions.id, req.scheduledPtSessionId ?? ''),
        ),
      )
      .for('update')
      .limit(1)
    if (!session) throw new NotFoundError('pt_session_not_found')

    // Ownership guard for instructor-initiated cancels.
    if (input.requireOwnInstructorId && session.instructorId !== input.requireOwnInstructorId) {
      throw new ForbiddenError('not_your_session')
    }

    const now = clockNow()

    // A manual session has no debit on its request: each seat was paid on its
    // own booking, so each is settled on its own package (./manual.ts).
    if (req.origin === 'portal') {
      return cancelManualSessionInTx(tx, tenantId, {
        req,
        session,
        source,
        ...(clientId ? { clientId } : {}),
        actorStaffId: resolvedByStaffId,
        now,
        mail,
      })
    }

    // Refund decision. Staff (and system) bypass window/cap (always full);
    // client is gated by the PT window + shared cancellation cap.
    let refundSessions = 0
    let wasWithinWindow = true
    let wasWithinCap = true
    if (staff) {
      refundSessions = cost
      // The window never decides a staff cancel's refund, but it is recorded
      // truthfully, and a late one keeps the package Activated (below).
      wasWithinWindow = await staffCancelInTime(tenantId, 'pt', session.startsAt, null, now)
    } else {
      const evaluation = await evaluateCancellation({
        tenantId,
        clientId: req.clientId,
        kind: 'pt',
        sessionStartsAt: session.startsAt,
        now,
      })
      wasWithinWindow = evaluation.wasWithinWindow
      wasWithinCap = evaluation.wasWithinCap
      // Hard deadline: inside the window (or after start) the cancel is rejected,
      // not merely forfeited — same contract as the class self-cancel path.
      if (!evaluation.wasWithinWindow) {
        throw new AppError(422, 'cancellation_window_passed', { window_hours: evaluation.windowHours })
      }
      refundSessions = evaluation.refund === 'full' ? cost : 0
    }

    const sessionBookings = await tx
      .select({ id: bookings.id, clientId: bookings.clientId })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.ptSessionId, session.id),
          eq(bookings.state, 'confirmed'),
        ),
      )
      .for('update')
    // The requester's booking carries the debit (schedule.ts). If it was already
    // cancelled on its own (services/bookings/cancel.ts), that cancel settled the
    // session(s) — returned or forfeited — and returning them here would pay twice.
    const requesterStillBooked = sessionBookings.some(b => b.clientId === req.clientId)
    if (!requesterStillBooked) refundSessions = 0
    const refundOutcome: CancelPtRequestResult['refundOutcome'] = !requesterStillBooked
      ? 'n_a'
      : refundSessions > 0
        ? 'session_returned'
        : 'forfeited'

    const requesterBookingId = sessionBookings.find(b => b.clientId === req.clientId)?.id ?? null
    await refundToPackage(refundSessions, staff ? 'pt_admin_cancel_refund' : 'pt_cancel_refund', requesterBookingId)
    if (refundOutcome === 'forfeited' && req.debitedClientPackageId) {
      await recordMovement(tx, {
        tenantId,
        clientId: req.clientId,
        clientPackageId: req.debitedClientPackageId,
        cause: 'kept',
        bookingId: requesterBookingId,
        actor: actorOfSource(source),
        actedByStaffId: resolvedByStaffId,
      })
    }

    // The session that Activated the package, cancelled in time, returns it to
    // Dormant (be/docs/adr/0011). Not when the requester's booking was already
    // cancelled on its own: that cancel settled it.
    if (requesterStillBooked && req.debitedClientPackageId) {
      await reverseActivationOnCancel(tx, {
        tenantId,
        clientId: req.clientId,
        clientPackageId: req.debitedClientPackageId,
        ptSessionId: session.id,
        late: !wasWithinWindow,
        actedByStaffId: resolvedByStaffId,
      })
    }

    // Cancel the session.
    await tx
      .update(ptSessions)
      .set({
        lifecycle: 'cancelled',
        cancelledAt: now,
        cancelledByStaffId: resolvedByStaffId,
      })
      .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, session.id)))

    // Cancel every booking still on the session. The requester's booking carries
    // the refund outcome; co-clients (2on1 partner) only lose their seat (`n_a`).
    for (const bk of sessionBookings) {
      await tx
        .update(bookings)
        .set({
          state: 'cancelled',
          refundOutcome: bk.clientId === req.clientId ? refundOutcome : 'n_a',
          checkInState: 'n_a',
          cancelledAt: now,
        })
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bk.id)))
    }

    // One cancellation row, attributed to the requester (the actor who owns the
    // request + the debit). Counts once toward their shared class/PT cap.
    const requesterBooking = sessionBookings.find(b => b.clientId === req.clientId)
    if (requesterBooking) {
      await tx.insert(cancellations).values({
        tenantId,
        bookingId: requesterBooking.id,
        clientId: req.clientId,
        kind: 'pt',
        source,
        cancelledByStaffId: byPerson ? (actorStaffId ?? null) : null,
        wasWithinWindow,
        wasWithinCap,
        refundFired: refundSessions > 0,
        cancelledAt: now,
      })
    }

    await tx
      .update(ptRequests)
      .set({ status: 'cancelled_after_scheduled', resolvedAt: now, resolvedByStaffId, cancelSource: source })
      .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, ptRequestId)))

    await tx.insert(inboxItems).values({
      tenantId,
      type: staff ? 'admin_cancel_class_pt' : 'client_cancellation',
      payload: {
        ptRequestId,
        ptSessionId: session.id,
        clientId: req.clientId,
        kind: 'pt',
        refundOutcome,
        refundedSessions: refundSessions,
        ...(actorStaffId ? { actorStaffId } : {}),
        at: now.toISOString(),
      },
    })

    // NTF-11: every member the session booked is told — the requester with the
    // sessions returned to them, a 2-on-1 partner, who paid nothing, without.
    // Returned only when there was a package to return them to, as on the
    // pending path: `refundToPackage` moves nothing without one.
    if (source !== 'system') {
      const returned = req.debitedClientPackageId ? refundSessions : 0
      for (const bk of sessionBookings) {
        mail.request.push({
          clientId: bk.clientId,
          sessionsReturned: bk.clientId === req.clientId ? returned : 0,
          ptSessionId: session.id,
        })
      }
    }

    return { status: 'cancelled_after_scheduled', refundedSessions: refundSessions, refundOutcome }
  })
}

/**
 * Every 5 min (jobs/index.ts): expire pending PT requests past their advance
 * booking window. Routes each through the same `pending` refund path with
 * source='system' — refund the debit, flip to cancelled_before_scheduled.
 */
export async function expireStaleSessions(): Promise<void> {
  const now = clockNow()
  // The scan is deliberately platform-wide — one process sweeps every studio —
  // but each expiry is then performed AS its own tenant, so the refund, the
  // status flip and the inbox item all land under the right one.
  const stale = await db
    .select({ id: ptRequests.id, tenantId: ptRequests.tenantId })
    .from(ptRequests)
    .where(and(eq(ptRequests.status, 'pending'), lt(ptRequests.expiresAt, now)))

  for (const row of stale) {
    try {
      // No fallback: #63 landed and `tenant_id` is `NOT NULL`, so this is a
      // `string`. It used to read `?? TENANT_ONE_ID`, which was right while the
      // column was nullable and a row that predated tenancy belonged to the
      // first studio. Today that would expire one studio's request under
      // another's context.
      await cancelPtRequest(row.tenantId, {
        ptRequestId: row.id,
        source: 'system',
        expired: true,
      })
    } catch (err) {
      // A request that raced into a terminal/scheduled state between the scan and
      // the lock is fine to skip — the sweep is best-effort and idempotent.
      logger.error({ ptRequestId: row.id, err }, 'pt-expiry: failed to expire request')
    }
  }
}

/**
 * Companion to flipNoShows (jobs/index.ts): a SCHEDULED PT request whose session
 * has ended moves to the terminal `attended` state, so it drops off the client's
 * "upcoming" list and surfaces under their "past" history (and the admin "attended"
 * filter). Per-booking check_in_state (attended / no_show) still records who actually
 * showed up — this only advances the request lifecycle past its session.
 */
export async function completeEndedPtSessions(): Promise<void> {
  const now = clockNow()
  // Platform-wide on purpose, like `expirePackages`: this is a clock advancing
  // a lifecycle, not a caller asking a question, and it moves each row only in
  // relation to its own session. Nothing crosses between studios.
  const ended = await db
    .select({ id: ptRequests.id })
    .from(ptRequests)
    .innerJoin(ptSessions, eq(ptSessions.id, ptRequests.scheduledPtSessionId))
    .where(
      and(
        eq(ptRequests.status, 'scheduled'),
        eq(ptSessions.lifecycle, 'active'),
        lt(ptSessions.endsAt, now),
      ),
    )
  if (!ended.length) return
  await db
    .update(ptRequests)
    .set({ status: 'attended' })
    .where(inArray(ptRequests.id, ended.map(r => r.id)))
}
