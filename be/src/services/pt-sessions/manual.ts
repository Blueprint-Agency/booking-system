/**
 * Manual PT sessions (#334): a private session staff put on the calendar with
 * no member request behind it — agreed over the phone or at the front desk.
 *
 * Every session still has a request: the portal writes one itself, marked
 * `origin = 'portal'` with the acting staff member, no proposed slots, no
 * expiry and no debit of its own, and schedules it in the same transaction. So
 * the lists and the attended sweep read it like any other. It has no debit to
 * price a cancel or a type change off, so those read its `origin` and settle
 * seat by seat here instead (below).
 *
 * Payment is per seat, not per request: each attendee pays ONE session from
 * their own package, recorded on their own booking (`client_package_id`,
 * `credits_or_sessions_used = 1`). Whether a package may pay is the pure rule
 * in ./seat.ts; this file loads and locks the rows around it. A warning the
 * rule raises (type mismatch; for an Admin, a package bound to another coach)
 * is a 409 `seat_needs_override` naming the warnings, unless the caller sent
 * `override`. A Dormant package Activates on its seat, from that moment
 * (be/docs/adr/0011).
 *
 * Everything after creation is priced per seat too (#335): cancelling the
 * session refunds each booking to the package it was paid from, a member
 * cancels their own seat under the PT window, staff remove one member, and
 * the 1on1 ↔ 2on1 change seats or refunds the partner on their own package —
 * never touching the other attendee's balance. A seat whose session Activated
 * its package, cancelled in time, returns the package to Dormant.
 */
import { and, asc, eq, notInArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { ptRequests, ptSessionClients, ptSessions } from '../../db/schema/schedule'
import { bookings, cancellations } from '../../db/schema/bookings'
import { inboxItems } from '../../db/schema/inbox'
import { clients, staffUsers } from '../../db/schema/identity'
import { clientPackages, ptPackages } from '../../db/schema/packages'
import { debitCredits, refundCredits, type Tx } from '../packages/ledger'
import { activateOnSchedule, reverseActivationOnCancel, sweepExpired } from '../packages/activation'
import { activationExpiry } from '../packages/validity'
import { evaluateCancellation, staffCancelInTime } from '../policy/evaluate-cancellation'
import type { CancelSource, RefundOutcome as BookingRefundOutcome } from '../bookings/refund-outcome'
import { now as clockNow } from '../../lib/clock'
import { generateBookingCodes } from '../bookings/qr'
import { assertRoomAvailable, assertRoomInLocation } from '../schedule/room-conflicts'
import { assertInstructorsAvailable, findClash } from '../schedule/occupancy'
import { ensureInstructors } from '../schedule/roster'
import { ptSessionCost, type PtSessionType } from './cost'
import {
  mayPayForSeat,
  orderSeatCandidates,
  SEAT_COST,
  type SeatPackage,
  type SeatRefusal,
  type SeatWarning,
} from './seat'
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'

export interface ManualSeatInput {
  clientId: string
  /** Staff's pick of the member's packages. Absent, the Default payer pays. */
  clientPackageId?: string | null
}

interface Actor {
  actorStaffId: string
  /**
   * Decides the binding half of the seat rule: an Admin is warned about a
   * package bound to another coach, an Instructor refused.
   */
  actorIsAdmin: boolean
  /** Staff said "Add anyway": the rule's warnings no longer stop the seat. */
  override: boolean
}

export interface CreateManualPtSessionInput extends Actor {
  sessionType: PtSessionType
  /** Forced to the actor on the instructor route. */
  instructorId: string
  locationId: string
  roomId: string
  startsAt: Date
  endsAt: Date
  /** Null leaves the session Unpriced. */
  instructorPaySgd?: number | null
  /** At least one: a session is not saved with nobody on it. */
  members: ManualSeatInput[]
}

export interface AddManualPtSessionMemberInput extends Actor, ManualSeatInput {
  ptSessionId: string
  /** Instructor route: the session must be one they run. */
  requireOwnInstructorId?: string
}

/** A refusal's HTTP status. Only the binding is a 403: it is who asked, not the package. */
function refuse(refusal: SeatRefusal): never {
  if (refusal === 'bound_to_other_instructor') throw new ForbiddenError(refusal)
  throw new ConflictError(refusal)
}

interface SeatSessionRow {
  id: string
  sessionType: PtSessionType
  instructorId: string
  capacityOnline: number
}

type LoadedPackage = SeatPackage & { id: string; purchasedAt: Date }

const packageColumns = {
  id: clientPackages.id,
  kind: clientPackages.kind,
  sessionType: ptPackages.sessionType,
  creditsOrSessionsRemaining: clientPackages.creditsOrSessionsRemaining,
  expiresAt: clientPackages.expiresAt,
  active: clientPackages.active,
  boundInstructorId: clientPackages.boundInstructorId,
  purchasedAt: clientPackages.purchasedAt,
}

/** The Tenant's member, alive. Another studio's member is simply not found. */
async function assertMember(reader: Tx | typeof db, tenantId: string, clientId: string): Promise<void> {
  const [member] = await reader
    .select({ status: clients.status, deletedAt: clients.deletedAt })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId)))
    .limit(1)
  if (!member || member.deletedAt) throw new NotFoundError('client_not_found')
  if (member.status !== 'active') throw new ConflictError('client_blocked')
}

/**
 * Which package pays for this member's seat: staff's pick, checked by the rule,
 * or else the Default payer — the first package the rule allows in
 * ./seat.ts's order. Nothing allowed refuses with the reason of the package
 * the member would have expected to pay. Every row read is locked.
 */
async function choosePackage(
  tx: Tx,
  tenantId: string,
  session: SeatSessionRow,
  member: ManualSeatInput,
  actor: Actor,
  now: Date,
): Promise<{ pkg: LoadedPackage; warnings: SeatWarning[] }> {
  const judge = (pkg: LoadedPackage) =>
    mayPayForSeat({
      pkg,
      session: { sessionType: session.sessionType, instructorId: session.instructorId },
      actorIsAdmin: actor.actorIsAdmin,
      now,
    })

  if (member.clientPackageId) {
    const [pkg] = await tx
      .select(packageColumns)
      .from(clientPackages)
      .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
      .where(
        and(
          eq(clientPackages.tenantId, tenantId),
          eq(clientPackages.id, member.clientPackageId),
          eq(clientPackages.clientId, member.clientId),
        ),
      )
      // Postgres refuses FOR UPDATE on the nullable side of an outer join.
      .for('update', { of: clientPackages })
      .limit(1)
    if (!pkg) throw new NotFoundError('client_package_not_found')
    const verdict = judge(pkg)
    if (!verdict.ok) refuse(verdict.refusal)
    return { pkg, warnings: verdict.warnings }
  }

  const held = await tx
    .select(packageColumns)
    .from(clientPackages)
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.clientId, member.clientId),
        eq(clientPackages.kind, 'pt'),
      ),
    )
    .for('update', { of: clientPackages })
  const ordered = orderSeatCandidates(
    held.map(pkg => ({ pkg, purchasedAt: pkg.purchasedAt, verdict: judge(pkg) })),
    session,
  )
  const payer = ordered.find(c => c.verdict.ok)
  if (payer?.verdict.ok) return { pkg: payer.pkg, warnings: payer.verdict.warnings }
  const first = ordered[0]
  refuse(first && !first.verdict.ok ? first.verdict.refusal : 'not_a_pt_package')
}

/**
 * Put one member on a manual session: roster room, not already on it, a
 * package that may pay (and staff's say-so for any warning), one session
 * debited, an attendee row and a confirmed booking carrying the package, and
 * a Dormant package Activated. The caller holds the session row locked.
 */
async function seatMember(
  tx: Tx,
  tenantId: string,
  session: SeatSessionRow,
  member: ManualSeatInput,
  actor: Actor,
): Promise<{ bookingId: string; clientPackageId: string }> {
  await assertMember(tx, tenantId, member.clientId)

  const seated = await tx
    .select({ clientId: bookings.clientId })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.ptSessionId, session.id),
        eq(bookings.state, 'confirmed'),
      ),
    )
  if (seated.some(b => b.clientId === member.clientId)) throw new ConflictError('already_booked')
  if (seated.length >= session.capacityOnline) throw new ConflictError('session_full')

  // A single-booking cancel frees the seat but leaves its attendee row, so
  // the attendees are brought back to who is booked before this one joins —
  // or the same member coming back would collide with their old row.
  const seatedIds = seated.map(b => b.clientId)
  await tx
    .delete(ptSessionClients)
    .where(
      and(
        eq(ptSessionClients.tenantId, tenantId),
        eq(ptSessionClients.ptSessionId, session.id),
        ...(seatedIds.length ? [notInArray(ptSessionClients.clientId, seatedIds)] : []),
      ),
    )

  const now = clockNow()
  // An ended package reads as ended now, not only once the nightly sweep runs.
  await sweepExpired(tx, tenantId, member.clientId, now)
  const { pkg, warnings } = await choosePackage(tx, tenantId, session, member, actor, now)
  if (warnings.length && !actor.override) {
    throw new ConflictError('seat_needs_override', {
      warnings,
      client_id: member.clientId,
      client_package_id: pkg.id,
    })
  }

  await debitCredits(tx, {
    tenantId,
    clientId: member.clientId,
    clientPackageId: pkg.id,
    amount: SEAT_COST,
    reason: 'pt_manual_seat',
    actedByStaffId: actor.actorStaffId,
  })

  await tx.insert(ptSessionClients).values({ tenantId, ptSessionId: session.id, clientId: member.clientId })
  const { qrToken, code } = generateBookingCodes()
  const [booking] = await tx
    .insert(bookings)
    .values({
      tenantId,
      clientId: member.clientId,
      kind: 'pt',
      ptSessionId: session.id,
      clientPackageId: pkg.id,
      state: 'confirmed',
      creditsOrSessionsUsed: SEAT_COST,
      qrToken,
      code,
    })
    .returning({ id: bookings.id })

  await activateOnSchedule(tx, tenantId, pkg.id, session.id)
  return { bookingId: booking!.id, clientPackageId: pkg.id }
}

/**
 * Two staff saving the same slot at once must not both get it: the clash
 * checks read before any write, so each create takes a transaction-scoped
 * lock on its room and its instructor — in one order, so two creates cannot
 * deadlock — and asks again once it holds them.
 */
async function holdSlot(
  tx: Tx,
  tenantId: string,
  subjects: { kind: 'room' | 'instructor'; id: string }[],
  window: { startsAt: Date; endsAt: Date },
): Promise<void> {
  const keys = subjects.map(s => `pt-slot:${tenantId}:${s.kind}:${s.id}`).sort()
  for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
  for (const subject of subjects) {
    const clash = await findClash(tenantId, subject, window, undefined, tx)
    if (clash) throw new ConflictError('schedule_conflict', { ...clash })
  }
}

export async function createManualPtSession(
  tenantId: string,
  input: CreateManualPtSessionInput,
): Promise<{ ptSessionId: string; ptRequestId: string }> {
  if (input.endsAt <= input.startsAt) throw new BadRequestError('bad_time_range')
  const capacity = ptSessionCost(input.sessionType) // 1on1 → 1 seat, 2on1 → 2
  if (input.members.length === 0) throw new BadRequestError('invalid_request')
  const ids = input.members.map(m => m.clientId)
  if (new Set(ids).size !== ids.length) throw new ConflictError('already_booked')
  if (ids.length > capacity) throw new ConflictError('session_full')

  // The same gates as scheduling a request: room in its Location, room free,
  // instructor free — the one `schedule_conflict` 409 for either clash.
  await assertRoomInLocation(tenantId, input.roomId, input.locationId)
  const window = { startsAt: input.startsAt, endsAt: input.endsAt }
  await assertRoomAvailable(tenantId, input.roomId, input.startsAt, input.endsAt)
  await assertInstructorsAvailable(tenantId, [input.instructorId], window)

  return db.transaction(async tx => {
    await holdSlot(
      tx,
      tenantId,
      [
        { kind: 'room', id: input.roomId },
        { kind: 'instructor', id: input.instructorId },
      ],
      window,
    )
    await ensureInstructors(tenantId, [input.instructorId], tx)

    const at = clockNow()
    // The request the session hangs off: the first member as its client, the
    // second as the co-client, already scheduled. It debits nothing — each
    // seat is paid on its own booking below.
    const [req] = await tx
      .insert(ptRequests)
      .values({
        tenantId,
        clientId: input.members[0]!.clientId,
        locationId: input.locationId,
        sessionType: input.sessionType,
        coClientId: input.members[1]?.clientId ?? null,
        status: 'scheduled',
        origin: 'portal',
        createdByStaffId: input.actorStaffId,
        expiresAt: null,
        resolvedAt: at,
        resolvedByStaffId: input.actorStaffId,
      })
      .returning({ id: ptRequests.id })

    const [session] = await tx
      .insert(ptSessions)
      .values({
        tenantId,
        ptRequestId: req!.id,
        instructorId: input.instructorId,
        locationId: input.locationId,
        roomId: input.roomId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        sessionType: input.sessionType,
        instructorPaySgd: input.instructorPaySgd == null ? null : input.instructorPaySgd.toFixed(2),
        capacityOnline: capacity,
        lifecycle: 'active',
        scheduledAt: at,
        scheduledByStaffId: input.actorStaffId,
      })
      .returning({ id: ptSessions.id })

    await tx
      .update(ptRequests)
      .set({ scheduledPtSessionId: session!.id })
      .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, req!.id)))

    const seatSession: SeatSessionRow = {
      id: session!.id,
      sessionType: input.sessionType,
      instructorId: input.instructorId,
      capacityOnline: capacity,
    }
    for (const member of input.members) {
      await seatMember(tx, tenantId, seatSession, member, input)
    }
    return { ptSessionId: session!.id, ptRequestId: req!.id }
  })
}

export async function addManualPtSessionMember(
  tenantId: string,
  input: AddManualPtSessionMemberInput,
): Promise<{ bookingId: string; clientPackageId: string }> {
  return db.transaction(async tx => {
    // Locked, as class booking locks the class: two adds for the last seat
    // are decided one after the other.
    const { session, req } = await lockManualSession(tx, tenantId, input.ptSessionId, input.requireOwnInstructorId)
    const seat = await seatMember(tx, tenantId, session, input, input)
    await followRoster(tx, tenantId, session.id, req)
    return seat
  })
}

/**
 * A manual session and the request behind it, both locked — the request
 * first, the order cancelPtRequest takes them in, so a change and a cancel
 * of one session wait on each other rather than deadlock. Refused as the
 * session's own checks come: not found, not the instructor's, cancelled,
 * then a member's request (`not_a_manual_session`).
 */
async function lockManualSession(tx: Tx, tenantId: string, ptSessionId: string, requireOwnInstructorId?: string) {
  const sessionWhere = and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, ptSessionId))
  const [peek] = await tx.select({ ptRequestId: ptSessions.ptRequestId }).from(ptSessions).where(sessionWhere).limit(1)
  if (!peek) throw new NotFoundError('pt_session_not_found')
  const [req] = peek.ptRequestId
    ? await tx
        .select({
          id: ptRequests.id,
          origin: ptRequests.origin,
          status: ptRequests.status,
          clientId: ptRequests.clientId,
          coClientId: ptRequests.coClientId,
        })
        .from(ptRequests)
        .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, peek.ptRequestId)))
        .for('update')
        .limit(1)
    : []
  const [session] = await tx
    .select({
      id: ptSessions.id,
      sessionType: ptSessions.sessionType,
      instructorId: ptSessions.instructorId,
      capacityOnline: ptSessions.capacityOnline,
      lifecycle: ptSessions.lifecycle,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
    })
    .from(ptSessions)
    .where(sessionWhere)
    .for('update')
    .limit(1)
  if (!session) throw new NotFoundError('pt_session_not_found')
  if (requireOwnInstructorId && session.instructorId !== requireOwnInstructorId) {
    throw new ForbiddenError('not_your_session')
  }
  if (session.lifecycle !== 'active') throw new ConflictError('session_cancelled')
  // A member's request is paid by its requester for the whole session, so a
  // seat settled on its own has no place on it.
  if (req?.origin !== 'portal') throw new ConflictError('not_a_manual_session')
  return { session, req }
}

/**
 * A seat is only given back while the session is still to come: once it has
 * ended (the attended sweep may not have run yet) its sessions were used, and
 * a seat someone was checked in on is their attendance, not a refund.
 */
function assertSeatsStillOpen(
  session: { endsAt: Date },
  req: { status: string },
  seats: { checkInState: string }[],
  now: Date,
): void {
  if (req.status !== 'scheduled' || session.endsAt <= now) throw new ConflictError('session_ended')
  if (seats.some(s => s.checkInState === 'attended')) throw new ConflictError('booking_attended')
}

/** What cancelling a seat did with the one session it paid. */
type RefundOutcome = Extract<BookingRefundOutcome, 'session_returned' | 'forfeited' | 'n_a'>

/** Confirmed seats on a session, first booked first, each locked. */
function seatsOn(tx: Tx, tenantId: string, ptSessionId: string) {
  return tx
    .select({
      id: bookings.id,
      clientId: bookings.clientId,
      clientPackageId: bookings.clientPackageId,
      used: bookings.creditsOrSessionsUsed,
      checkInState: bookings.checkInState,
    })
    .from(bookings)
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.ptSessionId, ptSessionId), eq(bookings.state, 'confirmed')))
    .orderBy(asc(bookings.bookedAt), asc(bookings.id))
    .for('update')
}

type Seat = Awaited<ReturnType<typeof seatsOn>>[number]

/**
 * The request and the attendee rows mirror who is booked, as a request
 * session's do: the request's client stays while they are booked, and the
 * co-client is whoever else is. With nobody booked the request keeps its
 * client — it is a NOT NULL column, and the seat can be filled again.
 */
async function followRoster(
  tx: Tx,
  tenantId: string,
  ptSessionId: string,
  req: { id: string; clientId: string; coClientId: string | null },
): Promise<void> {
  const ids = (await seatsOn(tx, tenantId, ptSessionId)).map(b => b.clientId)
  await tx
    .delete(ptSessionClients)
    .where(
      and(
        eq(ptSessionClients.tenantId, tenantId),
        eq(ptSessionClients.ptSessionId, ptSessionId),
        ...(ids.length ? [notInArray(ptSessionClients.clientId, ids)] : []),
      ),
    )
  if (!ids.length) return
  const clientId = ids.includes(req.clientId) ? req.clientId : ids[0]!
  const coClientId = ids.find(id => id !== clientId) ?? null
  if (clientId !== req.clientId || coClientId !== req.coClientId) {
    await tx
      .update(ptRequests)
      .set({ clientId, coClientId })
      .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, req.id)))
  }
}

/**
 * Cancel one seat and settle it on its own package: the one session it paid
 * comes back when `refund` says so, the package returns to Dormant if this
 * session Activated it and the cancel came in time (be/docs/adr/0011), and
 * the booking and a cancellations row record it. Whatever else is on the
 * session is not touched.
 */
async function cancelSeat(
  tx: Tx,
  tenantId: string,
  input: {
    seat: Seat
    ptSessionId: string
    source: CancelSource
    refund: boolean
    reason: string
    wasWithinWindow: boolean
    wasWithinCap: boolean
    actorStaffId: string | null
    now: Date
  },
): Promise<{ refundOutcome: RefundOutcome; refunded: number }> {
  const { seat } = input
  const used = seat.used ?? 0
  const refunded = input.refund && seat.clientPackageId && used > 0 ? used : 0
  if (refunded) {
    await refundCredits(tx, {
      tenantId,
      clientId: seat.clientId,
      clientPackageId: seat.clientPackageId!,
      amount: refunded,
      reason: input.reason,
      actedByStaffId: input.actorStaffId,
    })
  }
  if (seat.clientPackageId) {
    await reverseActivationOnCancel(tx, {
      tenantId,
      clientId: seat.clientId,
      clientPackageId: seat.clientPackageId,
      ptSessionId: input.ptSessionId,
      late: !input.wasWithinWindow,
      actedByStaffId: input.actorStaffId,
    })
  }
  const refundOutcome: RefundOutcome = refunded ? 'session_returned' : used > 0 && !input.refund ? 'forfeited' : 'n_a'
  await tx
    .update(bookings)
    .set({ state: 'cancelled', refundOutcome, checkInState: 'n_a', cancelledAt: input.now })
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, seat.id)))
  await tx.insert(cancellations).values({
    tenantId,
    bookingId: seat.id,
    clientId: seat.clientId,
    kind: 'pt',
    source: input.source,
    wasWithinWindow: input.wasWithinWindow,
    wasWithinCap: input.wasWithinCap,
    refundFired: refunded > 0,
    cancelledAt: input.now,
  })
  return { refundOutcome, refunded }
}

/** A request row as the cancel reads it. */
export interface ManualCancelRequest {
  id: string
  clientId: string
  coClientId: string | null
}

export interface ManualCancelResult {
  status: 'cancelled_after_scheduled' | 'seat_cancelled'
  refundedSessions: number
  refundOutcome: RefundOutcome
}

/**
 * Cancel a scheduled manual session, inside cancel.ts's transaction with the
 * request and session rows already locked.
 *
 *   staff  → the whole session: every seat still booked gets its session back
 *            on its own package, whatever the window (a staff cancel bypasses
 *            it, as on a request session), each recorded as a staff cancel.
 *   member → their own seat only, under the PT window: inside it the cancel
 *            is refused, outside it the shared cap decides the refund, as a
 *            request session's. The session goes on for whoever is left, and
 *            is cancelled with the last one.
 */
export async function cancelManualSessionInTx(
  tx: Tx,
  tenantId: string,
  input: {
    req: ManualCancelRequest
    session: { id: string; startsAt: Date }
    source: 'client' | 'admin'
    clientId?: string
    actorStaffId: string | null
    now: Date
  },
): Promise<ManualCancelResult> {
  const { req, session, now } = input
  const seats = await seatsOn(tx, tenantId, session.id)

  const endSession = async () => {
    await tx
      .update(ptSessions)
      .set({ lifecycle: 'cancelled', cancelledAt: now, cancelledByStaffId: input.actorStaffId })
      .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, session.id)))
    await tx
      .update(ptRequests)
      .set({ status: 'cancelled_after_scheduled', resolvedAt: now, resolvedByStaffId: input.actorStaffId })
      .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, req.id)))
  }

  if (input.source === 'client') {
    const mine = seats.find(s => s.clientId === input.clientId)
    if (!mine) throw new ForbiddenError('not_your_request')
    const evaluation = await evaluateCancellation({
      tenantId,
      clientId: mine.clientId,
      kind: 'pt',
      sessionStartsAt: session.startsAt,
      now,
    })
    if (!evaluation.wasWithinWindow) {
      throw new AppError(422, 'cancellation_window_passed', { window_hours: evaluation.windowHours })
    }
    const { refundOutcome, refunded } = await cancelSeat(tx, tenantId, {
      seat: mine,
      ptSessionId: session.id,
      source: 'client',
      refund: evaluation.refund === 'full',
      reason: 'pt_cancel_refund',
      wasWithinWindow: true,
      wasWithinCap: evaluation.wasWithinCap,
      actorStaffId: null,
      now,
    })
    const last = seats.length === 1
    if (last) await endSession()
    else await followRoster(tx, tenantId, session.id, req)
    await tx.insert(inboxItems).values({
      tenantId,
      type: 'client_cancellation',
      payload: {
        ptRequestId: req.id,
        ptSessionId: session.id,
        bookingId: mine.id,
        clientId: mine.clientId,
        kind: 'pt',
        refundOutcome,
        refundedSessions: refunded,
        at: now.toISOString(),
      },
    })
    return { status: last ? 'cancelled_after_scheduled' : 'seat_cancelled', refundedSessions: refunded, refundOutcome }
  }

  // The window never decides a staff cancel's refund, but it is recorded
  // truthfully, and a late one keeps each package Activated.
  const wasWithinWindow = await staffCancelInTime(tenantId, 'pt', session.startsAt, null, now)
  let refundedSessions = 0
  for (const seat of seats) {
    const { refunded } = await cancelSeat(tx, tenantId, {
      seat,
      ptSessionId: session.id,
      source: 'admin',
      refund: true,
      reason: 'pt_admin_cancel_refund',
      wasWithinWindow,
      wasWithinCap: true,
      actorStaffId: input.actorStaffId,
      now,
    })
    refundedSessions += refunded
  }
  await endSession()
  const refundOutcome: RefundOutcome = refundedSessions > 0 ? 'session_returned' : 'n_a'
  await tx.insert(inboxItems).values({
    tenantId,
    type: 'admin_cancel_class_pt',
    payload: {
      ptRequestId: req.id,
      ptSessionId: session.id,
      clientId: req.clientId,
      kind: 'pt',
      refundOutcome,
      refundedSessions,
      ...(input.actorStaffId ? { actorStaffId: input.actorStaffId } : {}),
      at: now.toISOString(),
    },
  })
  return { status: 'cancelled_after_scheduled', refundedSessions, refundOutcome }
}

export interface RemoveManualPtSessionMemberInput {
  ptSessionId: string
  clientId: string
  actorStaffId: string
  source: 'admin' | 'instructor'
  /** Instructor route: the session must be one they run. */
  requireOwnInstructorId?: string
}

/**
 * Staff take one member off a manual session (#335): their seat is cancelled
 * and its session returned to their own package, whatever the window; the
 * others stay seated and the session stays on, its seat free to fill again.
 */
export async function removeManualPtSessionMember(
  tenantId: string,
  input: RemoveManualPtSessionMemberInput,
): Promise<{ refundOutcome: RefundOutcome; refundedSessions: number }> {
  return db.transaction(async tx => {
    const { session, req } = await lockManualSession(tx, tenantId, input.ptSessionId, input.requireOwnInstructorId)
    const seat = (await seatsOn(tx, tenantId, session.id)).find(s => s.clientId === input.clientId)
    if (!seat) throw new NotFoundError('booking_not_found')

    const now = clockNow()
    assertSeatsStillOpen(session, req, [seat], now)
    const { refundOutcome, refunded } = await cancelSeat(tx, tenantId, {
      seat,
      ptSessionId: session.id,
      source: input.source,
      refund: true,
      reason: 'pt_manual_seat_removed_refund',
      wasWithinWindow: await staffCancelInTime(tenantId, 'pt', session.startsAt, null, now),
      wasWithinCap: true,
      actorStaffId: input.actorStaffId,
      now,
    })
    await followRoster(tx, tenantId, session.id, req)
    await tx.insert(inboxItems).values({
      tenantId,
      type: 'admin_cancel_class_pt',
      payload: {
        ptRequestId: req.id,
        ptSessionId: session.id,
        bookingId: seat.id,
        clientId: seat.clientId,
        kind: 'pt',
        refundOutcome,
        refundedSessions: refunded,
        source: input.source,
        actorStaffId: input.actorStaffId,
        at: now.toISOString(),
      },
    })
    return { refundOutcome, refundedSessions: refunded }
  })
}

/**
 * Switch a manual session between 1on1 and 2on1, inside updatePtSession's
 * transaction with the request and session rows locked, in that order, and
 * the session found still active (#335). Per seat, never through the
 * requester: an upgrade seats the partner on their own package exactly as
 * adding a member does (the seat rule, a named package or the Default payer,
 * warnings needing `override`, a Dormant package Activated); a downgrade
 * cancels whoever is not the request's client and returns their session to
 * their own package. The other attendee's balance never moves. The caller
 * writes the session's own type and capacity.
 */
export async function retypeManualSessionInTx(
  tx: Tx,
  tenantId: string,
  input: {
    session: { id: string; instructorId: string; startsAt: Date; endsAt: Date }
    req: { id: string; status: string; clientId: string; coClientId: string | null }
    to: PtSessionType
    partnerClientId?: string
    partnerClientPackageId?: string | null
    actorStaffId: string
    override: boolean
  },
): Promise<void> {
  const { session, req } = input
  const seats = await seatsOn(tx, tenantId, session.id)
  // A downgrade keeps the request's client, or else whoever booked first.
  const keep = seats.find(s => s.clientId === req.clientId) ?? seats[0]
  const leaving = input.to === '1on1' ? seats.filter(s => s !== keep) : []
  // Neither way once the session is over: its seats were used.
  assertSeatsStillOpen(session, req, leaving, clockNow())

  if (input.to === '2on1') {
    if (!input.partnerClientId) throw new BadRequestError('partner_required')
    await seatMember(
      tx,
      tenantId,
      { id: session.id, sessionType: '2on1', instructorId: session.instructorId, capacityOnline: ptSessionCost('2on1') },
      { clientId: input.partnerClientId, clientPackageId: input.partnerClientPackageId ?? null },
      // The type change is an Admin's alone.
      { actorStaffId: input.actorStaffId, actorIsAdmin: true, override: input.override },
    )
  } else {
    const now = clockNow()
    const wasWithinWindow = await staffCancelInTime(tenantId, 'pt', session.startsAt, null, now)
    for (const seat of leaving) {
      await cancelSeat(tx, tenantId, {
        seat,
        ptSessionId: session.id,
        source: 'admin',
        refund: true,
        reason: 'pt_type_change_refund',
        wasWithinWindow,
        wasWithinCap: true,
        actorStaffId: input.actorStaffId,
        now,
      })
    }
  }

  await tx
    .update(ptRequests)
    .set({ sessionType: input.to, coClientName: null, coClientEmail: null })
    .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, req.id)))
  await followRoster(tx, tenantId, session.id, req)
}

// ----------------------------------------------------------------------------
// The package list staff choose from
// ----------------------------------------------------------------------------

export interface SeatCandidate {
  id: string
  name: string | null
  sessionType: PtSessionType | null
  sessionsLeft: number | null
  expiresAt: Date | null
  boundInstructor: { id: string; name: string } | null
  /** Can pay, with or without warnings. */
  eligible: boolean
  refusal: SeatRefusal | null
  warnings: SeatWarning[]
  /** Dormant only: the end date a seat would stamp on it now. */
  activateUntil: Date | null
}

/**
 * Every PT package the member holds, read against a session of this type with
 * this instructor, in the Default payer's order: each with whether it can pay,
 * why not, or what staff would be warned of — and for a Dormant one, the end
 * date adding the member would start. Takes the session's shape rather than
 * its id so the form can ask before the session exists.
 */
export async function listSeatCandidates(
  tenantId: string,
  input: { clientId: string; sessionType: PtSessionType; instructorId: string; actorIsAdmin: boolean },
): Promise<{ defaultClientPackageId: string | null; packages: SeatCandidate[] }> {
  // Refused as adding them would be, so the form never offers a seat the add
  // turns down: another studio's member or a deleted one is not found, a
  // blocked one is `client_blocked`.
  await assertMember(db, tenantId, input.clientId)

  const rows = await db
    .select({
      ...packageColumns,
      name: ptPackages.name,
      durationMonths: clientPackages.durationMonths,
      validityDays: clientPackages.validityDays,
      boundInstructorName: staffUsers.name,
    })
    .from(clientPackages)
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
    .leftJoin(staffUsers, eq(staffUsers.id, clientPackages.boundInstructorId))
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.clientId, input.clientId),
        eq(clientPackages.kind, 'pt'),
      ),
    )
    .orderBy(asc(clientPackages.purchasedAt))

  const now = clockNow()
  const session = { sessionType: input.sessionType, instructorId: input.instructorId }
  const ordered = orderSeatCandidates(
    rows.map(pkg => ({
      pkg,
      purchasedAt: pkg.purchasedAt,
      verdict: mayPayForSeat({ pkg, session, actorIsAdmin: input.actorIsAdmin, now }),
    })),
    session,
  )
  const packages = ordered.map(({ pkg, verdict }) => ({
    id: pkg.id,
    name: pkg.name,
    sessionType: pkg.sessionType,
    sessionsLeft: pkg.creditsOrSessionsRemaining,
    expiresAt: pkg.expiresAt,
    boundInstructor: pkg.boundInstructorId
      ? { id: pkg.boundInstructorId, name: pkg.boundInstructorName || 'Instructor' }
      : null,
    eligible: verdict.ok,
    refusal: verdict.ok ? null : verdict.refusal,
    warnings: verdict.ok ? verdict.warnings : [],
    activateUntil: verdict.ok && pkg.expiresAt === null ? activationExpiry(pkg, now) : null,
  }))
  return {
    defaultClientPackageId: packages.find(p => p.eligible)?.id ?? null,
    packages,
  }
}
