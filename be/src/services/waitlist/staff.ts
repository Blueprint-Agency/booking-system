/**
 * Staff working a class's waitlist from the session page (spec-waitlist.md §7,
 * §10): the panel's rows, "Add to class" and "Remove". Staff putting a member
 * *into* the line is `join` in `./entries` — the same join as the member's own.
 *
 * Every write takes the class row lock first, like booking, cancel and
 * promotion, so a staff action and a cancel's automatic promotion take turns.
 * An instructor reaches the classes they are the main instructor of and no
 * others — the rule booking and check-in use.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { waitlistEntries } from '../../db/schema/bookings'
import {
  candidatePackages,
  holdsSeat,
  lockClass,
  packageDisplayName,
  payAndBook,
  type BookClassResult,
} from '../bookings/book'
import { countSeats, staffPromotionSeat } from '../bookings/seats'
import { selectPackage, type PackageRule, type SelectionRefusal } from '../packages/selection'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { now as clockNow } from '../../lib/clock'
import { beforeWindow } from './rules'
import { lineState, listForClass, waitingLine } from './line'
import { classCancelWindow } from '../policy/cancel-window'
import { sendPromotionEmails } from './promote'

export type StaffRole = 'admin' | 'instructor'

export interface StaffActor {
  role: StaffRole
  staffId: string
}

/** 403 unless the actor may work this class's line: any admin, or the class's own main instructor. */
export function assertMayWorkClass(actor: StaffActor, cls: { mainInstructorId: string }): void {
  if (actor.role === 'instructor' && cls.mainInstructorId !== actor.staffId) {
    throw new ForbiddenError('not_your_session', { message: 'This class is not one you are teaching.' })
  }
}

/* ── The panel ─────────────────────────────────────────────────────── */

/**
 * Whether a waiting member's packages could pay if they were added now:
 * `pending` names the package that would, `cannot_pay` the selection's reason.
 */
export type WaitlistPaymentStatus =
  | { status: 'pending'; packageName: string }
  | { status: 'cannot_pay'; reason: SelectionRefusal }

export interface WaitlistPanelRow {
  entryId: string
  position: number
  client: { id: string; name: string }
  joinedAt: Date
  paymentStatus: WaitlistPaymentStatus
}

/**
 * The class's line in queue order, each row with whether the member could pay.
 * The Default payer is chosen exactly as a promotion would at this instant, and
 * nothing is written: no sweep, no lock, no debit.
 */
export async function waitlistPanel(
  tenantId: string,
  cls: { id: string; locationId: string; startsAt: Date; creditCost: number; rule: PackageRule },
  now: Date = clockNow(),
): Promise<WaitlistPanelRow[]> {
  const line = await listForClass(tenantId, cls.id, now)
  if (line.length === 0) return []

  return db.transaction(async tx => {
    const rows: WaitlistPanelRow[] = []
    for (const e of line) {
      const pkgs = await candidatePackages(tx, tenantId, e.clientId)
      const choice = selectPackage({
        packages: pkgs,
        classLocationId: cls.locationId,
        classStartsAt: cls.startsAt,
        creditCost: cls.creditCost,
        rule: cls.rule,
        now,
      })
      const payer = choice.ok ? pkgs.find(p => p.id === choice.clientPackageId)! : null
      rows.push({
        entryId: e.id,
        position: e.position,
        client: { id: e.clientId, name: e.clientName || 'Member' },
        joinedAt: e.joinedAt,
        paymentStatus: payer
          ? { status: 'pending', packageName: packageDisplayName(payer.kind, payer.catalogueName) }
          : // No pick is passed, so a refusal is always one of selection's own reasons.
            { status: 'cannot_pay', reason: (choice as { refusal: SelectionRefusal }).refusal },
      })
    }
    return rows
  })
}

/* ── Add to class ──────────────────────────────────────────────────── */

export interface StaffPromoteInput {
  classId: string
  entryId: string
  actor: StaffActor
  /** Admin only: take an overbook seat when online and buffer are both full. */
  overbook?: boolean
}

/**
 * Book one waiting member onto the class (§7, Mindbody's "Add to class"):
 * whatever the Cancellation Window says, into a free online seat, else a buffer
 * seat, else an overbook seat for an admin who asked, else `class_full`. The
 * booking is paid for as any booking is; a package that cannot pay is refused
 * with the selection's reason and the member keeps their place.
 *
 * The member is emailed as an automatic promotion would email them only while
 * the free cancel the email promises is still theirs — before the window. Inside
 * it staff are booking by hand, and the email would promise a free cancel the
 * member no longer has.
 */
export async function staffPromote(tenantId: string, input: StaffPromoteInput): Promise<BookClassResult> {
  const now = clockNow()
  const { booking, promotion, emailable } = await db.transaction(async tx => {
    const cls = await lockClass(tx, tenantId, input.classId)
    if (!cls || cls.lifecycle !== 'active') throw new NotFoundError('class_not_found')
    assertMayWorkClass(input.actor, cls)
    if (cls.startsAt <= now) throw new BadRequestError('class_already_started')

    const entry = (await waitingLine(tx, tenantId, cls.id, now)).find(e => e.id === input.entryId)
    if (!entry) throw new NotFoundError('waitlist_entry_not_found')
    // Booking by hand settles a place in line, so this is a guard, not a path.
    if (await holdsSeat(tx, tenantId, entry.clientId, cls.id)) throw new ConflictError('already_booked')

    const decision = staffPromotionSeat(
      await countSeats(tx, tenantId, cls.id),
      cls,
      input.actor.role,
      input.overbook ?? false,
    )
    if (!decision.ok) {
      const line = await lineState(tx, tenantId, cls, now)
      throw new ConflictError('class_full', {
        waitlist_open: line.open,
        waiting: line.waiting,
        capacity_waitlist: cls.capacityWaitlist,
      })
    }

    // Nobody is there to pick, so the Default payer pays.
    const paid = await payAndBook(tx, tenantId, cls, {
      clientId: entry.clientId,
      seat: decision.seat,
      clientPackageId: null,
      now,
    })
    if (!paid.ok) throw new ConflictError(paid.refusal)

    await tx
      .update(waitlistEntries)
      .set({ status: 'promoted', bookingId: paid.booking.bookingId, resolvedAt: now, resolvedBy: input.actor.staffId })
      .where(and(eq(waitlistEntries.tenantId, tenantId), eq(waitlistEntries.id, entry.id)))

    return {
      booking: paid.booking,
      promotion: { entryId: entry.id, bookingId: paid.booking.bookingId, clientId: entry.clientId, classId: cls.id },
      emailable: beforeWindow(cls.startsAt, await classCancelWindow(tenantId, cls), now),
    }
  })

  if (emailable) await sendPromotionEmails(tenantId, [promotion])
  return booking
}

/* ── Remove ────────────────────────────────────────────────────────── */

/**
 * Take a waiting member out of the line (§6): `removed`, by this staff member.
 * Everyone behind moves up, since positions are counted, never stored.
 */
export async function staffRemove(
  tenantId: string,
  input: { classId: string; entryId: string; actor: StaffActor },
): Promise<void> {
  const now = clockNow()
  await db.transaction(async tx => {
    const cls = await lockClass(tx, tenantId, input.classId)
    if (!cls) throw new NotFoundError('class_not_found')
    assertMayWorkClass(input.actor, cls)

    const live = (await waitingLine(tx, tenantId, cls.id, now)).some(e => e.id === input.entryId)
    if (!live) throw new NotFoundError('waitlist_entry_not_found')

    await tx
      .update(waitlistEntries)
      .set({ status: 'removed', resolvedAt: now, resolvedBy: input.actor.staffId })
      .where(
        and(
          eq(waitlistEntries.tenantId, tenantId),
          eq(waitlistEntries.id, input.entryId),
          eq(waitlistEntries.classId, cls.id),
          eq(waitlistEntries.status, 'waiting'),
        ),
      )
  })
}
