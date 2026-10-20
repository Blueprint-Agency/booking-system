import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { classpassInboundEmails } from '../../db/schema'
import type { ClassPassEmailKind, ClassPassEmailOutcome, ClassPassReviewReason } from '../../db/enums'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { placeClassPassBooking } from './import-booking'
import { mapClassPassLocationName, type ClassPassLocationMapping } from './locations'
import { parseClassPassBooking } from './parse'
import { isOpen, OPEN_OUTCOMES, recordPlaced } from './review-items'

/**
 * ClassPass review (#413): the ClassPass emails the importer could not place,
 * open until an Admin closes each one.
 *
 * An open item is a kept email with an outcome of `review` or `unparsed` and
 * no `resolved_at`: a booking it could not place, one kept while the import
 * was off (`import_off`, a cancellation too), or one whose placing failed. An
 * Admin closes it by booking it into a class they pick (through the same
 * ClassPass booking path as the importer), by dismissing it, or by mapping its
 * location, which re-runs the import on every open item from that location.
 * Closing records who and when.
 */

export type ClassPassReviewItem = {
  id: string
  kind: ClassPassEmailKind
  receivedAt: Date
  subject: string
  outcome: ClassPassEmailOutcome
  reason: ClassPassReviewReason | null
  reservationId: string | null
  className: string | null
  locationName: string | null
  startsAt: Date | null
  memberName: string | null
  memberEmail: string | null
  text: string | null
  html: string | null
  bookingId: string | null
  resolvedAt: Date | null
  resolvedByStaffId: string | null
}

const columns = {
  id: classpassInboundEmails.id,
  kind: classpassInboundEmails.kind,
  receivedAt: classpassInboundEmails.receivedAt,
  subject: classpassInboundEmails.subject,
  outcome: classpassInboundEmails.outcome,
  reason: classpassInboundEmails.reviewReason,
  reservationId: classpassInboundEmails.reservationId,
  className: classpassInboundEmails.className,
  locationName: classpassInboundEmails.locationName,
  startsAt: classpassInboundEmails.startsAt,
  memberName: classpassInboundEmails.memberName,
  memberEmail: classpassInboundEmails.memberEmail,
  text: classpassInboundEmails.text,
  html: classpassInboundEmails.html,
  bookingId: classpassInboundEmails.bookingId,
  resolvedAt: classpassInboundEmails.resolvedAt,
  resolvedByStaffId: classpassInboundEmails.resolvedByStaffId,
}

/** Every open item, oldest first. */
export async function listClassPassReview(tenantId: string): Promise<ClassPassReviewItem[]> {
  return db
    .select(columns)
    .from(classpassInboundEmails)
    .where(and(eq(classpassInboundEmails.tenantId, tenantId), isOpen))
    .orderBy(asc(classpassInboundEmails.receivedAt), asc(classpassInboundEmails.id))
}

async function readItem(tenantId: string, id: string): Promise<ClassPassReviewItem> {
  const [row] = await db
    .select(columns)
    .from(classpassInboundEmails)
    .where(and(eq(classpassInboundEmails.tenantId, tenantId), eq(classpassInboundEmails.id, id)))
  if (!row) throw new NotFoundError('classpass_review_not_found')
  return row
}

/** The open item, locked so two Admins cannot both close it; refused when it is not open. */
async function lockOpenItem(tenantId: string, id: string) {
  const [row] = await db
    .select({
      id: classpassInboundEmails.id,
      kind: classpassInboundEmails.kind,
      outcome: classpassInboundEmails.outcome,
      resolvedAt: classpassInboundEmails.resolvedAt,
      text: classpassInboundEmails.text,
      html: classpassInboundEmails.html,
      locationName: classpassInboundEmails.locationName,
    })
    .from(classpassInboundEmails)
    .where(and(eq(classpassInboundEmails.tenantId, tenantId), eq(classpassInboundEmails.id, id)))
    .for('update')
  if (!row) throw new NotFoundError('classpass_review_not_found')
  if (row.resolvedAt || !OPEN_OUTCOMES.includes(row.outcome)) throw new ConflictError('classpass_review_resolved')
  return row
}

/**
 * Books the item's member into the class the Admin picked, as a ClassPass
 * booking with the email's reservation ID. Booking needs only what the class
 * does not give: the reservation ID and the member's name and email; the time
 * and location are the class's. The member is found by email or created, as
 * the importer does. Refused when the item is not a booking
 * (`classpass_review_not_booking`), the email did not name the reservation and
 * the member (`classpass_review_incomplete`), the reservation is already a
 * booking here (`classpass_reservation_taken`), the member is already on the
 * class (`already_booked`), their record was removed
 * (`classpass_client_deleted`), or the class is not this studio's active one
 * (`class_not_found`).
 */
export async function bookClassPassReviewItem(
  tenantId: string,
  id: string,
  classId: string,
  staffId: string,
): Promise<ClassPassReviewItem> {
  const item = await lockOpenItem(tenantId, id)
  if (item.kind !== 'booking') throw new BadRequestError('classpass_review_not_booking')
  const placed = await placeClassPassBooking(tenantId, parseClassPassBooking(item), { classId })
  if (placed.outcome === 'unparsed') throw new BadRequestError('classpass_review_incomplete')
  if (placed.outcome === 'review') {
    throw placed.reason === 'already_booked'
      ? new ConflictError('already_booked')
      : new ConflictError('classpass_client_deleted')
  }
  await recordPlaced(tenantId, id, placed, staffId)
  return readItem(tenantId, id)
}

/** Closes the item and books nothing. */
export async function dismissClassPassReviewItem(tenantId: string, id: string, staffId: string): Promise<ClassPassReviewItem> {
  await lockOpenItem(tenantId, id)
  await db
    .update(classpassInboundEmails)
    .set({ resolvedAt: new Date(), resolvedByStaffId: staffId })
    .where(and(eq(classpassInboundEmails.tenantId, tenantId), eq(classpassInboundEmails.id, id)))
  return readItem(tenantId, id)
}

/**
 * Maps the item's location, as ClassPass wrote it, to one of the studio's
 * Locations (`mapClassPassLocationName`: a mapping already there to that same
 * Location is used as it is), which runs the import again on every open item
 * from that location. Returns the mapping and what became of each item it
 * re-ran.
 */
export async function mapClassPassReviewLocation(
  tenantId: string,
  id: string,
  locationId: string,
  staffId: string,
): Promise<{ mapping: ClassPassLocationMapping; items: ClassPassReviewItem[] }> {
  const item = await lockOpenItem(tenantId, id)
  if (!item.locationName) throw new BadRequestError('classpass_review_incomplete')
  const { mapping, rerun } = await mapClassPassLocationName(tenantId, { locationName: item.locationName, locationId }, staffId)
  const items = rerun.length
    ? await db
        .select(columns)
        .from(classpassInboundEmails)
        .where(and(eq(classpassInboundEmails.tenantId, tenantId), inArray(classpassInboundEmails.id, rerun)))
        .orderBy(asc(classpassInboundEmails.receivedAt), asc(classpassInboundEmails.id))
    : []
  return { mapping, items }
}
