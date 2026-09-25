import { and, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../db'
import {
  classes,
  classSupportingInstructors,
  ptSessions,
  ptSessionClients,
  ptSessionSupportingInstructors,
  classTypes,
  locations,
  rooms,
  staffUsers,
  clients,
  bookings,
  clientPackages,
  waitlistEntries,
} from '../../db/schema'
import type { BookingSeat, ClassDifficulty, ClientPackageKind } from '../../db/enums'
import { ForbiddenError, NotFoundError } from '../../shared/errors'
import { sessionCheckInState, type SessionCheckInState } from '../bookings/session-check-in'
import { attendanceCapacity, countSeats, type SeatCounts } from '../bookings/seats'
import { waitlistEnabled } from '../waitlist/line'
import { waitlistPanel, type WaitlistPanelRow } from '../waitlist/staff'

export interface NamedRef {
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
  /** Which seat the booking holds; the roster tags `buffer` and `overbook`. */
  seat: BookingSeat
  /** The booking was made by a waitlist promotion, automatic or by staff. */
  promotedFromWaitlist: boolean
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
  instructorPaySgd: number | null
  supportingInstructorIds: string[]
  supportingInstructors: (NamedRef & { paySgd: number | null })[]
  location: NamedRef | null
  room: NamedRef | null
  capacityOnline: number
  capacityWaitlist: number
  capacityBuffer: number
  creditCost: number
  /** Every confirmed booking — the same number as `seats.attending`. */
  bookedCount: number
  /** Online plus buffer seats; the waitlist is not a seat. */
  attendanceCapacity: number
  seats: SeatCounts
  attendees: ClassAttendee[]
  /** The class's line in queue order, with whether each member could pay now. */
  waitlist: WaitlistPanelRow[]
  /** The studio's waitlist switch. Off, the line above still lists and can be worked. */
  waitlistEnabled: boolean
  checkInState: SessionCheckInState
  createdAt: Date
  scheduledBy: NamedRef | null
  /** The Class Series that created this class, if any. */
  seriesId: string | null
}

export async function getClassDetail(tenantId: string, id: string): Promise<ClassDetail> {
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
      instructorPaySgd: classes.instructorPaySgd,
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
      seriesId: classes.seriesId,
    })
    .from(classes)
    .leftJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .leftJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
    .leftJoin(locations, eq(locations.id, classes.locationId))
    .leftJoin(rooms, eq(rooms.id, classes.roomId))
    .leftJoin(creator, eq(creator.id, classes.createdByStaffId))
    .where(and(eq(classes.tenantId, tenantId), eq(classes.id, id)))
    .limit(1)
  if (!row) throw new NotFoundError('class_not_found')

  const seats = await countSeats(db, tenantId, id)

  // Roster (admin-restructure.md §10): the confirmed attendees and the no-shows.
  // A no-show is a decision on the roster, not a departure from it — leaving it
  // off would hide the row it was made on.
  const attendeeRows = await db
    .select({
      bookingId: bookings.id,
      clientId: bookings.clientId,
      clientName: clients.name,
      packageKind: clientPackages.kind,
      creditsUsed: bookings.creditsOrSessionsUsed,
      checkInState: bookings.checkInState,
      code: bookings.code,
      seat: bookings.seat,
      promotedEntryId: waitlistEntries.id,
    })
    .from(bookings)
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .leftJoin(clientPackages, eq(clientPackages.id, bookings.clientPackageId))
    .leftJoin(
      waitlistEntries,
      and(eq(waitlistEntries.tenantId, bookings.tenantId), eq(waitlistEntries.bookingId, bookings.id)),
    )
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.classId, id),
        inArray(bookings.state, ['confirmed', 'no_show']),
      ),
    )
    .orderBy(bookings.bookedAt)
  const attendees: ClassAttendee[] = attendeeRows.map(r => ({
    bookingId: r.bookingId,
    client: { id: r.clientId, name: r.clientName ?? 'Member' },
    packageKind: (r.packageKind as ClientPackageKind | null) ?? null,
    creditsUsed: r.creditsUsed ?? 0,
    checkInState: r.checkInState as ClassAttendee['checkInState'],
    code: r.code,
    seat: r.seat,
    promotedFromWaitlist: r.promotedEntryId !== null,
  }))

  const waitlist = await waitlistPanel(tenantId, {
    id: row.id,
    locationId: row.locationId,
    startsAt: row.startsAt,
    creditCost: row.creditCost,
  })

  const supportingRows = await db
    .select({
      instructorId: classSupportingInstructors.instructorId,
      name: staffUsers.name,
      paySgd: classSupportingInstructors.paySgd,
    })
    .from(classSupportingInstructors)
    .leftJoin(staffUsers, eq(staffUsers.id, classSupportingInstructors.instructorId))
    .where(
      and(
        eq(classSupportingInstructors.tenantId, tenantId),
        eq(classSupportingInstructors.classId, id),
      ),
    )
  const supportingInstructors = supportingRows
    .map(r => ({
      id: r.instructorId,
      name: r.name ?? 'Instructor',
      paySgd: r.paySgd == null ? null : Number(r.paySgd),
    }))
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
    instructorPaySgd: row.instructorPaySgd == null ? null : Number(row.instructorPaySgd),
    supportingInstructorIds,
    supportingInstructors,
    location: row.locationName ? { id: row.locationId, name: row.locationName } : null,
    room: row.roomId && row.roomName ? { id: row.roomId, name: row.roomName } : null,
    capacityOnline: row.capacityOnline,
    capacityWaitlist: row.capacityWaitlist,
    capacityBuffer: row.capacityBuffer,
    creditCost: row.creditCost,
    bookedCount: seats.attending,
    attendanceCapacity: attendanceCapacity(row),
    seats,
    attendees,
    waitlist,
    waitlistEnabled: waitlistEnabled(tenantId),
    checkInState: sessionCheckInState(attendees.map(a => a.checkInState)),
    createdAt: row.createdAt,
    scheduledBy:
      row.scheduledById && row.scheduledByName
        ? { id: row.scheduledById, name: row.scheduledByName }
        : null,
    seriesId: row.seriesId,
  }
}

/**
 * A class's detail for the instructor teaching it — the same read as the
 * admin's, refused for a class the caller is not the main instructor of (the
 * ownership rule check-in and class cancellation use).
 */
export async function getOwnClassDetail(
  tenantId: string,
  id: string,
  instructorStaffId: string,
): Promise<ClassDetail> {
  const detail = await getClassDetail(tenantId, id)
  if (detail.mainInstructorId !== instructorStaffId) {
    throw new ForbiddenError('not_your_session', { message: 'This class is not one you are teaching.' })
  }
  return detail
}

export interface PtSessionAttendee {
  id: string
  name: string
  code: string | null
  checkInState: 'pending' | 'attended' | 'no_show' | 'n_a' | null
}

export interface PtSessionDetail {
  id: string
  /** Null once the member who requested it is permanently deleted (#144). */
  ptRequestId: string | null
  lifecycle: 'active' | 'cancelled'
  startsAt: Date
  endsAt: Date
  sessionType: '1on1' | '2on1'
  instructor: NamedRef | null
  mainInstructorId: string
  instructorPaySgd: number | null
  supportingInstructorIds: string[]
  supportingInstructors: (NamedRef & { paySgd: number | null })[]
  location: NamedRef | null
  room: NamedRef | null
  capacityOnline: number
  capacityWaitlist: number
  capacityBuffer: number
  clients: PtSessionAttendee[]
  checkInState: SessionCheckInState
}

export async function getPtSessionDetail(
  tenantId: string,
  id: string,
): Promise<PtSessionDetail> {
  const [row] = await db
    .select({
      id: ptSessions.id,
      ptRequestId: ptSessions.ptRequestId,
      lifecycle: ptSessions.lifecycle,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
      sessionType: ptSessions.sessionType,
      capacityOnline: ptSessions.capacityOnline,
      capacityWaitlist: ptSessions.capacityWaitlist,
      capacityBuffer: ptSessions.capacityBuffer,
      instructorId: ptSessions.instructorId,
      instructorName: staffUsers.name,
      instructorPaySgd: ptSessions.instructorPaySgd,
      locationId: ptSessions.locationId,
      locationName: locations.name,
      roomId: ptSessions.roomId,
      roomName: rooms.name,
    })
    .from(ptSessions)
    .leftJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .leftJoin(locations, eq(locations.id, ptSessions.locationId))
    .leftJoin(rooms, eq(rooms.id, ptSessions.roomId))
    .where(and(eq(ptSessions.tenantId, tenantId), eq(ptSessions.id, id)))
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
    .where(
      and(eq(ptSessionClients.tenantId, tenantId), eq(ptSessionClients.ptSessionId, id)),
    )

  const attendees: PtSessionAttendee[] = clientRows.map(c => ({
    id: c.id,
    name: c.name,
    code: c.code ?? null,
    checkInState: (c.checkInState as PtSessionAttendee['checkInState']) ?? null,
  }))

  const supportingRows = await db
    .select({
      instructorId: ptSessionSupportingInstructors.instructorId,
      name: staffUsers.name,
      paySgd: ptSessionSupportingInstructors.paySgd,
    })
    .from(ptSessionSupportingInstructors)
    .leftJoin(staffUsers, eq(staffUsers.id, ptSessionSupportingInstructors.instructorId))
    .where(
      and(
        eq(ptSessionSupportingInstructors.tenantId, tenantId),
        eq(ptSessionSupportingInstructors.ptSessionId, id),
      ),
    )
  const supportingInstructors = supportingRows
    .map(r => ({
      id: r.instructorId,
      name: r.name ?? 'Instructor',
      paySgd: r.paySgd == null ? null : Number(r.paySgd),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const supportingInstructorIds = supportingInstructors.map(s => s.id)

  return {
    id: row.id,
    ptRequestId: row.ptRequestId,
    lifecycle: row.lifecycle as PtSessionDetail['lifecycle'],
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    sessionType: row.sessionType as PtSessionDetail['sessionType'],
    instructor: row.instructorName ? { id: row.instructorId, name: row.instructorName } : null,
    mainInstructorId: row.instructorId,
    instructorPaySgd: row.instructorPaySgd == null ? null : Number(row.instructorPaySgd),
    supportingInstructorIds,
    supportingInstructors,
    location: row.locationName ? { id: row.locationId, name: row.locationName } : null,
    room: row.roomId && row.roomName ? { id: row.roomId, name: row.roomName } : null,
    capacityOnline: row.capacityOnline,
    capacityWaitlist: row.capacityWaitlist,
    capacityBuffer: row.capacityBuffer,
    clients: attendees,
    checkInState: sessionCheckInState(attendees.map(a => a.checkInState)),
  }
}
