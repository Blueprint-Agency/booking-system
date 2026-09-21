/**
 * The **Complimentary Package** (#176): a catalogue package an admin gives a
 * member at no charge, and the removal of one given by mistake.
 *
 * Giving goes through `grantPackage` — the same service a paid purchase uses —
 * so a comp is indistinguishable from a purchase except in money: nothing paid,
 * the catalogue price frozen as its List Price, no payment intent, and the
 * `complimentary` marker that keeps it out of Gross. Every rule a sale obeys
 * therefore holds for free: it lands Dormant, one package per Family runs, a
 * second trial is refused, an Unlimited Plan names its Home Location and an
 * Instructor-Bound PT package names its instructor.
 *
 * Nothing is emailed. The admin comping a class tells the member; a templated
 * "your purchase is confirmed" for something nobody bought is not that message.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { auditLog, manualAdjustments } from '../../db/schema/ledger'
import { clients } from '../../db/schema/identity'
import { clientPackages } from '../../db/schema/packages'
import { classes, ptRequests, ptSessions } from '../../db/schema/schedule'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { reportError } from '../../shared/logger'
import { cancelBooking } from '../bookings/cancel'
import { cancelPtRequest } from '../pt-sessions/cancel'
import { removalRefusal } from './complimentary-removal'
import type { Tx } from './ledger'
import { grantPackage } from './purchase'

/** What a comp records as paid — for the plan and for an Add-On given with it. */
const FREE = '0.00'

export interface GiveComplimentaryInput {
  clientId: string
  packageKind: 'class' | 'pt'
  /** id of the `class_packages` or `pt_packages` row being given. */
  packageId: string
  /** Why it was free. Required — it is the only record of that. */
  reason: string
  /** Home Location for an Unlimited Plan; refused on every other kind. */
  locationId?: string | null
  /**
   * Give the **Cross-Location Add-On** with the plan, at $0. Only an Unlimited
   * Plan can carry one, and a comped Add-On is recorded as zero paid rather
   * than as absent — "given, free" and "not given" are different facts.
   */
  crossLocation?: boolean
  /** The Bound Instructor for an Instructor-Bound PT package. */
  instructorId?: string | null
  actedByStaffId: string
}

/**
 * Give a member a catalogue package at no charge.
 *
 * The reason lands twice, deliberately: on the member's package adjustment
 * ledger, which is the panel an admin reads on the member's own page, and in
 * the audit log, which is where the acting staff member's actions are traced.
 * Neither can be derived from the other — the ledger row dies with the package
 * if the grant is removed, and the audit log never names the wallet.
 */
export async function giveComplimentaryPackage(
  tenantId: string,
  input: GiveComplimentaryInput,
): Promise<{ clientPackageId: string }> {
  const reason = input.reason.trim()
  if (!reason) throw new BadRequestError('reason_required')

  // The member must be this studio's, and not blocked: a package given to
  // somebody who cannot sign in here is a grant nobody can spend.
  const [member] = await db
    .select({ id: clients.id, deletedAt: clients.deletedAt })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, input.clientId)))
    .limit(1)
  if (!member) throw new NotFoundError('client_not_found')
  if (member.deletedAt) throw new ConflictError('client_blocked')

  const granted = await grantPackage(tenantId, {
    clientId: input.clientId,
    // No Purchase, because no sale. Which is also why there is no idempotency
    // key here: giving the same package twice is two gifts, and the admin who
    // did it can remove one.
    purchaseId: null,
    amountSgd: FREE,
    packageKind: input.packageKind,
    packageId: input.packageId,
    locationId: input.locationId,
    instructorId: input.instructorId,
    crossLocationPaidSgd: input.crossLocation ? FREE : null,
    complimentary: true,
  })

  await db.insert(manualAdjustments).values({
    tenantId,
    clientId: input.clientId,
    clientPackageId: granted.clientPackageId,
    // No credit moved — the package arrived with its balance. The ledger's
    // delta-0 rows are how every non-credit admin edit already records itself.
    delta: 0,
    reason: `Complimentary package: ${reason}`,
    actedByStaffId: input.actedByStaffId,
  })

  await db.insert(auditLog).values({
    tenantId,
    actorStaffId: input.actedByStaffId,
    actorType: 'staff',
    action: 'complimentary_package_given',
    targetTable: 'client_packages',
    targetId: granted.clientPackageId,
    payload: {
      reason,
      clientId: input.clientId,
      packageKind: input.packageKind,
      packageId: input.packageId,
    },
  })

  return { clientPackageId: granted.clientPackageId }
}

export interface RemoveComplimentaryInput {
  clientId: string
  clientPackageId: string
  reason: string
  actedByStaffId: string
}

export interface RemoveComplimentaryResult {
  /** How many not-yet-held bookings the removal cancelled. */
  cancelledBookings: number
}

/**
 * Take back a Complimentary Package given by mistake, while it is Untouched.
 *
 * A comp has no money behind it, so there is no Refund to issue and nothing for
 * the provider to reverse: the row goes, and the not-yet-held bookings it paid
 * for are cancelled first. Once the package is Touched this is refused — the
 * balance and expiry edits beside it are the tools then, and they leave the
 * history standing.
 *
 * The rows that pointed at the package outlive it with their link cleared
 * rather than deleted: a cancelled booking and a resolved PT request are things
 * that happened to the member, and a studio's own history is not something an
 * admin's correction gets to erase.
 */
export async function removeComplimentaryPackage(
  tenantId: string,
  input: RemoveComplimentaryInput,
): Promise<RemoveComplimentaryResult> {
  const reason = input.reason.trim()
  if (!reason) throw new BadRequestError('reason_required')

  const [pkg] = await db
    .select()
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.id, input.clientPackageId),
        eq(clientPackages.clientId, input.clientId),
      ),
    )
    .limit(1)
  if (!pkg) throw new NotFoundError('client_package_not_found')
  // Only a comp is removable. A purchase is refunded, which gives the money
  // back and leaves the row voided — deleting one would delete the sale.
  if (!pkg.complimentary) throw new BadRequestError('not_complimentary')

  await assertUntouched(tenantId, input.clientPackageId)

  // PT first: cancelling a request cancels the session and the booking under
  // it, so doing the bookings first would leave a request pointing at a class
  // that no longer has one.
  await cancelPtRequestsOn(tenantId, input.clientPackageId, input.actedByStaffId)
  const cancelledBookings = await cancelFutureBookingsOn(tenantId, input.clientPackageId)

  // Read again inside the transaction: the checks above ran outside it, and a
  // member booking with the package in between must not be quietly deleted.
  await db.transaction(async tx => {
    // The same row a booking locks before it spends from it (`packages/ledger`),
    // locked here first: a booking landing between the check below and the
    // delete would meet the foreign key instead of this refusal.
    const [held] = await tx
      .select({ id: clientPackages.id })
      .from(clientPackages)
      .where(
        and(
          eq(clientPackages.tenantId, tenantId),
          eq(clientPackages.id, input.clientPackageId),
        ),
      )
      .for('update')
      .limit(1)
    // Two admins removing one package at once: the second finds it gone, which
    // is the answer it was going to give anyway.
    if (!held) throw new NotFoundError('client_package_not_found')

    await assertUntouched(tenantId, input.clientPackageId, tx)
    const live = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.clientPackageId, input.clientPackageId),
          // A seat still standing on the package — one that would not cancel, or
          // one booked between the cancel pass and here. Either way the removal
          // stops rather than leaving somebody holding a place nothing paid for.
          eq(bookings.state, 'confirmed'),
        ),
      )
    if (live.length > 0) throw new ConflictError('package_has_live_bookings')

    await tx
      .update(bookings)
      .set({ clientPackageId: null })
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.clientPackageId, input.clientPackageId),
        ),
      )
    await tx
      .update(ptRequests)
      .set({ debitedClientPackageId: null })
      .where(
        and(
          eq(ptRequests.tenantId, tenantId),
          eq(ptRequests.debitedClientPackageId, input.clientPackageId),
        ),
      )
    // The ledger rows are the package's own history — the grant's reason and
    // any credit moved on it. They cannot outlive the row they describe, and
    // the audit entry below is what survives the removal.
    await tx
      .delete(manualAdjustments)
      .where(
        and(
          eq(manualAdjustments.tenantId, tenantId),
          eq(manualAdjustments.clientPackageId, input.clientPackageId),
        ),
      )
    await tx
      .delete(clientPackages)
      .where(
        and(
          eq(clientPackages.tenantId, tenantId),
          eq(clientPackages.id, input.clientPackageId),
        ),
      )

    await tx.insert(auditLog).values({
      tenantId,
      actorStaffId: input.actedByStaffId,
      actorType: 'staff',
      action: 'complimentary_package_removed',
      targetTable: 'client_packages',
      targetId: input.clientPackageId,
      payload: {
        reason,
        clientId: input.clientId,
        kind: pkg.kind,
        listPriceSgd: pkg.listPriceSgd,
        cancelledBookings,
      },
    })
  })

  return { cancelledBookings }
}

type Handle = typeof db | Tx

/** Every booking the package paid for, against the Untouched rule. */
async function assertUntouched(
  tenantId: string,
  clientPackageId: string,
  handle: Handle = db,
): Promise<void> {
  const rows = await handle
    .select({
      state: bookings.state,
      checkInState: bookings.checkInState,
      classStartsAt: classes.startsAt,
      ptStartsAt: ptSessions.startsAt,
    })
    .from(bookings)
    .leftJoin(classes, eq(classes.id, bookings.classId))
    .leftJoin(ptSessions, eq(ptSessions.id, bookings.ptSessionId))
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.clientPackageId, clientPackageId)))

  const refusal = removalRefusal(
    rows.map(r => ({
      state: r.state,
      checkInState: r.checkInState,
      startsAt: r.classStartsAt ?? r.ptStartsAt ?? null,
    })),
    new Date(),
  )
  if (refusal) throw new ConflictError(refusal)
}

/**
 * Cancel the PT requests the package paid for that have not been held. The
 * sessions they return land back on the package that is about to go, which
 * costs nothing and keeps one cancel path instead of two.
 */
async function cancelPtRequestsOn(
  tenantId: string,
  clientPackageId: string,
  actorStaffId: string,
): Promise<void> {
  const rows = await db
    .select({ id: ptRequests.id })
    .from(ptRequests)
    .where(
      and(
        eq(ptRequests.tenantId, tenantId),
        eq(ptRequests.debitedClientPackageId, clientPackageId),
        inArray(ptRequests.status, ['pending', 'scheduled']),
      ),
    )
  for (const r of rows) {
    // Named, like every other row this removal writes: the admin who took the
    // package back is the one who cancelled the sessions on it.
    await cancelPtRequest(tenantId, { ptRequestId: r.id, source: 'admin', actorStaffId })
  }
}

/** Cancel the classes the package paid for that have not been held yet. */
async function cancelFutureBookingsOn(
  tenantId: string,
  clientPackageId: string,
): Promise<number> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .leftJoin(classes, eq(classes.id, bookings.classId))
    .leftJoin(ptSessions, eq(ptSessions.id, bookings.ptSessionId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.clientPackageId, clientPackageId),
        eq(bookings.state, 'confirmed'),
      ),
    )

  let cancelled = 0
  for (const r of rows) {
    try {
      // `packageVoided` is the same arm a refund's unwind uses: the credit is
      // not handed back, because the package it would go to is being removed.
      await cancelBooking(tenantId, { bookingId: r.id, source: 'admin', packageVoided: true })
      cancelled += 1
    } catch (err) {
      // A booking that will not cancel is reported and left: the transaction
      // below refuses the removal while any confirmed booking stands, so a
      // failure here ends as a refusal rather than as an orphaned seat.
      reportError(err, 'complimentary removal could not cancel booking', {
        scope: 'complimentary',
        bookingId: r.id,
      })
    }
  }
  return cancelled
}
