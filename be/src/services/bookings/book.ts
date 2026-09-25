/**
 * Class booking: capacity check + credit deduct in a single transaction.
 * See be-client.md §4a.
 *
 * A member (`bookClass`) and staff booking a member (`staffBookClass`) are the
 * same booking; they differ only in which seat they may take, which is
 * `./seats` (spec-waitlist.md §2).
 *
 * Which package pays is `services/packages/selection` — a pure module, so the
 * Location, ordering and prospective-expiry rules are testable without a
 * database. This file loads rows, locks them, and writes what it is told.
 *
 * Concurrency: the class row is locked FOR UPDATE so concurrent bookings for the
 * same class serialise (capacity + double-book checks are race-safe); the
 * client's package rows are locked too so a double-click can't double-debit —
 * and so a Dormant package has exactly one writer at Activation.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { classes } from '../../db/schema/schedule'
import { bookings } from '../../db/schema/bookings'
import { clients } from '../../db/schema/identity'
import { clientPackages } from '../../db/schema/packages'
import type { BookingSeat } from '../../db/enums'
import { generateBookingCodes } from './qr'
import { countSeats, seatFor, type SeatRole } from './seats'
import type { Tx } from '../schedule/roster'
import { debitCredits } from '../packages/ledger'
import { activatePackage, sweepExpired } from '../packages/activation'
import { selectPackage, type SelectionRefusal } from '../packages/selection'
import { lineState, settleWaitingOnBooking } from '../waitlist/line'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { now as clockNow } from '../../lib/clock'

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
  seat: BookingSeat
}

/** A member booking themselves: an online seat or nothing. */
export async function bookClass(
  tenantId: string,
  input: BookClassInput,
): Promise<BookClassResult> {
  return bookIntoClass(tenantId, { ...input, role: 'member', overbook: false })
}

export interface StaffBookClassInput {
  clientId: string
  classId: string
  role: Exclude<SeatRole, 'member'>
  /** The staff member booking. An instructor may only book onto a class they teach. */
  actorStaffId: string
  /** Admin only: take an overbook seat when the buffer is full. Ignored for instructors. */
  overbook?: boolean
}

/**
 * Staff booking a member onto a class (spec-waitlist.md §7): a buffer seat, or
 * an overbook seat for an admin who asked. Everything else — package selection,
 * the debit, Activation, the QR code — is the member's booking, unchanged.
 */
export async function staffBookClass(
  tenantId: string,
  input: StaffBookClassInput,
): Promise<BookClassResult> {
  return bookIntoClass(tenantId, {
    clientId: input.clientId,
    classId: input.classId,
    role: input.role,
    overbook: input.overbook ?? false,
    actorStaffId: input.actorStaffId,
  })
}

async function bookIntoClass(
  tenantId: string,
  input: BookClassInput & { role: SeatRole; overbook: boolean; actorStaffId?: string },
): Promise<BookClassResult> {
  const { clientId, classId } = input

  // One instant for the whole booking: the started check, the expiry sweep,
  // selection and the Activation stamp all agree on what "now" is.
  const now = clockNow()

  return db.transaction(async tx => {
    // 1. Lock the class row so capacity is evaluated race-free.
    const cls = await lockClass(tx, tenantId, classId)

    if (!cls || cls.lifecycle !== 'active') throw new NotFoundError('class_not_found')
    // An instructor reaches their own classes only — the same rule as check-in.
    if (input.role === 'instructor' && cls.mainInstructorId !== input.actorStaffId) {
      throw new ForbiddenError('not_your_session', { message: 'This class is not one you are teaching.' })
    }
    if (cls.startsAt <= now) throw new BadRequestError('class_already_started')

    // A member booked by staff must be one of this studio's members. RLS would
    // refuse the insert anyway; this makes it a 404 rather than a 500.
    if (input.role !== 'member') {
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId), isNull(clients.deletedAt)))
        .limit(1)
      if (!client) throw new NotFoundError('client_not_found')
    }

    // 2. Already booked? (one confirmed booking per client per class)
    if (await holdsSeat(tx, tenantId, clientId, classId)) throw new ConflictError('already_booked')

    // 3. Which seat — counted under the class lock, decided by the seat rules.
    const counts = await countSeats(tx, tenantId, classId)
    const decision = seatFor(counts, cls, input.role, input.overbook)
    if (!decision.ok) {
      // The waitlist fields let the caller offer the queue instead.
      const line = await lineState(tx, tenantId, cls, now)
      throw new ConflictError('class_full', {
        waitlist_open: line.open,
        waiting: line.waiting,
        capacity_waitlist: cls.capacityWaitlist,
      })
    }

    // 4–5. Pay and book.
    const paid = await payAndBook(tx, tenantId, cls, {
      clientId,
      seat: decision.seat,
      useCredits: input.useCredits ?? false,
      now,
    })
    if (!paid.ok) throw new ConflictError(paid.refusal)

    // Booked by hand while waiting in the line: the place in it is spent.
    await settleWaitingOnBooking(tx, tenantId, {
      classId,
      clientId,
      by: input.role === 'member' ? 'client' : input.actorStaffId!,
      now,
    })

    return paid.booking
  })
}

/** The class row a booking reads, as `lockClass` returns it. */
export interface LockedClass {
  id: string
  locationId: string
  startsAt: Date
  capacityOnline: number
  capacityBuffer: number
  capacityWaitlist: number
  creditCost: number
  lifecycle: string
  mainInstructorId: string
}

/**
 * Lock a class row `FOR UPDATE` and read what booking needs. Every writer of a
 * class's seats or line — booking, cancel, the waitlist — takes this lock first,
 * so they serialise per class.
 */
export async function lockClass(tx: Tx, tenantId: string, classId: string): Promise<LockedClass | undefined> {
  const [cls] = await tx
    .select({
      id: classes.id,
      locationId: classes.locationId,
      startsAt: classes.startsAt,
      capacityOnline: classes.capacityOnline,
      capacityBuffer: classes.capacityBuffer,
      capacityWaitlist: classes.capacityWaitlist,
      creditCost: classes.creditCost,
      lifecycle: classes.lifecycle,
      mainInstructorId: classes.mainInstructorId,
    })
    .from(classes)
    .where(and(eq(classes.tenantId, tenantId), eq(classes.id, classId)))
    .for('update')
    .limit(1)
  return cls
}

/** Whether the member already holds a confirmed booking on the class — one per member per class. */
export async function holdsSeat(tx: Tx, tenantId: string, clientId: string, classId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.clientId, clientId),
        eq(bookings.classId, classId),
        eq(bookings.state, 'confirmed'),
      ),
    )
    .limit(1)
  return !!row
}

/**
 * The member's packages that could pay for a class, as selection reads them.
 * Add `.for('update')` when about to spend one.
 */
export function candidatePackages(reader: Tx, tenantId: string, clientId: string) {
  return reader
    .select({
      id: clientPackages.id,
      kind: clientPackages.kind,
      creditsOrSessionsRemaining: clientPackages.creditsOrSessionsRemaining,
      expiresAt: clientPackages.expiresAt,
      locationId: clientPackages.locationId,
      durationMonths: clientPackages.durationMonths,
      validityDays: clientPackages.validityDays,
      crossLocationPaidSgd: clientPackages.crossLocationPaidSgd,
      purchasedAt: clientPackages.purchasedAt,
    })
    .from(clientPackages)
    .where(
      and(
        // The credit-isolation rule, at the one place credits are chosen to be
        // spent: a plan sold by another studio is not a candidate here.
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.clientId, clientId),
        eq(clientPackages.active, true),
      ),
    )
}

export type PayAndBookResult = { ok: true; booking: BookClassResult } | { ok: false; refusal: SelectionRefusal }

/**
 * Pay for a seat on a class the caller has locked, and insert the booking:
 * package selection, the debit, Activation, the QR code. The one booking path —
 * a member, staff and a waitlist promotion all come through here, so a promoted
 * booking is paid for exactly as if the member had booked it by hand.
 *
 * A package that cannot pay is returned, not thrown, so a promotion can skip to
 * the next member in line inside the same transaction. Nothing has been written
 * by then except the expiry sweep, which is the nightly job's own write early.
 */
export async function payAndBook(
  tx: Tx,
  tenantId: string,
  cls: LockedClass,
  input: { clientId: string; seat: BookingSeat; useCredits: boolean; now: Date },
): Promise<PayAndBookResult> {
  const { clientId, now } = input

  // Pick a package to pay with (lock the client's rows).
  // A package whose expiry has passed since the nightly sweep still says
  // `active`, and the one-Activated-per-family index counts it. Sweep the
  // member's own rows first so an ended package can never block the next
  // one from starting — the same flip the cron does, a day early.
  await sweepExpired(tx, tenantId, clientId, now)
  const pkgs = await candidatePackages(tx, tenantId, clientId).for('update')

  const choice = selectPackage({
    packages: pkgs,
    classLocationId: cls.locationId,
    classStartsAt: cls.startsAt,
    creditCost: cls.creditCost,
    useCredits: input.useCredits,
    now,
  })
  if (!choice.ok) return { ok: false, refusal: choice.refusal }

  const { clientPackageId, creditsUsed } = choice

  if (creditsUsed > 0) {
    // The ledger re-derives `active` — a bundle spent to exactly zero stops
    // being a booking candidate immediately, not at the nightly sweep.
    await debitCredits(tx, {
      tenantId,
      clientId,
      clientPackageId,
      amount: creditsUsed,
      reason: 'class_booking_debit',
      // See ledger.ts — booking debits stay out of the admin adjustments panel.
      audit: false,
    })
  }

  // Activation (§3): the first confirmed class booking a Dormant package pays
  // for starts its clock, stamped here because this transaction already holds
  // the row locked — one writer, no race. One-way: no cancellation un-stamps it.
  if (choice.activateUntil) {
    await activatePackage(tx, tenantId, clientPackageId, choice.activateUntil)
  }

  // Create the booking.
  const { qrToken, code } = generateBookingCodes()
  const [row] = await tx
    .insert(bookings)
    .values({
      tenantId,
      clientId,
      kind: 'class',
      classId: cls.id,
      clientPackageId,
      state: 'confirmed',
      seat: input.seat,
      creditsOrSessionsUsed: creditsUsed,
      qrToken,
      code,
    })
    .returning({ id: bookings.id })

  return { ok: true, booking: { bookingId: row!.id, qrToken, code, seat: input.seat } }
}
