import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../db'
import { clients, staffUsers } from '../../db/schema/identity'
import { classTypes, locations, rooms } from '../../db/schema/catalog'
import { ptRequests, ptRequestSlots, ptSessions } from '../../db/schema/schedule'
import { bookings, cancellations } from '../../db/schema/bookings'
import { clientPackages } from '../../db/schema/packages'
import type { PtRequestOrigin } from '../../db/enums'
import { summarizeCancellation, type CancelledBy } from '../bookings/cancellation-summary'

export interface ClientPtRequestView {
  id: string
  /** Preferred class type; both null when the member asked for "any". */
  classTypeId: string | null
  className: string | null
  locationId: string
  locationName: string
  sessionType: '1on1' | '2on1'
  status: string
  /** Is this client the requester (who owns the credit) or the 2on1 partner (read-only)? */
  role: 'requester' | 'partner'
  /** The requester's name. Used by partner cards ("hosted by …"). */
  requesterName: string | null
  message: string | null
  /** Staff's word on a time the member did not propose. Both attendees see it. */
  scheduleNote: string | null
  /** Staff's reason for cancelling. Both attendees see it. */
  cancelNote: string | null
  coClientName: string | null
  createdAt: Date
  /** Null on a manual session's request, which never waits pending. */
  expiresAt: Date | null
  /** `endTime` is null on requests made since members propose start times only. */
  slots: { proposedDate: string; startTime: string; endTime: string | null }[]
  /** Populated once the request is scheduled — the final session details. */
  session: {
    startsAt: Date
    endsAt: Date
    instructorName: string | null
    roomName: string | null
  } | null
  /** This member's own booking on the scheduled session (for QR check-in). */
  booking: { qrToken: string; code: string; checkInState: string; refundOutcome: string } | null
  /** Cancellation outcome when the request is terminal; null while active/pending. */
  refundOutcome: string | null
  /** How it ended, on a cancelled or expired request or a seat the member left; null while live (#351). */
  cancellation: PtCancellation | null
}

/**
 * Who ended a PT request or seat, as the member reading it sees it: themselves
 * (`member`), the studio, or — to a 2on1 partner — the host who cancelled their
 * own request. Null when it expired unscheduled: nobody cancelled it.
 */
export type PtCancelledBy = CancelledBy | 'host'

export interface PtCancellation {
  cancelledAt: Date | null
  cancelledBy: PtCancelledBy | null
  expired: boolean
}

/** A `cancellations` row on a booking of the session, as the summary reads it. */
interface SessionRecord {
  bookingId: string
  clientId: string
  source: string
  wasWithinWindow: boolean
  wasWithinCap: boolean
  cancelledAt: Date
}

/**
 * How a cancelled request (or seat) ended, from what its cancel recorded and
 * nothing else (#351), read through the class's `summarizeCancellation`:
 *
 *   - Unscheduled: the request's own fields. A staff cancel records its staff
 *     member; an expiry is the system's, made once `expires_at` had passed;
 *     anything else the requester withdrew.
 *   - Scheduled: the `cancellations` row on the member's own booking (a
 *     manual seat's, or the requester's), else the requester's row (what a
 *     2on1 partner reads — the host's own cancel is the host's), else the
 *     request's resolver.
 */
function ptCancellation(
  r: { requesterClientId: string; status: string; resolvedAt: Date | null; resolvedByStaffId: string | null; expiresAt: Date | null },
  clientId: string,
  mine: { id: string; cancelledAt: Date | null; refundOutcome: string } | null,
  records: SessionRecord[],
): PtCancellation {
  const theirs = (who: string): PtCancelledBy => (who === clientId ? 'member' : 'host')
  if (r.status === 'cancelled_before_scheduled') {
    const expired = !r.resolvedByStaffId && !!r.expiresAt && !!r.resolvedAt && r.resolvedAt >= r.expiresAt
    return {
      cancelledAt: r.resolvedAt,
      cancelledBy: expired ? null : r.resolvedByStaffId ? 'studio' : theirs(r.requesterClientId),
      expired,
    }
  }
  const record =
    records.find(c => c.bookingId === mine?.id) ?? records.find(c => c.clientId === r.requesterClientId) ?? null
  if (!record) {
    return {
      cancelledAt: mine?.cancelledAt ?? r.resolvedAt,
      cancelledBy: r.resolvedByStaffId ? 'studio' : theirs(r.requesterClientId),
      expired: false,
    }
  }
  const summary = summarizeCancellation({
    refundOutcome: mine?.refundOutcome ?? null,
    creditsUsed: 0,
    bookingCancelledAt: mine?.cancelledAt ?? null,
    record,
  })
  return {
    cancelledAt: summary.cancelledAt,
    cancelledBy: summary.cancelledBy === 'member' ? theirs(record.clientId) : 'studio',
    expired: false,
  }
}

export async function listClientPtRequests(
  tenantId: string,
  clientId: string,
): Promise<ClientPtRequestView[]> {
  // Aliased so we can read the requester's name even when `clientId` is the
  // 2on1 partner (and ptRequests.clientId is someone else).
  const requester = alias(clients, 'requester')
  const reqRows = await db
    .select({
      id: ptRequests.id,
      requesterClientId: ptRequests.clientId,
      requesterName: requester.name,
      classTypeId: ptRequests.classTypeId,
      className: classTypes.name,
      locationId: ptRequests.locationId,
      locationName: locations.name,
      sessionType: ptRequests.sessionType,
      status: ptRequests.status,
      message: ptRequests.message,
      scheduleNote: ptRequests.scheduleNote,
      cancelNote: ptRequests.cancelNote,
      coClientName: ptRequests.coClientName,
      createdAt: ptRequests.createdAt,
      expiresAt: ptRequests.expiresAt,
      resolvedAt: ptRequests.resolvedAt,
      resolvedByStaffId: ptRequests.resolvedByStaffId,
      coClientId: ptRequests.coClientId,
      sessionId: ptSessions.id,
      sessionStartsAt: ptSessions.startsAt,
      sessionEndsAt: ptSessions.endsAt,
      instructorName: staffUsers.name,
      roomName: rooms.name,
    })
    .from(ptRequests)
    .leftJoin(requester, eq(requester.id, ptRequests.clientId))
    .leftJoin(classTypes, eq(classTypes.id, ptRequests.classTypeId))
    .leftJoin(locations, eq(locations.id, ptRequests.locationId))
    .leftJoin(ptSessions, eq(ptSessions.id, ptRequests.scheduledPtSessionId))
    .leftJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .leftJoin(rooms, eq(rooms.id, ptSessions.roomId))
    // Caller is the requester, the 2on1 partner (co_client_id), or held a seat
    // since cancelled: a manual session's request follows who is still booked,
    // so a member who left keeps their seat only through its booking (#351).
    .where(
      and(
        eq(ptRequests.tenantId, tenantId),
        or(
          eq(ptRequests.clientId, clientId),
          eq(ptRequests.coClientId, clientId),
          inArray(
            ptRequests.scheduledPtSessionId,
            db
              .select({ id: bookings.ptSessionId })
              .from(bookings)
              .where(
                and(
                  eq(bookings.tenantId, tenantId),
                  eq(bookings.clientId, clientId),
                  eq(bookings.kind, 'pt'),
                  eq(bookings.state, 'cancelled'),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(desc(ptRequests.createdAt))

  if (reqRows.length === 0) return []

  const ids = reqRows.map(r => r.id)
  const slotRows = await db
    .select()
    .from(ptRequestSlots)
    .where(
      and(eq(ptRequestSlots.tenantId, tenantId), inArray(ptRequestSlots.ptRequestId, ids)),
    )
    .orderBy(asc(ptRequestSlots.proposedDate), asc(ptRequestSlots.startTime))

  const slotsByReq = new Map<string, ClientPtRequestView['slots']>()
  for (const s of slotRows) {
    const list = slotsByReq.get(s.ptRequestId) ?? []
    list.push({ proposedDate: s.proposedDate, startTime: s.startTime, endTime: s.endTime })
    slotsByReq.set(s.ptRequestId, list)
  }

  // This member's booking on each scheduled session (QR/code/check-in for the card).
  const sessionIds = reqRows.map(r => r.sessionId).filter((v): v is string => !!v)
  type MyBooking = {
    id: string
    state: string
    cancelledAt: Date | null
    qrToken: string
    code: string
    checkInState: string
    refundOutcome: string
  }
  const bookingBySession = new Map<string, MyBooking>()
  const recordsBySession = new Map<string, SessionRecord[]>()
  if (sessionIds.length) {
    const bks = await db
      .select({
        id: bookings.id,
        ptSessionId: bookings.ptSessionId,
        state: bookings.state,
        cancelledAt: bookings.cancelledAt,
        qrToken: bookings.qrToken,
        code: bookings.code,
        checkInState: bookings.checkInState,
        refundOutcome: bookings.refundOutcome,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.clientId, clientId),
          inArray(bookings.ptSessionId, sessionIds),
        ),
      )
    for (const { ptSessionId, ...b } of bks) {
      // A member seated again after leaving holds two: the live one is theirs.
      if (ptSessionId && bookingBySession.get(ptSessionId)?.state !== 'confirmed') {
        bookingBySession.set(ptSessionId, b)
      }
    }

    // Every cancellation recorded on the sessions' bookings: who cancelled.
    const records = await db
      .select({
        ptSessionId: bookings.ptSessionId,
        bookingId: cancellations.bookingId,
        clientId: cancellations.clientId,
        source: cancellations.source,
        wasWithinWindow: cancellations.wasWithinWindow,
        wasWithinCap: cancellations.wasWithinCap,
        cancelledAt: cancellations.cancelledAt,
      })
      .from(cancellations)
      .innerJoin(bookings, eq(bookings.id, cancellations.bookingId))
      .where(and(eq(cancellations.tenantId, tenantId), inArray(bookings.ptSessionId, sessionIds)))
    for (const { ptSessionId, ...c } of records) {
      if (ptSessionId) recordsBySession.set(ptSessionId, [...(recordsBySession.get(ptSessionId) ?? []), c])
    }
  }

  return reqRows.map(r => {
    // On the request no longer, yet listed: a seat they held, paid for and
    // left (#351). Theirs, as a requester's is: nobody hosted them.
    const seatLeft = r.requesterClientId !== clientId && r.coClientId !== clientId
    const role: 'requester' | 'partner' = r.requesterClientId === clientId || seatLeft ? 'requester' : 'partner'
    const booking = r.sessionId ? bookingBySession.get(r.sessionId) ?? null : null
    const status = seatLeft ? 'cancelled_after_scheduled' : r.status
    const refundOutcome =
      status === 'cancelled_before_scheduled'
        ? // The debit was the requester's: a partner had nothing to get back.
          role === 'requester' ? 'session_returned' : 'n_a'
        : status === 'cancelled_after_scheduled'
          ? (booking?.refundOutcome ?? (role === 'requester' ? 'forfeited' : 'n_a'))
          : null
    const cancellation =
      status === 'cancelled_before_scheduled' || status === 'cancelled_after_scheduled'
        ? ptCancellation({ ...r, status }, clientId, booking, r.sessionId ? (recordsBySession.get(r.sessionId) ?? []) : [])
        : null
    return {
      id: r.id,
      classTypeId: r.classTypeId,
      className: r.classTypeId ? (r.className ?? 'Class') : null,
      locationId: r.locationId,
      locationName: r.locationName ?? 'Studio',
      sessionType: r.sessionType as '1on1' | '2on1',
      status,
      role,
      requesterName: r.requesterName,
      // The requester's private note to the instructor isn't the partner's to read.
      message: role === 'partner' ? null : r.message,
      // Staff's notes are to whoever is on the session, the partner included.
      scheduleNote: r.scheduleNote,
      cancelNote: r.cancelNote,
      coClientName: r.coClientName,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      slots: slotsByReq.get(r.id) ?? [],
      session: r.sessionId
        ? {
            startsAt: r.sessionStartsAt!,
            endsAt: r.sessionEndsAt!,
            instructorName: r.instructorName,
            roomName: r.roomName,
          }
        : null,
      booking,
      refundOutcome,
      cancellation,
    }
  })
}

// ----------------------------------------------------------------------------
// Admin / instructor triage (hydrated)
// ----------------------------------------------------------------------------

export type PtRequestStatusFilter =
  | 'pending'
  | 'scheduled'
  | 'cancelled_before_scheduled'
  | 'cancelled_after_scheduled'
  | 'attended'

export interface AdminPtRequestView {
  id: string
  status: string
  sessionType: '1on1' | '2on1'
  message: string | null
  /** Staff's note to the member on scheduling a time they did not propose. */
  scheduleNote: string | null
  /** Staff's reason for cancelling, as the member sees it. */
  cancelNote: string | null
  /** `portal` for a manual session staff created, `member` for a member's request. */
  origin: PtRequestOrigin
  createdAt: Date
  /** Null on a manual session's request, which never waits pending. */
  expiresAt: Date | null
  resolvedAt: Date | null
  client: { id: string; name: string; email: string }
  /** Preferred class type; null when the member asked for "any". */
  classType: { id: string; name: string } | null
  location: { id: string; name: string }
  /** Resolved partner for 2on1: a member (with clientId) OR a not-yet-member (clientId null). */
  coClient: { clientId: string | null; name: string | null; email: string | null } | null
  /**
   * The **Bound Instructor** of the package this request was debited from —
   * who the member bought their sessions with. Null means the package is open
   * to any instructor. An admin routes by it; an instructor sees it only on
   * requests they may take, because the queue hides the rest.
   */
  boundInstructor: { id: string; name: string } | null
  /** `endTime` is null on requests made since members propose start times only. */
  slots: { proposedDate: string; startTime: string; endTime: string | null }[]
  /** Populated once scheduled (else null). */
  session: {
    id: string
    startsAt: Date
    endsAt: Date
    instructorName: string | null
    roomName: string | null
  } | null
  /** Requester booking cancellation outcome when terminal; null while active/pending. */
  refundOutcome: string | null
}

/**
 * `staff_users` is joined twice on this query — once for whoever ended up
 * teaching the scheduled session, once for whoever the package is bound to.
 * They are different questions and frequently different people.
 */
const boundInstructor = alias(staffUsers, 'bound_instructor')

function adminSelect() {
  return db
    .select({
      id: ptRequests.id,
      status: ptRequests.status,
      sessionType: ptRequests.sessionType,
      message: ptRequests.message,
      scheduleNote: ptRequests.scheduleNote,
      cancelNote: ptRequests.cancelNote,
      origin: ptRequests.origin,
      createdAt: ptRequests.createdAt,
      expiresAt: ptRequests.expiresAt,
      resolvedAt: ptRequests.resolvedAt,
      clientId: clients.id,
      clientName: clients.name,
      clientEmail: clients.email,
      classTypeId: ptRequests.classTypeId,
      className: classTypes.name,
      locationId: ptRequests.locationId,
      locationName: locations.name,
      coClientId: ptRequests.coClientId,
      coClientNameRaw: ptRequests.coClientName,
      coClientEmailRaw: ptRequests.coClientEmail,
      sessionId: ptSessions.id,
      sessionStartsAt: ptSessions.startsAt,
      sessionEndsAt: ptSessions.endsAt,
      instructorName: staffUsers.name,
      roomName: rooms.name,
      boundInstructorId: clientPackages.boundInstructorId,
      boundInstructorName: boundInstructor.name,
    })
    .from(ptRequests)
    .innerJoin(clients, eq(clients.id, ptRequests.clientId))
    .leftJoin(classTypes, eq(classTypes.id, ptRequests.classTypeId))
    .leftJoin(locations, eq(locations.id, ptRequests.locationId))
    .leftJoin(ptSessions, eq(ptSessions.id, ptRequests.scheduledPtSessionId))
    // pt_sessions.instructor_id → instructors.staff_user_id, which IS staff_users.id.
    .leftJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .leftJoin(rooms, eq(rooms.id, ptSessions.roomId))
    .leftJoin(clientPackages, eq(clientPackages.id, ptRequests.debitedClientPackageId))
    .leftJoin(boundInstructor, eq(boundInstructor.id, clientPackages.boundInstructorId))
}

type AdminRow = Awaited<ReturnType<ReturnType<typeof adminSelect>['where']>>[number]

async function hydrateAdminRows(
  tenantId: string,
  rows: AdminRow[],
): Promise<AdminPtRequestView[]> {
  if (rows.length === 0) return []

  // Resolve existing-member partners to live name/email in one batch.
  const memberPartnerIds = rows.map(r => r.coClientId).filter((v): v is string => !!v)
  const memberById = new Map<string, { name: string; email: string }>()
  if (memberPartnerIds.length) {
    const members = await db
      .select({ id: clients.id, name: clients.name, email: clients.email })
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), inArray(clients.id, memberPartnerIds)))
    for (const m of members) memberById.set(m.id, { name: m.name, email: m.email })
  }

  const slotsByReq = new Map<string, AdminPtRequestView['slots']>()
  const slotRows = await db
    .select()
    .from(ptRequestSlots)
    .where(
      and(
        eq(ptRequestSlots.tenantId, tenantId),
        inArray(ptRequestSlots.ptRequestId, rows.map(r => r.id)),
      ),
    )
    .orderBy(asc(ptRequestSlots.proposedDate), asc(ptRequestSlots.startTime))
  for (const s of slotRows) {
    const list = slotsByReq.get(s.ptRequestId) ?? []
    list.push({ proposedDate: s.proposedDate, startTime: s.startTime, endTime: s.endTime })
    slotsByReq.set(s.ptRequestId, list)
  }

  const sessionIds = rows.map(r => r.sessionId).filter((v): v is string => !!v)
  const requesterOutcomeBySession = new Map<string, string>()
  if (sessionIds.length) {
    const bks = await db
      .select({
        ptSessionId: bookings.ptSessionId,
        clientId: bookings.clientId,
        refundOutcome: bookings.refundOutcome,
      })
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), inArray(bookings.ptSessionId, sessionIds)))
    const requesterBySession = new Map(
      rows.filter(r => r.sessionId).map(r => [r.sessionId!, r.clientId]),
    )
    for (const b of bks) {
      if (b.ptSessionId && requesterBySession.get(b.ptSessionId) === b.clientId) {
        requesterOutcomeBySession.set(b.ptSessionId, b.refundOutcome)
      }
    }
  }

  return rows.map(r => {
    let coClient: AdminPtRequestView['coClient'] = null
    if (r.sessionType === '2on1') {
      if (r.coClientId) {
        const m = memberById.get(r.coClientId)
        coClient = { clientId: r.coClientId, name: m?.name ?? null, email: m?.email ?? null }
      } else {
        coClient = { clientId: null, name: r.coClientNameRaw, email: r.coClientEmailRaw }
      }
    }
    return {
      id: r.id,
      status: r.status,
      sessionType: r.sessionType as '1on1' | '2on1',
      message: r.message,
      scheduleNote: r.scheduleNote,
      cancelNote: r.cancelNote,
      origin: r.origin,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      resolvedAt: r.resolvedAt,
      client: { id: r.clientId, name: r.clientName, email: r.clientEmail },
      classType: r.classTypeId ? { id: r.classTypeId, name: r.className ?? 'Class' } : null,
      location: { id: r.locationId, name: r.locationName ?? 'Studio' },
      coClient,
      boundInstructor: r.boundInstructorId
        ? { id: r.boundInstructorId, name: r.boundInstructorName || 'Instructor' }
        : null,
      slots: slotsByReq.get(r.id) ?? [],
      session: r.sessionId
        ? {
            id: r.sessionId,
            startsAt: r.sessionStartsAt!,
            endsAt: r.sessionEndsAt!,
            instructorName: r.instructorName,
            roomName: r.roomName,
          }
        : null,
      refundOutcome:
        r.status === 'cancelled_before_scheduled'
          ? 'session_returned'
          : r.status === 'cancelled_after_scheduled'
            ? (r.sessionId ? requesterOutcomeBySession.get(r.sessionId) ?? 'forfeited' : 'forfeited')
            : null,
    }
  })
}

export interface ListPtRequestsForAdminOpts {
  status?: PtRequestStatusFilter
  /** Workspace scoping — restrict to these location ids (admin's granted locations). */
  locationIds?: string[]
  /**
   * The instructor whose queue this is. Hides requests debited from a package
   * bound to somebody else — work they may not pick up, so work they should
   * not be reading a member's private note about. Omit for the admin queue,
   * which sees everything with the binding shown.
   */
  visibleToInstructorId?: string
}

/** Portal triage queue. Optional status + location-scope filters; newest first. */
export async function listPtRequestsForAdmin(
  tenantId: string,
  opts: ListPtRequestsForAdminOpts = {},
): Promise<AdminPtRequestView[]> {
  const conds = [eq(ptRequests.tenantId, tenantId)]
  if (opts.status) conds.push(eq(ptRequests.status, opts.status))
  if (opts.locationIds && opts.locationIds.length) {
    conds.push(inArray(ptRequests.locationId, opts.locationIds))
  }
  if (opts.visibleToInstructorId) {
    // Unbound, or bound to them. `IS NULL` covers both the open package and a
    // request with no package to read — neither is somebody else's.
    conds.push(
      or(
        isNull(clientPackages.boundInstructorId),
        eq(clientPackages.boundInstructorId, opts.visibleToInstructorId),
      )!,
    )
  }
  const rows = await adminSelect()
    .where(and(...conds))
    .orderBy(desc(ptRequests.createdAt))
  return hydrateAdminRows(tenantId, rows)
}

export async function getPtRequestForAdmin(
  tenantId: string,
  id: string,
): Promise<AdminPtRequestView | null> {
  const rows = await adminSelect()
    .where(and(eq(ptRequests.tenantId, tenantId), eq(ptRequests.id, id)))
    .limit(1)
  const hydrated = await hydrateAdminRows(tenantId, rows)
  return hydrated[0] ?? null
}

export interface PartnerLookupResult {
  found: boolean
  clientId?: string
  name?: string
}

export async function lookupPartnerByEmail(
  tenantId: string,
  email: string,
  requesterClientId: string,
): Promise<PartnerLookupResult> {
  const [row] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(
      and(
        // An address registered at another studio is `found: false` here. This
        // endpoint answers "is this person a member?" from a member's own
        // typing, and answering it across the platform would turn it into a
        // directory of everyone on it.
        eq(clients.tenantId, tenantId),
        sql`lower(${clients.email}) = ${email.trim().toLowerCase()}`,
        ne(clients.id, requesterClientId),
      ),
    )
    .limit(1)
  if (!row) return { found: false }
  return { found: true, clientId: row.id, name: row.name }
}
