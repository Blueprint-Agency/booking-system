import { and, eq, sql } from 'drizzle-orm'
import { afterCommit, db } from '../../db'
import { bookings, classes, classpassLocationMappings, classTypes, clients } from '../../db/schema'
import type { ClassPassEmailOutcome, ClassPassReviewReason } from '../../db/enums'
import { AppError, ConflictError, NotFoundError } from '../../shared/errors'
import { classPassBookClass } from '../bookings/book'
import { createClient } from '../clients/manage'
import { emailEveryAdmin } from '../notifications/send'
import { sessionTimeFormat } from '../notifications/send-booking-email'
import { zonedInstant } from '../schedule/series-dates'
import { loadTenantById } from '../tenants/tenants'
import { requireTenantUrl } from '../tenants/urls'
import { normaliseClassPassLocation } from './location-name'
import { isComplete, type ClassPassBookingFields } from './parse'

/**
 * Placing a ClassPass booking email: what the email says, which class
 * and member it means, and the ClassPass booking it makes.
 *
 * - The location goes through the studio's ClassPass location mapping.
 * - The class is the active one at that Location starting at the email's time,
 *   read in the studio's timezone. Two or more: the one whose Class Type name
 *   is ClassPass's class name, ignoring case.
 * - The member is found by email at this studio, or created with no phone and
 *   sent nothing.
 * - The booking is a ClassPass booking (`classPassBookClass`). One that took an
 *   Overbook seat emails every Admin once the transaction commits.
 *
 * What it can't place it books nothing for, and says why (`reason`), for
 * ClassPass review. Runs in the caller's Tenant transaction.
 */

export type PlacedBooking = {
  outcome: ClassPassEmailOutcome
  reason: ClassPassReviewReason | null
  fields: ClassPassBookingFields
  startsAt: Date | null
  clientId: string | null
  bookingId: string | null
}

type ClassMatch = { classId: string } | { reason: ClassPassReviewReason }

/** A class at a Location and start, as `pickClass` chooses among them. */
export type ClassAtTime = { id: string; lifecycle: string; typeName: string }

/** The class at `locationId` starting at `startsAt` that ClassPass means. */
async function matchClass(tenantId: string, locationId: string, startsAt: Date, className: string): Promise<ClassMatch> {
  const found = await db
    .select({ id: classes.id, lifecycle: classes.lifecycle, typeName: classTypes.name })
    .from(classes)
    .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .where(and(eq(classes.tenantId, tenantId), eq(classes.locationId, locationId), eq(classes.startsAt, startsAt)))
  return pickClass(found, className)
}

/**
 * Which of the classes at one Location and start ClassPass's `className`
 * means: the one active class, or of several the one whose Class Type has that
 * name, ignoring case. The roster check chooses with it too.
 */
export function pickClass(found: ClassAtTime[], className: string): ClassMatch {
  const active = found.filter(c => c.lifecycle === 'active')
  if (active.length === 1) return { classId: active[0]!.id }
  if (active.length > 1) {
    const named = active.filter(c => c.typeName.trim().toLowerCase() === className.trim().toLowerCase())
    return named.length === 1 ? { classId: named[0]!.id } : { reason: 'ambiguous_class' }
  }
  return { reason: found.length > 0 ? 'class_cancelled' : 'no_class' }
}

/** The member with this email here, made when there is none; or why they can't be booked. */
async function memberFor(
  tenantId: string,
  name: string,
  email: string,
): Promise<{ clientId: string } | { reason: ClassPassReviewReason }> {
  const [existing] = await db
    .select({ id: clients.id, deletedAt: clients.deletedAt })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), sql`lower(${clients.email}) = ${email}`))
    .limit(1)
  if (existing) return existing.deletedAt ? { reason: 'client_deleted' } : { clientId: existing.id }
  // ClassPass gives no phone, and has already confirmed the booking with them:
  // no invitation, no welcome.
  const created = await createClient({ tenantId, name, email, phone: '', phoneUnknown: true, sendInvite: false })
  return { clientId: created.id }
}

/** When the Admin's picked class starts: this studio's active class, or `class_not_found`. */
async function activeClassStart(tenantId: string, classId: string): Promise<Date> {
  const [cls] = await db
    .select({ startsAt: classes.startsAt })
    .from(classes)
    .where(and(eq(classes.tenantId, tenantId), eq(classes.id, classId), eq(classes.lifecycle, 'active')))
  if (!cls) throw new NotFoundError('class_not_found')
  return cls.startsAt
}

/** The class at the email's mapped Location and time, or why there is none. */
async function classFor(tenantId: string, fields: { locationName: string; className: string }, startsAt: Date): Promise<ClassMatch> {
  const [mapping] = await db
    .select({ locationId: classpassLocationMappings.locationId })
    .from(classpassLocationMappings)
    .where(
      and(
        eq(classpassLocationMappings.tenantId, tenantId),
        eq(classpassLocationMappings.locationName, normaliseClassPassLocation(fields.locationName)),
      ),
    )
  if (!mapping) return { reason: 'unmapped_location' }
  return matchClass(tenantId, mapping.locationId, startsAt, fields.className)
}

/**
 * `fields` is what `parseClassPassBooking` read from the email.
 *
 * `classId` is a class an Admin picked in ClassPass review, booked in
 * place of the one the email's Location and time would match. Then a
 * reservation already booked here is refused `classpass_reservation_taken`
 * rather than taken as the same email again, and a class that is not this
 * studio's active one is refused `class_not_found`. The class gives the time
 * and place, so the email need only name the reservation and the member.
 */
export async function placeClassPassBooking(
  tenantId: string,
  fields: ClassPassBookingFields,
  options: { classId?: string } = {},
): Promise<PlacedBooking> {
  const placed = { fields, startsAt: null as Date | null, clientId: null as string | null, bookingId: null as string | null }
  const review = (reason: ClassPassReviewReason) => ({ ...placed, outcome: 'review' as const, reason })
  const unparsed = { ...placed, outcome: 'unparsed' as const, reason: 'unparsed' as const }

  const { reservationId, memberName, memberEmail } = fields
  if (!reservationId || !memberName || !memberEmail) return unparsed

  // This reservation is already a booking here: the same booking forwarded twice.
  const [held] = await db
    .select({ id: bookings.id, clientId: bookings.clientId })
    .from(bookings)
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.classpassReservationId, reservationId)))
  if (held && options.classId) throw new ConflictError('classpass_reservation_taken', { booking_id: held.id })

  let match: ClassMatch
  if (options.classId) {
    placed.startsAt = await activeClassStart(tenantId, options.classId)
    match = { classId: options.classId }
  } else {
    if (!isComplete(fields)) return unparsed
    const tenant = await loadTenantById(tenantId)
    placed.startsAt = zonedInstant(fields.localDate, fields.localTime, tenant?.timezone ?? 'UTC')
    if (held) return { ...placed, clientId: held.clientId, bookingId: held.id, outcome: 'noop', reason: null }
    match = await classFor(tenantId, fields, placed.startsAt)
  }
  if ('reason' in match) return review(match.reason)

  const who = await memberFor(tenantId, memberName, memberEmail)
  if ('reason' in who) return review(who.reason)
  placed.clientId = who.clientId

  let booked
  try {
    booked = await classPassBookClass(tenantId, {
      clientId: who.clientId,
      classId: match.classId,
      reservationId,
    })
  } catch (err) {
    if (err instanceof AppError && err.code === 'already_booked') return review('already_booked')
    throw err
  }
  placed.bookingId = booked.bookingId

  if (booked.seat === 'overbook') {
    const classId = match.classId
    // Invariant: set above from the class or the email before anything is booked.
    const startsAt = placed.startsAt!
    afterCommit(() =>
      emailEveryAdmin(
        tenantId,
        'classpass_overbooked',
        async () => {
          const [cls] = await db
            .select({ name: classTypes.name })
            .from(classes)
            .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
            .where(and(eq(classes.tenantId, tenantId), eq(classes.id, classId)))
          return {
            client_name: memberName,
            class_name: cls?.name ?? fields.className ?? '',
            date: (await sessionTimeFormat(tenantId)).format(startsAt),
            classpass_url: `${await requireTenantUrl('portal', tenantId)}/admin/classpass`,
          }
        },
        { scope: 'classpass-overbooked', classId },
      ),
    )
  }

  return { ...placed, outcome: 'imported', reason: null }
}
