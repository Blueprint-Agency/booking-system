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
import { classPackages, clientPackages, ptPackages } from '../../db/schema/packages'
import { candidatePackages, holdsSeat, lockClass, payAndBook, type BookClassResult } from '../bookings/book'
import { countSeats, staffPromotionSeat } from '../bookings/seats'
import { selectPackage, type SelectionRefusal } from '../packages/selection'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { now as clockNow } from '../../lib/clock'
import { beforeWindow } from './rules'
import { classWindowHours, lineState, listForClass, waitingLine } from './line'
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

const KIND_NAME: Record<string, string> = {
  credit_bundle: 'Credit bundle',
  unlimited: 'Unlimited',
  trial: 'Trial pass',
  pt: 'PT package',
}

/**
 * The class's line in queue order, each row with whether the member could pay.
 * Selection runs exactly as a booking would at this instant, and nothing is
 * written: no sweep, no lock, no debit.
 */
export async function waitlistPanel(
  tenantId: string,
  cls: { id: string; locationId: string; startsAt: Date; creditCost: number },
  now: Date = clockNow(),
): Promise<WaitlistPanelRow[]> {
  const line = await listForClass(tenantId, cls.id, now)
  if (line.length === 0) return []

  return db.transaction(async tx => {
    const choices = new Map<string, ReturnType<typeof selectPackage>>()
    for (const e of line) {
      choices.set(
        e.id,
        selectPackage({
          packages: await candidatePackages(tx, tenantId, e.clientId),
          classLocationId: cls.locationId,
          classStartsAt: cls.startsAt,
          creditCost: cls.creditCost,
          useCredits: false,
          now,
        }),
      )
    }

    const chosenIds = [...choices.values()].flatMap(c => (c.ok ? [c.clientPackageId] : []))
    const names = new Map<string, string>()
    if (chosenIds.length > 0) {
      const rows = await tx
        .select({
          id: clientPackages.id,
          kind: clientPackages.kind,
          classPackageName: classPackages.name,
          ptPackageName: ptPackages.name,
        })
        .from(clientPackages)
        .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
        .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
        .where(and(eq(clientPackages.tenantId, tenantId), inArray(clientPackages.id, chosenIds)))
      for (const r of rows) names.set(r.id, r.classPackageName ?? r.ptPackageName ?? KIND_NAME[r.kind] ?? 'Package')
    }

    return line.map(e => {
      const choice = choices.get(e.id)!
      return {
        entryId: e.id,
        position: e.position,
        client: { id: e.clientId, name: e.clientName || 'Member' },
        joinedAt: e.joinedAt,
        paymentStatus: choice.ok
          ? { status: 'pending', packageName: names.get(choice.clientPackageId) ?? 'Package' }
          : { status: 'cannot_pay', reason: choice.refusal },
      }
    })
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

    const paid = await payAndBook(tx, tenantId, cls, {
      clientId: entry.clientId,
      seat: decision.seat,
      useCredits: false,
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
      emailable: beforeWindow(cls.startsAt, await classWindowHours(tenantId), now),
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
