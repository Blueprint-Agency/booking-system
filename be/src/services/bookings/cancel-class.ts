/**
 * Cancels an entire class instance — bulk full refund to every confirmed booker.
 * See admin-restructure.md §10 (class detail) + §13 (inbox).
 *
 * Two actors reach this, and they get the SAME outcome for members — only the
 * recorded provenance differs (`source`):
 *   - `admin`      — any admin/superadmin, no reason required.
 *   - `instructor` — the class's MAIN instructor cancelling their own class
 *                    (spec-instructor-leave.md § instructor-initiated class
 *                    cancellation). Reason required; no notice window; all
 *                    admins are emailed afterwards.
 *
 * Cancellation bypasses window/cap (always full refund). Unlimited bookings
 * (0 credits used) just release the seat — outcome `n_a`, no balance write. All in one
 * transaction; the class row is locked FOR UPDATE so it can't race in-flight bookings/cancels.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { classes } from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { bookings, cancellations } from '../../db/schema/bookings'
import { inboxItems } from '../../db/schema/inbox'
import { refundCredits } from '../packages/ledger'
import { sendTemplatedEmail } from '../notifications/send'
import { logger } from '../../shared/logger'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'

export type CancelClassSource = 'admin' | 'instructor'

export interface CancelClassInput {
  classId: string
  actorStaffId: string
  /** Who is acting. Defaults to `admin` (the original caller). */
  source?: CancelClassSource
  /** Required when `source` is `instructor`; stored on the inbox item. */
  reason?: string
}

export interface CancelClassResult {
  totalBookings: number
  refundedCount: number
}

const sgDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  dateStyle: 'medium',
  timeStyle: 'short',
})

export async function cancelClass(input: CancelClassInput): Promise<CancelClassResult> {
  const { classId, actorStaffId } = input
  const source: CancelClassSource = input.source ?? 'admin'
  const reason = input.reason?.trim() ?? ''
  // Instructors only ever get here for their OWN class, with a reason. Checked
  // in the service (not the route) so no future caller can skip it.
  if (source === 'instructor' && !reason) throw new BadRequestError('reason_required')

  const outcome = await db.transaction(async tx => {
    const [cls] = await tx
      .select({
        id: classes.id,
        lifecycle: classes.lifecycle,
        mainInstructorId: classes.mainInstructorId,
        startsAt: classes.startsAt,
        classTypeId: classes.classTypeId,
      })
      .from(classes)
      .where(eq(classes.id, classId))
      .for('update')
      .limit(1)
    if (!cls) throw new NotFoundError('class_not_found')
    if (source === 'instructor' && cls.mainInstructorId !== actorStaffId) {
      throw new ForbiddenError('not_main_instructor')
    }
    if (cls.lifecycle !== 'active') throw new ConflictError('class_not_active')

    const now = new Date()

    // Flip the class.
    await tx
      .update(classes)
      .set({ lifecycle: 'cancelled', cancelledAt: now, cancelledByStaffId: actorStaffId })
      .where(eq(classes.id, classId))

    // All confirmed bookings → cancel + refund.
    const confirmed = await tx
      .select({
        id: bookings.id,
        clientId: bookings.clientId,
        clientPackageId: bookings.clientPackageId,
        used: bookings.creditsOrSessionsUsed,
      })
      .from(bookings)
      .where(and(eq(bookings.classId, classId), eq(bookings.state, 'confirmed')))
      .for('update')

    let refundedCount = 0
    for (const bk of confirmed) {
      const used = bk.used ?? 0
      const refundFired = used > 0 && !!bk.clientPackageId

      if (refundFired) {
        // Ledger re-derives `active` — an emptied bundle refunded here is
        // spendable again (it previously came back unusable).
        await refundCredits(tx, {
          clientId: bk.clientId,
          clientPackageId: bk.clientPackageId!,
          amount: used,
          reason:
            source === 'instructor'
              ? 'instructor_class_cancellation_refund'
              : 'admin_class_cancellation_refund',
          actedByStaffId: actorStaffId,
        })
        refundedCount++
      }

      await tx.insert(cancellations).values({
        bookingId: bk.id,
        clientId: bk.clientId,
        kind: 'class',
        source,
        wasWithinWindow: true,
        wasWithinCap: true,
        refundFired,
        cancelledAt: now,
      })

      await tx
        .update(bookings)
        .set({
          state: 'cancelled',
          refundOutcome: refundFired ? 'credit_returned' : 'n_a',
          checkInState: 'n_a',
          cancelledAt: now,
        })
        .where(eq(bookings.id, bk.id))
    }

    // Inbox notification per §13. The instructor's reason is free text and
    // lives here — the only place a cancellation carries one.
    await tx.insert(inboxItems).values({
      type: source === 'instructor' ? 'instructor_cancel_class' : 'admin_cancel_class_pt',
      payload: {
        kind: 'class',
        classId,
        cancelledByStaffId: actorStaffId,
        totalBookings: confirmed.length,
        refundedCount,
        at: now.toISOString(),
        ...(source === 'instructor' ? { reason } : {}),
      },
    })

    return {
      totalBookings: confirmed.length,
      refundedCount,
      startsAt: cls.startsAt,
      classTypeId: cls.classTypeId,
    }
  })

  if (source === 'instructor') {
    await emailAdmins({
      classTypeId: outcome.classTypeId,
      startsAt: outcome.startsAt,
      instructorStaffId: actorStaffId,
      reason,
      refundedCount: outcome.refundedCount,
    })
  }

  return { totalBookings: outcome.totalBookings, refundedCount: outcome.refundedCount }
}

/**
 * Best-effort — runs after the transaction commits and never throws. A class
 * that is already cancelled must not 500 because SMTP (or a missing template
 * row on an unseeded database) misbehaved.
 */
async function emailAdmins(args: {
  classTypeId: string
  startsAt: Date
  instructorStaffId: string
  reason: string
  refundedCount: number
}): Promise<void> {
  try {
    const [type] = await db
      .select({ name: classTypes.name })
      .from(classTypes)
      .where(eq(classTypes.id, args.classTypeId))
      .limit(1)
    const [instructor] = await db
      .select({ name: staffUsers.name })
      .from(staffUsers)
      .where(eq(staffUsers.id, args.instructorStaffId))
      .limit(1)
    const admins = await db
      .select({ id: staffUsers.id, email: staffUsers.email })
      .from(staffUsers)
      .where(
        and(inArray(staffUsers.role, ['admin', 'superadmin']), eq(staffUsers.status, 'active')),
      )

    for (const admin of admins) {
      await sendTemplatedEmail({
        slug: 'instructor_cancel_class',
        recipient: { email: admin.email, userId: admin.id, userKind: 'staff' },
        variables: {
          class_name: type?.name ?? 'Class',
          date: sgDateTime.format(args.startsAt),
          instructor_name: instructor?.name ?? 'An instructor',
          reason: args.reason,
          refunded_count: String(args.refundedCount),
        },
      })
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'instructor class cancellation: admin notification failed',
    )
  }
}
