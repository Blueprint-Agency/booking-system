import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  classes,
  ptSessions,
  ptSessionClients,
  classTypes,
  locations,
  rooms,
  staffUsers,
  clients,
  bookings,
} from '../../db/schema'
import { NotFoundError } from '../../shared/errors'

interface NamedRef {
  id: string
  name: string
}

export interface ClassDetail {
  id: string
  lifecycle: 'active' | 'cancelled'
  startsAt: Date
  endsAt: Date
  classType: NamedRef | null
  instructor: NamedRef | null
  location: NamedRef | null
  room: NamedRef | null
  capacityOnline: number
  capacityWaitlist: number
  capacityBuffer: number
  creditCost: number
  bookedCount: number
}

export async function getClassDetail(id: string): Promise<ClassDetail> {
  const [row] = await db
    .select({
      id: classes.id,
      lifecycle: classes.lifecycle,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      capacityOnline: classes.capacityOnline,
      capacityWaitlist: classes.capacityWaitlist,
      capacityBuffer: classes.capacityBuffer,
      creditCost: classes.creditCost,
      classTypeId: classes.classTypeId,
      classTypeName: classTypes.name,
      instructorId: classes.mainInstructorId,
      instructorName: staffUsers.name,
      locationId: classes.locationId,
      locationName: locations.name,
      roomId: classes.roomId,
      roomName: rooms.name,
    })
    .from(classes)
    .leftJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .leftJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
    .leftJoin(locations, eq(locations.id, classes.locationId))
    .leftJoin(rooms, eq(rooms.id, classes.roomId))
    .where(eq(classes.id, id))
    .limit(1)
  if (!row) throw new NotFoundError('class_not_found')

  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.classId, id), eq(bookings.state, 'confirmed')))

  return {
    id: row.id,
    lifecycle: row.lifecycle as ClassDetail['lifecycle'],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    classType: row.classTypeName ? { id: row.classTypeId, name: row.classTypeName } : null,
    instructor: row.instructorName ? { id: row.instructorId, name: row.instructorName } : null,
    location: row.locationName ? { id: row.locationId, name: row.locationName } : null,
    room: row.roomId && row.roomName ? { id: row.roomId, name: row.roomName } : null,
    capacityOnline: row.capacityOnline,
    capacityWaitlist: row.capacityWaitlist,
    capacityBuffer: row.capacityBuffer,
    creditCost: row.creditCost,
    bookedCount: count?.n ?? 0,
  }
}

export interface PtSessionDetail {
  id: string
  lifecycle: 'active' | 'cancelled'
  startsAt: Date
  endsAt: Date
  sessionType: '1on1' | '2on1'
  instructor: NamedRef | null
  location: NamedRef | null
  capacityOnline: number
  capacityWaitlist: number
  capacityBuffer: number
  clients: NamedRef[]
}

export async function getPtSessionDetail(id: string): Promise<PtSessionDetail> {
  const [row] = await db
    .select({
      id: ptSessions.id,
      lifecycle: ptSessions.lifecycle,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
      sessionType: ptSessions.sessionType,
      capacityOnline: ptSessions.capacityOnline,
      capacityWaitlist: ptSessions.capacityWaitlist,
      capacityBuffer: ptSessions.capacityBuffer,
      instructorId: ptSessions.instructorId,
      instructorName: staffUsers.name,
      locationId: ptSessions.locationId,
      locationName: locations.name,
    })
    .from(ptSessions)
    .leftJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .leftJoin(locations, eq(locations.id, ptSessions.locationId))
    .where(eq(ptSessions.id, id))
    .limit(1)
  if (!row) throw new NotFoundError('pt_session_not_found')

  const clientRows = await db
    .select({ id: clients.id, name: clients.name })
    .from(ptSessionClients)
    .innerJoin(clients, eq(clients.id, ptSessionClients.clientId))
    .where(eq(ptSessionClients.ptSessionId, id))

  return {
    id: row.id,
    lifecycle: row.lifecycle as PtSessionDetail['lifecycle'],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    sessionType: row.sessionType as PtSessionDetail['sessionType'],
    instructor: row.instructorName ? { id: row.instructorId, name: row.instructorName } : null,
    location: row.locationName ? { id: row.locationId, name: row.locationName } : null,
    capacityOnline: row.capacityOnline,
    capacityWaitlist: row.capacityWaitlist,
    capacityBuffer: row.capacityBuffer,
    clients: clientRows,
  }
}
