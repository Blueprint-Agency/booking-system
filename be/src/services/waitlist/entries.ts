/**
 * A member joining and leaving a class's waitlist (spec-waitlist.md §4, §6).
 *
 * Joining costs nothing: no credit is debited and no package is activated. It
 * checks that the member *could* pay, with the same selection a booking runs,
 * and the package is chosen again at promotion — packages change in between.
 */
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { waitlistEntries } from '../../db/schema/bookings'
import { classes } from '../../db/schema/schedule'
import { clients } from '../../db/schema/identity'
import { candidatePackages, holdsSeat, lockClass } from '../bookings/book'
import { countSeats } from '../bookings/seats'
import { selectPackage } from '../packages/selection'
import { ConflictError, NotFoundError } from '../../shared/errors'
import { beforeWindow, joinRefusal, positions } from './rules'
import { classWindowHours, waitingLine, waitlistEnabled } from './line'
import { assertMayWorkClass, type StaffActor } from './staff'

export interface JoinResult {
  entryId: string
  position: number
}

/**
 * Put a member in a full class's line. The checks run in §4's order under the
 * class row lock, so the line's length and the seat count cannot move between
 * being read and the entry being written.
 *
 * `staff` is set when staff put the member in line from a full class's Add
 * member prompt (§7). The rules are the member's own; staff must also be allowed
 * to work the class, and the member must be one of this studio's. Who did it is
 * the route's audit record — the entry itself is the member's place in line.
 */
export async function join(
  tenantId: string,
  clientId: string,
  classId: string,
  now: Date,
  staff?: StaffActor,
): Promise<JoinResult> {
  return db.transaction(async tx => {
    const cls = await lockClass(tx, tenantId, classId)
    if (staff) {
      if (cls) assertMayWorkClass(staff, cls)
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId), isNull(clients.deletedAt)))
        .limit(1)
      if (!client) throw new NotFoundError('client_not_found')
    }
    const active = !!cls && cls.lifecycle === 'active'
    const windowHours = await classWindowHours(tenantId)

    const booked = await holdsSeat(tx, tenantId, clientId, classId)
    const waiting = cls ? await waitingLine(tx, tenantId, classId, now) : []
    const counts = await countSeats(tx, tenantId, classId)

    const refusal = joinRefusal({
      enabled: waitlistEnabled(tenantId),
      classActive: active,
      closed: !cls || !beforeWindow(cls.startsAt, windowHours, now),
      alreadyBooked: booked,
      alreadyWaiting: waiting.some(e => e.clientId === clientId),
      onlineFull: !!cls && counts.onlineUsed >= cls.capacityOnline,
      waiting: waiting.length,
      capacityWaitlist: cls?.capacityWaitlist ?? 0,
    })
    if (refusal === 'class_not_found') throw new NotFoundError(refusal)
    if (refusal === 'waitlist_closed') throw new ConflictError(refusal, { window_hours: windowHours })
    if (refusal) throw new ConflictError(refusal)

    // Could the member pay if a seat opened now? The same selection as a
    // booking, read without locking or spending anything.
    const choice = selectPackage({
      packages: await candidatePackages(tx, tenantId, clientId),
      classLocationId: cls!.locationId,
      classStartsAt: cls!.startsAt,
      creditCost: cls!.creditCost,
      useCredits: false,
      now,
    })
    if (!choice.ok) throw new ConflictError(choice.refusal)

    const [entry] = await tx
      .insert(waitlistEntries)
      // `clock_timestamp()`, not the column's `now()` default: `now()` is when
      // the transaction began, and a join that waited on the class lock began
      // before the one it queued behind — it would jump ahead of it in line.
      .values({ tenantId, clientId, classId, status: 'waiting', joinedAt: sql`clock_timestamp()` })
      .returning({ id: waitlistEntries.id, joinedAt: waitlistEntries.joinedAt })

    const position = positions([...waiting, { id: entry!.id, clientId, joinedAt: entry!.joinedAt }]).get(entry!.id)!
    return { entryId: entry!.id, position }
  })
}

/**
 * The member leaves the line (§6): `withdrawn`, any time before the class
 * starts. Not a cancellation — no `cancellations` row, no inbox item, nothing
 * against the cancellation cap.
 */
export async function leave(tenantId: string, clientId: string, entryId: string, now: Date): Promise<void> {
  // Only a live entry of the member's own on a class that has not started. The
  // status guard in the update also loses cleanly to a promotion that got there
  // first.
  const live = db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.tenantId, tenantId), gt(classes.startsAt, now)))
  const left = await db
    .update(waitlistEntries)
    .set({ status: 'withdrawn', resolvedAt: now, resolvedBy: 'client' })
    .where(
      and(
        eq(waitlistEntries.tenantId, tenantId),
        eq(waitlistEntries.id, entryId),
        eq(waitlistEntries.clientId, clientId),
        eq(waitlistEntries.status, 'waiting'),
        inArray(waitlistEntries.classId, live),
      ),
    )
    .returning({ id: waitlistEntries.id })
  if (left.length === 0) throw new NotFoundError('waitlist_entry_not_found')
}
