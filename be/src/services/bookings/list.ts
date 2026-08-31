/**
 * Client-facing read of a member's own class bookings. See be-client.md §3.
 *
 *   - upcoming: state='confirmed' AND class.starts_at >= now  (cancel + QR affordances)
 *   - past:     class.starts_at < now AND state IN ('confirmed','no_show')  (check-in badge)
 *
 * Cancelled bookings are terminal and not surfaced in either tab (spec §8.3: Upcoming/Past).
 */
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { classes } from '../../db/schema/schedule'
import { classTypes, locations, rooms } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { clientPackages } from '../../db/schema/packages'
import type { ClientPackageKind } from '../../db/enums'
import { NotFoundError } from '../../shared/errors'

interface NamedRef {
  id: string
  name: string
}

export interface ClassBookingRow {
  bookingId: string
  classId: string
  name: string
  instructor: NamedRef | null
  location: NamedRef | null
  room: NamedRef | null
  startsAt: Date
  endsAt: Date
  creditCost: number
  creditsUsed: number
  packageKind: ClientPackageKind | null
  wasUnlimited: boolean
  checkInState: 'pending' | 'attended' | 'no_show' | 'n_a'
  state: 'confirmed' | 'cancelled' | 'no_show'
  qrToken: string
  code: string
}

const baseSelect = {
  bookingId: bookings.id,
  classId: classes.id,
  name: classTypes.name,
  instructorId: classes.mainInstructorId,
  instructorName: staffUsers.name,
  locationId: locations.id,
  locationName: locations.name,
  roomId: rooms.id,
  roomName: rooms.name,
  startsAt: classes.startsAt,
  endsAt: classes.endsAt,
  creditCost: classes.creditCost,
  creditsUsed: bookings.creditsOrSessionsUsed,
  packageKind: clientPackages.kind,
  checkInState: bookings.checkInState,
  state: bookings.state,
  qrToken: bookings.qrToken,
  code: bookings.code,
}

type Raw = {
  bookingId: string
  classId: string
  name: string | null
  instructorId: string
  instructorName: string | null
  locationId: string
  locationName: string | null
  roomId: string | null
  roomName: string | null
  startsAt: Date
  endsAt: Date
  creditCost: number
  creditsUsed: number | null
  packageKind: string | null
  checkInState: string
  state: string
  qrToken: string
  code: string
}

function toRow(r: Raw): ClassBookingRow {
  const used = r.creditsUsed ?? 0
  return {
    bookingId: r.bookingId,
    classId: r.classId,
    name: r.name ?? 'Class',
    instructor: r.instructorName ? { id: r.instructorId, name: r.instructorName } : null,
    location: r.locationName ? { id: r.locationId, name: r.locationName } : null,
    room: r.roomId && r.roomName ? { id: r.roomId, name: r.roomName } : null,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    creditCost: r.creditCost,
    creditsUsed: used,
    packageKind: (r.packageKind as ClientPackageKind | null) ?? null,
    wasUnlimited: r.packageKind === 'unlimited' || (used === 0 && r.packageKind === null),
    checkInState: r.checkInState as ClassBookingRow['checkInState'],
    state: r.state as ClassBookingRow['state'],
    qrToken: r.qrToken,
    code: r.code,
  }
}

export async function listClassBookings(
  tenantId: string,
  clientId: string,
  scope: 'upcoming' | 'past',
): Promise<ClassBookingRow[]> {
  const now = new Date()
  const where =
    scope === 'upcoming'
      ? and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.clientId, clientId),
          eq(bookings.kind, 'class'),
          eq(bookings.state, 'confirmed'),
          gte(classes.startsAt, now),
        )
      : and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.clientId, clientId),
          eq(bookings.kind, 'class'),
          inArray(bookings.state, ['confirmed', 'no_show']),
          lt(classes.startsAt, now),
        )

  const rows = (await db
    .select(baseSelect)
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .leftJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .leftJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
    .leftJoin(locations, eq(locations.id, classes.locationId))
    .leftJoin(rooms, eq(rooms.id, classes.roomId))
    .leftJoin(clientPackages, eq(clientPackages.id, bookings.clientPackageId))
    .where(where)
    .orderBy(scope === 'upcoming' ? asc(classes.startsAt) : desc(classes.startsAt))) as Raw[]

  return rows.map(toRow)
}

export async function getClassBookingDetail(
  tenantId: string,
  clientId: string,
  bookingId: string,
): Promise<ClassBookingRow> {
  const [row] = (await db
    .select(baseSelect)
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .leftJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .leftJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
    .leftJoin(locations, eq(locations.id, classes.locationId))
    .leftJoin(rooms, eq(rooms.id, classes.roomId))
    .leftJoin(clientPackages, eq(clientPackages.id, bookings.clientPackageId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.id, bookingId),
        eq(bookings.clientId, clientId),
        eq(bookings.kind, 'class'),
      ),
    )
    .limit(1)) as Raw[]
  if (!row) throw new NotFoundError('booking_not_found')
  return toRow(row)
}
