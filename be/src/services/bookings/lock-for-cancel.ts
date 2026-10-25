import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { classes, ptRequests, ptSessions } from '../../db/schema/schedule'

/**
 * Lock, for the rest of the transaction, what cancelling these bookings and PT
 * requests will lock, in the standard order: a PT request before its session, a
 * class or session before its booking, each kind in id order. A member's cancel
 * of one of them takes the package last, so a pass that holds their package
 * from its first cancel on (a Refund's Void, a Complimentary Package's Remove)
 * takes this before it.
 */
export async function lockForCancel(
  tenantId: string,
  targets: { bookingIds: readonly string[]; ptRequestIds?: readonly string[] },
): Promise<void> {
  const bookingIds = [...targets.bookingIds]
  const seats = bookingIds.length
    ? await db
        .select({ classId: bookings.classId, ptSessionId: bookings.ptSessionId, ptRequestId: ptSessions.ptRequestId })
        .from(bookings)
        .leftJoin(ptSessions, and(eq(ptSessions.tenantId, bookings.tenantId), eq(ptSessions.id, bookings.ptSessionId)))
        .where(and(eq(bookings.tenantId, tenantId), inArray(bookings.id, bookingIds)))
    : []
  const requested = targets.ptRequestIds?.length
    ? await db
        .select({ ptSessionId: ptRequests.scheduledPtSessionId })
        .from(ptRequests)
        .where(and(eq(ptRequests.tenantId, tenantId), inArray(ptRequests.id, [...targets.ptRequestIds])))
    : []

  const requestIds = distinct([...(targets.ptRequestIds ?? []), ...seats.map(s => s.ptRequestId)])
  const sessionIds = distinct([...requested.map(r => r.ptSessionId), ...seats.map(s => s.ptSessionId)])
  const classIds = distinct(seats.map(s => s.classId))

  if (requestIds.length) {
    await db
      .select({ id: ptRequests.id })
      .from(ptRequests)
      .where(and(eq(ptRequests.tenantId, tenantId), inArray(ptRequests.id, requestIds)))
      .orderBy(ptRequests.id)
      .for('update')
  }
  if (sessionIds.length) {
    await db
      .select({ id: ptSessions.id })
      .from(ptSessions)
      .where(and(eq(ptSessions.tenantId, tenantId), inArray(ptSessions.id, sessionIds)))
      .orderBy(ptSessions.id)
      .for('update')
  }
  if (classIds.length) {
    await db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.tenantId, tenantId), inArray(classes.id, classIds)))
      .orderBy(classes.id)
      .for('update')
  }
  if (bookingIds.length) {
    await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), inArray(bookings.id, bookingIds)))
      .orderBy(bookings.id)
      .for('update')
  }
}

function distinct(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))]
}
