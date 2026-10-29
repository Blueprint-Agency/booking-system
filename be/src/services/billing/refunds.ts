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
import { and, count, eq, gt, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
import { afterCommit, db, retryingTransaction, withTenant } from '../../db'
import { isRetryableAbort } from '../../db/retryable-abort'
import { tenantForPaymentIntent } from '../../db/routing'
import { auditLog, purchases, stripePayments } from '../../db/schema/ledger'
import { bookings } from '../../db/schema/bookings'
import {
  classPackages,
  clientPackages,
  promoCodeRedemptions,
  promoCodes,
  ptPackages,
} from '../../db/schema/packages'
import { classes, ptSessions, workshops, workshopTiers, workshopTierDays, workshopDays } from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { clients } from '../../db/schema/identity'
import { now as clockNow } from '../../lib/clock'
import { requireTenantUrl } from '../tenants/urls'
import type Stripe from 'stripe'
import { paymentOnPlatformAccount, stripeForProviderAccount, stripeForTenant } from '../../lib/stripe'
import { outbound } from '../../lib/outbound'
import { logger, reportError } from '../../shared/logger'
import { toCents } from '../../shared/money'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { cancelBooking } from '../bookings/cancel'
import { lockForCancel } from '../bookings/lock-for-cancel'
import type { Tx } from '../schedule/roster'
import { closeCorporateRequestsForRefund } from '../corporate/requests'
import { refundPromoCodeRedemption } from '../packages/promo-redemption'
import { sendTemplatedEmail } from '../notifications/send'
import {
  heldPayments,
  REFUND_IN_FLIGHT_MS,
  refundInFlight,
  refundIncompleteSql,
  refundProgress,
  type RefundProgress,
} from './balance'
import {
  markPurchaseAbandoned,
  markPurchaseRefunded,
  paymentsForPurchase,
  purchaseById,
  restateBalanceOnPartRefund,
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
  /** The Purchase that paid for the package, which the bell links to (#485). */
  purchaseId: string | null
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
  /** Whether a Refund is already on its way — see `RefundProgress`. */
  progress: RefundProgress
  /** What the Refund gives back: the whole Purchase, however many cards it came in on. */
  amountSgd: string
  /**
   * Whether the Cross-Location Add-On goes back with it (#275). True when it was
   * bought with the plan, in the same charge; false when it was bought later on
   * a Purchase of its own, which dies with the plan and is not returned; null
   * when the plan has none.
   */
  addOnIncluded: boolean | null
  /** Classes and sessions still ahead on this package — every one is cancelled. */
  upcomingBookingCount: number
  /** The Promo Code the Refund hands back, or null when none was used. */
  promoCode: string | null
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
      crossLocationPaidSgd: clientPackages.crossLocationPaidSgd,
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
    .groupBy(
      clientPackages.id,
      clientPackages.purchaseId,
      clientPackages.crossLocationPaidSgd,
      purchases.amountPaidSgd,
    )

  const pkgIds = rows.map(r => r.id)
  const purchaseIds = rows.map(r => r.purchaseId)
  const [held, promos, upcoming, separateAddOns] = await Promise.all([
    heldPaymentsFor(tenantId, purchaseIds),
    promoCodesFor(tenantId, purchaseIds),
    upcomingBookingCounts(tenantId, pkgIds),
    separatelyBoughtAddOns(tenantId, pkgIds),
  ])

  const out: Record<string, RefundState> = {}
  for (const r of rows) {
    const count = Number(r.count ?? 0)
    const h = r.purchaseId ? held.get(r.purchaseId) : undefined
    out[r.id] = {
      purchaseId: r.purchaseId,
      refundable: holdsMoney(r.amountPaidSgd),
      attendedCount: count,
      notice: attendedNotice(count, r.since ? new Date(r.since) : null),
      paymentCount: h?.count ?? 0,
      progress: h?.progress ?? 'none',
      amountSgd: r.amountPaidSgd ?? '0.00',
      addOnIncluded: r.crossLocationPaidSgd == null ? null : !separateAddOns.has(r.id),
      upcomingBookingCount: upcoming.get(r.id) ?? 0,
      promoCode: (r.purchaseId && promos.get(r.purchaseId)) || null,
    }
  }
  return out
}

/** What a Purchase still has at the provider, as the Refund screens need it. */
export interface HeldPayments {
  /** How many payments a Refund will return — one line each on the statement. */
  count: number
  progress: RefundProgress
}

/**
 * The payments each of these Purchases still has at the provider, and how many
 * of them a Refund has already asked for.
 *
 * The **held** set — `succeeded` and `pending` both — because that is exactly
 * what `issueRefund` will call the provider about, and a dialog that promised a
 * different number from the one the statement shows would be worse than saying
 * nothing. See `heldPayments` in balance.ts for why `pending` counts as held.
 *
 * One query for the whole page, keyed by Purchase, because the client detail
 * page reads every row at once.
 */
export async function heldPaymentsFor(
  tenantId: string,
  purchaseIds: (string | null)[],
): Promise<Map<string, HeldPayments>> {
  const ids = purchaseIds.filter((id): id is string => id != null)
  if (ids.length === 0) return new Map()
  // A string, not a Date: a raw `sql` parameter is not run through the column's
  // mapper, and postgres-js will not serialise a bare Date there.
  const inFlightSince = new Date(clockNow().getTime() - REFUND_IN_FLIGHT_MS).toISOString()
  const held = sql`${stripePayments.status} in ('succeeded', 'pending')`
  const rows = await db
    .select({
      purchaseId: stripePayments.purchaseId,
      held: sql<number>`count(*) filter (where ${held})::int`,
      heldRequested: sql<number>`count(*) filter (where ${held} and ${stripePayments.refundRequestedAt} > ${inFlightSince})::int`,
      refunded: sql<number>`count(*) filter (where ${stripePayments.status} = 'refunded')::int`,
    })
    .from(stripePayments)
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        inArray(stripePayments.purchaseId, ids),
        inArray(stripePayments.status, ['succeeded', 'pending', 'refunded']),
      ),
    )
    .groupBy(stripePayments.purchaseId)
  return new Map(
    rows.map(r => {
      const counts = {
        held: Number(r.held ?? 0),
        heldRequested: Number(r.heldRequested ?? 0),
        refunded: Number(r.refunded ?? 0),
      }
      return [r.purchaseId, { count: counts.held, progress: refundProgress(counts) }]
    }),
  )
}

/**
 * A Purchase whose Refund an admin has to look at (#485), read off the same
 * payment rows, the same `refundProgress` and the same `REFUND_IN_FLIGHT_MS` as
 * the Refund screens, but across the studio and at `now` (the app clock).
 *
 * `incomplete` is `refundProgress` saying so (as `refundIncompleteSql`, its SQL twin). `stale` is a payment a Refund
 * asked for more than a day ago that is still held: Stripe never confirmed it,
 * and `refundInFlight` has stopped believing it. A press of Refund re-issues
 * those, which stamps them afresh, so the Purchase leaves the list.
 */
export interface RefundNeedingAdmin {
  purchaseId: string
  clientId: string
  clientName: string
  itemName: string
  /** `incomplete`: how many payments are back or asked for, of how many in all. */
  returnedCount: number
  paymentCount: number
  incomplete: boolean
  /** The money still held with a day-old ask against it; null when none is. */
  stale: { amountSgd: string; since: Date } | null
  /** When the Refund last asked the provider for anything. */
  lastAskedAt: Date
}

/**
 * The Purchases whose Refund an admin has to look at, one grouped row each, with
 * `incomplete` and `staleCount` computed in SQL: `refundsNeedingAdmin` reads the
 * rows and `countRefundsNeedingAdmin` counts them, so what needs an admin is
 * written once. A Purchase is a candidate when some payment is held and a Refund
 * has asked for one or one is back; it needs an admin when it is `incomplete`
 * (`refundIncompleteSql`, the twin of `refundProgress`) or has a stale ask.
 */
function refundCandidates(tenantId: string, now: Date) {
  // A string, not a Date: see `heldPaymentsFor`.
  const cutoff = new Date(now.getTime() - REFUND_IN_FLIGHT_MS).toISOString()
  const held = sql`${stripePayments.status} in ('succeeded', 'pending')`
  const asked = sql`${stripePayments.refundRequestedAt} is not null`
  const heldN = sql<number>`count(*) filter (where ${held})::int`
  const heldRequestedN = sql<number>`count(*) filter (where ${held} and ${stripePayments.refundRequestedAt} > ${cutoff})::int`
  const refundedN = sql<number>`count(*) filter (where ${stripePayments.status} = 'refunded')::int`
  const staleN = sql<number>`count(*) filter (where ${held} and ${stripePayments.refundRequestedAt} <= ${cutoff})::int`
  const incomplete = refundIncompleteSql({ held: heldN, heldRequested: heldRequestedN, refunded: refundedN })
  return db
    .select({
      purchaseId: stripePayments.purchaseId,
      clientId: purchases.clientId,
      clientName: clients.name,
      itemName: sql<string | null>`${purchases.metadata}->>'item_name'`.as('item_name'),
      held: heldN.as('held'),
      heldRequested: heldRequestedN.as('held_requested'),
      refunded: refundedN.as('refunded'),
      staleCount: staleN.as('stale_count'),
      incomplete: sql<boolean>`${incomplete}`.as('incomplete'),
      staleAmount: sql<string | null>`sum(${stripePayments.amountSgd}) filter (where ${held} and ${stripePayments.refundRequestedAt} <= ${cutoff})`.as('stale_amount'),
      staleSince: sql<string | null>`min(${stripePayments.refundRequestedAt}) filter (where ${held} and ${stripePayments.refundRequestedAt} <= ${cutoff})`.as('stale_since'),
      lastAskedAt: sql<string | null>`max(${stripePayments.refundRequestedAt})`.as('last_asked_at'),
    })
    .from(stripePayments)
    .innerJoin(purchases, eq(purchases.id, stripePayments.purchaseId))
    .innerJoin(clients, eq(clients.id, purchases.clientId))
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        inArray(stripePayments.status, ['succeeded', 'pending', 'refunded']),
        // A payment with no purchase or a purchase with no member has nobody to name.
        sql`${stripePayments.purchaseId} is not null and ${purchases.clientId} is not null`,
      ),
    )
    .groupBy(stripePayments.purchaseId, purchases.clientId, clients.name, purchases.metadata)
    .having(
      sql`count(*) filter (where ${held}) > 0
        and (count(*) filter (where ${held} and ${asked}) > 0 or count(*) filter (where ${stripePayments.status} = 'refunded') > 0)
        and (${incomplete} or ${staleN} > 0)`,
    )
}

/** How many Purchases have a Refund stopped part-way (`incomplete`) or a day-old ask Stripe never confirmed (`stale`). */
export async function countRefundsNeedingAdmin(
  tenantId: string,
  now: Date,
  which: 'incomplete' | 'stale',
): Promise<number> {
  const candidates = refundCandidates(tenantId, now).as('refund_candidates')
  const [row] = await db
    .select({ n: count() })
    .from(candidates)
    .where(which === 'incomplete' ? eq(candidates.incomplete, true) : gt(candidates.staleCount, 0))
  return Number(row?.n ?? 0)
}

export async function refundsNeedingAdmin(tenantId: string, now: Date): Promise<RefundNeedingAdmin[]> {
  const rows = await refundCandidates(tenantId, now)
  const out: RefundNeedingAdmin[] = []
  for (const r of rows) {
    if (!r.purchaseId || !r.clientId) continue
    const stale = r.staleCount > 0 && r.staleAmount && r.staleSince ? { amountSgd: r.staleAmount, since: new Date(r.staleSince) } : null
    out.push({
      purchaseId: r.purchaseId,
      clientId: r.clientId,
      clientName: r.clientName,
      itemName: r.itemName || 'Purchase',
      returnedCount: r.refunded + r.heldRequested,
      paymentCount: r.held + r.refunded,
      incomplete: r.incomplete,
      stale,
      lastAskedAt: new Date(r.lastAskedAt ?? r.staleSince ?? now),
    })
  }
  return out
}

/**
 * The Promo Code each Purchase used, which its Refund hands back
 * (`refundPromoCodeRedemption`). Held against the payment that consumed it, so
 * it is found through the Purchase's payments.
 */
async function promoCodesFor(
  tenantId: string,
  purchaseIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = purchaseIds.filter((id): id is string => id != null)
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ purchaseId: stripePayments.purchaseId, code: promoCodes.code })
    .from(stripePayments)
    .innerJoin(
      promoCodeRedemptions,
      and(
        eq(promoCodeRedemptions.tenantId, stripePayments.tenantId),
        eq(promoCodeRedemptions.stripePaymentIntentId, stripePayments.paymentIntentId),
        eq(promoCodeRedemptions.status, 'consumed'),
      ),
    )
    .innerJoin(promoCodes, eq(promoCodes.id, promoCodeRedemptions.promoCodeId))
    .where(and(eq(stripePayments.tenantId, tenantId), inArray(stripePayments.purchaseId, ids)))
  return new Map(rows.map(r => [r.purchaseId, r.code]))
}

/**
 * The bookings still ahead on each package — what `cancelFutureBookings` will
 * cancel when its Refund lands, and on the same terms.
 */
async function upcomingBookingCounts(
  tenantId: string,
  clientPackageIds: string[],
): Promise<Map<string, number>> {
  if (clientPackageIds.length === 0) return new Map()
  const rows = await db
    .select({ id: bookings.clientPackageId, n: sql<number>`count(*)::int` })
    .from(bookings)
    .leftJoin(classes, eq(classes.id, bookings.classId))
    .leftJoin(ptSessions, eq(ptSessions.id, bookings.ptSessionId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        inArray(bookings.clientPackageId, clientPackageIds),
        eq(bookings.state, 'confirmed'),
        eq(bookings.checkInState, 'pending'),
        sql`coalesce(${classes.startsAt}, ${ptSessions.startsAt}) > now()`,
      ),
    )
    .groupBy(bookings.clientPackageId)
  return new Map(rows.filter(r => r.id != null).map(r => [r.id!, Number(r.n ?? 0)]))
}

/**
 * The plans whose Cross-Location Add-On was bought later, on a Purchase of its
 * own. That payment points at the plan, not through its `purchase_id`, so the
 * plan's Refund never returns it — the Add-On simply ends with the plan.
 */
async function separatelyBoughtAddOns(
  tenantId: string,
  clientPackageIds: string[],
): Promise<Set<string>> {
  if (clientPackageIds.length === 0) return new Set()
  const rows = await db
    .select({ id: stripePayments.clientPackageId })
    .from(stripePayments)
    .innerJoin(purchases, eq(purchases.id, stripePayments.purchaseId))
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        inArray(stripePayments.clientPackageId, clientPackageIds),
        eq(purchases.kind, 'cross_location_add_on'),
      ),
    )
  return new Set(rows.map(r => r.id).filter((id): id is string => id != null))
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
}): Promise<IssuedPurchaseRefund> {
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
 * Listed: every `confirmed` booking, and every booking cancelled **without its
 * money going back** whose Purchase still holds some (#272) — which is what
 * cancelling a Workshop leaves behind. The Workshop's cancel refunds nobody, so
 * this card is where the admin returns each member's money; hiding the row the
 * moment the Workshop was cancelled left the provider's dashboard as the only
 * way to do it. A refunded booking (`stripe_refunded`, its Purchase zeroed)
 * drops off, as a Voided package does — there is nothing left here to hang a
 * second refund on.
 */
export interface WorkshopPurchase {
  bookingId: string
  /** The Purchase that paid for it, which the bell links to (#485); null for a free place. */
  purchaseId: string | null
  workshopName: string
  tierName: string | null
  amountPaidSgd: string
  listPriceSgd: string
  purchasedAt: Date
  /** The place is gone — its Workshop was cancelled — and the money has not come back. */
  cancelled: boolean
  refundable: boolean
  refundNotice: string | null
  /** How many payments the Refund will return — see `RefundState`. */
  paymentCount: number
  /** Whether a Refund is already on its way — see `RefundProgress`. */
  progress: RefundProgress
  /** What the Refund gives back: the whole Purchase. */
  refundAmountSgd: string
  /** The Promo Code the Refund hands back, or null when none was used. */
  promoCode: string | null
}

/** A place in a cancelled Workshop whose money has not come back (#272): the Purchase still holds money. */
const cancelledAndUnrefunded = () =>
  and(eq(bookings.state, 'cancelled'), eq(bookings.refundOutcome, 'n_a'), gt(purchases.amountPaidSgd, '0'))

/**
 * A paid place in a cancelled Workshop that nobody has refunded (#485), one per
 * booking. A Refund already asked for is not "hasn't been refunded": it is on
 * its way, or `refund_unconfirmed` once a day old.
 */
export interface UnrefundedWorkshopPlace {
  bookingId: string
  purchaseId: string
  clientId: string
  clientName: string
  workshopName: string
  amountSgd: string
  cancelledAt: Date
}

/**
 * The one rule for an unrefunded place: a workshop place cancelled with money
 * still on it and no Refund already asked for. The list and the count both read
 * it; `extra` narrows both alike (a dismissal, one booking).
 */
const unrefundedPlaceWhere = (tenantId: string, extra?: SQL) =>
  and(
    eq(bookings.tenantId, tenantId),
    eq(bookings.kind, 'workshop'),
    cancelledAndUnrefunded(),
    sql`not exists (
      select 1 from ${stripePayments}
      where ${stripePayments.purchaseId} = ${purchases.id}
        and ${stripePayments.status} in ('succeeded', 'pending')
        and ${stripePayments.refundRequestedAt} is not null
    )`,
    extra,
  )

/** How many unrefunded places there are, in SQL, by the rule the list reads. */
export async function countUnrefundedWorkshopPlaces(tenantId: string, extra?: SQL): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(bookings)
    .innerJoin(workshops, eq(workshops.id, bookings.workshopId))
    .innerJoin(purchases, eq(purchases.id, bookings.purchaseId))
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .where(unrefundedPlaceWhere(tenantId, extra))
  return Number(row?.n ?? 0)
}

export async function listUnrefundedWorkshopPlaces(
  tenantId: string,
  extra?: SQL,
): Promise<UnrefundedWorkshopPlace[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      purchaseId: purchases.id,
      clientId: bookings.clientId,
      clientName: clients.name,
      workshopName: workshops.name,
      amountSgd: purchases.amountPaidSgd,
      cancelledAt: bookings.cancelledAt,
      bookedAt: bookings.bookedAt,
    })
    .from(bookings)
    .innerJoin(workshops, eq(workshops.id, bookings.workshopId))
    .innerJoin(purchases, eq(purchases.id, bookings.purchaseId))
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .where(unrefundedPlaceWhere(tenantId, extra))
  return rows.map(r => ({
    bookingId: r.bookingId,
    purchaseId: r.purchaseId,
    clientId: r.clientId,
    clientName: r.clientName,
    workshopName: r.workshopName,
    amountSgd: r.amountSgd ?? '0.00',
    cancelledAt: r.cancelledAt ?? r.bookedAt,
  }))
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
      state: bookings.state,
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
        or(
          eq(bookings.state, 'confirmed'),
          cancelledAndUnrefunded(),
        ),
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

  const [held, promos] = await Promise.all([
    heldPaymentsFor(tenantId, rows.map(r => r.purchaseId)),
    promoCodesFor(tenantId, rows.map(r => r.purchaseId)),
  ])

  return rows.map(r => {
    const count = r.checkInState === 'attended' || r.checkInState === 'no_show' ? 1 : 0
    const h = r.purchaseId ? held.get(r.purchaseId) : undefined
    return {
      paymentCount: h?.count ?? 0,
      progress: h?.progress ?? 'none',
      refundAmountSgd: r.purchasePaidSgd ?? '0.00',
      promoCode: (r.purchaseId && promos.get(r.purchaseId)) || null,
      bookingId: r.bookingId,
      purchaseId: r.purchaseId,
      workshopName: r.workshopName,
      tierName: r.tierName,
      amountPaidSgd: r.amountPaidSgd ?? '0.00',
      listPriceSgd: r.listPriceSgd ?? '0.00',
      purchasedAt: r.purchasedAt,
      cancelled: r.state === 'cancelled',
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
}): Promise<IssuedPurchaseRefund> {
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
 * Not the account the studio sells on today — no provider hands a payment
 * intent across accounts — so the account comes off the payment row rather than
 * off the Tenant. `null` there is the platform's own account, which this app no
 * longer holds a key for (#293): such a payment is refused as
 * `payment_on_platform_account` and returned from the Stripe dashboard instead.
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
  await outbound('stripe', 'refunds.create', () =>
    stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `refund:${paymentIntentId}` },
    ),
  )
}

/**
 * What one press of a Refund button did at the provider (#275).
 *
 * `complete` is false when the provider refused a payment after taking an
 * earlier one: the Refund is half-issued, and the admin has to be told so
 * rather than shown an error that reads as though nothing happened. It is a
 * result and not a thrown error on purpose — the request runs in one
 * transaction, and throwing would roll back the very stamps that record which
 * payments did go back.
 */
export interface IssuedRefund {
  purchaseId: string
  /** The payments this press asked the provider to return. */
  paymentIntentIds: string[]
  /** Every payment the Refund covers — held ones and any already back. */
  paymentCount: number
  /**
   * How many of those are back or asked for — this press, earlier presses, or
   * the provider's own dashboard. Asked for, not landed: the money is back only
   * when `charge.refunded` says so.
   */
  requestedCount: number
  complete: boolean
}

/** A Refund aimed at a plan or a booking, which carries the studio-rule override. */
export type IssuedPurchaseRefund = IssuedRefund & { attendedCount: number; override: boolean }

/**
 * Give back every payment a Purchase is still holding, each on its own account,
 * and stamp each one as asked for the moment the provider takes it.
 *
 * In sequence, because they are one decision and one audit row covers them. A
 * payment already asked for is skipped — its Refund is on its way, and the
 * webhook will land it — so pressing again after an incomplete Refund returns
 * only the rest. When there is nothing left to ask for, the Refund is refused
 * as `refund_processing`: the provider is not asked twice for the same money.
 * An ask older than `REFUND_IN_FLIGHT_MS` is no longer believed, so a Refund the
 * provider failed after accepting it can be issued again rather than stranded.
 *
 * A call that fails while none of the Purchase's money is back or asked for is
 * thrown as it was — nothing happened. One that fails after some did (on this
 * press, an earlier one, or the provider's dashboard) is reported and returned
 * as an incomplete Refund, which the unwind refuses to treat as finished until
 * the rest is returned.
 */
async function returnEveryPayment(
  tenantId: string,
  purchaseId: string,
  payments: readonly PurchasePayment[],
): Promise<IssuedRefund> {
  const held = heldPayments([...payments])
  const toReturn = held.filter(p => !refundInFlight(p.refundRequestedAt))
  if (toReturn.length === 0) throw new ConflictError('refund_processing')

  // Before any of them goes back: a payment recorded against the platform
  // account (#293) cannot be returned from here, and finding that out on the
  // second payment would leave the first already returned — a Refund half-done
  // on purpose. The admin is told where it can be issued instead.
  if (toReturn.some(p => p.providerAccountId == null)) throw paymentOnPlatformAccount()

  const covered = held.length + payments.filter(p => p.status === 'refunded').length
  const alreadyAsked = covered - toReturn.length
  const paymentIntentIds: string[] = []
  for (const payment of toReturn) {
    try {
      await refundAtProvider(tenantId, payment.paymentIntentId, payment.providerAccountId)
    } catch (err) {
      if (alreadyAsked + paymentIntentIds.length === 0) throw err
      reportError(err, 'refund stopped part-way — some payments returned, some not', {
        scope: 'refunds',
        purchaseId,
        failedIntent: payment.paymentIntentId,
      })
      break
    }
    await stampRefundRequested(tenantId, payment.paymentIntentId)
    paymentIntentIds.push(payment.paymentIntentId)
  }

  const requestedCount = alreadyAsked + paymentIntentIds.length
  return {
    purchaseId,
    paymentIntentIds,
    paymentCount: covered,
    requestedCount,
    complete: requestedCount === covered,
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
 * as a finished Refund — it reports it and waits, and the result tells the
 * admin who pressed the button (see `IssuedRefund`).
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
}): Promise<IssuedPurchaseRefund> {
  // A comp grant, a $0 trial, a free workshop place or a Promo Code that took
  // the total to zero never reached the payment provider, so there is no money
  // to give back. Corporate is out of scope for the same reason from the other
  // end — it creates no client-package row at all, so it cannot be named here.
  if (!args.purchaseId) throw new BadRequestError('purchase_not_refundable')

  const payments = await paymentsForPurchase(args.tenantId, args.purchaseId)
  const held = heldPayments(payments)
  if (held.length === 0) {
    // Nothing held. Told apart so an admin double-clicking a button reads
    // "already refunded" rather than "not refundable", which is the difference
    // between a race they can ignore and a purchase they should look at.
    if (payments.some(p => p.status === 'refunded')) throw new ConflictError('already_refunded')
    throw new BadRequestError('purchase_not_refundable')
  }

  const override = !isUntouched(args.attendedCount)
  const issued = await returnEveryPayment(args.tenantId, args.purchaseId, payments)
  const { paymentIntentIds } = issued
  if (paymentIntentIds.length === 0) return { ...issued, attendedCount: args.attendedCount, override }

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
        complete: issued.complete,
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

  return { ...issued, attendedCount: args.attendedCount, override }
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
}): Promise<IssuedRefund & { returnedSgd: string }> {
  // Held for the rest of the request, as a Resume holds it (`lockPurchase` in
  // open-purchases.ts): a member minting a new payment page and this ending the
  // one it finds cannot interleave, so the page ended below is the live one.
  const [purchase] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.tenantId, args.tenantId), eq(purchases.id, args.purchaseId)))
    .limit(1)
    .for('update')
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
  const held = heldPayments(payments)
  // An `open` Purchase with nothing against it is an abandoned click, not money
  // the studio is holding — the member owes nothing on it and does not remember
  // making it. There is nothing to give back.
  if (held.length === 0) throw new BadRequestError('purchase_not_refundable')

  await endOpenCheckout(args.tenantId, purchase, payments)

  const returnedSgd = purchase.amountPaidSgd
  // A part-paid Purchase is exactly the shape that can straddle a studio's move
  // onto its own account, so each payment goes back where it came in (#97).
  const issued = await returnEveryPayment(args.tenantId, args.purchaseId, payments)
  const { paymentIntentIds } = issued
  if (paymentIntentIds.length === 0) return { ...issued, returnedSgd }

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
        complete: issued.complete,
      },
    })
  } catch (err) {
    reportError(err, 'abandoned refund audit row failed', {
      scope: 'refunds',
      purchaseId: args.purchaseId,
      reason: args.reason,
    })
  }

  return { ...issued, returnedSgd }
}

/**
 * End the payment page open against a part-paid Purchase, before any of its
 * money goes back (RFD-20).
 *
 * The member comes back to a part-paid Purchase through Resume, which leaves a
 * payment page open against it with no expiry. Refunding the Purchase without
 * ending that page would leave the member able to pay into a sale the studio
 * has just closed — and that money would land on an Abandoned Purchase that no
 * screen lists and no Refund button reaches. So the page dies first, under the
 * row lock the caller holds, which is also what stops a Resume making another
 * one in the meantime.
 *
 * What the provider says decides the rest, as it does for Resume's own
 * predecessor (`expirePredecessor` in open-purchases.ts):
 * - ended now: no payment can arrive on it;
 * - no longer open, and either expired or unknown on this account: nothing to
 *   wait for;
 * - complete and paid, on a payment this Purchase already holds: the Refund
 *   below returns it with the rest;
 * - complete and paid on a payment not yet recorded: the money is on its way
 *   to the studio and the Refund cannot see it, so it is refused as
 *   `checkout_session_busy` until the payment lands and can be returned with
 *   the rest;
 * - anything else — a timeout, an outage: the page is alive and unknown, and
 *   refused the same way.
 */
async function endOpenCheckout(
  tenantId: string,
  purchase: PurchaseRow,
  payments: readonly PurchasePayment[],
): Promise<void> {
  const sessionId = purchase.checkoutSessionId
  if (!sessionId) return
  const busy = (err: unknown): never => {
    reportError(err, 'refund held back: the purchase’s payment page could not be ended', {
      scope: 'refunds',
      purchaseId: purchase.id,
      checkoutSessionId: sessionId,
    })
    throw new ConflictError('checkout_session_busy', {
      message:
        'The member is paying towards this purchase right now. Wait a minute for their payment to land, then refund it.',
    })
  }
  // Stripe's answer for a session that is no longer open, or that this account
  // never had. Anything else is about the call, and says nothing about the page.
  const noLongerOpen = (err: unknown) =>
    (err as { type?: unknown } | null)?.type === 'StripeInvalidRequestError'

  const stripe = await stripeForTenant(tenantId)
  let session: Stripe.Checkout.Session
  try {
    session = await outbound('stripe', 'checkout.sessions.expire', () =>
      stripe.checkout.sessions.expire(sessionId),
    )
  } catch (err) {
    if (!noLongerOpen(err)) return busy(err)
    // No longer open — which way it closed is the whole question.
    try {
      session = await outbound('stripe', 'checkout.sessions.retrieve', () =>
        stripe.checkout.sessions.retrieve(sessionId),
      )
    } catch (retrieveErr) {
      if (noLongerOpen(retrieveErr)) return
      return busy(retrieveErr)
    }
  }
  if (session?.status !== 'complete' || session.payment_status === 'unpaid') return
  const intent =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  if (intent && !payments.some(p => p.paymentIntentId === intent)) {
    busy(new Error(`checkout session ${sessionId} was paid on ${intent}, not yet recorded`))
  }
}

/**
 * Give back a payment that landed on a Purchase already closed by a Refund
 * (RFD-21).
 *
 * A Refund is the whole Purchase, so money reaching it after its Refund belongs
 * to that Refund too. Refunding from the portal ends the member's payment page
 * first (`endOpenCheckout`), but a Refund issued from the provider's dashboard
 * cannot, and a page paid on in that gap would leave the studio holding money
 * against a Purchase that is closed — listed nowhere, refundable from nowhere.
 * So it is returned here, on the account it was paid on, and its own
 * `charge.refunded` stamps it back like any other.
 *
 * The caller has recorded the payment as `succeeded`, so the money is on the
 * ledger before it is asked back. A payment already back, or with its return
 * already asked for, is left alone: a redelivery asks the provider nothing. A
 * provider that refuses throws, so the delivery fails and is retried rather
 * than the money being left where nobody can see it.
 */
export async function returnLatePayment(
  tenantId: string,
  purchaseId: string,
  paymentIntentId: string,
): Promise<void> {
  const [payment] = await db
    .select({
      status: stripePayments.status,
      providerAccountId: stripePayments.providerAccountId,
      refundRequestedAt: stripePayments.refundRequestedAt,
    })
    .from(stripePayments)
    .where(
      and(eq(stripePayments.tenantId, tenantId), eq(stripePayments.paymentIntentId, paymentIntentId)),
    )
    .limit(1)
  if (!payment || payment.status === 'refunded' || refundInFlight(payment.refundRequestedAt)) return

  logger.warn(
    { scope: 'refunds', tenantId, purchaseId, paymentIntentId },
    'payment landed on a Purchase already refunded — returning it',
  )
  await refundAtProvider(tenantId, paymentIntentId, payment.providerAccountId)
  await stampRefundRequested(tenantId, paymentIntentId)
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
  // One that is recorded later is checked then, and never granted against
  // (`settleAndMayGrant` in webhook-handler.ts).
  if (!tenantId) return
  return withTenant(tenantId, () => unwindRefundForTenant(paymentIntentId))
}

/**
 * The unwind for one payment, inside a Tenant context already open. Exported
 * for the checkout webhook, which meets a charge refunded at the provider
 * before its payment was recorded — the `charge.refunded` that should have
 * unwound it found no row — and runs this once it has written the row.
 */
export function unwindRefundForTenant(paymentIntentId: string): Promise<void> {
  // One unit: a deadlock in any of its cancels starts the whole unwind over.
  return retryingTransaction('Refund unwind', tx => unwindPayment(tx, paymentIntentId))
}

async function unwindPayment(tx: Tx, paymentIntentId: string): Promise<void> {
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

  // The Purchase is held before anything is written, so a payment landing on
  // it at the same moment — a Resume page paid on while this card went back
  // from the provider's dashboard — waits for this unwind, or this for it, and
  // neither decides on a copy the other has since changed (RFD-23). Before the
  // payment row, as every path that holds both takes them.
  await purchaseById(tenantId, payment.purchaseId, { lock: true })

  // This payment is back. Stamped before the Purchase's status is read, and NOT as
  // the gate for the unwind: the gate is the Purchase's own status, stamped
  // last. A redelivery that arrives after this write still walks the whole
  // unwind, which is what makes a pass that died halfway simply get redone.
  await stampPaymentRefunded(tenantId, paymentIntentId)
  await unwindPurchase(tx, tenantId, payment.purchaseId)
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
async function unwindPurchase(tx: Tx, tenantId: string, purchaseId: string): Promise<void> {
  const purchase = await purchaseById(tenantId, purchaseId)
  // Already refunded or already abandoned means a redelivery of an event that
  // completed.
  if (!purchase || purchase.status === 'refunded' || purchase.status === 'abandoned') return

  const payments = await paymentsForPurchase(tenantId, purchaseId)
  const outstanding = heldPayments(payments)
  if (outstanding.length > 0) {
    await restateBalanceOnPartRefund(tenantId, purchaseId, payments)
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
  //
  // A booking already cancelled with its Workshop (#272) is caught too: the
  // Workshop's cancel gives nobody their money back and records `n_a`, and a
  // Refund issued afterwards is what does — so this is where its outcome
  // becomes `stripe_refunded`. Its cancel time is the Workshop's, and stays.
  await db
    .update(bookings)
    .set({
      state: 'cancelled',
      refundOutcome: 'stripe_refunded',
      cancelledAt: sql`coalesce(${bookings.cancelledAt}, now())`,
    })
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.purchaseId, purchaseId),
        or(
          and(eq(bookings.state, 'confirmed'), eq(bookings.checkInState, 'pending')),
          and(eq(bookings.state, 'cancelled'), eq(bookings.refundOutcome, 'n_a')),
        ),
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
  // a standalone Add-On payment. The money is recorded; a corporate package's
  // pending request goes with it.
  if (!pkg) {
    const corporate = await closeCorporateRequestsForRefund(tenantId, purchaseId)
    // A request already scheduled is not cancelled here: its session is the
    // admin's to cancel. The money is already back, so it cannot be refused
    // either — it is reported, loudly, for a human to settle, as a booking that
    // will not cancel is above.
    for (const corporateRequestId of corporate.scheduled) {
      reportError(
        new Error(`corporate request ${corporateRequestId} is scheduled; its Purchase was refunded`),
        'refund left a scheduled corporate request standing — cancel its session',
        { scope: 'refunds', purchaseId, corporateRequestId },
      )
    }
    await markPurchaseRefunded(tenantId, purchaseId)
    return
  }

  await lockForCancel(tx, tenantId, { bookingIds: (await futureBookingsOn(tenantId, pkg.id)).map(t => t.id) })

  // The Void holds the package row from here until it commits, whether or not
  // the package is still active: the update below matches only an active one,
  // so on a used-up package it would hold nothing. A return that waits for this
  // finds the Purchase refunded, which is marked last and commits with it, and
  // takes nothing back; one that ran first landed before the Void and is
  // Voided with the package.
  await db
    .select({ id: clientPackages.id })
    .from(clientPackages)
    .where(and(eq(clientPackages.tenantId, tenantId), eq(clientPackages.id, pkg.id)))
    .for('update')

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
  // instructor payroll and the studio's attendance record. Read again now the
  // Void holds the package, so a booking that paid with it just before is
  // cancelled too.
  const cancelled = await cancelFutureBookings(tenantId, pkg.id)

  // The Purchase's status becomes refunded and its Balance goes to zero. Last,
  // and the winner of the race sends the email.
  if (!(await markPurchaseRefunded(tenantId, purchaseId))) return

  // The member is told. The provider sends its own money receipt; ours is the
  // one that says the plan has ended and names the classes that were cancelled.
  // Cancelling someone's booked classes silently is not acceptable — and this
  // must never take the unwind down with it, so it swallows. Once committed,
  // so an unwind run again (`retryingTransaction`) mails nobody twice.
  afterCommit(async () => {
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
  })
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
  // must never take the unwind down with it, so it swallows. Once committed,
  // as the refund email is.
  const clientId = purchase.clientId
  afterCommit(async () => {
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
        recipient: { email: client.email, userId: clientId, userKind: 'client' },
        variables,
      })
    } catch (err) {
      reportError(err, 'abandoned refund email failed', { scope: 'refunds', purchaseId: purchase.id })
    }
  })
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
 * Record that the provider has taken a Refund for this payment and it is on
 * its way (#275). Only ever reached for a payment with no ask in flight, so it
 * overwrites a stale one — the ask being timed is the one just made.
 */
async function stampRefundRequested(tenantId: string, paymentIntentId: string): Promise<void> {
  await db
    .update(stripePayments)
    .set({ refundRequestedAt: clockNow() })
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
 * cancel service with a `system` source — so waitlist promotion comes free and
 * there is one cancellation path rather than two.
 */
async function cancelFutureBookings(
  tenantId: string,
  clientPackageId: string,
): Promise<CancelledSession[]> {
  const cancelled: CancelledSession[] = []
  for (const t of await futureBookingsOn(tenantId, clientPackageId)) {
    try {
      // A Voided package takes nothing back whichever way `credit` points: `n_a`.
      await cancelBooking(tenantId, { bookingId: t.id, source: 'system', credit: 'return', packageVoided: true })
      cancelled.push({ name: t.name, startsAt: t.startsAt })
    } catch (err) {
      if (isRetryableAbort(err)) throw err
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

async function futureBookingsOn(
  tenantId: string,
  clientPackageId: string,
): Promise<Array<{ id: string; name: string; startsAt: Date }>> {
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

  return [
    ...classRows.map(r => ({ id: r.id, name: String(r.name), startsAt: r.startsAt })),
    ...ptRows.map(r => ({ id: r.id, name: 'Private session', startsAt: r.startsAt })),
  ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}
