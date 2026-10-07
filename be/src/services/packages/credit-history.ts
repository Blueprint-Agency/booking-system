/**
 * A package's Credit history (#353): its Credit movements, newest first, each
 * with the booking it was for and who made it. One read for both readers — the
 * member's My packages and the staff profile — which differ only in what the
 * route lets out (a staff member's name and note are staff-only).
 */
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages } from '../../db/schema/packages'
import { creditMovements } from '../../db/schema/ledger'
import { bookings, cancellations } from '../../db/schema/bookings'
import { classes, ptSessions } from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { NotFoundError } from '../../shared/errors'
import type { CreditMovementActor, CreditMovementCause } from './ledger'

export interface CreditMovementView {
  id: string
  at: Date
  cause: Exclude<CreditMovementCause, 'opening'>
  delta: number
  balanceAfter: number | null
  actor: CreditMovementActor
  booking: {
    id: string
    kind: 'class' | 'workshop' | 'pt'
    title: string | null
    startsAt: Date | null
    /** On a `kept` row: whether its cancel was a Late cancel (else over the cap, or staff's Keep). */
    cancelledLate: boolean | null
  } | null
  staffName: string | null
  note: string | null
}

export interface CreditHistory {
  /** Where the record starts: the migration's `opening` row, else the purchase. */
  historyFrom: Date
  movements: CreditMovementView[]
}

/** The member's own package's history. Another member's, or another studio's, is not found. */
export async function creditHistory(tenantId: string, clientId: string, clientPackageId: string): Promise<CreditHistory> {
  const [pkg] = await db
    .select({ purchasedAt: clientPackages.purchasedAt })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.id, clientPackageId),
        eq(clientPackages.clientId, clientId),
      ),
    )
    .limit(1)
  if (!pkg) throw new NotFoundError('client_package_not_found')

  const rows = await db
    .select({
      id: creditMovements.id,
      at: creditMovements.createdAt,
      cause: creditMovements.cause,
      delta: creditMovements.delta,
      balanceAfter: creditMovements.balanceAfter,
      actor: creditMovements.actor,
      note: creditMovements.note,
      staffName: staffUsers.name,
      bookingId: bookings.id,
      bookingKind: bookings.kind,
      classTitle: classTypes.name,
      classStartsAt: classes.startsAt,
      ptStartsAt: ptSessions.startsAt,
      wasWithinWindow: cancellations.wasWithinWindow,
    })
    .from(creditMovements)
    .leftJoin(bookings, eq(bookings.id, creditMovements.bookingId))
    .leftJoin(classes, eq(classes.id, bookings.classId))
    .leftJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .leftJoin(ptSessions, eq(ptSessions.id, bookings.ptSessionId))
    .leftJoin(staffUsers, eq(staffUsers.id, creditMovements.actedByStaffId))
    // A kept credit's cancel: was it a Late cancel, or over the cap? A booking is cancelled once.
    .leftJoin(
      cancellations,
      and(eq(cancellations.bookingId, creditMovements.bookingId), eq(creditMovements.cause, 'kept')),
    )
    .where(and(eq(creditMovements.tenantId, tenantId), eq(creditMovements.clientPackageId, clientPackageId)))
    .orderBy(desc(creditMovements.createdAt), desc(creditMovements.id))

  const opening = rows.find(r => r.cause === 'opening')
  return {
    historyFrom: opening?.at ?? pkg.purchasedAt,
    movements: rows.flatMap(r =>
      r.cause === 'opening'
        ? []
        : [
            {
              id: r.id,
              at: r.at,
              cause: r.cause,
              delta: r.delta,
              balanceAfter: r.balanceAfter,
              actor: r.actor,
              booking: r.bookingId
                ? {
                    id: r.bookingId,
                    kind: r.bookingKind!,
                    title: r.bookingKind === 'class' ? ((r.classTitle as string | null) ?? null) : null,
                    startsAt: r.classStartsAt ?? r.ptStartsAt,
                    cancelledLate: r.wasWithinWindow === null ? null : !r.wasWithinWindow,
                  }
                : null,
              staffName: r.staffName,
              note: r.note,
            },
          ],
    ),
  }
}

/**
 * The wire shape. `staff` adds who acted and the adjustment's reason — a
 * staff member's name and free text are the studio's, never the member's to read.
 */
export function serializeCreditHistory(h: CreditHistory, audience: 'member' | 'staff') {
  return {
    history_from: h.historyFrom,
    movements: h.movements.map(m => ({
      id: m.id,
      at: m.at,
      cause: m.cause,
      delta: m.delta,
      balance_after: m.balanceAfter,
      actor: m.actor,
      booking: m.booking && {
        id: m.booking.id,
        kind: m.booking.kind,
        title: m.booking.title,
        starts_at: m.booking.startsAt,
        cancelled_late: m.booking.cancelledLate,
      },
      ...(audience === 'staff' ? { staff_name: m.staffName, note: m.note } : {}),
    })),
  }
}
