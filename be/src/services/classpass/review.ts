import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { classpassInboundEmails } from '../../db/schema'
import type { ClassPassEmailOutcome, ClassPassReviewReason } from '../../db/enums'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { placeClassPassBooking, type PlacedBooking } from './import-booking'
import { addClassPassLocationMapping, normaliseClassPassLocation, type ClassPassLocationMapping } from './locations'
import { isComplete, parseClassPassBooking } from './parse'

/**
 * ClassPass review (#413): the ClassPass booking emails the importer could not
 * place, open until an Admin closes each one.
 *
 * An open item is a kept email with an outcome of `review` or `unparsed` and
 * no `resolved_at`. An Admin closes it by booking it into a class they pick
 * (through the same ClassPass booking path as the importer), by dismissing it,
 * or by mapping its location, which re-runs the import on every open item
 * from that location. Closing records who and when.
 */

const OPEN_OUTCOMES: ClassPassEmailOutcome[] = ['review', 'unparsed']

export type ClassPassReviewItem = {
  id: string
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

const isOpen = and(inArray(classpassInboundEmails.outcome, OPEN_OUTCOMES), isNull(classpassInboundEmails.resolvedAt))

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
 * Writes what placing it did. An item that is no longer for review (imported,
 * or found already booked) is closed in the Admin's name.
 */
async function recordPlaced(tenantId: string, id: string, placed: PlacedBooking, staffId: string): Promise<void> {
  const closed = !OPEN_OUTCOMES.includes(placed.outcome)
  await db
    .update(classpassInboundEmails)
    .set({
      outcome: placed.outcome,
      reviewReason: placed.reason,
      startsAt: placed.startsAt,
      clientId: placed.clientId,
      bookingId: placed.bookingId,
      ...(closed ? { resolvedAt: new Date(), resolvedByStaffId: staffId } : {}),
    })
    .where(and(eq(classpassInboundEmails.tenantId, tenantId), eq(classpassInboundEmails.id, id)))
}

/**
 * Books the item's member into the class the Admin picked, as a ClassPass
 * booking with the email's reservation ID. The member is found by email or
 * created, as the importer does. Refused when the email could not be read
 * (`classpass_review_incomplete`), the reservation is already a booking here
 * (`classpass_reservation_taken`), the member is already on the class
 * (`already_booked`), their record was removed (`client_deleted`), or the class
 * is not this studio's active one (`class_not_found`).
 */
export async function bookClassPassReviewItem(
  tenantId: string,
  id: string,
  classId: string,
  staffId: string,
): Promise<ClassPassReviewItem> {
  const item = await lockOpenItem(tenantId, id)
  const fields = parseClassPassBooking(item)
  if (!isComplete(fields)) throw new BadRequestError('classpass_review_incomplete')
  const placed = await placeClassPassBooking(tenantId, fields, { classId })
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
 * Locations, then runs the import again on every open item from that location
 * (spellings that normalise alike included). Each one that now places is
 * booked and closed in the Admin's name; the rest stay open with their new
 * reason. Returns the mapping and what became of each item it re-ran.
 */
export async function mapClassPassReviewLocation(
  tenantId: string,
  id: string,
  locationId: string,
  staffId: string,
): Promise<{ mapping: ClassPassLocationMapping; items: ClassPassReviewItem[] }> {
  const item = await lockOpenItem(tenantId, id)
  if (!item.locationName) throw new BadRequestError('classpass_review_incomplete')
  const mapping = await addClassPassLocationMapping(tenantId, { locationName: item.locationName, locationId })

  const open = await db
    .select({
      id: classpassInboundEmails.id,
      text: classpassInboundEmails.text,
      html: classpassInboundEmails.html,
      locationName: classpassInboundEmails.locationName,
    })
    .from(classpassInboundEmails)
    .where(and(eq(classpassInboundEmails.tenantId, tenantId), isOpen))
    .orderBy(asc(classpassInboundEmails.receivedAt), asc(classpassInboundEmails.id))
    .for('update')
  const fromThere = open.filter(o => o.locationName && normaliseClassPassLocation(o.locationName) === mapping.locationName)

  const items: ClassPassReviewItem[] = []
  for (const o of fromThere) {
    const placed = await placeClassPassBooking(tenantId, parseClassPassBooking(o))
    await recordPlaced(tenantId, o.id, placed, staffId)
    items.push(await readItem(tenantId, o.id))
  }
  return { mapping, items }
}
