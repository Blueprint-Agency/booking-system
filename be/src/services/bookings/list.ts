/**
 * Client-facing read of a member's own class bookings. See be-client.md §3.
 *
 *   - upcoming:  state='confirmed' AND class.starts_at >= now  (cancel + QR affordances)
 *   - past:      class.starts_at < now, not cancelled  (attended, no-show, or held unticked)
 *   - cancelled: state='cancelled', any start time, newest cancellation first
 *
 * Past holds only what was held. A cancelled booking is on Cancelled from the
 * moment it is cancelled, with the summary of its cancellation
 * (`cancellation-summary.ts`) — fe-client-features §8.3, #349.
 */
import { and, asc, desc, eq, gte, lt, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { bookings, cancellations } from '../../db/schema/bookings'
import { classes } from '../../db/schema/schedule'
import { classTypes, locations, rooms } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { clientPackages } from '../../db/schema/packages'
import type { ClientPackageKind } from '../../db/enums'
import { now as clockNow } from '../../lib/clock'
import { NotFoundError } from '../../shared/errors'
import { cancelWindowResolver, type HasCancelWindow } from '../policy/cancel-window'
import { cancellationRecord, summarizeCancellation, type CancellationSummary } from './cancellation-summary'

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
  /** The class's Cancellation Window in hours, read now — its own, else the studio's. */
  effectiveCancelWindowHours: number
  /** When that window opens: a cancel after this instant is a Late cancel (#318). */
  cancelDeadline: Date
  /** The class's own window, null for the studio's — what a cancel is judged by. */
  cancelWindowHours: number | null
  /** The package that paid; null when none did. */
  clientPackageId: string | null
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
  cancelWindowHours: classes.cancelWindowHours,
  creditsUsed: bookings.creditsOrSessionsUsed,
  clientPackageId: bookings.clientPackageId,
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
  cancelWindowHours: number | null
  creditsUsed: number | null
  clientPackageId: string | null
  packageKind: string | null
  checkInState: string
  state: string
  qrToken: string
  code: string
}

const HOUR_MS = 3_600_000

function toRow(r: Raw, windowOf: (cls: HasCancelWindow) => number): ClassBookingRow {
  const used = r.creditsUsed ?? 0
  const windowHours = windowOf(r)
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
    effectiveCancelWindowHours: windowHours,
    cancelDeadline: new Date(r.startsAt.getTime() - windowHours * HOUR_MS),
    cancelWindowHours: r.cancelWindowHours,
    clientPackageId: r.clientPackageId,
  }
}

export async function listClassBookings(
  tenantId: string,
  clientId: string,
  scope: 'upcoming' | 'past',
): Promise<ClassBookingRow[]> {
  const now = clockNow()
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
          ne(bookings.state, 'cancelled'),
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

  const windowOf = await cancelWindowResolver(tenantId)
  return rows.map(r => toRow(r, windowOf))
}

export interface CancelledClassBookingRow extends ClassBookingRow {
  cancellation: CancellationSummary
}

/** The member's cancelled class bookings, whatever their start time, newest cancellation first. */
export async function listCancelledClassBookings(
  tenantId: string,
  clientId: string,
): Promise<CancelledClassBookingRow[]> {
  const cancelledAt = sql<Date | null>`coalesce(${cancellations.cancelledAt}, ${bookings.cancelledAt})`
  const rows = await db
    .select({
      ...baseSelect,
      refundOutcome: bookings.refundOutcome,
      bookingCancelledAt: bookings.cancelledAt,
      recordSource: cancellations.source,
      recordWithinWindow: cancellations.wasWithinWindow,
      recordWithinCap: cancellations.wasWithinCap,
      recordCancelledAt: cancellations.cancelledAt,
    })
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .leftJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .leftJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
    .leftJoin(locations, eq(locations.id, classes.locationId))
    .leftJoin(rooms, eq(rooms.id, classes.roomId))
    .leftJoin(clientPackages, eq(clientPackages.id, bookings.clientPackageId))
    .leftJoin(cancellations, and(eq(cancellations.tenantId, tenantId), eq(cancellations.bookingId, bookings.id)))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.clientId, clientId),
        eq(bookings.kind, 'class'),
        eq(bookings.state, 'cancelled'),
      ),
    )
    .orderBy(sql`${cancelledAt} DESC NULLS LAST`, desc(classes.startsAt))

  const windowOf = await cancelWindowResolver(tenantId)
  return rows.map(r => {
    const row = toRow(r as Raw, windowOf)
    return {
      ...row,
      cancellation: summarizeCancellation({
        kind: 'class',
        refundOutcome: r.refundOutcome,
        creditsUsed: row.creditsUsed,
        bookingCancelledAt: r.bookingCancelledAt,
        record: cancellationRecord({
          source: r.recordSource,
          wasWithinWindow: r.recordWithinWindow,
          wasWithinCap: r.recordWithinCap,
          cancelledAt: r.recordCancelledAt,
        }),
      }),
    }
  })
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
  return toRow(row, await cancelWindowResolver(tenantId))
}
