import { and, eq, inArray, lt } from 'drizzle-orm'
import { db } from '../../db'
import { ptRequests, ptSessions } from '../../db/schema/schedule'
import { bookings, cancellations } from '../../db/schema/bookings'
import { inboxItems } from '../../db/schema/inbox'
import { evaluateCancellation } from '../policy/evaluate-cancellation'
import { refundCredits } from '../packages/ledger'
import { ptSessionCost } from './cost'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { captureException } from '../../instrument'

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
 *
 * Terminal states are an idempotent no-op. Credit movements write a
 * manual_adjustments ledger row for traceability/parity with the class path.
 */
export type CancelPtSource = 'client' | 'admin' | 'system'

export interface CancelPtRequestInput {
  ptRequestId: string
  source: CancelPtSource
  /** Required for source='client' — asserts the request belongs to this client. */
  clientId?: string
  /** Staff actor for admin cancels (recorded on the request + ledger). */
  actorStaffId?: string
  /**
   * When set (instructor-initiated cancel), restricts the action to a SCHEDULED
   * session the instructor personally runs. Instructors cannot cancel pending
   * (un-triaged) requests, nor sessions assigned to another instructor.
   */
  requireOwnInstructorId?: string
}

export interface CancelPtRequestResult {
  status: 'cancelled_before_scheduled' | 'cancelled_after_scheduled' | 'noop'
  refundedSessions: number
  refundOutcome: 'session_returned' | 'forfeited' | 'n_a'
}

export async function cancelPtRequest(input: CancelPtRequestInput): Promise<CancelPtRequestResult> {
  const { ptRequestId, source, clientId, actorStaffId } = input

  return db.transaction(async tx => {
    const [req] = await tx
      .select()
      .from(ptRequests)
      .where(eq(ptRequests.id, ptRequestId))
      .for('update')
      .limit(1)
    if (!req) throw new NotFoundError('pt_request_not_found')

    // Ownership: a client may only cancel their own request.
    if (source === 'client' && clientId && req.clientId !== clientId) {
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
    const resolvedByStaffId = source === 'admin' ? (actorStaffId ?? null) : null

    // Refund `n` sessions to the exact debited package (ledger locks the row,
    // re-derives `active` and writes the audit entry).
    const refundToPackage = async (n: number, reason: string) => {
      if (n <= 0 || !req.debitedClientPackageId) return
      await refundCredits(tx, {
        clientId: req.clientId,
        clientPackageId: req.debitedClientPackageId,
        amount: n,
        reason,
        actedByStaffId: resolvedByStaffId,
      })
    }

    // ---- pending → cancelled_before_scheduled (always refund) -------------
    if (req.status === 'pending') {
      await refundToPackage(
        cost,
        source === 'system' ? 'pt_request_expiry_refund' : 'pt_request_cancel_refund',
      )
      await tx
        .update(ptRequests)
        .set({ status: 'cancelled_before_scheduled', resolvedAt: new Date(), resolvedByStaffId })
        .where(eq(ptRequests.id, ptRequestId))
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
        // See bookings/cancel.ts: the session row is where the tenant comes from
        // until this service is scoped in its own batch (#62).
        tenantId: ptSessions.tenantId,
        startsAt: ptSessions.startsAt,
        lifecycle: ptSessions.lifecycle,
        instructorId: ptSessions.instructorId,
      })
      .from(ptSessions)
      .where(eq(ptSessions.id, req.scheduledPtSessionId ?? ''))
      .for('update')
      .limit(1)
    if (!session) throw new NotFoundError('pt_session_not_found')

    // Ownership guard for instructor-initiated cancels.
    if (input.requireOwnInstructorId && session.instructorId !== input.requireOwnInstructorId) {
      throw new ForbiddenError('not_your_session')
    }

    const now = new Date()

    // Refund decision. Admin bypasses window/cap (always full); client is gated
    // by the PT window + shared cancellation cap.
    let refundSessions = 0
    let wasWithinWindow = true
    let wasWithinCap = true
    if (source === 'admin') {
      refundSessions = cost
    } else {
      const evaluation = await evaluateCancellation({
        tenantId: session.tenantId!,
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
    const refundOutcome: CancelPtRequestResult['refundOutcome'] =
      refundSessions > 0 ? 'session_returned' : 'forfeited'

    await refundToPackage(refundSessions, source === 'admin' ? 'pt_admin_cancel_refund' : 'pt_cancel_refund')

    // Cancel the session.
    await tx
      .update(ptSessions)
      .set({
        lifecycle: 'cancelled',
        cancelledAt: now,
        cancelledByStaffId: source === 'admin' ? (actorStaffId ?? null) : null,
      })
      .where(eq(ptSessions.id, session.id))

    // Cancel every booking on the session. The requester's booking carries the
    // refund outcome; co-clients (2on1 partner) only lose their seat (`n_a`).
    const sessionBookings = await tx
      .select({ id: bookings.id, clientId: bookings.clientId })
      .from(bookings)
      .where(and(eq(bookings.ptSessionId, session.id), eq(bookings.state, 'confirmed')))
      .for('update')
    for (const bk of sessionBookings) {
      await tx
        .update(bookings)
        .set({
          state: 'cancelled',
          refundOutcome: bk.clientId === req.clientId ? refundOutcome : 'n_a',
          checkInState: 'n_a',
          cancelledAt: now,
        })
        .where(eq(bookings.id, bk.id))
    }

    // One cancellation row, attributed to the requester (the actor who owns the
    // request + the debit). Counts once toward their shared class/PT cap.
    const requesterBooking = sessionBookings.find(b => b.clientId === req.clientId)
    if (requesterBooking) {
      await tx.insert(cancellations).values({
        bookingId: requesterBooking.id,
        clientId: req.clientId,
        kind: 'pt',
        source: source === 'admin' ? 'admin' : 'client',
        wasWithinWindow,
        wasWithinCap,
        refundFired: refundSessions > 0,
        cancelledAt: now,
      })
    }

    await tx
      .update(ptRequests)
      .set({ status: 'cancelled_after_scheduled', resolvedAt: now, resolvedByStaffId })
      .where(eq(ptRequests.id, ptRequestId))

    await tx.insert(inboxItems).values({
      type: source === 'admin' ? 'admin_cancel_class_pt' : 'client_cancellation',
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

    // NOTE(email): pt_cancelled_session_returned / pt_cancelled_forfeited are sent
    // out-of-band, consistent with the class cancel path which is inbox-only in v1.

    return { status: 'cancelled_after_scheduled', refundedSessions: refundSessions, refundOutcome }
  })
}

/**
 * Every 5 min (jobs/index.ts): expire pending PT requests past their advance
 * booking window. Routes each through the same `pending` refund path with
 * source='system' — refund the debit, flip to cancelled_before_scheduled.
 */
export async function expireStaleSessions(): Promise<void> {
  const now = new Date()
  const stale = await db
    .select({ id: ptRequests.id })
    .from(ptRequests)
    .where(and(eq(ptRequests.status, 'pending'), lt(ptRequests.expiresAt, now)))

  for (const row of stale) {
    try {
      await cancelPtRequest({ ptRequestId: row.id, source: 'system' })
    } catch (err) {
      // A request that raced into a terminal/scheduled state between the scan and
      // the lock is fine to skip — the sweep is best-effort and idempotent.
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ ptRequestId: row.id, err: msg }, 'pt-expiry: failed to expire request')
      captureException(err, { scope: 'pt-expiry', ptRequestId: row.id })
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
  const now = new Date()
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
