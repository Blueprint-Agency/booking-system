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
import { and, eq, gte, isNotNull, lte, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages, classPackages, ptPackages, promoCodes } from '../../db/schema/packages'
import { bookings } from '../../db/schema/bookings'
import { stripePayments } from '../../db/schema/ledger'
import { merchOrders, locations } from '../../db/schema/catalog'
import { workshops } from '../../db/schema/schedule'
import { clients } from '../../db/schema/identity'
import { listPayroll, type PayrollRow } from '../payroll/list'
import { summarizeFinance, type FinanceSummary } from './totals'
import type { MoneyEvent } from './events'

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
}

const base = {
  locationId: null,
  locationName: null,
  listPriceSgd: null,
  paidSgd: null,
  promoCode: null,
  refunded: false,
  instructorId: null,
  instructorName: null,
  paySgd: null,
  payKind: null,
  classTypeId: null,
  endsAt: null,
  sessionType: null,
} satisfies Omit<MoneyEvent, 'kind' | 'id' | 'occurredAt' | 'label'>

/** Payroll's row shape → a Money Event. Pay rows are the money-out side. */
function payrollToEvent(r: PayrollRow): MoneyEvent {
  return {
    ...base,
    kind: r.kind === 'manual' ? 'manual' : 'instructor_pay',
    id: r.id,
    occurredAt: r.startsAt,
    endsAt: r.endsAt,
    label: r.label,
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

async function listMoneyIn(filter: FinanceFilter): Promise<MoneyEvent[]> {
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
      paymentIntentId: clientPackages.stripePaymentIntentId,
    })
    .from(clientPackages)
    .innerJoin(clients, eq(clients.id, clientPackages.clientId))
    .leftJoin(locations, eq(locations.id, clientPackages.locationId))
    .leftJoin(promoCodes, eq(promoCodes.id, clientPackages.appliedPromoCodeId))
    .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
    .where(and(...within(clientPackages.purchasedAt, filter)))

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
      paymentIntentId: bookings.stripePaymentIntentId,
    })
    .from(bookings)
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .innerJoin(workshops, eq(workshops.id, bookings.workshopId))
    .leftJoin(locations, eq(locations.id, workshops.locationId))
    .leftJoin(promoCodes, eq(promoCodes.id, bookings.appliedPromoCodeId))
    .where(
      and(
        eq(bookings.kind, 'workshop'),
        isNotNull(bookings.listPriceSgd),
        ...within(bookings.bookedAt, filter),
      ),
    )

  // -- corporate package sales ------------------------------------------------
  // No client_packages row exists for these, so there is no List Price to
  // compare against and no Promo Code that could have applied — the price is
  // negotiated off-platform. List equals paid, and the discount is always zero.
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
        eq(stripePayments.kind, 'corporate_package'),
        eq(stripePayments.status, 'succeeded'),
        ...within(stripePayments.createdAt, filter),
      ),
    )

  // -- merch orders -----------------------------------------------------------
  // Paid online, collected in person. No Promo Codes and no Location.
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
    .where(and(...within(merchOrders.createdAt, filter)))

  // -- refunds ----------------------------------------------------------------
  // A Refund is the whole purchase back. It lands on its OWN date so a closed
  // month never restates itself, and the purchase row it reverses stays in the
  // set, tagged — see docs/adr/0001-finance-replaces-payroll.md.
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
    .where(
      and(
        eq(stripePayments.status, 'refunded'),
        isNotNull(stripePayments.refundedAt),
        ...within(stripePayments.refundedAt, filter),
      ),
    )

  // Which purchases carry the "Refunded" tag. Read over the WHOLE history, not
  // the filtered window: a purchase in August refunded in September is still a
  // refunded purchase when you look at August.
  const refunded = new Set(
    (
      await db
        .select({ intent: stripePayments.paymentIntentId })
        .from(stripePayments)
        .where(eq(stripePayments.status, 'refunded'))
    ).map(r => r.intent),
  )
  const isRefunded = (intent: string | null) => intent != null && refunded.has(intent)

  const events: MoneyEvent[] = []

  for (const r of packageRows) {
    const name = r.classPackageName ?? r.ptPackageName ?? r.kind
    events.push({
      ...base,
      kind: 'purchase',
      id: r.id,
      occurredAt: r.purchasedAt,
      label: `${name} — ${r.clientName}`,
      locationId: r.locationId,
      locationName: r.locationName,
      listPriceSgd: r.listPriceSgd,
      paidSgd: r.amountPaidSgd,
      promoCode: r.promoCode,
      refunded: isRefunded(r.paymentIntentId),
    })
    // The Add-On's own line. The column IS what the member paid for it, and it
    // is not part of the plan's List Price, so it is its own Money Event with
    // no discount — never a discount on the plan.
    if (r.crossLocationPaidSgd != null) {
      events.push({
        ...base,
        kind: 'addon',
        id: r.id,
        occurredAt: r.purchasedAt,
        label: `Cross-Location Add-On — ${r.clientName}`,
        locationId: r.locationId,
        locationName: r.locationName,
        listPriceSgd: r.crossLocationPaidSgd,
        paidSgd: r.crossLocationPaidSgd,
        refunded: isRefunded(r.paymentIntentId),
      })
    }
  }

  for (const r of workshopRows) {
    events.push({
      ...base,
      kind: 'workshop_ticket',
      id: r.id,
      occurredAt: r.bookedAt,
      label: `${r.workshopName} — ${r.clientName}`,
      locationId: r.locationId,
      locationName: r.locationName,
      listPriceSgd: r.listPriceSgd,
      paidSgd: r.amountPaidSgd,
      promoCode: r.promoCode,
      refunded: isRefunded(r.paymentIntentId),
    })
  }

  for (const r of corporateRows) {
    events.push({
      ...base,
      kind: 'corporate',
      id: r.id,
      occurredAt: r.createdAt,
      label: `Corporate package — ${r.clientName}`,
      listPriceSgd: r.amountSgd,
      paidSgd: r.amountSgd,
      refunded: isRefunded(r.paymentIntentId),
    })
  }

  for (const r of merchRows) {
    events.push({
      ...base,
      kind: 'merch',
      id: r.id,
      occurredAt: r.createdAt,
      label: `${r.title} — ${r.clientName}`,
      listPriceSgd: r.amountSgd,
      paidSgd: r.amountSgd,
      refunded: isRefunded(r.paymentIntentId),
    })
  }

  for (const r of refundRows) {
    events.push({
      ...base,
      kind: 'refund',
      id: r.id,
      // Guarded by isNotNull above; the cast is the query's shape, not a guess.
      occurredAt: r.refundedAt as Date,
      label: `Refund — ${r.clientName}`,
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
export async function getFinance(filter: FinanceFilter): Promise<FinanceSummary> {
  const [payrollRows, moneyIn] = await Promise.all([
    listPayroll({
      instructorId: filter.instructorId,
      classTypeId: filter.classTypeId,
      from: filter.from,
      to: filter.to,
    }),
    listMoneyIn(filter),
  ])

  let events = [...payrollRows.map(payrollToEvent), ...moneyIn]

  if (filter.location) {
    events =
      filter.location === UNATTRIBUTED
        ? events.filter(e => e.locationId == null)
        : events.filter(e => e.locationId === filter.location)
  }

  // "Needs pay" is the backlog of sessions priced before pay was required.
  // A Manual Entry is never unpriced — it IS its amount — so it never appears.
  if (filter.needsPayOnly) {
    events = events.filter(e => e.kind === 'instructor_pay' && e.paySgd == null)
  }

  return summarizeFinance(events)
}

/**
 * The CSV, from the same rows the screen got. Not a second query and not a
 * second shape — a projection, so the file and the table cannot disagree.
 */
export function financeCsv(summary: FinanceSummary): string {
  const header = [
    'date',
    'type',
    'description',
    'location',
    'member_or_instructor',
    'list_price_sgd',
    'discount_sgd',
    'paid_sgd',
    'promo_code',
    'instructor_pay_sgd',
    'refunded',
  ]
  const cell = (v: string | number | boolean | null) => {
    if (v == null) return ''
    const s = String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = summary.rows.map(r =>
    [
      r.occurred_at,
      r.kind,
      r.label,
      r.unattributed ? 'Unattributed' : r.location_name,
      r.instructor_name,
      r.list_price_sgd,
      r.discount_sgd,
      r.paid_sgd,
      r.promo_code,
      r.pay_sgd,
      r.refunded ? 'yes' : '',
    ]
      .map(cell)
      .join(','),
  )
  return [header.join(','), ...lines].join('\r\n')
}
