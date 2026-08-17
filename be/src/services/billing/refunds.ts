/**
 * Refunds (§14).
 *
 * **A Refund voids the purchase it paid for, cancels every future booking on it,
 * and hands the Promo Code back.** There is no partial refund and no separate
 * admin revoke.
 *
 * The shape of this module is the decision: `issueRefund` only calls the
 * payment provider and returns, and `unwindRefund` — driven by
 * `charge.refunded` — does all of the rest. The provider's dashboard can never
 * be locked out, so a refund can always arrive off-book; writing the unwind once
 * makes a dashboard refund and a button refund indistinguishable by
 * construction. Which is also why **every step below is a no-op on a second
 * pass** — the provider retries, and both paths land here.
 */
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { auditLog, stripePayments } from '../../db/schema/ledger'
import { bookings } from '../../db/schema/bookings'
import { classPackages, clientPackages, ptPackages } from '../../db/schema/packages'
import { classes, ptSessions } from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { clients } from '../../db/schema/identity'
import { CLIENT_URL } from '../../env'
import { stripe } from '../../lib/stripe'
import { reportError } from '../../shared/logger'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { cancelBooking } from '../bookings/cancel'
import { refundPromoCodeRedemption } from '../packages/promo-redemption'
import { sendTemplatedEmail } from '../notifications/send'
import {
  attendedNotice,
  composeRefundEmail,
  isUntouched,
  type CancelledSession,
} from './refund-notice'

const ACCOUNT_URL = `${CLIENT_URL}/account`

export interface RefundState {
  /** There is money at the provider to give back. */
  refundable: boolean
  attendedCount: number
  /** Null when the purchase is **Untouched** — there is nothing to warn about. */
  notice: string | null
}

/**
 * Every purchase this member holds, with what the portal shows beside its Refund
 * button. **Eligibility is a notice, not a gate** — the button is always
 * present, and the admin may refund anyway.
 *
 * The **Untouched** fold is the one line at the centre of it: a purchase is
 * Untouched while no class it paid for has been attended or no-showed. A no-show
 * counts as used — the class ran and the seat was held, and the alternative
 * makes "don't turn up" the way to stay refundable. A class booked but not yet
 * held does not count; refunding simply cancels it. A Dormant plan has no
 * bookings at all and is trivially Untouched.
 *
 * Batched over the client rather than asked per package, because the client
 * detail page reads every row at once and this is a group-by either way. The
 * sentence is composed here, not in the portal: frontends derive no domain rule.
 */
export async function refundStatesFor(clientId: string): Promise<Record<string, RefundState>> {
  const rows = await db
    .select({
      id: clientPackages.id,
      paymentIntentId: clientPackages.stripePaymentIntentId,
      count: sql<number>`count(${bookings.id})::int`,
      since: sql<string | null>`min(coalesce(${classes.startsAt}, ${ptSessions.startsAt}))`,
    })
    .from(clientPackages)
    .leftJoin(
      bookings,
      and(
        eq(bookings.clientPackageId, clientPackages.id),
        inArray(bookings.checkInState, ['attended', 'no_show']),
      ),
    )
    .leftJoin(classes, eq(classes.id, bookings.classId))
    .leftJoin(ptSessions, eq(ptSessions.id, bookings.ptSessionId))
    .where(eq(clientPackages.clientId, clientId))
    .groupBy(clientPackages.id, clientPackages.stripePaymentIntentId)

  const out: Record<string, RefundState> = {}
  for (const r of rows) {
    const count = Number(r.count ?? 0)
    out[r.id] = {
      // A comp grant, a $0 trial and a Promo Code that took the total to zero
      // never reached the payment provider, so there is no money to give back.
      refundable: r.paymentIntentId != null,
      attendedCount: count,
      notice: attendedNotice(count, r.since ? new Date(r.since) : null),
    }
  }
  return out
}

/**
 * Issue the Refund. **This calls the payment provider and returns.** Nothing is
 * unwound here: the `charge.refunded` webhook it triggers does all of it, which
 * is what makes this button and the provider's dashboard the same operation.
 *
 * Always the full amount — no amount is accepted, because there is no partial
 * refund. For a plan bought with a Cross-Location Add-On in the same session
 * that is plan plus Add-On together, since the two were one charge.
 *
 * The typed reason is mandatory and is written to the audit log with the
 * override flag and the attended count. It is the only record of why an admin
 * refunded against the studio's rule.
 */
export async function issueRefund(args: {
  clientId: string
  clientPackageId: string
  reason: string
  actorStaffId: string
}): Promise<{ paymentIntentId: string; attendedCount: number; override: boolean }> {
  const [pkg] = await db
    .select({
      id: clientPackages.id,
      clientId: clientPackages.clientId,
      paymentIntentId: clientPackages.stripePaymentIntentId,
    })
    .from(clientPackages)
    .where(
      and(eq(clientPackages.id, args.clientPackageId), eq(clientPackages.clientId, args.clientId)),
    )
    .limit(1)
  if (!pkg) throw new NotFoundError('client_package_not_found')
  // A comp grant, a $0 trial or a Promo Code that took the total to zero never
  // reached the payment provider, so there is no money to give back. Corporate
  // is out of scope for the same reason from the other end — it creates no
  // client-package row at all, so it cannot be named here.
  if (!pkg.paymentIntentId) throw new BadRequestError('purchase_not_refundable')

  const [payment] = await db
    .select({ status: stripePayments.status })
    .from(stripePayments)
    .where(eq(stripePayments.paymentIntentId, pkg.paymentIntentId))
    .limit(1)
  if (payment?.status === 'refunded') throw new ConflictError('already_refunded')

  const count = (await refundStatesFor(args.clientId))[args.clientPackageId]?.attendedCount ?? 0
  const override = !isUntouched(count)

  // Keyed on the payment intent, which is the money path's only real guard: the
  // `already_refunded` check above reads a status the webhook flips
  // asynchronously, so a double-click or a client retry would otherwise reach
  // the provider twice. One purchase can only ever be refunded once, so the
  // purchase's own intent is the natural key.
  await stripe.refunds.create(
    { payment_intent: pkg.paymentIntentId },
    { idempotencyKey: `refund:${pkg.paymentIntentId}` },
  )

  // Written after the provider has taken it, so the log records refunds that
  // actually happened. The generic audit middleware records the request; this
  // row records the decision, which is the part nobody can reconstruct — but the
  // money has already moved, so a failure to write it is reported rather than
  // thrown back at an admin whose refund did go through.
  try {
    await db.insert(auditLog).values({
      actorStaffId: args.actorStaffId,
      actorType: 'staff',
      action: 'purchase_refunded',
      targetTable: 'client_packages',
      targetId: args.clientPackageId,
      payload: {
        reason: args.reason,
        override,
        attendedCount: count,
        paymentIntentId: pkg.paymentIntentId,
      },
    })
  } catch (err) {
    reportError(err, 'refund audit row failed', {
      scope: 'refunds',
      clientPackageId: args.clientPackageId,
      reason: args.reason,
    })
  }

  return { paymentIntentId: pkg.paymentIntentId, attendedCount: count, override }
}

/**
 * The unwind, driven by `charge.refunded`. **Every step is a no-op on a second
 * pass** — each write is conditioned on the state it is moving away from, and
 * the only step that cannot be (the email) is gated on the payment row's flip,
 * which is atomic.
 *
 * The flip is stamped **last** on purpose. As a first step it would be a neat
 * gate and a trap: a delivery that died halfway would leave the payment marked
 * refunded and the plan still live, and the provider's retry would return at the
 * gate having unwound nothing. Stamping at the end means a half-finished pass is
 * simply redone, and the one non-repeatable act rides on the one atomic write.
 */
export async function unwindRefund(paymentIntentId: string): Promise<void> {
  const [payment] = await db
    .select({
      status: stripePayments.status,
      bookingId: stripePayments.bookingId,
      amountSgd: stripePayments.amountSgd,
    })
    .from(stripePayments)
    .where(eq(stripePayments.paymentIntentId, paymentIntentId))
    .limit(1)
  // No row means a charge this system never recorded; already refunded means a
  // redelivery of an event that completed.
  if (!payment || payment.status === 'refunded') return

  // The Promo Code comes back — to the member's one-use limit and the code's
  // pool at once. The row survives as `refunded`; only the partial index lets it.
  await refundPromoCodeRedemption(paymentIntentId)

  // A workshop's booking IS the purchase, so the ledger's booking link is what
  // gets cancelled. Attended and no-showed workshops stand as history for the
  // same reason classes do.
  //
  // Deliberately NOT through `cancelBooking`: that service refuses a workshop
  // outright (`workshop_cancel_unsupported`) because a workshop booking has no
  // package, no credit and no cancellation-cap meaning — the `cancellations`
  // row it writes is typed `class | pt`. And `stripe_refunded` rather than the
  // `n_a` the class and PT bookings take: that rule is about bookings a voided
  // package paid for, where returning a credit would be meaningless. Here money
  // genuinely went back for this exact booking, which is what the arm is for.
  if (payment.bookingId) {
    await db
      .update(bookings)
      .set({ state: 'cancelled', refundOutcome: 'stripe_refunded', cancelledAt: new Date() })
      .where(
        and(
          eq(bookings.id, payment.bookingId),
          eq(bookings.state, 'confirmed'),
          eq(bookings.checkInState, 'pending'),
        ),
      )
  }

  // The purchase is **Voided**. Matched on the plan's OWN purchase intent,
  // never on `stripe_payments.client_package_id`: a standalone Cross-Location
  // Add-On payment also points at the plan, and refunding an Add-On must not
  // void the plan someone else's money paid for. The Add-On has no independent
  // refund — it dies with the plan, free, because it is a column on this row.
  const [pkg] = await db
    .select({
      id: clientPackages.id,
      clientId: clientPackages.clientId,
      classPackageName: classPackages.name,
      ptPackageName: ptPackages.name,
      clientName: clients.name,
      clientEmail: clients.email,
    })
    .from(clientPackages)
    .innerJoin(clients, eq(clients.id, clientPackages.clientId))
    .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
    .where(eq(clientPackages.stripePaymentIntentId, paymentIntentId))
    .limit(1)
  // A workshop (whose booking is above and IS the purchase), a corporate package
  // (which creates no client-package row, so there is nothing to void) or a
  // standalone Add-On payment. The money is recorded and nothing else moves.
  if (!pkg) {
    await stampRefunded(paymentIntentId)
    return
  }

  // `active` is the same lever the nightly expiry sweep already pulls — no new
  // column, and the payment's status records *why* it went down.
  await db
    .update(clientPackages)
    .set({ active: false })
    .where(and(eq(clientPackages.id, pkg.id), eq(clientPackages.active, true)))

  // Every FUTURE booking the purchase paid for is cancelled. Attended
  // and no-showed bookings stand as history: un-attending a class would rewrite
  // instructor payroll and the studio's attendance record.
  const cancelled = await cancelFutureBookings(pkg.id)

  // The payment row's status becomes refunded and the time is stamped. Last, and
  // the winner of the race sends the email.
  if (!(await stampRefunded(paymentIntentId))) return

  // The member is told. The provider sends its own money receipt; ours is the
  // one that says the plan has ended and names the classes that were cancelled.
  // Cancelling someone's booked classes silently is not acceptable — and this
  // must never take the unwind down with it, so it swallows.
  try {
    const { slug, variables } = composeRefundEmail({
      clientName: pkg.clientName,
      packageName: pkg.classPackageName ?? pkg.ptPackageName ?? 'Your package',
      amountSgd: payment.amountSgd,
      cancelled,
      accountUrl: ACCOUNT_URL,
    })
    await sendTemplatedEmail({
      slug,
      recipient: { email: pkg.clientEmail, userId: pkg.clientId, userKind: 'client' },
      variables,
    })
  } catch (err) {
    reportError(err, 'refund email failed', { scope: 'refunds', paymentIntentId })
  }
}

/**
 * Mark the payment refunded, once. `status <> 'refunded'` makes the write its
 * own lock: two concurrent deliveries of the same event both do the (idempotent)
 * unwinding, and exactly one of them gets a row back and sends the email.
 */
async function stampRefunded(paymentIntentId: string): Promise<boolean> {
  const rows = await db
    .update(stripePayments)
    .set({ status: 'refunded', refundedAt: new Date() })
    .where(
      and(
        eq(stripePayments.paymentIntentId, paymentIntentId),
        ne(stripePayments.status, 'refunded'),
      ),
    )
    .returning({ id: stripePayments.id })
  return rows.length > 0
}

/**
 * Cancel every future booking the voided purchase paid for, through the existing
 * cancel service with an admin source — so waitlist promotion comes free and
 * there is one cancellation path rather than two.
 *
 * Only `confirmed` and `pending` bookings whose session is still ahead are
 * touched, which is both the history rule and the idempotency: a second pass
 * finds none.
 */
async function cancelFutureBookings(clientPackageId: string): Promise<CancelledSession[]> {
  const now = new Date()
  const [classRows, ptRows] = await Promise.all([
    db
      .select({ id: bookings.id, name: classTypes.name, startsAt: classes.startsAt })
      .from(bookings)
      .innerJoin(classes, eq(classes.id, bookings.classId))
      .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
      .where(
        and(
          eq(bookings.clientPackageId, clientPackageId),
          eq(bookings.state, 'confirmed'),
          eq(bookings.checkInState, 'pending'),
          gt(classes.startsAt, now),
        ),
      ),
    db
      .select({ id: bookings.id, startsAt: ptSessions.startsAt })
      .from(bookings)
      .innerJoin(ptSessions, eq(ptSessions.id, bookings.ptSessionId))
      .where(
        and(
          eq(bookings.clientPackageId, clientPackageId),
          eq(bookings.state, 'confirmed'),
          eq(bookings.checkInState, 'pending'),
          gt(ptSessions.startsAt, now),
        ),
      ),
  ])

  const targets: Array<{ id: string; name: string; startsAt: Date }> = [
    ...classRows.map(r => ({ id: r.id, name: String(r.name), startsAt: r.startsAt })),
    ...ptRows.map(r => ({ id: r.id, name: 'Private session', startsAt: r.startsAt })),
  ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

  const cancelled: CancelledSession[] = []
  for (const t of targets) {
    try {
      await cancelBooking({ bookingId: t.id, source: 'admin', packageVoided: true })
      cancelled.push({ name: t.name, startsAt: t.startsAt })
    } catch (err) {
      // One booking that will not cancel — checked in between the read and the
      // write, most likely — must not strand the rest, nor hold back the email
      // telling the member their plan has ended. It is reported, loudly: a
      // confirmed booking left on a Voided package is a seat someone was
      // refunded for, and a human has to settle it.
      reportError(err, 'refund could not cancel booking', { scope: 'refunds', bookingId: t.id })
    }
  }
  return cancelled
}
