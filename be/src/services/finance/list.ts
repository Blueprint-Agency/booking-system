/**
 * Finance listing — every Money Event in a period, money in and money out.
 *
 * Deliberately thin: it fetches and maps, and does NO arithmetic. Every figure
 * comes out of `summarizeFinance`, so the tiles, the table and the CSV cannot
 * disagree. If you find yourself adding a `+` here, it belongs in ./totals.ts.
 *
 * Money OUT is not re-queried — it is `services/payroll`'s existing five-source
 * union, mapped into Money Events. Payroll stays the owner of what "a completed
 * session that owes pay" means; Finance does not get a second opinion on it.
 *
 * Money IN comes from six places, none of which are a ledger table:
 *   - client_packages                  → purchase (and its Cross-Location Add-On)
 *   - bookings (kind = 'workshop')     → workshop_ticket
 *   - stripe_payments (corporate)      → corporate
 *   - merch_orders                     → merch
 *   - stripe_payments (refunded)       → refund
 * There is no finance_events table and there should not be one: these rows ARE
 * the ledger, and a copy of them would be a second thing to keep true.
 */
import { and, eq, gte, inArray, isNotNull, lte, notInArray } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages, classPackages, ptPackages, promoCodes } from '../../db/schema/packages'
import { bookings } from '../../db/schema/bookings'
import { purchases, stripePayments } from '../../db/schema/ledger'
import { locations, merchOrders } from '../../db/schema/catalog'
import { workshops } from '../../db/schema/schedule'
import { clients } from '../../db/schema/identity'
import { listPayroll, type PayrollRow } from '../payroll/list'
import { summarizeFinance, type FinanceSummary } from './totals'
import type { MoneyEvent, MoneyEventType } from './events'

/**
 * The Location filter. A Location id narrows to that studio; the literal
 * 'unattributed' narrows to the rows that record no Location at all — see
 * be/CONTEXT.md §Money for why that is a value and not a null hole.
 */
export const UNATTRIBUTED = 'unattributed'

export interface FinanceFilter {
  from?: Date
  to?: Date
  /** A Location id, or UNATTRIBUTED. */
  location?: string
  /** Narrows the money-OUT side only — money in names no instructor. */
  instructorId?: string
  /** Narrows the money-OUT side only. Excludes every money-in row. */
  classTypeId?: string
  /** Only sessions whose pay has not been set yet. */
  needsPayOnly?: boolean
  /** Narrow to these transaction types. Empty/absent means every type. */
  types?: readonly MoneyEventType[]
  /** Case-insensitive substring of the member's or the instructor's name. */
  q?: string
}

const base = {
  variant: null,
  party: null,
  locationId: null,
  locationName: null,
  listPriceSgd: null,
  paidSgd: null,
  promoCode: null,
  refunded: false,
  // Only a package purchase can be one, and only when its row says so.
  complimentary: false,
  instructorId: null,
  instructorName: null,
  paySgd: null,
  payKind: null,
  classTypeId: null,
  endsAt: null,
  sessionType: null,
} satisfies Omit<MoneyEvent, 'kind' | 'type' | 'id' | 'occurredAt'>

/** What a pay row is a payment *for*, in the type column's vocabulary. */
const PAYROLL_TYPE: Record<PayrollRow['kind'], MoneyEventType> = {
  class: 'class',
  pt: 'pt_session',
  workshop: 'workshop',
  manual: 'manual',
}

/** What a package purchase was, in the type column's vocabulary. */
const PACKAGE_TYPE: Record<'credit_bundle' | 'unlimited' | 'trial' | 'pt', MoneyEventType> = {
  credit_bundle: 'credit',
  unlimited: 'unlimited',
  trial: 'trial',
  pt: 'pt_package',
}

/** Payroll's row shape → a Money Event. Pay rows are the money-out side. */
function payrollToEvent(r: PayrollRow): MoneyEvent {
  return {
    ...base,
    kind: r.kind === 'manual' ? 'manual' : 'instructor_pay',
    type: PAYROLL_TYPE[r.kind],
    id: r.id,
    occurredAt: r.startsAt,
    endsAt: r.endsAt,
    // Payroll's label is the class type, the workshop's name or the entry's own
    // wording — the "which one" of the type, which is exactly the variant.
    variant: r.label,
    locationId: r.locationId,
    locationName: r.locationName,
    instructorId: r.instructorId,
    instructorName: r.instructorName,
    paySgd: r.instructorPaySgd,
    payKind: r.kind,
    classTypeId: r.classTypeId,
    sessionType: r.sessionType,
  }
}

/** Bounds on the date a Money Event belongs to. */
const within = (col: Parameters<typeof gte>[0], f: FinanceFilter) => {
  const conds = []
  if (f.from) conds.push(gte(col, f.from))
  if (f.to) conds.push(lte(col, f.to))
  return conds
}

async function listMoneyIn(tenantId: string, filter: FinanceFilter): Promise<MoneyEvent[]> {
  // A class-type or instructor filter is a question about teaching, and no
  // money-in row answers it. Returning nothing beats returning rows that
  // silently ignore the filter the admin set.
  if (filter.classTypeId || filter.instructorId || filter.needsPayOnly) return []

  // -- package purchases, and the Add-Ons hanging off them --------------------
  const packageRows = await db
    .select({
      id: clientPackages.id,
      purchasedAt: clientPackages.purchasedAt,
      kind: clientPackages.kind,
      listPriceSgd: clientPackages.listPriceSgd,
      amountPaidSgd: clientPackages.amountPaidSgd,
      crossLocationPaidSgd: clientPackages.crossLocationPaidSgd,
      locationId: clientPackages.locationId,
      locationName: locations.name,
      promoCode: promoCodes.code,
      clientName: clients.name,
      classPackageName: classPackages.name,
      ptPackageName: ptPackages.name,
      purchaseId: clientPackages.purchaseId,
      complimentary: clientPackages.complimentary,
    })
    .from(clientPackages)
    .innerJoin(clients, eq(clients.id, clientPackages.clientId))
    .leftJoin(locations, eq(locations.id, clientPackages.locationId))
    .leftJoin(promoCodes, eq(promoCodes.id, clientPackages.appliedPromoCodeId))
    .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
    .where(
      and(eq(clientPackages.tenantId, tenantId), ...within(clientPackages.purchasedAt, filter)),
    )

  // -- workshop tickets -------------------------------------------------------
  // Only bookings that actually carry money: class and PT bookings are paid for
  // by a package, and counting them would double-count that package's purchase.
  const workshopRows = await db
    .select({
      id: bookings.id,
      bookedAt: bookings.bookedAt,
      listPriceSgd: bookings.listPriceSgd,
      amountPaidSgd: bookings.amountPaidSgd,
      workshopName: workshops.name,
      locationId: workshops.locationId,
      locationName: locations.name,
      promoCode: promoCodes.code,
      clientName: clients.name,
      purchaseId: bookings.purchaseId,
    })
    .from(bookings)
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .innerJoin(workshops, eq(workshops.id, bookings.workshopId))
    .leftJoin(locations, eq(locations.id, workshops.locationId))
    .leftJoin(promoCodes, eq(promoCodes.id, bookings.appliedPromoCodeId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.kind, 'workshop'),
        isNotNull(bookings.listPriceSgd),
        ...within(bookings.bookedAt, filter),
      ),
    )

  // -- corporate package sales ------------------------------------------------
  // No client_packages row exists for these, so there is no List Price to
  // compare against and no Promo Code that could have applied — the price is
  // negotiated off-platform. List equals paid, and the discount is always zero.
  //
  // `succeeded` OR `refunded`, NOT `succeeded` alone: the refund webhook flips
  // the status, so filtering to succeeded would delete the sale from Gross while
  // leaving its negative Refund row standing — Net understated by twice the
  // amount, and a purchase that visibly happened missing from the month it
  // happened in. Every other money-in source reads its own table and is immune;
  // corporate is the only kind that reads the payment row itself.
  const corporateRows = await db
    .select({
      id: stripePayments.id,
      createdAt: stripePayments.createdAt,
      amountSgd: stripePayments.amountSgd,
      clientName: clients.name,
      paymentIntentId: stripePayments.paymentIntentId,
    })
    .from(stripePayments)
    .innerJoin(clients, eq(clients.id, stripePayments.clientId))
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        eq(stripePayments.kind, 'corporate_package'),
        inArray(stripePayments.status, ['succeeded', 'refunded']),
        ...within(stripePayments.createdAt, filter),
      ),
    )

  // -- merch orders -----------------------------------------------------------
  // Read from `merch_orders`, NOT from `stripe_payments` where kind = 'merch'.
  // The order row is the purchase: it exists for a free item too (which never
  // reaches the payment provider and so has no payment row at all), and it keeps
  // its own frozen copy of the title and the amount, so renaming, repricing or
  // deleting the catalogue item never rewrites what the member bought.
  //
  // A Merch Order takes no Promo Code and has no Location — one shelf, both
  // studios hand it over — so its List Price is what was paid, its discount is
  // always zero, and it reports as Unattributed.
  const merchRows = await db
    .select({
      id: merchOrders.id,
      createdAt: merchOrders.createdAt,
      title: merchOrders.title,
      amountSgd: merchOrders.amountSgd,
      clientName: clients.name,
      paymentIntentId: merchOrders.stripePaymentIntentId,
    })
    .from(merchOrders)
    .innerJoin(clients, eq(clients.id, merchOrders.clientId))
    .where(and(eq(merchOrders.tenantId, tenantId), ...within(merchOrders.createdAt, filter)))

  // -- refunds ----------------------------------------------------------------
  // A Refund is the whole purchase back. It lands on its OWN date so a closed
  // month never restates itself, and the purchase row it reverses stays in the
  // set, tagged — see be/docs/adr/0002-finance-replaces-payroll.md.
  const refundRows = await db
    .select({
      id: stripePayments.id,
      paymentIntentId: stripePayments.paymentIntentId,
      refundedAt: stripePayments.refundedAt,
      amountSgd: stripePayments.amountSgd,
      kind: stripePayments.kind,
      clientName: clients.name,
    })
    .from(stripePayments)
    .innerJoin(clients, eq(clients.id, stripePayments.clientId))
    // The Purchase the payment belongs to, for the settlement test below.
    .innerJoin(purchases, eq(purchases.id, stripePayments.purchaseId))
    .where(
      and(
        eq(stripePayments.tenantId, tenantId),
        eq(stripePayments.status, 'refunded'),
        isNotNull(stripePayments.refundedAt),
        // **A Purchase that never settled produces no Refund event** (#93).
        //
        // Every money-in row above is read off what a sale *delivered* — a
        // plan, a booking, a Merch Order — so a Purchase still `open` has
        // contributed nothing to Gross. Giving that money back is the studio
        // ceasing to hold cash it never counted as revenue, and reporting it
        // here would subtract from Net a figure Net never contained, quietly
        // understating the month by the refunded amount.
        //
        // `abandoned` is the same purchase a moment later (#95). An admin
        // refunding an ungranted Purchase closes it as abandoned rather than
        // refunded precisely so the two stay apart here: the row was `open`
        // when the money went back and would be excluded on that ground alone,
        // and it must keep being excluded once it is closed. Naming both is
        // what makes that true regardless of which side of the status flip a
        // finance query happens to run on.
        notInArray(purchases.status, ['open', 'abandoned']),
        ...within(stripePayments.refundedAt, filter),
      ),
    )

  // Which purchases carry the "Refunded" tag. Read over the WHOLE history, not
  // the filtered window: a purchase in August refunded in September is still a
  // refunded purchase when you look at August.
  //
  // Two keys off one query, because the rows above are keyed two ways: a plan
  // and a workshop booking name the Purchase (#92), while a corporate payment
  // and a Merch Order still name the intent. Both come off the same refunded
  // payment rows, so they cannot disagree.
  const refundedPayments = await db
    .select({
      intent: stripePayments.paymentIntentId,
      purchaseId: stripePayments.purchaseId,
    })
    .from(stripePayments)
    .where(and(eq(stripePayments.tenantId, tenantId), eq(stripePayments.status, 'refunded')))
  const refundedIntents = new Set(refundedPayments.map(r => r.intent))
  const refundedPurchases = new Set(refundedPayments.map(r => r.purchaseId))
  const isRefunded = (intent: string | null) => intent != null && refundedIntents.has(intent)
  const purchaseRefunded = (purchaseId: string | null) =>
    purchaseId != null && refundedPurchases.has(purchaseId)

  const events: MoneyEvent[] = []

  for (const r of packageRows) {
    events.push({
      ...base,
      kind: 'purchase',
      type: PACKAGE_TYPE[r.kind],
      id: r.id,
      occurredAt: r.purchasedAt,
      // The catalogue item bought — "Bundle of 10". Null where the source
      // package has been deleted: the type still says what it was.
      variant: r.classPackageName ?? r.ptPackageName,
      party: r.clientName,
      locationId: r.locationId,
      locationName: r.locationName,
      listPriceSgd: r.listPriceSgd,
      paidSgd: r.amountPaidSgd,
      promoCode: r.promoCode,
      refunded: purchaseRefunded(r.purchaseId),
      complimentary: r.complimentary,
    })
    // The Add-On's own line. The column IS what the member paid for it, and it
    // is not part of the plan's List Price, so it is its own Money Event with
    // no discount — never a discount on the plan.
    if (r.crossLocationPaidSgd != null) {
      events.push({
        ...base,
        kind: 'addon',
        type: 'addon',
        id: r.id,
        occurredAt: r.purchasedAt,
        party: r.clientName,
        locationId: r.locationId,
        locationName: r.locationName,
        listPriceSgd: r.crossLocationPaidSgd,
        paidSgd: r.crossLocationPaidSgd,
        refunded: purchaseRefunded(r.purchaseId),
        // An Add-On given with a comped plan was given too, at $0. It totals to
        // nothing either way; saying so keeps the two lines telling one story.
        complimentary: r.complimentary,
      })
    }
  }

  for (const r of workshopRows) {
    events.push({
      ...base,
      kind: 'workshop_ticket',
      type: 'workshop',
      id: r.id,
      occurredAt: r.bookedAt,
      variant: r.workshopName,
      party: r.clientName,
      locationId: r.locationId,
      locationName: r.locationName,
      listPriceSgd: r.listPriceSgd,
      paidSgd: r.amountPaidSgd,
      promoCode: r.promoCode,
      refunded: purchaseRefunded(r.purchaseId),
    })
  }

  for (const r of corporateRows) {
    events.push({
      ...base,
      kind: 'corporate',
      type: 'corporate',
      id: r.id,
      occurredAt: r.createdAt,
      // No variant: a corporate package is negotiated off-platform and has no
      // catalogue item behind it to name.
      party: r.clientName,
      listPriceSgd: r.amountSgd,
      paidSgd: r.amountSgd,
      refunded: isRefunded(r.paymentIntentId),
    })
  }

  for (const r of merchRows) {
    events.push({
      ...base,
      kind: 'merch',
      type: 'merch',
      id: r.id,
      occurredAt: r.createdAt,
      // The title frozen on the order, not the catalogue's current one.
      variant: r.title,
      party: r.clientName,
      listPriceSgd: r.amountSgd,
      paidSgd: r.amountSgd,
      refunded: isRefunded(r.paymentIntentId),
    })
  }

  for (const r of refundRows) {
    events.push({
      ...base,
      kind: 'refund',
      type: 'refund',
      id: r.id,
      // Guarded by isNotNull above; the cast is the query's shape, not a guess.
      occurredAt: r.refundedAt as Date,
      party: r.clientName,
      paidSgd: `-${r.amountSgd}`,
      refunded: true,
    })
  }

  return events
}

/**
 * The one Finance read. Admin passes whatever the screen has set.
 *
 * ponytail: the Location filter is applied in memory, after the union, rather
 * than as a WHERE on each of the ten queries — one predicate instead of ten,
 * for a studio with two Locations and a few thousand rows a month. If a period
 * ever returns enough rows to feel it, push it into each query's conditions.
 */
export async function getFinance(
  tenantId: string,
  filter: FinanceFilter,
): Promise<FinanceSummary> {
  const [payrollRows, moneyIn] = await Promise.all([
    listPayroll(tenantId, {
      instructorId: filter.instructorId,
      classTypeId: filter.classTypeId,
      from: filter.from,
      to: filter.to,
    }),
    listMoneyIn(tenantId, filter),
  ])

  let events = [...payrollRows.map(payrollToEvent), ...moneyIn]

  if (filter.location) {
    events =
      filter.location === UNATTRIBUTED
        ? events.filter(e => e.locationId == null)
        : events.filter(e => e.locationId === filter.location)
  }

  if (filter.types?.length) {
    const wanted = new Set<string>(filter.types)
    events = events.filter(e => wanted.has(e.type))
  }

  // One search box over both sides of the ledger: a member on a purchase, an
  // instructor on a pay row. Which of the two a name is doesn't have to be known
  // before typing it, which is the point of not having an Instructor picker.
  if (filter.q?.trim()) {
    const needle = filter.q.trim().toLowerCase()
    events = events.filter(e =>
      `${e.party ?? ''} ${e.instructorName ?? ''}`.toLowerCase().includes(needle),
    )
  }

  // "Needs pay" is the backlog of sessions priced before pay was required.
  // A Manual Entry is never unpriced — it IS its amount — so it never appears.
  if (filter.needsPayOnly) {
    events = events.filter(e => e.kind === 'instructor_pay' && e.paySgd == null)
  }

  return summarizeFinance(events)
}
