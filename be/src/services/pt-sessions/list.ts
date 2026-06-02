import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { classTypes, locations } from '../../db/schema/catalog'
import { ptRequests, ptRequestSlots } from '../../db/schema/schedule'

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
