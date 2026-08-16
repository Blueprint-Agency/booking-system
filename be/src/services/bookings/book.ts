/**
 * Class booking: capacity check + credit deduct in a single transaction.
 * See be-client.md §4a.
 *
 * Which package pays is `services/packages/selection` — a pure module, so the
 * Location, ordering and prospective-expiry rules are testable without a
 * database. This file loads rows, locks them, and writes what it is told.
 *
 * Concurrency: the class row is locked FOR UPDATE so concurrent bookings for the
 * same class serialise (capacity + double-book checks are race-safe); the
 * client's package rows are locked too so a double-click can't double-debit —
 * and so a Dormant plan has exactly one writer at Activation.
 */
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { classes } from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { clientPackages } from '../../db/schema/packages'
import { generateBookingCodes } from './qr'
import { debitCredits } from '../packages/ledger'
import { selectPackage } from '../packages/selection'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'

export interface BookClassInput {
  clientId: string
  classId: string
  /**
   * Pay with credits for a class the member's Unlimited Plan does not cover
   * (§2). The one piece of client input selection accepts.
   */
  useCredits?: boolean
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
        locationId: classes.locationId,
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
        creditsOrSessionsRemaining: clientPackages.creditsOrSessionsRemaining,
        expiresAt: clientPackages.expiresAt,
        locationId: clientPackages.locationId,
        durationMonths: clientPackages.durationMonths,
      })
      .from(clientPackages)
      .where(and(eq(clientPackages.clientId, clientId), eq(clientPackages.active, true)))
      .for('update')

    const choice = selectPackage({
      packages: pkgs,
      classLocationId: cls.locationId,
      classStartsAt: cls.startsAt,
      creditCost: cls.creditCost,
      useCredits: input.useCredits ?? false,
      now,
    })
    if (!choice.ok) throw new ConflictError(choice.refusal)

    const { clientPackageId, creditsUsed } = choice

    if (creditsUsed > 0) {
      // The ledger re-derives `active` — a bundle spent to exactly zero stops
      // being a booking candidate immediately, not at the nightly sweep.
      await debitCredits(tx, {
        clientId,
        clientPackageId,
        amount: creditsUsed,
        reason: 'class_booking_debit',
        // See ledger.ts — booking debits stay out of the admin adjustments panel.
        audit: false,
      })
    }

    // Activation (§3): the first confirmed class booking a Dormant plan pays for
    // starts its clock, stamped here because this transaction already holds the
    // row locked — one writer, no race. One-way: no cancellation un-stamps it.
    if (choice.activateUntil) {
      await tx
        .update(clientPackages)
        .set({ expiresAt: choice.activateUntil })
        .where(eq(clientPackages.id, clientPackageId))
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
