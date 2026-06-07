/**
 * Class booking: capacity check + credit deduct in a single transaction.
 * See be-client.md §4a.
 *
 * Package selection (server-side, no client input):
 *   1. An active, non-expired UNLIMITED package — books for free (no debit).
 *   2. Else the soonest-expiring active credit_bundle/trial package with enough
 *      credits — debited by the class credit_cost.
 *   3. Else → 409 insufficient_credits.
 *
 * Concurrency: the class row is locked FOR UPDATE so concurrent bookings for the
 * same class serialise (capacity + double-book checks are race-safe); the
 * client's package rows are locked too so a double-click can't double-debit.
 */
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { classes } from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { clientPackages } from '../../db/schema/packages'
import { generateBookingCodes } from './qr'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export interface BookClassInput {
  clientId: string
  classId: string
}

export interface BookClassResult {
  bookingId: string
  qrToken: string
  code: string
}

export async function bookClass(input: BookClassInput): Promise<BookClassResult> {
  const { clientId, classId } = input

  return db.transaction(async tx => {
    // 1. Lock the class row so capacity is evaluated race-free.
    const [cls] = await tx
      .select({
        id: classes.id,
        startsAt: classes.startsAt,
        capacityOnline: classes.capacityOnline,
        creditCost: classes.creditCost,
        lifecycle: classes.lifecycle,
      })
      .from(classes)
      .where(eq(classes.id, classId))
      .for('update')
      .limit(1)

    if (!cls || cls.lifecycle !== 'active') throw new NotFoundError('class_not_found')
    if (cls.startsAt <= new Date()) throw new BadRequestError('class_already_started')

    // 2. Already booked? (one confirmed booking per client per class)
    const [existing] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.clientId, clientId),
          eq(bookings.classId, classId),
          eq(bookings.state, 'confirmed'),
        ),
      )
      .limit(1)
    if (existing) throw new ConflictError('already_booked')

    // 3. Capacity — online seats only (matches the catalog's spots_left).
    const countRows = await tx
      .select({ cnt: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.classId, classId), eq(bookings.state, 'confirmed')))
    const confirmedCount = Number(countRows[0]?.cnt ?? 0)
    if (confirmedCount >= cls.capacityOnline) throw new ConflictError('class_full')

    // 4. Pick a package to pay with (lock the client's rows).
    const now = new Date()
    const pkgs = await tx
      .select({
        id: clientPackages.id,
        kind: clientPackages.kind,
        remaining: clientPackages.creditsOrSessionsRemaining,
        expiresAt: clientPackages.expiresAt,
      })
      .from(clientPackages)
      .where(and(eq(clientPackages.clientId, clientId), eq(clientPackages.active, true)))
      .for('update')

    // Usable now AND still valid when the class actually runs — a package that expires
    // before the class can't pay for it (G1: validity is checked against the class date,
    // not just `now`). Applies to both unlimited and credit packages.
    const consumable = pkgs.filter(
      p =>
        (p.expiresAt === null || p.expiresAt > now) &&
        (p.expiresAt === null || p.expiresAt >= cls.startsAt),
    )

    let clientPackageId: string
    let creditsUsed: number

    const unlimited = consumable.find(p => p.kind === 'unlimited')
    if (unlimited) {
      clientPackageId = unlimited.id
      creditsUsed = 0
    } else {
      const credit = consumable
        .filter(
          p =>
            (p.kind === 'credit_bundle' || p.kind === 'trial') &&
            (p.remaining ?? 0) >= cls.creditCost,
        )
        .sort((a, b) => {
          const ax = a.expiresAt ? a.expiresAt.getTime() : Infinity
          const bx = b.expiresAt ? b.expiresAt.getTime() : Infinity
          return ax - bx
        })[0]
      if (!credit) throw new ConflictError('insufficient_credits')

      await tx
        .update(clientPackages)
        .set({
          creditsOrSessionsRemaining: sql`${clientPackages.creditsOrSessionsRemaining} - ${cls.creditCost}`,
        })
        .where(eq(clientPackages.id, credit.id))
      clientPackageId = credit.id
      creditsUsed = cls.creditCost
    }

    // 5. Create the booking.
    const { qrToken, code } = generateBookingCodes()
    const [row] = await tx
      .insert(bookings)
      .values({
        clientId,
        kind: 'class',
        classId,
        clientPackageId,
        state: 'confirmed',
        creditsOrSessionsUsed: creditsUsed,
        qrToken,
        code,
      })
      .returning({ id: bookings.id })

    return { bookingId: row!.id, qrToken, code }
  })
}
