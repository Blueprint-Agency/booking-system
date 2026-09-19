/**
 * Refunds (§14).
 *
 * **A Refund voids the purchase it paid for, cancels every future booking on it,
 * and hands the Promo Code back.** There is no partial refund and no separate
 * admin revoke.
 *
 * Since #92 a Refund is something done to a **Purchase** rather than to a
 * payment intent. The Purchase owns the money and a payment is evidence of part
 * of it, so issuing a Refund walks the Purchase's payments and returns every
 * one: a purchase settled by two cards is unwound by one admin action rather
 * than two. Today every Purchase holds exactly one payment, so an admin sees no
 * difference — the path is simply ready for the ones that will hold two.
 *
 * The shape of this module is the decision: `issueRefund` only calls the
 * payment provider and returns, and `unwindRefund` — driven by
 * `charge.refunded` — does all of the rest. The provider's dashboard can never
 * be locked out, so a refund can always arrive off-book; writing the unwind once
 * makes a dashboard refund and a button refund indistinguishable by
 * construction. Which is also why **every step below is a no-op on a second
 * pass** — the provider retries, and both paths land here.
 *
 * Since #95 a Purchase that granted nothing can be returned too, and it is the
 * one case where the unwind has nothing to unwind: no plan to Void, no bookings
 * to cancel, no place to give up, because the grant runs on settlement and this
 * sale never settled. It closes as **abandoned** rather than refunded — money
 * that was never revenue must not be subtracted from Net as though it had been.
 */
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import { db, withTenant } from '../../db'
import { tenantForPaymentIntent } from '../../db/routing'
import { auditLog, purchases, stripePayments } from '../../db/schema/ledger'
import { bookings } from '../../db/schema/bookings'
import { classPackages, clientPackages, ptPackages } from '../../db/schema/packages'
import { classes, ptSessions, workshops, workshopTiers, workshopTierDays, workshopDays } from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { clients } from '../../db/schema/identity'
import { requireTenantUrl } from '../tenants/urls'
import { stripeForProviderAccount } from '../../lib/stripe'
import { reportError } from '../../shared/logger'
import { toCents } from '../../shared/money'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { cancelBooking } from '../bookings/cancel'
import { refundPromoCodeRedemption } from '../packages/promo-redemption'
import { sendTemplatedEmail } from '../notifications/send'
import { heldPayments } from './balance'
import {
  markPurchaseAbandoned,
  markPurchaseRefunded,
  paymentsForPurchase,
  purchaseById,
  type PurchasePayment,
  type PurchaseRow,
} from './purchases'
import {
  attendedNotice,
  composeAbandonedRefundEmail,
  composeRefundEmail,
  isUntouched,
  type CancelledSession,
} from './refund-notice'

/**
 * The refunded member's own account page, on their own studio's app.
 *
 * A function and not a module constant, which is the substance of the change
 * rather than a style choice: a constant can only be built from a
 * platform-wide origin, and this email is sent to a member of whichever studio
 * took the money. One studio's `/account` is not a page another studio's member
 * can even sign into.
 */
const accountUrlFor = (tenantId: string) =>
  requireTenantUrl('client', tenantId).then(base => `${base}/account`)

/**
 * Is there money at the provider to give back?
 *
 * Read off the Purchase's own Balance, which is derived from the payment rows
 * and means *money currently held*: a comp grant, a $0 trial and a Promo Code
 * that took the total to zero never reached the provider and hold nothing, and
 * a Purchase already refunded has been zeroed by `markPurchaseRefunded`. It is
 * the same question the payment intent used to answer by being non-null, asked
 * of the record that now owns the money.
 */
const holdsMoney = (amountPaidSgd: string | null): boolean =>
  amountPaidSgd != null && toCents(amountPaidSgd) > 0

export interface RefundState {
  /** There is money at the provider to give back. */
  refundable: boolean
  attendedCount: number
  /** Null when the purchase is **Untouched** — there is nothing to warn about. */
  notice: string | null
  /**
   * How many payments the Refund will return (#93).
   *
   * A Purchase settled with two cards is unwound by two provider calls, so two
   * returns appear on the studio's statement and two on the member's. The admin
   * pressed one button; the dialog says so before they do, because a second
   * unexplained line on a statement is a phone call.
   */
  paymentCount: number
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
export async function refundStatesFor(
  tenantId: string,
  clientId: string,
): Promise<Record<string, RefundState>> {
  const rows = await db
    .select({
      id: clientPackages.id,
      purchaseId: clientPackages.purchaseId,
      amountPaidSgd: purchases.amountPaidSgd,
      count: sql<number>`count(${bookings.id})::int`,
      since: sql<string | null>`min(coalesce(${classes.startsAt}, ${ptSessions.startsAt}))`,
    })
    .from(clientPackages)
    .leftJoin(purchases, eq(purchases.id, clientPackages.purchaseId))
    .leftJoin(
      bookings,
      and(
        eq(bookings.clientPackageId, clientPackages.id),
        inArray(bookings.checkInState, ['attended', 'no_show']),
      ),
    )
    .leftJoin(classes, eq(classes.id, bookings.classId))
    .leftJoin(ptSessions, eq(ptSessions.id, bookings.ptSessionId))
    .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.clientId, clientId)))
    .groupBy(clientPackages.id, clientPackages.purchaseId, purchases.amountPaidSgd)

  const held = await heldPaymentCounts(tenantId, rows.map(r => r.purchaseId))

  const out: Record<string, RefundState> = {}
  for (const r of rows) {
    const count = Number(r.count ?? 0)
    out[r.id] = {
      refundable: holdsMoney(r.amountPaidSgd),
      attendedCount: count,
      notice: attendedNotice(count, r.since ? new Date(r.since) : null),
      paymentCount: (r.purchaseId && held.get(r.purchaseId)) || 0,
    }
  }
  return out
}

/**
 * How many payments each of these Purchases still has at the provider.
 *
 * The **held** set — `succeeded` and `pending` both — because that is exactly
 * what `issueRefund` will call the provider about, and a dialog that promised a
 * different number from the one the statement shows would be worse than saying
 * nothing. See `heldPayments` in balance.ts for why `pending` counts as held.
 *
 * One query for the whole page, keyed by Purchase, because the client detail
 * page reads every row at once.
 */
export async function heldPaymentCounts(
  tenantId: string,
  purchaseIds: (string | null)[],
): Promise<Map<string, number>> {
  const ids = purchaseIds.filter((id): id is string => id != null)
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({
      purchaseId: stripePayments.purchaseId,
      n: sql<number>`count(*)::int`,
    })
    .from(stripePayments)
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        inArray(stripePayments.purchaseId, ids),
        inArray(stripePayments.status, ['succeeded', 'pending']),
      ),
    )
    .groupBy(stripePayments.purchaseId)
  return new Map(rows.map(r => [r.purchaseId, Number(r.n ?? 0)]))
}

/**
 * Issue the Refund. **This calls the payment provider, once per payment the
 * Purchase holds, and returns.** Nothing is unwound here: the `charge.refunded`
 * webhook each call triggers does all of it, which is what makes this button
 * and the provider's dashboard the same operation.
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
  tenantId: string
  clientId: string
  clientPackageId: string
  reason: string
  actorStaffId: string
}): Promise<{
  purchaseId: string
  paymentIntentIds: string[]
  attendedCount: number
  override: boolean
}> {
  const [pkg] = await db
    .select({
      id: clientPackages.id,
      clientId: clientPackages.clientId,
      purchaseId: clientPackages.purchaseId,
    })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.tenantId, args.tenantId),
        eq(clientPackages.id, args.clientPackageId),
        eq(clientPackages.clientId, args.clientId),
      ),
    )
    .limit(1)
  if (!pkg) throw new NotFoundError('client_package_not_found')

  const count =
    (await refundStatesFor(args.tenantId, args.clientId))[args.clientPackageId]?.attendedCount ?? 0

  return refundPurchaseAndAudit({
    tenantId: args.tenantId,
    purchaseId: pkg.purchaseId,
    targetTable: 'client_packages',
    targetId: args.clientPackageId,
    actorStaffId: args.actorStaffId,
    reason: args.reason,
    attendedCount: count,
  })
}

/**
 * Every workshop purchase this member holds, with what the portal shows beside
 * its Refund button (§14, issue #36). A workshop's booking **is** the purchase —
 * there is no `client_packages` row for it — so `refundable`/`notice` are
 * computed straight off the one booking rather than via `refundStatesFor`.
 *
 * Only `confirmed` bookings are listed: a refunded workshop booking is flipped
 * to `cancelled` by `unwindRefund`, and a Voided package disappears from the
 * portal the same way — there is nothing left here to hang a second refund on.
 */
export interface WorkshopPurchase {
  bookingId: string
  workshopName: string
  tierName: string | null
  amountPaidSgd: string
  listPriceSgd: string
  purchasedAt: Date
  refundable: boolean
  refundNotice: string | null
  /** How many payments the Refund will return — see `RefundState`. */
  paymentCount: number
}

export async function listWorkshopPurchases(
  tenantId: string,
  clientId: string,
): Promise<WorkshopPurchase[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      workshopName: workshops.name,
      tierId: bookings.workshopTierId,
      tierName: workshopTiers.name,
      amountPaidSgd: bookings.amountPaidSgd,
      listPriceSgd: bookings.listPriceSgd,
      purchasedAt: bookings.bookedAt,
      checkInState: bookings.checkInState,
      purchasePaidSgd: purchases.amountPaidSgd,
      purchaseId: bookings.purchaseId,
    })
    .from(bookings)
    .innerJoin(workshops, eq(workshops.id, bookings.workshopId))
    .leftJoin(workshopTiers, eq(workshopTiers.id, bookings.workshopTierId))
    .leftJoin(purchases, eq(purchases.id, bookings.purchaseId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.clientId, clientId),
        eq(bookings.kind, 'workshop'),
        eq(bookings.state, 'confirmed'),
      ),
    )
  if (rows.length === 0) return []

  // The date the notice quotes — the earliest day the booked tier covers —
  // batched per tier rather than per row, mirroring `listMyWorkshopBookings`.
  const tierIds = Array.from(new Set(rows.map(r => r.tierId).filter((v): v is string => Boolean(v))))
  const sinceByTier = new Map<string, Date>()
  if (tierIds.length) {
    const dayRows = await db
      .select({ tierId: workshopTierDays.workshopTierId, startsAt: workshopDays.startsAt })
      .from(workshopTierDays)
      .innerJoin(workshopDays, eq(workshopDays.id, workshopTierDays.workshopDayId))
      .where(
        and(
          eq(workshopTierDays.tenantId, tenantId),
          inArray(workshopTierDays.workshopTierId, tierIds),
        ),
      )
    for (const d of dayRows) {
      const cur = sinceByTier.get(d.tierId)
      if (!cur || d.startsAt < cur) sinceByTier.set(d.tierId, d.startsAt)
    }
  }

  const held = await heldPaymentCounts(tenantId, rows.map(r => r.purchaseId))

  return rows.map(r => {
    const count = r.checkInState === 'attended' || r.checkInState === 'no_show' ? 1 : 0
    return {
      paymentCount: (r.purchaseId && held.get(r.purchaseId)) || 0,
      bookingId: r.bookingId,
      workshopName: r.workshopName,
      tierName: r.tierName,
      amountPaidSgd: r.amountPaidSgd ?? '0.00',
      listPriceSgd: r.listPriceSgd ?? '0.00',
      purchasedAt: r.purchasedAt,
      refundable: holdsMoney(r.purchasePaidSgd),
      refundNotice: attendedNotice(count, r.tierId ? sinceByTier.get(r.tierId) ?? null : null),
    }
  })
}

/**
 * Issue the Refund for a workshop purchase — the same operation as
 * `issueRefund`, aimed at a booking instead of a `client_packages` row since a
 * workshop purchase has none. Calls the provider and returns; `unwindRefund`
 * (already workshop-aware) does the rest, so this button and a dashboard refund
 * are indistinguishable by construction, same as for packages.
 */
export async function issueWorkshopRefund(args: {
  tenantId: string
  clientId: string
  bookingId: string
  reason: string
  actorStaffId: string
}): Promise<{
  purchaseId: string
  paymentIntentIds: string[]
  attendedCount: number
  override: boolean
}> {
  const [booking] = await db
    .select({
      id: bookings.id,
      purchaseId: bookings.purchaseId,
      checkInState: bookings.checkInState,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, args.tenantId),
        eq(bookings.id, args.bookingId),
        eq(bookings.clientId, args.clientId),
        eq(bookings.kind, 'workshop'),
      ),
    )
    .limit(1)
  if (!booking) throw new NotFoundError('workshop_booking_not_found')

  const count = booking.checkInState === 'attended' || booking.checkInState === 'no_show' ? 1 : 0

  return refundPurchaseAndAudit({
    tenantId: args.tenantId,
    purchaseId: booking.purchaseId,
    targetTable: 'bookings',
    targetId: args.bookingId,
    actorStaffId: args.actorStaffId,
    reason: args.reason,
    attendedCount: count,
  })
}

/**
 * The provider call itself, **on the account the money came in on** (#97).
 *
 * Not the account the studio sells on today. A studio that moves onto its own
 * credentials leaves its history on the platform's account — no provider hands
 * a payment intent across accounts — so its old sales stay there, refundable,
 * indefinitely, and a Purchase straddling the move holds payments on both. The
 * account therefore comes off the payment row rather than off the Tenant, and
 * `null` is the platform's own.
 *
 * Keyed on the payment intent, which is the money path's only real guard — the
 * caller's `already_refunded` check reads a status the webhook flips
 * asynchronously, so a double-click or a client retry would otherwise reach the
 * provider twice. The key is the intent alone and not the Tenant, because an
 * intent belongs to one account and the key is scoped to that account — which
 * is now true across the migration boundary as well, since the account the key
 * is scoped to is the one this call is made on.
 */
export async function refundAtProvider(
  tenantId: string,
  paymentIntentId: string,
  providerAccountId: string | null,
): Promise<void> {
  const stripe = await stripeForProviderAccount(tenantId, providerAccountId)
  await stripe.refunds.create(
    { payment_intent: paymentIntentId },
    { idempotencyKey: `refund:${paymentIntentId}` },
  )
}

/**
 * Give back every payment a Purchase is still holding, each on its own account.
 *
 * In sequence, because they are one decision and the audit row below covers
 * them together. A call that fails part-way leaves some payments returned and
 * some not, which the unwind refuses to treat as a finished Refund — it reports
 * it and waits, and the admin who pressed the button sees the error.
 */
async function returnEveryPayment(
  tenantId: string,
  toReturn: readonly PurchasePayment[],
): Promise<void> {
  for (const payment of toReturn) {
    await refundAtProvider(tenantId, payment.paymentIntentId, payment.providerAccountId)
  }
}

/**
 * The part `issueRefund` and `issueWorkshopRefund` share: return every payment
 * the Purchase holds, then write the one record of why an admin refunded
 * against the studio's rule.
 *
 * The provider calls run in sequence and one audit row covers them, because
 * they are one decision. A call that fails part-way through leaves a Purchase
 * with some payments returned and some not, which the unwind refuses to treat
 * as a finished Refund — it reports it and waits, and the admin who pressed the
 * button sees the error.
 *
 * The audit row is written after the provider has taken it, so the log records
 * refunds that actually happened. The generic audit middleware records the
 * request; this row records the decision — but the money has already moved, so
 * a failure to write it is reported rather than thrown back at an admin whose
 * refund did go through.
 */
async function refundPurchaseAndAudit(args: {
  tenantId: string
  purchaseId: string | null
  targetTable: 'client_packages' | 'bookings'
  targetId: string
  actorStaffId: string
  reason: string
  attendedCount: number
}): Promise<{
  purchaseId: string
  paymentIntentIds: string[]
  attendedCount: number
  override: boolean
}> {
  // A comp grant, a $0 trial, a free workshop place or a Promo Code that took
  // the total to zero never reached the payment provider, so there is no money
  // to give back. Corporate is out of scope for the same reason from the other
  // end — it creates no client-package row at all, so it cannot be named here.
  if (!args.purchaseId) throw new BadRequestError('purchase_not_refundable')

  const payments = await paymentsForPurchase(args.tenantId, args.purchaseId)
  const toReturn = heldPayments(payments)
  if (toReturn.length === 0) {
    // Nothing held. Told apart so an admin double-clicking a button reads
    // "already refunded" rather than "not refundable", which is the difference
    // between a race they can ignore and a purchase they should look at.
    if (payments.some(p => p.status === 'refunded')) throw new ConflictError('already_refunded')
    throw new BadRequestError('purchase_not_refundable')
  }

  const override = !isUntouched(args.attendedCount)
  const paymentIntentIds = toReturn.map(p => p.paymentIntentId)
  await returnEveryPayment(args.tenantId, toReturn)

  try {
    await db.insert(auditLog).values({
      tenantId: args.tenantId,
      actorStaffId: args.actorStaffId,
      actorType: 'staff',
      action: 'purchase_refunded',
      targetTable: args.targetTable,
      targetId: args.targetId,
      payload: {
        reason: args.reason,
        override,
        attendedCount: args.attendedCount,
        purchaseId: args.purchaseId,
        paymentIntentIds,
      },
    })
  } catch (err) {
    reportError(err, 'refund audit row failed', {
      scope: 'refunds',
      targetTable: args.targetTable,
      targetId: args.targetId,
      reason: args.reason,
    })
  }

  return { purchaseId: args.purchaseId, paymentIntentIds, attendedCount: args.attendedCount, override }
}

/**
 * Refund a Purchase that was part-paid and **never granted** (#95).
 *
 * The money's only way out. A member who part-pays and never comes back leaves
 * the studio holding real cash against an entitlement that does not exist, and
 * every other path in this module refuses to touch it — `issueRefund` is aimed
 * at a plan and `issueWorkshopRefund` at a booking, and an ungranted Purchase
 * has neither.
 *
 * Same shape as the rest: **this calls the provider and returns.** The
 * `charge.refunded` webhook each call triggers does the unwind, which is what
 * keeps a refund issued from here and one issued from the provider's dashboard
 * the same operation. There is no attended count and no override, because
 * nothing was delivered — a Purchase that granted nothing cannot have been used,
 * so there is no studio rule to refund against and nothing to warn an admin
 * about beyond how many returns will land on the statement.
 */
export async function issueOpenPurchaseRefund(args: {
  tenantId: string
  purchaseId: string
  reason: string
  actorStaffId: string
}): Promise<{ purchaseId: string; paymentIntentIds: string[]; returnedSgd: string }> {
  const purchase = await purchaseById(args.tenantId, args.purchaseId)
  if (!purchase) throw new NotFoundError('purchase_not_found')
  // Only an ungranted Purchase comes through here. A `paid` one delivered
  // something and is refunded through the plan or the booking it bought, so
  // that the plan is Voided and its future bookings cancelled; sending it down
  // this path would return the money and leave the entitlement standing.
  if (purchase.status !== 'open') {
    if (purchase.status === 'abandoned') throw new ConflictError('already_refunded')
    throw new BadRequestError('purchase_not_open')
  }

  const payments = await paymentsForPurchase(args.tenantId, args.purchaseId)
  const toReturn = heldPayments(payments)
  // An `open` Purchase with nothing against it is an abandoned click, not money
  // the studio is holding — the member owes nothing on it and does not remember
  // making it. There is nothing to give back.
  if (toReturn.length === 0) throw new BadRequestError('purchase_not_refundable')

  const returnedSgd = purchase.amountPaidSgd
  const paymentIntentIds = toReturn.map(p => p.paymentIntentId)
  // A part-paid Purchase is exactly the shape that can straddle a studio's move
  // onto its own account, so each payment goes back where it came in (#97).
  await returnEveryPayment(args.tenantId, toReturn)

  // Written after the provider has taken it, and reported rather than thrown if
  // it fails — the money has already moved, and an admin whose refund went
  // through must not be told it did not. Same reasoning as
  // `refundPurchaseAndAudit`.
  try {
    await db.insert(auditLog).values({
      tenantId: args.tenantId,
      actorStaffId: args.actorStaffId,
      actorType: 'staff',
      action: 'purchase_abandoned',
      targetTable: 'purchases',
      targetId: args.purchaseId,
      payload: {
        reason: args.reason,
        purchaseId: args.purchaseId,
        paymentIntentIds,
        returnedSgd,
      },
    })
  } catch (err) {
    reportError(err, 'abandoned refund audit row failed', {
      scope: 'refunds',
      purchaseId: args.purchaseId,
      reason: args.reason,
    })
  }

  return { purchaseId: args.purchaseId, paymentIntentIds, returnedSgd }
}

/**
 * The unwind, driven by `charge.refunded`. **Every step is a no-op on a second
 * pass** — each write is conditioned on the state it is moving away from, and
 * the only step that cannot be (the email) is gated on the Purchase's flip,
 * which is atomic.
 *
 * The provider's event names one intent, so the intent is where this starts;
 * everything after routes on the **Purchase** that payment is evidence of part
 * of. That is what lets one admin action return a purchase settled by two cards
 * and unwind it once, when the second `charge.refunded` lands.
 */
export async function unwindRefund(
  paymentIntentId: string,
  claimedTenantId?: string | null,
): Promise<void> {
  // Route first, then work. The provider's event names an intent and nothing
  // else; with the tenant policies live, the application role cannot read across
  // tenants to find out whose it is, so the one narrow cross-tenant question —
  // "whose intent is this?" — goes through the owner-owned resolver in migration
  // 0034. Everything after runs inside that tenant's context.
  const tenantId = await tenantForPaymentIntent(paymentIntentId, claimedTenantId)
  // An intent this system never recorded: the same silence as a missing row.
  if (!tenantId) return
  return withTenant(tenantId, () => unwindRefundForTenant(paymentIntentId))
}

async function unwindRefundForTenant(paymentIntentId: string): Promise<void> {
  const [payment] = await db
    .select({
      // The provider's event names an intent and nothing else, and the intent is
      // unique across the platform — so the payment row is where the Tenant
      // comes from, and every write below is scoped with it. Reading it off the
      // money is what makes a dashboard refund and a button refund land in the
      // same studio without the webhook having to be told which.
      tenantId: stripePayments.tenantId,
      purchaseId: stripePayments.purchaseId,
    })
    .from(stripePayments)
    .where(eq(stripePayments.paymentIntentId, paymentIntentId))
    .limit(1)
  // No row means a charge this system never recorded.
  if (!payment) return
  const tenantId = payment.tenantId!

  // This payment is back. Stamped before the Purchase is looked at, and NOT as
  // the gate for the unwind: the gate is the Purchase's own status, stamped
  // last. A redelivery that arrives after this write still walks the whole
  // unwind, which is what makes a pass that died halfway simply get redone.
  await stampPaymentRefunded(tenantId, paymentIntentId)
  await unwindPurchase(tenantId, payment.purchaseId)
}

/**
 * The unwind proper, routed on the Purchase.
 *
 * **A Refund counts as complete only when every payment has been returned.** A
 * Purchase holding a payment the provider still has is not a refunded purchase
 * — it is a half-done one, and voiding the plan there would take a member's
 * entitlement away while keeping some of their money. So it is reported and
 * left alone, and the next `charge.refunded` finishes the job.
 *
 * The Purchase's own flip is stamped **last** on purpose. As a first step it
 * would be a neat gate and a trap: a delivery that died halfway would leave the
 * sale marked refunded and the plan still live, and the provider's retry would
 * return at the gate having unwound nothing. Stamping at the end means a
 * half-finished pass is simply redone, and the one non-repeatable act — the
 * member's email — rides on the one atomic write.
 */
async function unwindPurchase(tenantId: string, purchaseId: string): Promise<void> {
  const purchase = await purchaseById(tenantId, purchaseId)
  // Already refunded or already abandoned means a redelivery of an event that
  // completed.
  if (!purchase || purchase.status === 'refunded' || purchase.status === 'abandoned') return

  const payments = await paymentsForPurchase(tenantId, purchaseId)
  const outstanding = heldPayments(payments)
  if (outstanding.length > 0) {
    reportError(
      new Error(`purchase ${purchaseId} is part-refunded: ${outstanding.length} payment(s) still held`),
      'refund not complete — some payments not returned',
      {
        scope: 'refunds',
        purchaseId,
        heldIntents: outstanding.map(p => p.paymentIntentId).join(','),
      },
    )
    return
  }

  // The Promo Code comes back — to the member's one-use limit and the code's
  // pool at once. The row survives as `refunded`; only the partial index lets
  // it. Held against the intent that consumed it, so a Purchase settled by more
  // than one payment hands the code back on whichever of them carried it.
  for (const payment of payments) {
    await refundPromoCodeRedemption(tenantId, payment.paymentIntentId)
  }

  // A Purchase that granted nothing (#95). It is still `open` at this point,
  // which is precisely the statement that nothing was delivered: the grant runs
  // on settlement, and settlement is what moves a Purchase off `open`. So the
  // whole of the unwind below — voiding a plan, cancelling future bookings,
  // ending a workshop place — has nothing to act on, and the sale is closed as
  // **abandoned** rather than refunded. Told apart because they are different
  // events: a refund reverses revenue, and this money was never revenue.
  if (purchase.status === 'open') {
    await abandonPurchase(tenantId, purchase)
    return
  }

  // A workshop's booking IS the purchase, so it is what gets cancelled.
  // Attended and no-showed workshops stand as history for the same reason
  // classes do.
  //
  // Deliberately NOT through `cancelBooking`: that service refuses a workshop
  // outright (`workshop_cancel_unsupported`) because a workshop booking has no
  // package, no credit and no cancellation-cap meaning — the `cancellations`
  // row it writes is typed `class | pt`. And `stripe_refunded` rather than the
  // `n_a` the class and PT bookings take: that rule is about bookings a voided
  // package paid for, where returning a credit would be meaningless. Here money
  // genuinely went back for this exact booking, which is what the arm is for.
  await db
    .update(bookings)
    .set({ state: 'cancelled', refundOutcome: 'stripe_refunded', cancelledAt: new Date() })
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.purchaseId, purchaseId),
        eq(bookings.state, 'confirmed'),
        eq(bookings.checkInState, 'pending'),
      ),
    )

  // The purchase is **Voided**. Matched on the plan's OWN Purchase, never on
  // `stripe_payments.client_package_id`: a standalone Cross-Location Add-On
  // payment also points at the plan, and refunding an Add-On must not void the
  // plan someone else's money paid for. The Add-On is its own Purchase and has
  // no independent unwind — it dies with the plan, free, because it is a column
  // on this row.
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
    .where(
      and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.purchaseId, purchaseId)),
    )
    .limit(1)
  // A workshop (whose booking is above and IS the purchase), a corporate package
  // (which creates no client-package row, so there is nothing to void), Merch or
  // a standalone Add-On payment. The money is recorded and nothing else moves.
  if (!pkg) {
    await markPurchaseRefunded(tenantId, purchaseId)
    return
  }

  // `active` is the same lever the nightly expiry sweep already pulls — no new
  // column, and the payment's status records *why* it went down.
  await db
    .update(clientPackages)
    .set({ active: false })
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.id, pkg.id),
        eq(clientPackages.active, true),
      ),
    )

  // Every FUTURE booking the purchase paid for is cancelled. Attended
  // and no-showed bookings stand as history: un-attending a class would rewrite
  // instructor payroll and the studio's attendance record.
  const cancelled = await cancelFutureBookings(tenantId, pkg.id)

  // The Purchase's status becomes refunded and its Balance goes to zero. Last,
  // and the winner of the race sends the email.
  if (!(await markPurchaseRefunded(tenantId, purchaseId))) return

  // The member is told. The provider sends its own money receipt; ours is the
  // one that says the plan has ended and names the classes that were cancelled.
  // Cancelling someone's booked classes silently is not acceptable — and this
  // must never take the unwind down with it, so it swallows.
  try {
    const { slug, variables } = composeRefundEmail({
      clientName: pkg.clientName,
      packageName: pkg.classPackageName ?? pkg.ptPackageName ?? 'Your package',
      // What the member gets back is the whole Purchase, which is what the
      // Balance held a moment ago — however many cards it arrived on.
      amountSgd: purchase.amountPaidSgd,
      cancelled,
      accountUrl: await accountUrlFor(tenantId),
    })
    await sendTemplatedEmail({
      tenantId,
      slug,
      recipient: { email: pkg.clientEmail, userId: pkg.clientId, userKind: 'client' },
      variables,
    })
  } catch (err) {
    reportError(err, 'refund email failed', { scope: 'refunds', purchaseId })
  }
}

/**
 * Close an ungranted Purchase and tell the member their money is back (#95).
 *
 * Two steps and no third: the status flip, and the email that rides on winning
 * it. There is deliberately nothing to unwind — no plan to Void, no bookings to
 * cancel, no place to give up — because a Purchase that never settled granted
 * none of those. The Promo Code has already been handed back by the caller,
 * which is the one thing a part payment did consume.
 *
 * The flip is last and atomic for the same reason the refund flip is: it is what
 * decides which of two concurrent deliveries sends the one email.
 */
async function abandonPurchase(tenantId: string, purchase: PurchaseRow): Promise<void> {
  // Read before the flip zeroes it — this is what the member is being told came
  // back, and what the portal reconciles against the statement.
  const returnedSgd = purchase.amountPaidSgd

  if (!(await markPurchaseAbandoned(tenantId, purchase.id))) return

  // The money has gone back and the Purchase is closed; the only thing left is
  // telling the member, and a member permanently deleted (#144) is not there to
  // be told. The sale survives them with their identity removed, so there is no
  // address to write to and nothing further to do.
  if (!purchase.clientId) return

  const [client] = await db
    .select({ name: clients.name, email: clients.email })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, purchase.clientId)))
    .limit(1)
  if (!client) return

  // The provider sends its own money receipt; ours is the one that says the
  // purchase is closed and that nothing was ever issued on it — which is the
  // question a member who part-paid will otherwise ring the studio to ask. It
  // must never take the unwind down with it, so it swallows.
  try {
    const metadata = purchase.metadata as Record<string, string>
    const { slug, variables } = composeAbandonedRefundEmail({
      clientName: client.name,
      itemName: metadata.item_name || 'your purchase',
      amountSgd: returnedSgd,
      accountUrl: await accountUrlFor(tenantId),
    })
    await sendTemplatedEmail({
      tenantId,
      slug,
      recipient: { email: client.email, userId: purchase.clientId, userKind: 'client' },
      variables,
    })
  } catch (err) {
    reportError(err, 'abandoned refund email failed', { scope: 'refunds', purchaseId: purchase.id })
  }
}

/**
 * Mark one payment refunded. Idempotent by the same `status <> 'refunded'`
 * predicate the Purchase's own flip uses; unlike that one it gates nothing, so
 * its return value is not needed.
 */
async function stampPaymentRefunded(tenantId: string, paymentIntentId: string): Promise<void> {
  await db
    .update(stripePayments)
    .set({ status: 'refunded', refundedAt: new Date() })
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        eq(stripePayments.paymentIntentId, paymentIntentId),
        ne(stripePayments.status, 'refunded'),
      ),
    )
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
async function cancelFutureBookings(
  tenantId: string,
  clientPackageId: string,
): Promise<CancelledSession[]> {
  const now = new Date()
  const [classRows, ptRows] = await Promise.all([
    db
      .select({ id: bookings.id, name: classTypes.name, startsAt: classes.startsAt })
      .from(bookings)
      .innerJoin(classes, eq(classes.id, bookings.classId))
      .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
      .where(
        and(
          eq(bookings.tenantId, tenantId),
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
          eq(bookings.tenantId, tenantId),
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
      await cancelBooking(tenantId, { bookingId: t.id, source: 'admin', packageVoided: true })
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
