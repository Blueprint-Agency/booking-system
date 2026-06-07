import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clients, staffUsers } from '../../db/schema/identity'
import { classTypes, locations, rooms } from '../../db/schema/catalog'
import { ptRequests, ptRequestSlots, ptSessions } from '../../db/schema/schedule'

export interface ClientPtRequestView {
  id: string
  classTypeId: string
  className: string
  locationId: string
  locationName: string
  sessionType: '1on1' | '2on1'
  status: string
  message: string | null
  coClientName: string | null
  createdAt: Date
  expiresAt: Date
  slots: { proposedDate: string; startTime: string; endTime: string }[]
}

export async function listClientPtRequests(clientId: string): Promise<ClientPtRequestView[]> {
  const reqRows = await db
    .select({
      id: ptRequests.id,
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
    })
    .from(ptRequests)
    .leftJoin(classTypes, eq(classTypes.id, ptRequests.classTypeId))
    .leftJoin(locations, eq(locations.id, ptRequests.locationId))
    .where(eq(ptRequests.clientId, clientId))
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

  return reqRows.map(r => ({
    id: r.id,
    classTypeId: r.classTypeId,
    className: r.className ?? 'Class',
    locationId: r.locationId,
    locationName: r.locationName ?? 'Studio',
    sessionType: r.sessionType as '1on1' | '2on1',
    status: r.status,
    message: r.message,
    coClientName: r.coClientName,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    slots: slotsByReq.get(r.id) ?? [],
  }))
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
