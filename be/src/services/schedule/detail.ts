import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../db'
import {
  classes,
  classSupportingInstructors,
  ptSessions,
  ptSessionClients,
  classTypes,
  locations,
  rooms,
  staffUsers,
  clients,
  bookings,
  clientPackages,
} from '../../db/schema'
import type { ClassDifficulty, ClientPackageKind } from '../../db/enums'
import { NotFoundError } from '../../shared/errors'

interface NamedRef {
  id: string
  name: string
}

export interface ClassAttendee {
  bookingId: string
  client: NamedRef
  packageKind: ClientPackageKind | null
  creditsUsed: number
  checkInState: 'pending' | 'attended' | 'no_show' | 'n_a'
  code: string
}

export interface ClassDetail {
  id: string
  lifecycle: 'active' | 'cancelled'
  startsAt: Date
  endsAt: Date
  classType: NamedRef | null
  difficulty: ClassDifficulty
  instructor: NamedRef | null
  mainInstructorId: string
  supportingInstructorIds: string[]
  supportingInstructors: NamedRef[]
  location: NamedRef | null
  room: NamedRef | null
  capacityOnline: number
  capacityWaitlist: number
  capacityBuffer: number
  creditCost: number
  bookedCount: number
  attendees: ClassAttendee[]
  createdAt: Date
  scheduledBy: NamedRef | null
}

export async function getClassDetail(id: string): Promise<ClassDetail> {
  // staffUsers is joined twice (instructor + creator) so the creator side is aliased.
  const creator = alias(staffUsers, 'creator')
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
      difficulty: classTypes.difficulty,
      instructorId: classes.mainInstructorId,
      instructorName: staffUsers.name,
      locationId: classes.locationId,
      locationName: locations.name,
      roomId: classes.roomId,
      roomName: rooms.name,
      createdAt: classes.createdAt,
      scheduledById: classes.createdByStaffId,
      scheduledByName: creator.name,
    })
    .from(classes)
    .leftJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .leftJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
    .leftJoin(locations, eq(locations.id, classes.locationId))
    .leftJoin(rooms, eq(rooms.id, classes.roomId))
    .leftJoin(creator, eq(creator.id, classes.createdByStaffId))
    .where(eq(classes.id, id))
    .limit(1)
  if (!row) throw new NotFoundError('class_not_found')

  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.classId, id), eq(bookings.state, 'confirmed')))

  // Roster of confirmed attendees (admin-restructure.md §10).
  const attendeeRows = await db
    .select({
      bookingId: bookings.id,
      clientId: bookings.clientId,
      clientName: clients.name,
      packageKind: clientPackages.kind,
      creditsUsed: bookings.creditsOrSessionsUsed,
      checkInState: bookings.checkInState,
      code: bookings.code,
    })
    .from(bookings)
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .leftJoin(clientPackages, eq(clientPackages.id, bookings.clientPackageId))
    .where(and(eq(bookings.classId, id), eq(bookings.state, 'confirmed')))
    .orderBy(bookings.bookedAt)
  const attendees: ClassAttendee[] = attendeeRows.map(r => ({
    bookingId: r.bookingId,
    client: { id: r.clientId, name: r.clientName ?? 'Member' },
    packageKind: (r.packageKind as ClientPackageKind | null) ?? null,
    creditsUsed: r.creditsUsed ?? 0,
    checkInState: r.checkInState as ClassAttendee['checkInState'],
    code: r.code,
  }))

  const supportingRows = await db
    .select({ instructorId: classSupportingInstructors.instructorId, name: staffUsers.name })
    .from(classSupportingInstructors)
    .leftJoin(staffUsers, eq(staffUsers.id, classSupportingInstructors.instructorId))
    .where(eq(classSupportingInstructors.classId, id))
  const supportingInstructors = supportingRows
    .map(r => ({ id: r.instructorId, name: r.name ?? 'Instructor' }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const supportingInstructorIds = supportingInstructors.map(s => s.id)

  return {
    id: row.id,
    lifecycle: row.lifecycle as ClassDetail['lifecycle'],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    classType: row.classTypeName ? { id: row.classTypeId, name: row.classTypeName } : null,
    difficulty: row.difficulty as ClassDifficulty,
    instructor: row.instructorName ? { id: row.instructorId, name: row.instructorName } : null,
    mainInstructorId: row.instructorId,
    supportingInstructorIds,
    supportingInstructors,
    location: row.locationName ? { id: row.locationId, name: row.locationName } : null,
    room: row.roomId && row.roomName ? { id: row.roomId, name: row.roomName } : null,
    capacityOnline: row.capacityOnline,
    capacityWaitlist: row.capacityWaitlist,
    capacityBuffer: row.capacityBuffer,
    creditCost: row.creditCost,
    bookedCount: count?.n ?? 0,
    attendees,
    createdAt: row.createdAt,
    scheduledBy:
      row.scheduledById && row.scheduledByName
        ? { id: row.scheduledById, name: row.scheduledByName }
        : null,
  }
}

export interface PtSessionAttendee {
  id: string
  name: string
  code: string | null
  checkInState: 'pending' | 'attended' | 'no_show' | 'n_a' | null
}

export interface PtSessionDetail {
  id: string
  lifecycle: 'active' | 'cancelled'
  startsAt: Date
  endsAt: Date
  sessionType: '1on1' | '2on1'
  instructor: NamedRef | null
  location: NamedRef | null
  room: NamedRef | null
  capacityOnline: number
  capacityWaitlist: number
  capacityBuffer: number
  clients: PtSessionAttendee[]
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
      roomId: ptSessions.roomId,
      roomName: rooms.name,
    })
    .from(ptSessions)
    .leftJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .leftJoin(locations, eq(locations.id, ptSessions.locationId))
    .leftJoin(rooms, eq(rooms.id, ptSessions.roomId))
    .where(eq(ptSessions.id, id))
    .limit(1)
  if (!row) throw new NotFoundError('pt_session_not_found')

  const clientRows = await db
    .select({
      id: clients.id,
      name: clients.name,
      code: bookings.code,
      checkInState: bookings.checkInState,
    })
    .from(ptSessionClients)
    .innerJoin(clients, eq(clients.id, ptSessionClients.clientId))
    .leftJoin(
      bookings,
      and(eq(bookings.ptSessionId, id), eq(bookings.clientId, ptSessionClients.clientId)),
    )
    .where(eq(ptSessionClients.ptSessionId, id))

  return {
    id: row.id,
    lifecycle: row.lifecycle as PtSessionDetail['lifecycle'],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    sessionType: row.sessionType as PtSessionDetail['sessionType'],
    instructor: row.instructorName ? { id: row.instructorId, name: row.instructorName } : null,
    location: row.locationName ? { id: row.locationId, name: row.locationName } : null,
    room: row.roomId && row.roomName ? { id: row.roomId, name: row.roomName } : null,
    capacityOnline: row.capacityOnline,
    capacityWaitlist: row.capacityWaitlist,
    capacityBuffer: row.capacityBuffer,
    clients: clientRows.map(c => ({
      id: c.id,
      name: c.name,
      code: c.code ?? null,
      checkInState: (c.checkInState as PtSessionAttendee['checkInState']) ?? null,
    })),
  }
}
