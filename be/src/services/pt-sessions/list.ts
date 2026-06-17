import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../db'
import { clients, staffUsers } from '../../db/schema/identity'
import { classTypes, locations, rooms } from '../../db/schema/catalog'
import { ptRequests, ptRequestSlots, ptSessions } from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'

export interface ClientPtRequestView {
  id: string
  classTypeId: string
  className: string
  locationId: string
  locationName: string
  sessionType: '1on1' | '2on1'
  status: string
  /** Is this client the requester (who owns the credit) or the 2on1 partner (read-only)? */
  role: 'requester' | 'partner'
  /** The requester's name. Used by partner cards ("hosted by …"). */
  requesterName: string | null
  message: string | null
  coClientName: string | null
  createdAt: Date
  expiresAt: Date
  slots: { proposedDate: string; startTime: string; endTime: string }[]
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
}

export async function listClientPtRequests(clientId: string): Promise<ClientPtRequestView[]> {
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
      coClientName: ptRequests.coClientName,
      createdAt: ptRequests.createdAt,
      expiresAt: ptRequests.expiresAt,
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
    // Caller is either the requester OR the 2on1 partner (co_client_id).
    .where(or(eq(ptRequests.clientId, clientId), eq(ptRequests.coClientId, clientId)))
    .orderBy(desc(ptRequests.createdAt))

  if (reqRows.length === 0) return []

  const ids = reqRows.map(r => r.id)
  const slotRows = await db
    .select()
    .from(ptRequestSlots)
    .where(inArray(ptRequestSlots.ptRequestId, ids))
    .orderBy(asc(ptRequestSlots.proposedDate), asc(ptRequestSlots.startTime))

  const slotsByReq = new Map<string, ClientPtRequestView['slots']>()
  for (const s of slotRows) {
    const list = slotsByReq.get(s.ptRequestId) ?? []
    list.push({ proposedDate: s.proposedDate, startTime: s.startTime, endTime: s.endTime })
    slotsByReq.set(s.ptRequestId, list)
  }

  // This member's booking on each scheduled session (QR/code/check-in for the card).
  const sessionIds = reqRows.map(r => r.sessionId).filter((v): v is string => !!v)
  const bookingBySession = new Map<string, { qrToken: string; code: string; checkInState: string; refundOutcome: string }>()
  if (sessionIds.length) {
    const bks = await db
      .select({
        ptSessionId: bookings.ptSessionId,
        qrToken: bookings.qrToken,
        code: bookings.code,
        checkInState: bookings.checkInState,
        refundOutcome: bookings.refundOutcome,
      })
      .from(bookings)
      .where(and(eq(bookings.clientId, clientId), inArray(bookings.ptSessionId, sessionIds)))
    for (const b of bks) {
      if (b.ptSessionId) {
        bookingBySession.set(b.ptSessionId, {
          qrToken: b.qrToken,
          code: b.code,
          checkInState: b.checkInState,
          refundOutcome: b.refundOutcome,
        })
      }
    }
  }

  return reqRows.map(r => {
    const role: 'requester' | 'partner' = r.requesterClientId === clientId ? 'requester' : 'partner'
    const booking = r.sessionId ? bookingBySession.get(r.sessionId) ?? null : null
    const refundOutcome =
      r.status === 'cancelled_before_scheduled'
        ? 'session_returned'
        : r.status === 'cancelled_after_scheduled'
          ? (booking?.refundOutcome ?? (role === 'requester' ? 'forfeited' : 'n_a'))
          : null
    return {
      id: r.id,
      classTypeId: r.classTypeId,
      className: r.className ?? 'Class',
      locationId: r.locationId,
      locationName: r.locationName ?? 'Studio',
      sessionType: r.sessionType as '1on1' | '2on1',
      status: r.status,
      role,
      requesterName: r.requesterName,
      // The requester's private note to the instructor isn't the partner's to read.
      message: role === 'partner' ? null : r.message,
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
  createdAt: Date
  expiresAt: Date
  resolvedAt: Date | null
  client: { id: string; name: string; email: string }
  classType: { id: string; name: string }
  location: { id: string; name: string }
  /** Resolved partner for 2on1: a member (with clientId) OR a not-yet-member (clientId null). */
  coClient: { clientId: string | null; name: string | null; email: string | null } | null
  slots: { proposedDate: string; startTime: string; endTime: string }[]
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

function adminSelect() {
  return db
    .select({
      id: ptRequests.id,
      status: ptRequests.status,
      sessionType: ptRequests.sessionType,
      message: ptRequests.message,
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
    })
    .from(ptRequests)
    .innerJoin(clients, eq(clients.id, ptRequests.clientId))
    .leftJoin(classTypes, eq(classTypes.id, ptRequests.classTypeId))
    .leftJoin(locations, eq(locations.id, ptRequests.locationId))
    .leftJoin(ptSessions, eq(ptSessions.id, ptRequests.scheduledPtSessionId))
    // pt_sessions.instructor_id → instructors.staff_user_id, which IS staff_users.id.
    .leftJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .leftJoin(rooms, eq(rooms.id, ptSessions.roomId))
}

type AdminRow = Awaited<ReturnType<ReturnType<typeof adminSelect>['where']>>[number]

async function hydrateAdminRows(rows: AdminRow[]): Promise<AdminPtRequestView[]> {
  if (rows.length === 0) return []

  // Resolve existing-member partners to live name/email in one batch.
  const memberPartnerIds = rows.map(r => r.coClientId).filter((v): v is string => !!v)
  const memberById = new Map<string, { name: string; email: string }>()
  if (memberPartnerIds.length) {
    const members = await db
      .select({ id: clients.id, name: clients.name, email: clients.email })
      .from(clients)
      .where(inArray(clients.id, memberPartnerIds))
    for (const m of members) memberById.set(m.id, { name: m.name, email: m.email })
  }

  const slotsByReq = new Map<string, AdminPtRequestView['slots']>()
  const slotRows = await db
    .select()
    .from(ptRequestSlots)
    .where(inArray(ptRequestSlots.ptRequestId, rows.map(r => r.id)))
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
      .where(inArray(bookings.ptSessionId, sessionIds))
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
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      resolvedAt: r.resolvedAt,
      client: { id: r.clientId, name: r.clientName, email: r.clientEmail },
      classType: { id: r.classTypeId, name: r.className ?? 'Class' },
      location: { id: r.locationId, name: r.locationName ?? 'Studio' },
      coClient,
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
}

/** Portal triage queue. Optional status + location-scope filters; newest first. */
export async function listPtRequestsForAdmin(
  opts: ListPtRequestsForAdminOpts = {},
): Promise<AdminPtRequestView[]> {
  const conds = []
  if (opts.status) conds.push(eq(ptRequests.status, opts.status))
  if (opts.locationIds && opts.locationIds.length) {
    conds.push(inArray(ptRequests.locationId, opts.locationIds))
  }
  const rows = await adminSelect()
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(ptRequests.createdAt))
  return hydrateAdminRows(rows)
}

export async function getPtRequestForAdmin(id: string): Promise<AdminPtRequestView | null> {
  const rows = await adminSelect().where(eq(ptRequests.id, id)).limit(1)
  const hydrated = await hydrateAdminRows(rows)
  return hydrated[0] ?? null
}

export interface PartnerLookupResult {
  found: boolean
  clientId?: string
  name?: string
}

export async function lookupPartnerByEmail(
  email: string,
  requesterClientId: string,
): Promise<PartnerLookupResult> {
  const [row] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(sql`lower(${clients.email}) = ${email.trim().toLowerCase()}`, ne(clients.id, requesterClientId)))
    .limit(1)
  if (!row) return { found: false }
  return { found: true, clientId: row.id, name: row.name }
}
