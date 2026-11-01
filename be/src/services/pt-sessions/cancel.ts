import { and, eq, inArray, lt } from 'drizzle-orm'
import { afterCommit, db, retryingTransaction } from '../../db'
import { ptRequests, ptSessions } from '../../db/schema/schedule'
import { bookings, cancellations } from '../../db/schema/bookings'
import { clients } from '../../db/schema/identity'
import { activeAdminIds, recordUpdate, staffNameFor, studioWhen } from '../attention/updates'
import { lockMemberAndEvaluateCancellation, staffCancelInTime, type EvaluateResult } from '../policy/evaluate-cancellation'
import { actorOfSource, keepCredit, refundCredits, type Tx } from '../packages/ledger'
import { reverseActivationOnCancel } from '../packages/activation'
import { ptSessionCost } from './cost'
import { cancelManualSessionInTx } from './manual'
import { refuseOnceStarted } from './started'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { now as clockNow } from '../../lib/clock'
import { recordPtSessionCancelled } from '../attention/session-updates'
import { emptyPtCancelMail, sendPtCancelMail, type PtCancelMail } from '../notifications/send-booking-email'
import { sendPtRequestExpiredEmails } from '../notifications/send-pt-request-email'

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
 *               Refund decision (be-portal.md §3c): admin → always full refund; client → routed
 *               through evaluateCancellation(kind='pt') so a cancel within the
 *               configured PT window + cap returns the session(s), otherwise the
 *               action is rejected outright (hard deadline, mirroring classes).
 *               A scheduled request with no session (it named none, or its
 *               session is gone) is ended by an Admin alone: the debit comes
 *               back as a pending request's does, nothing else is settled. For
 *               anyone else it stays `pt_session_not_found`.
 *               Staff cancel only before the session starts
 *               (`session_already_started` after), and nothing
 *               returns to a Voided package.
 *               If this session Activated the package and the cancel is not
 *               late, the package returns to Dormant (be/docs/adr/0011).
 *               A manual session (`origin = 'portal'`) is settled seat by
 *               seat instead — staff cancel it whole, each booking refunded to
 *               its own package; a member cancels only their own seat
 *               (./manual.ts:cancelManualSessionInTx).
 *
 * Terminal states are an idempotent no-op, except `attended` for an admin or
 * instructor, who is refused `session_already_started`. Credit movements write a
 * manual_adjustments ledger row for traceability/parity with the class path.
 */
/**
 * Who cancelled: the member, an admin, the session's instructor, or the
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
  /**
   * The expiry cron. It ends a request only if it is still pending under the
   * lock, and the debit comes back as an expiry refund.
   */
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
  // It reaches the member's row, the package a Refund holds the Purchase of and
  // the Updates staff are told with, so it can deadlock with a Refund's unwind
  // (RFD-38) or an Admin's act as a booking cancel can, and Postgres aborts one
  // of the two: it runs again. The emails it owes are gathered by the attempt
  // that returns, so an aborted attempt adds none (PT-161).
  const { result, mail } = await retryingTransaction('PT request cancel', async tx => {
    const mail = emptyPtCancelMail()
    const result = await cancelPtRequestInTx(tx, tenantId, input, mail)
    return { result, mail }
  })
  // Sent only once the request's transaction has committed (`afterCommit`;
  // NTF-09, NTF-10, NTF-11). Sending never throws.
  if (mail.studio.length || mail.memberReturned.length || mail.memberForfeited.length || mail.request.length) {
    afterCommit(() => sendPtCancelMail(tenantId, mail))
  }
  // A pending request that lapsed tells its requester so, its own way.
  if (mail.expired.length) afterCommit(() => sendPtRequestExpiredEmails(tenantId, mail.expired))
  return result
}

async function cancelPtRequestInTx(
  tx: Tx,
  tenantId: string,
  input: CancelPtRequestInput,
  mail: PtCancelMail,
): Promise<CancelPtRequestResult> {
  const { ptRequestId, source, clientId, actorStaffId } = input

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

  const staff = source !== 'client'
  const byPerson = source === 'admin' || source === 'instructor'

  if (byPerson && req.status === 'attended') throw new AppError(422, 'session_already_started')
  const terminal =
    req.status === 'cancelled_before_scheduled' ||
    req.status === 'cancelled_after_scheduled' ||
    req.status === 'attended'
  const scheduledSinceExpirySweep = input.expired && req.status === 'scheduled'
  if (terminal || scheduledSinceExpirySweep) {
    return { status: 'noop', refundedSessions: 0, refundOutcome: 'n_a' }
  }

  // Instructors may only cancel sessions they run, and only once scheduled —
  // triage (pending) is an admin responsibility.
  if (input.requireOwnInstructorId && req.status !== 'scheduled') {
    throw new ForbiddenError('not_your_session')
  }

  const cost = ptSessionCost(req.sessionType)
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
  // re-derives `active` and writes the audit entry). Whether they landed is the
  // ledger's answer, read under the package lock: a Voided package takes
  // nothing back, whatever order the Refund and this cancel ran in. Nothing to
  // return, or no package to return it to, is not a refusal.
  const refundToPackage = async (n: number, reason: string, bookingId: string | null = null): Promise<boolean> => {
    if (n <= 0 || !req.debitedClientPackageId) return true
    const { landed } = await refundCredits(tx, {
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
    return landed
  }

  // ---- pending → cancelled_before_scheduled (always refund) -------------
  if (req.status === 'pending') {
    const landed = await refundToPackage(cost, input.expired ? 'pt_request_expiry_refund' : 'pt_request_cancel_refund')
    const returned = landed ? cost : 0
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
    const sessionsReturned = req.debitedClientPackageId ? returned : 0
    if (source !== 'system') {
      mail.request.push({ clientId: req.clientId, sessionsReturned, ptSessionId: null })
    }
    // Only the expiry job's own end of a pending request: a Remove, which also
    // ends one as the studio's machinery, is not a lapse. What the email says
    // came back is what the package took back, so a Voided one says nothing.
    if (input.expired) mail.expired.push({ ptRequestId, sessionsReturned })
    return {
      status: 'cancelled_before_scheduled',
      refundedSessions: returned,
      refundOutcome: landed ? 'session_returned' : 'n_a',
    }
  }

  // ---- scheduled → cancelled_after_scheduled (cascade) ------------------
  if (req.status !== 'scheduled') throw new ConflictError('cannot_cancel')

  // A scheduled request can have no session: it named none, or the id was
  // cleared when the session it named was found gone (migration 0140, a
  // restore).
  const sessionColumns = {
    id: ptSessions.id,
    startsAt: ptSessions.startsAt,
    lifecycle: ptSessions.lifecycle,
    instructorId: ptSessions.instructorId,
  }
  let [session] = req.scheduledPtSessionId
    ? await tx
        .select(sessionColumns)
        .from(ptSessions)
        .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, req.scheduledPtSessionId)))
        .for('update')
        .limit(1)
    : []
  if (!session && source === 'admin') {
    // A cleared id does not mean no session: one may still name this request.
    // The Admin's cancel then settles that session like any other, and the
    // request names it again, rather than refunding beside a live booking.
    ;[session] = await tx
      .select(sessionColumns)
      .from(ptSessions)
      .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.ptRequestId, ptRequestId)))
      .for('update')
      .limit(1)
    if (session) {
      await tx
        .update(ptRequests)
        .set({ scheduledPtSessionId: session.id })
        .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, ptRequestId)))
    }
  }
  if (!session) {
    // An Admin ends it: the credit it holds goes back as a pending request's
    // does, and there is no session, booking or cancellation to settle. A
    // member's, an Instructor's (it is no session of theirs) and the system's
    // cancel of it stay refused.
    if (source !== 'admin') throw new NotFoundError('pt_session_not_found')
    const landed = await refundToPackage(cost, 'pt_admin_cancel_refund')
    const returned = landed && req.debitedClientPackageId ? cost : 0
    await tx
      .update(ptRequests)
      .set({ status: 'cancelled_after_scheduled', resolvedAt: clockNow(), resolvedByStaffId, cancelSource: source })
      .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, ptRequestId)))
    mail.request.push({ clientId: req.clientId, sessionsReturned: returned, ptSessionId: null })
    return {
      status: 'cancelled_after_scheduled',
      refundedSessions: returned,
      refundOutcome: returned > 0 ? 'session_returned' : 'n_a',
    }
  }

  // Ownership guard for instructor-initiated cancels.
  if (input.requireOwnInstructorId && session.instructorId !== input.requireOwnInstructorId) {
    throw new ForbiddenError('not_your_session')
  }

  const now = clockNow()

  if (byPerson) refuseOnceStarted(session.startsAt, now)

  // A manual session has no debit on its request: each seat was paid on its
  // own booking, so each is settled on its own package (./manual.ts).
  if (req.origin === 'portal') {
    const settled = await cancelManualSessionInTx(tx, tenantId, {
      req,
      session,
      source,
      ...(clientId ? { clientId } : {}),
      actorStaffId: resolvedByStaffId,
      now,
      mail,
    })
    if (source === 'instructor' && settled.status === 'cancelled_after_scheduled') {
      await tellAdminsOfInstructorCancel(tenantId, req.clientId, session, resolvedByStaffId)
    }
    await recordPtSessionCancelled(tenantId, {
      ptSessionId: session.id,
      source,
      actorStaffId: resolvedByStaffId,
      memberClientId: clientId ?? req.clientId,
    })
    return settled
  }

  // Refund decision. Staff (and system) bypass window/cap (always full);
  // client is gated by the PT window + shared cancellation cap.
  let refundSessions = 0
  let wasWithinWindow = true
  let wasWithinCap = true
  // The member's own cancel is judged once, and the verdict is kept: the email
  // that tells them why the session was kept names its cause (below).
  let judged: EvaluateResult | null = null
  if (staff) {
    refundSessions = cost
    // The window never decides a staff cancel's refund, but it is recorded
    // truthfully, and a late one keeps the package Activated (below).
    wasWithinWindow = await staffCancelInTime(tenantId, 'pt', session.startsAt, now)
  } else {
    const evaluation = await lockMemberAndEvaluateCancellation({
      tenantId,
      clientId: req.clientId,
      kind: 'pt',
      sessionStartsAt: session.startsAt,
      now,
    })
    judged = evaluation
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
  let refundOutcome: CancelPtRequestResult['refundOutcome'] = !requesterStillBooked
    ? 'n_a'
    : refundSessions === 0
      ? 'forfeited'
      : 'session_returned'
  if (refundOutcome !== 'session_returned') refundSessions = 0

  const requesterBookingId = sessionBookings.find(b => b.clientId === req.clientId)?.id ?? null
  // A Voided package takes nothing back and keeps nothing: the ledger says so
  // under the package lock, and the cancel is settled `n_a`.
  if (!(await refundToPackage(refundSessions, staff ? 'pt_admin_cancel_refund' : 'pt_cancel_refund', requesterBookingId))) {
    refundSessions = 0
    refundOutcome = 'n_a'
  }
  if (
    refundOutcome === 'forfeited' &&
    req.debitedClientPackageId &&
    !(await keepCredit(tx, {
      tenantId,
      clientId: req.clientId,
      clientPackageId: req.debitedClientPackageId,
      bookingId: requesterBookingId,
      actor: actorOfSource(source),
      actedByStaffId: resolvedByStaffId,
    }))
  ) {
    refundOutcome = 'n_a'
  }

  // The session that Activated the package, cancelled in time, returns it to
  // Dormant (be/docs/adr/0011). Not when the requester's booking was already
  // cancelled on its own: that cancel settled it. A Voided package is left as
  // the Void left it, which the reversal judges under the package lock.
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

  // The session's instructors: told when a member left or an admin cancelled.
  await recordPtSessionCancelled(tenantId, {
    ptSessionId: session.id,
    source,
    actorStaffId: resolvedByStaffId,
    memberClientId: clientId ?? req.clientId,
  })

  // NTF-11: every member the session booked is told — the requester with the
  // sessions returned to them, a 2-on-1 partner, who paid nothing, without.
  // Returned only when there was a package to return them to, as on the
  // pending path: `refundToPackage` moves nothing without one.
  //
  // A member whose own cancel kept the session is told why instead
  // (`pt_cancelled_forfeited`), and not also that it was cancelled: one email.
  // The partner, who kept nothing, is still told of the cancel.
  if (source !== 'system') {
    const returned = req.debitedClientPackageId ? refundSessions : 0
    const forfeitedTo = source === 'client' && refundOutcome === 'forfeited' && judged ? requesterBookingId : null
    if (forfeitedTo && judged) {
      mail.memberForfeited.push({ bookingId: forfeitedTo, reason: judged.reason, windowHours: judged.windowHours })
    }
    for (const bk of sessionBookings) {
      if (bk.id === forfeitedTo) continue
      mail.request.push({
        clientId: bk.clientId,
        sessionsReturned: bk.clientId === req.clientId ? returned : 0,
        ptSessionId: session.id,
      })
    }
  }

  if (source === 'instructor') await tellAdminsOfInstructorCancel(tenantId, req.clientId, session, resolvedByStaffId)

  return { status: 'cancelled_after_scheduled', refundedSessions: refundSessions, refundOutcome }
}

/**
 * The bell's Update for every active admin but the instructor, written in the
 * cancel's own transaction. An admin's cancel tells no one.
 */
async function tellAdminsOfInstructorCancel(
  tenantId: string,
  memberId: string,
  session: { id: string; startsAt: Date },
  instructorStaffId: string | null,
): Promise<void> {
  if (!instructorStaffId) return
  const [member] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, memberId)))
    .limit(1)
  await recordUpdate(
    tenantId,
    'pt_session_cancelled_by_instructor',
    await activeAdminIds(tenantId, instructorStaffId),
    {
      ptSessionId: session.id,
      instructorName: await staffNameFor(tenantId, instructorStaffId, 'An instructor'),
      memberName: member?.name ?? 'a member',
      when: await studioWhen(tenantId, session.startsAt),
    },
    memberId,
  )
}

/**
 * Every 5 min (jobs/index.ts): expire pending PT requests past their advance
 * booking window. Routes each through the same `pending` refund path with
 * source='system' — refund the debit, flip to cancelled_before_scheduled.
 */
export async function expireStaleSessions(): Promise<void> {
  const now = clockNow()
  const stale = await db
    .select({ id: ptRequests.id, tenantId: ptRequests.tenantId })
    .from(ptRequests)
    .where(and(eq(ptRequests.status, 'pending'), lt(ptRequests.expiresAt, now)))

  for (const row of stale) {
    try {
      // No fallback: `tenant_id` is `NOT NULL`, so this is a `string`. A
      // fallback to the first studio would expire one studio's request under
      // another's context.
      await cancelPtRequest(row.tenantId, {
        ptRequestId: row.id,
        source: 'system',
        expired: true,
      })
    } catch (err) {
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
  const ended = and(
    eq(ptRequests.status, 'scheduled'),
    inArray(
      ptRequests.scheduledPtSessionId,
      db
        .select({ id: ptSessions.id })
        .from(ptSessions)
        .where(and(eq(ptSessions.lifecycle, 'active'), lt(ptSessions.endsAt, now))),
    ),
  )
  const locked = await db.select({ id: ptRequests.id }).from(ptRequests).where(ended).for('update')
  if (!locked.length) return
  // A statement that waited on a request's lock re-reads the request but not
  // its session, so a session just moved later would still read as ended.
  await db
    .update(ptRequests)
    .set({ status: 'attended' })
    .where(and(inArray(ptRequests.id, locked.map(r => r.id)), ended))
}
