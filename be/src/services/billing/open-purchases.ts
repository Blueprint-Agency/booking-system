/**
 * Unfinished Purchases: reading them, and paying more towards one (#93).
 *
 * **An open Purchase does not expire.** A checkout session does — Stripe's
 * expire after a day, and a capped Promo Code's Hold expires sooner — but the
 * debt does not, because the money the member has already handed over does not
 * evaporate with a browser tab. So this module is what a member comes back to:
 * the list on their account page, and a fresh session minted for whatever is
 * still owed at the moment they ask.
 *
 * Three rules hold the whole thing up, and all three live here rather than at
 * the route:
 *
 *   1. **The Balance is read from the database, every time.** The browser sends
 *      an amount and nothing else; what is outstanding is ours to know.
 *   2. **One live session per Purchase.** A new one expires its predecessor
 *      before it exists, so two open sessions can never together capture more
 *      than the price.
 *   3. **Nothing is granted here.** This takes money. The webhook decides what
 *      that money has bought, by the one question in `balance.ts`.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { purchases, stripePayments } from '../../db/schema/ledger'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { toCents } from '../../shared/money'
import { reportError } from '../../shared/logger'
import { stripeForTenant } from '../../lib/stripe'
import { tenantDisplayName } from '../tenants/mail-identity'
import { requireTenantUrl } from '../tenants/urls'
import { partPaymentEnabled } from '../policy/update'
import { amountPaidCents, outstandingCents } from './balance'
import {
  chargeableCents,
  mustPayInFull,
  refusePartPaymentWhenDisabled,
  PART_PAYMENT_FLOOR_CENTS,
} from './part-payment'
import { attachCheckoutSession, type PurchaseRow } from './purchases'
import { heldPaymentCounts } from './refunds'
import { checkoutSessionParams, type CheckoutLine } from './checkout-session'
import { daysSilent, isSilent, silenceNotice } from './refund-notice'

/** An unfinished Purchase, as every screen that shows one needs to see it. */
export interface OpenPurchaseView {
  id: string
  kind: PurchaseRow['kind']
  /** What was bought, frozen at checkout — see `itemName`. */
  itemName: string
  totalSgd: string
  paidSgd: string
  outstandingSgd: string
  /** The Balance can only be settled in one go from here down. */
  mustPayInFull: boolean
  /** When the first payment landed that did not clear it. Null before any did. */
  partPaidAt: Date | null
  createdAt: Date
  /**
   * How many payments the studio is holding against it (#95) — and so how many
   * returns a refund of it will put on the statement. Zero for a Purchase
   * opened and never paid towards, which is why it is not a count of rows.
   */
  paymentCount: number
}

/**
 * The Balance, recomputed from the payment rows rather than read off the
 * Purchase's cached column.
 *
 * They agree — `recomputeBalance` writes one from the other — but the cached
 * column is written by the webhook and this is the read that decides what a
 * member is allowed to be charged. Between a payment landing at the provider
 * and its webhook arriving, the ledger is the earlier and truer word, and the
 * direction of that gap matters: reading the ledger can only ever refuse to
 * charge money we already have.
 */
async function outstandingFor(tenantId: string, purchase: PurchaseRow): Promise<number> {
  const rows = await db
    .select({
      paymentIntentId: stripePayments.paymentIntentId,
      amountSgd: stripePayments.amountSgd,
      status: stripePayments.status,
    })
    .from(stripePayments)
    .where(
      and(eq(stripePayments.tenantId, tenantId), eq(stripePayments.purchaseId, purchase.id)),
    )
  return outstandingCents(toCents(purchase.totalSgd), amountPaidCents(rows))
}

const sgd = (cents: number) => (cents / 100).toFixed(2)

function view(
  purchase: PurchaseRow,
  outstanding: number,
  paymentCount: number,
): OpenPurchaseView {
  const metadata = purchase.metadata as Record<string, string>
  return {
    paymentCount,
    id: purchase.id,
    kind: purchase.kind,
    itemName: metadata.item_name || 'Purchase',
    totalSgd: purchase.totalSgd,
    paidSgd: sgd(toCents(purchase.totalSgd) - outstanding),
    outstandingSgd: sgd(outstanding),
    mustPayInFull: mustPayInFull(outstanding),
    partPaidAt: purchase.partPaidAt,
    createdAt: purchase.createdAt,
  }
}

/**
 * A member's unfinished Purchases, newest first.
 *
 * Only the ones money has actually been put against. A Purchase is opened the
 * instant a member clicks Pay and stays `open` if they close the tab at the
 * Stripe page, so listing every one of them would fill the account page with
 * abandoned clicks the member owes nothing on and does not remember making.
 * `part_paid_at` is exactly the fold between the two.
 */
export async function listOpenPurchases(
  tenantId: string,
  clientId: string,
): Promise<OpenPurchaseView[]> {
  const rows = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.tenantId, tenantId),
        eq(purchases.clientId, clientId),
        eq(purchases.status, 'open'),
        sql`${purchases.partPaidAt} is not null`,
      ),
    )
    .orderBy(desc(purchases.createdAt))

  if (rows.length === 0) return []

  // One grouped read for the page, not one per row: the account page and the
  // portal's client detail both call this inside a request that already holds a
  // pooled connection for its whole life.
  const ids = rows.map(r => r.id)
  const [paid, held] = await Promise.all([
    paidByPurchase(tenantId, ids),
    heldPaymentCounts(tenantId, ids),
  ])

  const out: OpenPurchaseView[] = []
  for (const row of rows) {
    const outstanding = outstandingCents(toCents(row.totalSgd), paid.get(row.id) ?? 0)
    // Settled at the provider but not yet at the webhook. It owes nothing, so
    // showing it would offer the member a payment there is no room for.
    if (outstanding > 0) out.push(view(row, outstanding, held.get(row.id) ?? 0))
  }
  return out
}

/**
 * What has been paid towards each of these Purchases, in one query.
 *
 * The same arithmetic `amountPaidCents` does — `succeeded` only, one row per
 * intent — pushed into Postgres because the alternative is a round trip per
 * purchase. It counts no crediting intent, because nothing is being processed
 * here: this is a read for a screen, not a settlement.
 *
 * A Purchase with no payment rows is absent from the result rather than zero,
 * which the caller reads as zero — the same thing, and it keeps the query to
 * the rows that exist.
 */
async function paidByPurchase(
  tenantId: string,
  purchaseIds: string[],
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      purchaseId: stripePayments.purchaseId,
      // `numeric` sums exactly in Postgres; the cast to cents happens once, on
      // the way out, so nothing here goes through a float.
      paidSgd: sql<string>`coalesce(sum(${stripePayments.amountSgd}), 0)`,
    })
    .from(stripePayments)
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        inArray(stripePayments.purchaseId, purchaseIds),
        eq(stripePayments.status, 'succeeded'),
      ),
    )
    .groupBy(stripePayments.purchaseId)
  return new Map(rows.map(r => [r.purchaseId, toCents(r.paidSgd)]))
}

/**
 * One Purchase of this member's, if it is still open and still owes something.
 *
 * Null covers every way there is nothing to say: no such Purchase, somebody
 * else's, settled, refunded, or settled at the provider and not yet at the
 * webhook. The confirmation page reads that null as "this one is done" — which
 * is why the client id is checked here rather than trusted from the caller.
 */
export async function openPurchaseById(
  tenantId: string,
  clientId: string,
  purchaseId: string,
): Promise<OpenPurchaseView | null> {
  const [row] = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.tenantId, tenantId),
        eq(purchases.clientId, clientId),
        eq(purchases.id, purchaseId),
        eq(purchases.status, 'open'),
      ),
    )
    .limit(1)
  if (!row) return null
  const outstanding = await outstandingFor(tenantId, row)
  if (outstanding <= 0) return null
  const held = await heldPaymentCounts(tenantId, [row.id])
  return view(row, outstanding, held.get(row.id) ?? 0)
}

/**
 * Read the Purchase and hold its row for the rest of the request.
 *
 * This is what actually makes "one live checkout session per Purchase" true.
 * Expiring the predecessor before creating the successor is only a rule while
 * the two steps cannot interleave, and two taps on Resume are two requests:
 * both would read the same session id, both would expire it, and both would
 * create one — leaving two live sessions that could together capture more than
 * the price.
 *
 * Every request already runs inside one transaction (`withTenant`, and see
 * middleware/tenant.ts), so the lock is held from here through the provider
 * call and the write that records the new session, and released when the
 * request ends. The second tap waits, then reads a Balance that already counts
 * the first — which is the answer it should have had.
 */
async function lockPurchase(tenantId: string, purchaseId: string): Promise<PurchaseRow | null> {
  const [row] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, purchaseId)))
    .limit(1)
    .for('update')
  return row ?? null
}

/**
 * Kill the session now in flight against this Purchase, if there is one.
 *
 * This is the whole of "only one live checkout session per Purchase". Two open
 * sessions against one Balance can together capture more than the price, and
 * afterwards there is no honest way to say which one the member meant — so the
 * predecessor dies before the successor is created, never after.
 *
 * Exactly one refusal is safe to carry on from: the provider saying this
 * session *cannot* be expired, which means it is already completed or already
 * expired. A completed one cannot be paid twice and the Balance this call is
 * about to read already counts it, so proceeding leaves one live session, which
 * is the invariant. Every other failure — a timeout, a rate limit, a network
 * drop — leaves the predecessor **alive and unknown**, and creating a successor
 * beside it is how one Purchase captures more than its price. Those abort, and
 * the member is told to try again.
 */
async function expirePredecessor(tenantId: string, purchase: PurchaseRow): Promise<void> {
  if (!purchase.checkoutSessionId) return
  try {
    const stripe = await stripeForTenant(tenantId)
    await stripe.checkout.sessions.expire(purchase.checkoutSessionId)
  } catch (err) {
    reportError(err, 'could not expire the previous checkout session', {
      scope: 'part-payment',
      purchaseId: purchase.id,
      checkoutSessionId: purchase.checkoutSessionId,
    })
    if (isAlreadyFinished(err)) return
    throw new ConflictError('checkout_session_busy', {
      message:
        'Your previous payment page is still open. Close it, wait a moment, and try again.',
    })
  }
}

/**
 * Did the provider refuse because there is nothing left to expire?
 *
 * `invalid_request_error` is Stripe's answer for a session that is already
 * complete or already expired — a statement about the session, made after the
 * call was received and understood. Everything else (`api_error`,
 * `rate_limit_error`, a connection failure with no type at all) is a statement
 * about the call, and says nothing about whether the session is still live.
 */
const isAlreadyFinished = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { type?: unknown }).type === 'StripeInvalidRequestError'

/**
 * Why a Purchase cannot be resumed, in the member's words.
 *
 * A map rather than a chain of ternaries so that adding a status to the enum
 * without deciding what it says here does not compile — every way a Purchase can
 * be closed is a different sentence, and a member reading the wrong one goes to
 * the front desk. **Abandoned** is the one #95 adds: the studio has given the
 * money back, and offering a Resume button beside that would invite a member to
 * start paying again for something already settled.
 */
const RESUME_REFUSALS: Record<Exclude<PurchaseRow['status'], 'open'>, string> = {
  paid: 'This purchase has already been paid in full.',
  refunded: 'This purchase was refunded.',
  abandoned:
    'This purchase was cancelled and everything you paid towards it has been refunded. Please start again if you still want it.',
}

/**
 * Mint a session for what is still owed on a Purchase the member already
 * started paying.
 *
 * `requestedCents` is null to pay the whole remainder — which is what the
 * account page's Resume button sends unless the member says otherwise, and what
 * a studio with Part Payment switched off can only ever send.
 *
 * **The switch does not gate this.** Turning Part Payment off hides the
 * checkbox on new checkouts; it does not seal a Balance a member is already
 * holding, because the alternative is money the studio has taken against a debt
 * nobody is allowed to clear. What the switch does gate is asking for *part* of
 * the remainder: with it off, the only offer is the whole thing.
 */
export async function resumePurchaseCheckout(args: {
  tenantId: string
  clientId: string
  email: string
  purchaseId: string
  requestedCents: number | null
}): Promise<{ url: string | null; chargedSgd: string; outstandingSgd: string }> {
  const purchase = await lockPurchase(args.tenantId, args.purchaseId)
  if (!purchase) throw new NotFoundError('purchase_not_found')
  // Scoped by Tenant already; this is the second half — one member may not pay
  // towards, or read the price of, another member's Purchase.
  if (purchase.clientId !== args.clientId) throw new ForbiddenError('not_your_purchase')
  if (purchase.status !== 'open') {
    throw new BadRequestError('purchase_not_open', {
      message: RESUME_REFUSALS[purchase.status],
    })
  }

  const outstanding = await outstandingFor(args.tenantId, purchase)
  // Asking for part of the remainder needs the studio's switch on; asking to
  // clear it does not, and never will — see the note above.
  if (args.requestedCents != null && !(await partPaymentEnabled(args.tenantId))) {
    refusePartPaymentWhenDisabled(args.requestedCents)
  }
  const charge = chargeableCents(outstanding, args.requestedCents)

  await expirePredecessor(args.tenantId, purchase)

  const metadata = purchase.metadata as Record<string, string>
  const clientUrl = await requireTenantUrl('client', args.tenantId)
  const studioName = await tenantDisplayName(args.tenantId)
  // The lines describe what is STILL owed, so the difference between them and
  // the charge is what will be owed after this card — which is the sentence
  // `partPaymentLine` puts under it.
  const lines: CheckoutLine[] = [
    {
      name: metadata.item_name || 'Purchase',
      description: `Balance outstanding · ${studioName}`,
      amountCents: outstanding,
    },
  ]

  const stripe = await stripeForTenant(args.tenantId)
  const session = await stripe.checkout.sessions.create(
    checkoutSessionParams(
      {
        tenantId: args.tenantId,
        email: args.email,
        lines,
        // An open Purchase does not expire. A Hold that once capped this sale
        // was Consumed by the first payment and the price locked with it, so
        // there is nothing left for an expiry to protect.
        expiresAt: null,
        metadata: { ...metadata, purchase_id: purchase.id },
        successUrl: `${clientUrl}/booking/confirmation?type=balance&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${clientUrl}/account?resumed=${purchase.id}`,
        // Always a part-payment session, even when it settles the Balance: it
        // is the second card on a split purchase either way, and cards-only is
        // the rule that makes the second card land while the member watches.
        partPaymentCents: charge,
      },
      studioName,
    ),
  )
  await attachCheckoutSession(args.tenantId, purchase.id, session.id)

  return {
    url: session.url,
    chargedSgd: sgd(charge),
    outstandingSgd: sgd(outstanding - charge),
  }
}

/**
 * What the studio is holding against Purchases that have granted nothing.
 *
 * A **stock, not a flow**: money currently held, read at this instant, and so
 * not scoped to the finance period beside it — the same shape as Active
 * Members, and for the same reason. A part payment made in June and settled in
 * July was held in June and is held no longer, and there is no column that can
 * say what the figure was on 30 June.
 *
 * It is deliberately not revenue and is never added to Gross or Net. It is here
 * so that money the studio is holding is somewhere an owner can see it, rather
 * than simply missing from their picture of their own cash.
 */
export async function heldOnOpenPurchases(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`coalesce(sum(${purchases.amountPaidSgd}), 0)` })
    .from(purchases)
    .where(and(eq(purchases.tenantId, tenantId), eq(purchases.status, 'open')))
  return toCents(row?.total ?? '0') / 100
}

/**
 * A part-paid Purchase that has gone quiet, as the portal's list shows one.
 *
 * The member is named because this list is read across the whole studio rather
 * than from inside one member's page — an admin settling these is working
 * through money, not through people.
 */
export interface SilentPurchaseView extends OpenPurchaseView {
  clientId: string
  clientName: string
  clientEmail: string
  /** The last payment that landed. What the silence is measured from. */
  lastPaymentAt: Date
  daysSilent: number
  silenceNotice: string
}

/**
 * Part-paid Purchases nobody has touched for a long time (#95).
 *
 * **Nothing is swept.** This is a list and only a list: money moving back to a
 * member without a person choosing it is not an improvement on money sitting
 * still, so the studio is told these exist and an admin decides each one. That
 * is also why there is no job, no `notified_at` column and no state — the query
 * is the feature, and it answers the same whether it is run once or never.
 *
 * Silence is measured from the **last** payment rather than from `part_paid_at`,
 * because a member who put a second card down last week is mid-purchase. See
 * `isSilent` for the threshold and why the number is a judgement.
 */
export async function listSilentPartPaidPurchases(
  tenantId: string,
  now: Date = new Date(),
): Promise<SilentPurchaseView[]> {
  const rows = await db
    .select({
      purchase: purchases,
      clientName: clients.name,
      clientEmail: clients.email,
      // The held set — `succeeded` and `pending` — because that is what a refund
      // will call the provider about, so the count the admin reads is the number
      // of lines the statement will grow by.
      lastPaymentAt: sql<string | null>`max(${stripePayments.createdAt})`,
      paymentCount: sql<number>`count(${stripePayments.id})::int`,
    })
    .from(purchases)
    .innerJoin(clients, eq(clients.id, purchases.clientId))
    .innerJoin(
      stripePayments,
      and(
        eq(stripePayments.purchaseId, purchases.id),
        inArray(stripePayments.status, ['succeeded', 'pending']),
      ),
    )
    .where(
      and(
        eq(purchases.tenantId, tenantId),
        eq(purchases.status, 'open'),
        sql`${purchases.partPaidAt} is not null`,
      ),
    )
    .groupBy(purchases.id, purchases.tenantId, clients.name, clients.email)
    .orderBy(purchases.createdAt)

  const out: SilentPurchaseView[] = []
  for (const row of rows) {
    if (!row.lastPaymentAt) continue
    const lastPaymentAt = new Date(row.lastPaymentAt)
    if (!isSilent(lastPaymentAt, now)) continue
    const outstanding = outstandingCents(
      toCents(row.purchase.totalSgd),
      toCents(row.purchase.amountPaidSgd),
    )
    out.push({
      ...view(row.purchase, outstanding, Number(row.paymentCount ?? 0)),
      clientId: row.purchase.clientId,
      clientName: row.clientName,
      clientEmail: row.clientEmail,
      lastPaymentAt,
      daysSilent: daysSilent(lastPaymentAt, now),
      silenceNotice: silenceNotice(lastPaymentAt, now),
    })
  }
  return out
}

/** Re-exported so a route can quote the floor and the switch from one module. */
export { PART_PAYMENT_FLOOR_CENTS, partPaymentEnabled }
