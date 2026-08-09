/**
 * Schedule a pending PT request (admin or instructor — the implicit "approval").
 *
 * Creates the pt_sessions row, the pt_session_clients join (requester + 2on1
 * partner), per-client bookings with QR/codes, flips pt_requests.status to
 * 'scheduled' and stamps scheduled_pt_session_id — all in one transaction.
 *
 * Credit accounting already happened at submit (services/pt-sessions/request.ts);
 * this path does NOT touch package balances — it only records `credits_or_sessions_used`
 * on each booking for audit. Refunds flow exclusively through cancel.ts.
 *
 * If the request used a "new" 2on1 partner (name + email only, not yet a member),
 * the admin must first create the partner's client record and back-fill
 * co_client_id; this service refuses to schedule until that's populated.
 *
 * See docs/md/be-portal.md §3c for the full contract.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { ptRequests, ptSessionClients, ptSessions } from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { generateBookingCodes } from '../bookings/qr'
import { assertRoomAvailable, assertRoomInLocation } from '../schedule/room-conflicts'
import { assertInstructorsAvailable, plannedInstructorIds } from '../schedule/occupancy'
import {
  ensureInstructors,
  replaceRoster,
  type RosterAssignment,
  type RosterPatch,
} from '../schedule/roster'
import { ptSessionCost } from './cost'
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
  /** Gross pay to the instructor for this session, in SGD. null/undefined = unpriced. */
  instructorPaySgd?: number | null
  actorStaffId: string
}

export type SchedulePtRequestError =
  | 'request_not_found'
  | 'not_pending'
  | 'partner_account_required'
  | 'bad_time_range'
// Room / instructor clashes are NOT in here: they throw
// ConflictError('schedule_conflict') from the occupancy module, the same 409
// every other scheduling path returns. See services/schedule/occupancy.ts.

export type SchedulePtRequestResult =
  | { ok: true; ptSessionId: string }
  | { ok: false; error: SchedulePtRequestError }

export async function schedulePtRequest(input: SchedulePtRequestInput): Promise<SchedulePtRequestResult> {
  if (input.endsAt <= input.startsAt) return { ok: false, error: 'bad_time_range' }

  const [req] = await db
    .select()
    .from(ptRequests)
    .where(eq(ptRequests.id, input.ptRequestId))
    .limit(1)
  if (!req) return { ok: false, error: 'request_not_found' }
  if (req.status !== 'pending') return { ok: false, error: 'not_pending' }
  // 2on1 needs a real member for the partner before a session can be minted.
  if (req.sessionType === '2on1' && !req.coClientId) {
    return { ok: false, error: 'partner_account_required' }
  }

  // Room must belong to the location (throws AppError on mismatch — surfaces 4xx).
  await assertRoomInLocation(input.roomId, input.locationId)

  // Room and instructor clashes both throw ConflictError('schedule_conflict') —
  // one identity, one 409, whichever subject was taken.
  await assertRoomAvailable(input.roomId, input.startsAt, input.endsAt)
  await assertInstructorsAvailable([input.instructorId], {
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  })

  const cost = ptSessionCost(req.sessionType)
  const capacityOnline = cost // 1on1 → 1 seat, 2on1 → 2 seats

  const ptSessionId = await db.transaction(async tx => {
    // The session row's own instructor_id FK points at instructors.staff_user_id,
    // so the profile row has to exist before there is a session to hang it on.
    await ensureInstructors([input.instructorId], tx)
    const [session] = await tx
      .insert(ptSessions)
      .values({
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
    await tx.insert(ptSessionClients).values(clientIds.map(clientId => ({ ptSessionId: sessionId, clientId })))

    // One confirmed booking per attendee. The debit already happened at submit;
    // `credits_or_sessions_used = 1 per client` is recorded for audit only. The
    // requester's booking carries the source package; the partner's seat is covered.
    for (const clientId of clientIds) {
      const { qrToken, code } = generateBookingCodes()
      await tx.insert(bookings).values({
        clientId,
        kind: 'pt',
        ptSessionId: sessionId,
        clientPackageId: clientId === req.clientId ? req.debitedClientPackageId : null,
        state: 'confirmed',
        creditsOrSessionsUsed: 1,
        qrToken,
        code,
      })
    }

    await tx
      .update(ptRequests)
      .set({
        status: 'scheduled',
        scheduledPtSessionId: sessionId,
        resolvedAt: new Date(),
        resolvedByStaffId: input.actorStaffId,
      })
      .where(eq(ptRequests.id, req.id))

    return sessionId
  })

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
  /** undefined = leave unchanged; null = clear; number = set (SGD). */
  instructorPaySgd?: number | null
  /** When provided, REPLACES the full supporting-instructor roster for this session. */
  supportingInstructors?: PtSupportingInstructorPatch[]
}

export async function updatePtSession(id: string, patch: UpdatePtSessionInput): Promise<PtSessionRow> {
  const [existing] = await db.select().from(ptSessions).where(eq(ptSessions.id, id)).limit(1)
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
      await assertRoomInLocation(newRoomId, newLocationId)
      await assertRoomAvailable(newRoomId, newStartsAt, newEndsAt, { kind: 'pt_session', id })
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
      await plannedInstructorIds({ kind: 'pt_session', id }, rosterPatch),
      { startsAt: newStartsAt, endsAt: newEndsAt },
      { kind: 'pt_session', id },
    )
  }

  return db.transaction(async tx => {
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
      const rows = await tx.update(ptSessions).set(set).where(eq(ptSessions.id, id)).returning()
      if (!rows[0]) throw new ConflictError('pt_session_update_failed')
      row = rows[0]
    }

    if (touchesRoster) {
      await replaceRoster(tx, { kind: 'pt_session', id }, rosterPatch)
      // instructor_id / instructor_pay_sgd may have moved under us.
      const [fresh] = await tx.select().from(ptSessions).where(eq(ptSessions.id, id)).limit(1)
      if (fresh) row = fresh
    }
    return row
  })
}
