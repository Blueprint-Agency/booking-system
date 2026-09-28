/**
 * Schedule a pending PT request (admin or instructor — the implicit "approval").
 *
 * Creates the pt_sessions row, the pt_session_clients join (requester + 2on1
 * partner), per-client bookings with QR/codes, flips pt_requests.status to
 * 'scheduled' and stamps scheduled_pt_session_id — all in one transaction.
 *
 * Credit accounting already happened at submit (services/pt-sessions/request.ts);
 * this path does NOT touch package balances — it only records `credits_or_sessions_used`
 * on each booking for audit. Refunds flow exclusively through cancel.ts. It does
 * Activate the debited package if the request left it Dormant (be/docs/adr/0011).
 *
 * If the request used a "new" 2on1 partner (name + email only, not yet a member),
 * the admin must first create the partner's client record and back-fill
 * co_client_id; this service refuses to schedule until that's populated.
 *
 * See docs/md/be-portal.md §3c for the full contract.
 */
import { and, eq, ne } from 'drizzle-orm'
import { db } from '../../db'
import { ptRequests, ptSessionClients, ptSessions } from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { clients } from '../../db/schema/identity'
import { clientPackages } from '../../db/schema/packages'
import { debitCredits, refundCredits, type Tx } from '../packages/ledger'
import { activateOnSchedule } from '../packages/activation'
import { generateBookingCodes } from '../bookings/qr'
import { assertMemberFree, lockMemberTime } from '../bookings/member-time'
import { assertRoomAvailable, assertRoomInLocation } from '../schedule/room-conflicts'
import { assertInstructorsAvailable, plannedInstructorIds } from '../schedule/occupancy'
import {
  ensureInstructors,
  replaceRoster,
  type RosterAssignment,
  type RosterPatch,
} from '../schedule/roster'
import { planPtTypeChange, ptSessionCost } from './cost'
import { retypeManualSessionInTx } from './manual'
import { maySchedulePtRequest } from './binding'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export interface SchedulePtRequestInput {
  ptRequestId: string
  /** Admin-assigned instructor — chosen at scheduling, not requested by client. */
  instructorId: string
  locationId: string
  /** Room the session runs in. Must belong to locationId and be clash-free. */
  roomId: string
  /** Final agreed start/end (timezone-aware). Need not match any proposed slot. */
  startsAt: Date
  endsAt: Date
  /**
   * Gross pay to the instructor for this session, in SGD. null = Unpriced.
   * Nullable for the same reason as `CreateClassInput.instructorPaySgd`: an
   * admin may leave it blank, and an instructor self-scheduling never sees it.
   */
  instructorPaySgd?: number | null
  actorStaffId: string
  /**
   * Whether the actor is scheduling as an admin. Decides the Bound Instructor
   * rule alone (see ./binding.ts) — an admin may place a bound package's
   * session with any instructor, an instructor may only take their own or an
   * unbound one. Required rather than defaulted: a caller who forgets would
   * otherwise be granted or denied the bypass by omission.
   */
  actorIsAdmin: boolean
  /**
   * Shown to the member beside their session: the portal offers it when the
   * time chosen is not one the member proposed, to say why. Optional.
   */
  note?: string | null
  /**
   * Staff were shown that a member on the request holds a booking at an
   * overlapping time (`time_clash`) and scheduled it anyway.
   */
  allowClash?: boolean
}

export type SchedulePtRequestError =
  | 'request_not_found'
  | 'not_pending'
  | 'partner_account_required'
  | 'bad_time_range'
  | 'pt_request_bound_to_other_instructor'
// Room / instructor clashes are NOT in here: they throw
// ConflictError('schedule_conflict') from the occupancy module, the same 409
// every other scheduling path returns. See services/schedule/occupancy.ts.

export type SchedulePtRequestResult =
  | { ok: true; ptSessionId: string }
  | { ok: false; error: SchedulePtRequestError }

/**
 * The Bound Instructor of the package a request was debited from — the one
 * input the may-schedule rule needs from the database. Null when the package
 * is open, and null when there is no package to read, which is the same answer
 * the rule wants: nothing to be bound to.
 */
async function boundInstructorFor(
  tenantId: string,
  clientPackageId: string,
): Promise<string | null> {
  const [pkg] = await db
    .select({ boundInstructorId: clientPackages.boundInstructorId })
    .from(clientPackages)
    .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.id, clientPackageId)))
    .limit(1)
  return pkg?.boundInstructorId ?? null
}

export async function schedulePtRequest(
  tenantId: string,
  input: SchedulePtRequestInput,
): Promise<SchedulePtRequestResult> {
  if (input.endsAt <= input.startsAt) return { ok: false, error: 'bad_time_range' }

  const [req] = await db
    .select()
    .from(ptRequests)
    .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, input.ptRequestId)))
    .limit(1)
  if (!req) return { ok: false, error: 'request_not_found' }
  if (req.status !== 'pending') return { ok: false, error: 'not_pending' }
  // 2on1 needs a real member for the partner before a session can be minted.
  if (req.sessionType === '2on1' && !req.coClientId) {
    return { ok: false, error: 'partner_account_required' }
  }

  // A package sold as sessions with one coach is not one a different
  // instructor may pick up off the queue. The instructor queue already hides
  // these; this is the check a stale screen cannot get past.
  const boundInstructorId = req.debitedClientPackageId
    ? await boundInstructorFor(tenantId, req.debitedClientPackageId)
    : null
  const allowed = maySchedulePtRequest({
    boundInstructorId,
    actorStaffId: input.actorStaffId,
    actorIsAdmin: input.actorIsAdmin,
  })
  if (!allowed.ok) return { ok: false, error: allowed.error }

  // Room must belong to the location (throws AppError on mismatch — surfaces 4xx).
  await assertRoomInLocation(tenantId, input.roomId, input.locationId)

  // Room and instructor clashes both throw ConflictError('schedule_conflict') —
  // one identity, one 409, whichever subject was taken.
  await assertRoomAvailable(tenantId, input.roomId, input.startsAt, input.endsAt)
  await assertInstructorsAvailable(tenantId, [input.instructorId], {
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  })

  const cost = ptSessionCost(req.sessionType)
  const capacityOnline = cost // 1on1 → 1 seat, 2on1 → 2 seats

  const ptSessionId = await db.transaction(async tx => {
    // The checks above read without a lock, so two schedules of one request can
    // both get here. Whichever locks the request first makes the session; the
    // other finds it no longer pending — a 409, not a unique-index 500.
    const [locked] = await tx
      .select({ status: ptRequests.status })
      .from(ptRequests)
      .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, req.id)))
      .for('update')
      .limit(1)
    if (locked?.status !== 'pending') return null

    // One body, one session at a time: neither member may already be booked
    // for an overlapping time, unless staff were warned and went ahead.
    const attendeeIds = [req.clientId, ...(req.coClientId ? [req.coClientId] : [])]
    await lockMemberTime(tx, tenantId, attendeeIds)
    for (const clientId of attendeeIds) {
      await assertMemberFree(
        tx,
        tenantId,
        clientId,
        { startsAt: input.startsAt, endsAt: input.endsAt },
        { allowClash: input.allowClash ?? false },
      )
    }

    // The session row's own instructor_id FK points at instructors.staff_user_id,
    // so the profile row has to exist before there is a session to hang it on.
    await ensureInstructors(tenantId, [input.instructorId], tx)
    const [session] = await tx
      .insert(ptSessions)
      .values({
        tenantId,
        ptRequestId: req.id,
        instructorId: input.instructorId,
        locationId: input.locationId,
        roomId: input.roomId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        sessionType: req.sessionType,
        instructorPaySgd:
          input.instructorPaySgd == null ? null : input.instructorPaySgd.toFixed(2),
        capacityOnline,
        lifecycle: 'active',
        scheduledAt: new Date(),
        scheduledByStaffId: input.actorStaffId,
      })
      .returning({ id: ptSessions.id })
    const sessionId = session!.id

    // Attendee roster: requester (+ partner for 2on1).
    const clientIds = [req.clientId, ...(req.coClientId ? [req.coClientId] : [])]
    await tx
      .insert(ptSessionClients)
      .values(clientIds.map(clientId => ({ tenantId, ptSessionId: sessionId, clientId })))

    // One confirmed booking per attendee. The debit already happened at submit.
    // The requester's booking carries the source package AND the FULL cost (2 for
    // a 2on1) — services/bookings/cancel.ts refunds `credits_or_sessions_used`
    // from `client_package_id`, so recording 1 there made a per-booking cancel
    // return half of what cancel.ts:cancelPtRequest returns. The partner's seat
    // is covered by the requester, hence 0 and no package.
    for (const clientId of clientIds) {
      const { qrToken, code } = generateBookingCodes()
      await tx.insert(bookings).values({
        tenantId,
        clientId,
        kind: 'pt',
        ptSessionId: sessionId,
        clientPackageId: clientId === req.clientId ? req.debitedClientPackageId : null,
        state: 'confirmed',
        creditsOrSessionsUsed: clientId === req.clientId ? cost : 0,
        qrToken,
        code,
      })
    }

    if (req.debitedClientPackageId) {
      await activateOnSchedule(tx, tenantId, req.debitedClientPackageId, sessionId)
    }

    await tx
      .update(ptRequests)
      .set({
        status: 'scheduled',
        scheduledPtSessionId: sessionId,
        // The member's request is approved: their app celebrates it once.
        approvalUnseen: true,
        scheduleNote: input.note?.trim() || null,
        resolvedAt: new Date(),
        resolvedByStaffId: input.actorStaffId,
      })
      .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, req.id)))

    return sessionId
  })
  if (!ptSessionId) return { ok: false, error: 'not_pending' }

  // NOTE(email): pt_session_approved is sent out-of-band, consistent with the
  // class booking path which is inbox/in-app only in v1.

  return { ok: true, ptSessionId }
}

// ============================================================================
// updatePtSession — edit/reschedule a SCHEDULED pt_sessions row. Mirrors
// services/schedule/classes.ts:updateClass (same shape/guards), swapping
// classSupportingInstructors for pt_session_supporting_instructors and the
// class capacity fields for PT's derived capacity_online (session_type → cost).
// ============================================================================

export type PtSessionRow = typeof ptSessions.$inferSelect

/**
 * One supporting instructor as the caller supplies them. Omitting `paySgd`
 * means "leave whatever is recorded alone" — see services/schedule/roster.ts.
 */
export type PtSupportingInstructorPatch = RosterAssignment

export interface UpdatePtSessionInput {
  instructorId?: string
  locationId?: string
  roomId?: string
  startsAt?: Date
  endsAt?: Date
  sessionType?: '1on1' | '2on1'
  /**
   * The partner joining a 1on1 → 2on1 upgrade. Optional only when the request
   * already records a co-client (e.g. re-upgrading after a downgrade); ignored
   * for every other change.
   */
  partnerClientId?: string
  /**
   * A manual session only (#335): the partner's package that pays their seat
   * on an upgrade. Absent, the PT Default payer does.
   */
  partnerClientPackageId?: string
  /** A manual session only: staff said "Add anyway" to the partner's seat warnings. */
  override?: boolean
  /**
   * Staff were shown that someone on the session holds a booking at an
   * overlapping time (`time_clash`) and moved it, or added the partner, anyway.
   */
  allowClash?: boolean
  /** Who is making the change — recorded on a manual session's seat movements. */
  actorStaffId: string
  /** undefined = leave unchanged; null = clear; number = set (SGD). */
  instructorPaySgd?: number | null
  /** When provided, REPLACES the full supporting-instructor roster for this session. */
  supportingInstructors?: PtSupportingInstructorPatch[]
}

/**
 * Switching a scheduled session's type has to move credits, the partner's
 * attendee row, the partner's booking and the request row TOGETHER — the request
 * row because cancel.ts prices its refund off `pt_requests.session_type`.
 *
 * Runs inside the caller's transaction, so a failure anywhere leaves nothing
 * behind. The cost rule and the delta decision come from ./cost.ts; this only
 * writes what the plan says. Refuse-before-apply: every check (balance, partner)
 * runs before the first write.
 */
async function reconcileSessionType(
  tx: Tx,
  tenantId: string,
  args: {
    sessionId: string
    ptRequestId: string
    from: '1on1' | '2on1'
    to: '1on1' | '2on1'
    partnerClientId?: string
  },
): Promise<void> {
  const [req] = await tx
    .select({
      id: ptRequests.id,
      clientId: ptRequests.clientId,
      coClientId: ptRequests.coClientId,
      debitedClientPackageId: ptRequests.debitedClientPackageId,
    })
    .from(ptRequests)
    .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, args.ptRequestId)))
    .for('update')
    .limit(1)
  if (!req) throw new NotFoundError('pt_request_not_found')
  if (!req.debitedClientPackageId) throw new ConflictError('pt_request_not_debited')

  const [pkg] = await tx
    .select({ remaining: clientPackages.creditsOrSessionsRemaining })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.id, req.debitedClientPackageId),
        eq(clientPackages.clientId, req.clientId),
      ),
    )
    .for('update')
    .limit(1)
  if (!pkg) throw new NotFoundError('client_package_not_found')

  const plan = planPtTypeChange(args.from, args.to, pkg.remaining)
  // Same error identity the ledger raises for an overdraw — one failure, one code.
  if (plan.refusal) throw new ConflictError(plan.refusal)

  // Resolve (and validate) the partner before anything is written.
  let partnerId: string | null = null
  if (plan.partner === 'add') {
    partnerId = args.partnerClientId ?? req.coClientId
    if (!partnerId) throw new BadRequestError('partner_required')
    if (partnerId === req.clientId) throw new BadRequestError('partner_cannot_be_requester')
    const [partner] = await tx
      .select({ id: clients.id, status: clients.status, deletedAt: clients.deletedAt })
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), eq(clients.id, partnerId)))
      .limit(1)
    if (!partner) throw new NotFoundError('partner_client_not_found')
    if (partner.status !== 'active' || partner.deletedAt) throw new ConflictError('partner_not_active')
  }

  // --- from here on, writes -------------------------------------------------
  if (plan.delta < 0) {
    await debitCredits(tx, {
      tenantId,
      clientId: req.clientId,
      clientPackageId: req.debitedClientPackageId,
      amount: -plan.delta,
      reason: 'pt_type_change_debit',
    })
  } else if (plan.delta > 0) {
    await refundCredits(tx, {
      tenantId,
      clientId: req.clientId,
      clientPackageId: req.debitedClientPackageId,
      amount: plan.delta,
      reason: 'pt_type_change_refund',
    })
  }

  if (plan.partner === 'add') {
    await tx
      .insert(ptSessionClients)
      .values({ tenantId, ptSessionId: args.sessionId, clientId: partnerId! })
    const { qrToken, code } = generateBookingCodes()
    await tx.insert(bookings).values({
      tenantId,
      clientId: partnerId!,
      kind: 'pt',
      ptSessionId: args.sessionId,
      state: 'confirmed',
      creditsOrSessionsUsed: 0,
      qrToken,
      code,
    })
  } else if (plan.partner === 'remove') {
    // Anyone on the session who isn't the requester loses their seat. The booking
    // is cancelled rather than deleted, matching cancel.ts (a co-client's seat
    // going away is `n_a` — they never held a credit of their own).
    await tx
      .delete(ptSessionClients)
      .where(
        and(
          eq(ptSessionClients.tenantId, tenantId),
          eq(ptSessionClients.ptSessionId, args.sessionId),
          ne(ptSessionClients.clientId, req.clientId),
        ),
      )
    await tx
      .update(bookings)
      .set({ state: 'cancelled', refundOutcome: 'n_a', checkInState: 'n_a', cancelledAt: new Date() })
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.ptSessionId, args.sessionId),
          ne(bookings.clientId, req.clientId),
          eq(bookings.state, 'confirmed'),
        ),
      )
  }

  // The request is what cancel.ts reads to price its refund, and what the portal
  // renders as the co-client — both have to follow the session.
  await tx
    .update(ptRequests)
    .set({
      sessionType: args.to,
      coClientId: partnerId,
      coClientName: null,
      coClientEmail: null,
    })
    .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, req.id)))

  // Keep the recorded figure equal to what the package actually paid, so a
  // per-booking cancel returns the same amount the whole-request cancel does.
  await tx
    .update(bookings)
    .set({ creditsOrSessionsUsed: ptSessionCost(args.to) })
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.ptSessionId, args.sessionId),
        eq(bookings.clientId, req.clientId),
        eq(bookings.state, 'confirmed'),
      ),
    )
}

export async function updatePtSession(
  tenantId: string,
  id: string,
  patch: UpdatePtSessionInput,
): Promise<PtSessionRow> {
  const [existing] = await db
    .select()
    .from(ptSessions)
    .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, id)))
    .limit(1)
  if (!existing) throw new NotFoundError('pt_session_not_found')
  if (existing.lifecycle !== 'active') throw new ConflictError('session_cancelled')

  const newRoomId = patch.roomId ?? existing.roomId
  const newLocationId = patch.locationId ?? existing.locationId
  const newStartsAt = patch.startsAt ?? existing.startsAt
  const newEndsAt = patch.endsAt ?? existing.endsAt

  if (newEndsAt <= newStartsAt) throw new BadRequestError('bad_time_range')

  if (
    patch.roomId !== undefined ||
    patch.locationId !== undefined ||
    patch.startsAt !== undefined ||
    patch.endsAt !== undefined
  ) {
    if (newRoomId) {
      await assertRoomInLocation(tenantId, newRoomId, newLocationId)
      await assertRoomAvailable(tenantId, newRoomId, newStartsAt, newEndsAt, {
        kind: 'pt_session',
        id,
      })
    }
  }

  // Who is on the session, and what they're paid, belongs to the roster module —
  // including instructor_id and instructor_pay_sgd, which live on this row.
  const touchesMain = patch.instructorId !== undefined || patch.instructorPaySgd !== undefined
  const touchesRoster = touchesMain || patch.supportingInstructors !== undefined

  const rosterPatch: RosterPatch = {
    ...(touchesMain
      ? {
          main: {
            ...(patch.instructorId !== undefined ? { instructorId: patch.instructorId } : {}),
            ...(patch.instructorPaySgd !== undefined ? { paySgd: patch.instructorPaySgd } : {}),
          },
        }
      : {}),
    ...(patch.supportingInstructors !== undefined
      ? { supporting: patch.supportingInstructors }
      : {}),
  }

  // A new roster, or the same roster at a new time, can put someone in two
  // places at once. Ask about whoever the session will END UP with.
  if (touchesRoster || patch.startsAt !== undefined || patch.endsAt !== undefined) {
    await assertInstructorsAvailable(
      tenantId,
      await plannedInstructorIds(tenantId, { kind: 'pt_session', id }, rosterPatch),
      { startsAt: newStartsAt, endsAt: newEndsAt },
      { kind: 'pt_session', id },
    )
  }

  return db.transaction(async tx => {
    // A move, or a partner joining, reads everyone's time below. Their locks
    // are all taken here, in one order, before any is taken one by one — the
    // partner's seat takes its own — so two such edits cannot deadlock. The
    // request and the session first, as every PT path takes them (cancelPtRequest,
    // a manual seat), then the members: never a member before its session.
    const movesOrGrows = patch.startsAt !== undefined || patch.endsAt !== undefined || patch.sessionType === '2on1'
    if (movesOrGrows) {
      if (existing.ptRequestId) {
        await tx
          .select({ id: ptRequests.id })
          .from(ptRequests)
          .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, existing.ptRequestId)))
          .for('update')
      }
      await tx
        .select({ id: ptSessions.id })
        .from(ptSessions)
        .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, id)))
        .for('update')
      const seatedNow = await tx
        .select({ clientId: bookings.clientId })
        .from(bookings)
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.ptSessionId, id), eq(bookings.state, 'confirmed')))
      await lockMemberTime(tx, tenantId, [
        ...seatedNow.map(s => s.clientId),
        ...(patch.partnerClientId ? [patch.partnerClientId] : []),
      ])
    }

    // Credits, attendees, bookings and the type flip all commit or roll back
    // together. Re-read under FOR UPDATE so two concurrent retypes can't both
    // see the old type and debit twice.
    if (patch.sessionType !== undefined) {
      // The request before the session, the order cancelPtRequest locks them
      // in, so a type change racing a cancel waits rather than deadlocks.
      const [req] = existing.ptRequestId
        ? await tx
            .select({
              id: ptRequests.id,
              origin: ptRequests.origin,
              status: ptRequests.status,
              clientId: ptRequests.clientId,
              coClientId: ptRequests.coClientId,
            })
            .from(ptRequests)
            .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, existing.ptRequestId)))
            .for('update')
            .limit(1)
        : []
      const [locked] = await tx
        .select({
          sessionType: ptSessions.sessionType,
          ptRequestId: ptSessions.ptRequestId,
          instructorId: ptSessions.instructorId,
          startsAt: ptSessions.startsAt,
          endsAt: ptSessions.endsAt,
          lifecycle: ptSessions.lifecycle,
        })
        .from(ptSessions)
        .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, id)))
        .for('update')
        .limit(1)
      if (!locked) throw new NotFoundError('pt_session_not_found')
      // Asked again under the lock: a cancel that committed since the read
      // above must not be followed by a seat, or a debit, on a dead session.
      if (locked.lifecycle !== 'active') throw new ConflictError('session_cancelled')
      // Setting the type to what it already is is a no-op, not a second debit.
      if (locked.sessionType !== patch.sessionType) {
        // A session whose requester was permanently deleted (#144) has no request
        // left to reconcile credits against.
        if (!locked.ptRequestId || !req) throw new ConflictError('pt_requester_deleted')
        if (req.origin === 'portal') {
          // A manual session is paid seat by seat, so the partner joins or
          // leaves on their own package (./manual.ts). Its seat rule judges
          // the binding against the instructor the session ends up with.
          await retypeManualSessionInTx(tx, tenantId, {
            session: {
              id,
              instructorId: patch.instructorId ?? locked.instructorId,
              startsAt: patch.startsAt ?? locked.startsAt,
              endsAt: patch.endsAt ?? locked.endsAt,
            },
            req,
            to: patch.sessionType,
            ...(patch.partnerClientId !== undefined ? { partnerClientId: patch.partnerClientId } : {}),
            partnerClientPackageId: patch.partnerClientPackageId ?? null,
            actorStaffId: patch.actorStaffId,
            override: patch.override === true,
            allowClash: patch.allowClash === true,
          })
        } else {
          await reconcileSessionType(tx, tenantId, {
            sessionId: id,
            ptRequestId: locked.ptRequestId,
            from: locked.sessionType,
            to: patch.sessionType,
            ...(patch.partnerClientId !== undefined ? { partnerClientId: patch.partnerClientId } : {}),
          })
        }
      }
    }

    // Moved, or joined by a partner: everyone on the session must be free for
    // its time — the same rule as scheduling it, and the same "anyway".
    if (movesOrGrows) {
      const seated = await tx
        .select({ clientId: bookings.clientId })
        .from(bookings)
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.ptSessionId, id), eq(bookings.state, 'confirmed')))
      const attendeeIds = seated.map(s => s.clientId)
      await lockMemberTime(tx, tenantId, attendeeIds)
      for (const clientId of attendeeIds) {
        await assertMemberFree(
          tx,
          tenantId,
          clientId,
          { startsAt: newStartsAt, endsAt: newEndsAt },
          { exclude: { kind: 'pt', id }, allowClash: patch.allowClash === true },
        )
      }
    }

    const set: Partial<typeof ptSessions.$inferInsert> = {}
    if (patch.locationId !== undefined) set.locationId = patch.locationId
    if (patch.roomId !== undefined) set.roomId = patch.roomId
    if (patch.startsAt !== undefined) set.startsAt = patch.startsAt
    if (patch.endsAt !== undefined) set.endsAt = patch.endsAt
    if (patch.sessionType !== undefined) {
      set.sessionType = patch.sessionType
      // PT capacity is derived from session_type (1on1 → 1 seat, 2on1 → 2), same
      // rule schedulePtRequest applies at creation — no independently-settable
      // capacity_online field for PT, unlike classes.
      set.capacityOnline = ptSessionCost(patch.sessionType)
    }

    let row = existing
    if (Object.keys(set).length) {
      const rows = await tx
        .update(ptSessions)
        .set(set)
        .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, id)))
        .returning()
      if (!rows[0]) throw new ConflictError('pt_session_update_failed')
      row = rows[0]
    }

    // A note from scheduling explains the time it was scheduled at. Moved to
    // another start, the note no longer describes the session, so it goes
    // rather than tell the member something that is not so.
    if (
      existing.ptRequestId &&
      patch.startsAt !== undefined &&
      patch.startsAt.getTime() !== existing.startsAt.getTime()
    ) {
      await tx
        .update(ptRequests)
        .set({ scheduleNote: null })
        .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, existing.ptRequestId)))
    }

    if (touchesRoster) {
      await replaceRoster(tx, tenantId, { kind: 'pt_session', id }, rosterPatch)
      // instructor_id / instructor_pay_sgd may have moved under us.
      const [fresh] = await tx
        .select()
        .from(ptSessions)
        .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, id)))
        .limit(1)
      if (fresh) row = fresh
    }
    return row
  })
}
