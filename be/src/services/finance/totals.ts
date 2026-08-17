/**
 * Finance grouping + totalling — pure, no DB, no HTTP.
 *
 * THE one place any money figure is computed. The tiles, the table and the CSV
 * export all come out of this function, so they cannot disagree about a period.
 * Routes pick fields from what it returns; they do no arithmetic of their own.
 *
 * Rules encoded here (see docs/adr/0001-finance-replaces-payroll.md):
 *   - discount is derived, List Price minus amount paid — never read from a
 *     Redemption, which is absent on a comp grant and partial when a Promotion
 *     and a Promo Code stack;
 *   - a Refund carries a negative `paidSgd` and is reported as a positive
 *     magnitude; the purchase it reverses stays in the set, tagged;
 *   - an Unpriced session contributes nothing and is counted separately — pay
 *     not decided yet is not pay of zero;
 *   - a row's mutability is a property of its kind and is carried on the row,
 *     so no frontend re-derives which rows may be edited;
 *   - rows are newest-first; per-instructor totals are by instructor name.
 */
import { isEditable, isMoneyIn, type MoneyEvent, type MoneyEventKind } from './events'

/** A Money Event as the endpoints serialize it (snake_case, JSON-ready). */
export interface FinanceLine {
  kind: MoneyEventKind
  id: string
  occurred_at: string
  ends_at: string | null
  label: string
  location_id: string | null
  location_name: string | null
  /** True where the platform records no Location for this row at all. */
  unattributed: boolean
  list_price_sgd: number | null
  paid_sgd: number | null
  /** List Price minus amount paid. Null on money-out rows. */
  discount_sgd: number | null
  promo_code: string | null
  refunded: boolean
  instructor_id: string | null
  instructor_name: string | null
  pay_sgd: number | null
  /** True where this is a session whose pay has not been decided. */
  unpriced: boolean
  /** Which table a pay edit on this row writes to. Null on every money-in row. */
  pay_kind: 'class' | 'pt' | 'workshop' | 'manual' | null
  class_type_id: string | null
  session_type: '1on1' | '2on1' | null
  duration_minutes: number | null
  /** Whether an admin may change this row's amount. Never re-derive it. */
  editable: boolean
}

export interface FinanceTotals {
  /** Sum of List Price across money-in rows, before anything came off. */
  gross_sgd: number
  /** Money given away by Promotions and Promo Codes. */
  discounts_sgd: number
  /** Refunded money, as a positive magnitude. */
  refunds_sgd: number
  /** Sum over PRICED pay rows only. */
  instructor_pay_sgd: number
  /** gross − discounts − refunds − instructor pay. Not profit. */
  net_sgd: number
}

export interface FinanceInstructorTotal {
  instructor_id: string
  instructor_name: string
  total_sgd: number
  session_count: number
}

export interface FinanceSummary {
  rows: FinanceLine[]
  totals: FinanceTotals
  /** Per-instructor pay breakdown — what to pay each instructor at month end. */
  instructor_totals: FinanceInstructorTotal[]
  /** Sessions with no pay set. Counted, excluded from every total. */
  unpriced_count: number
}

/** Money is numeric(10,2); accumulate in cents so 0.10 + 0.20 stays 0.30. */
const toCents = (v: string) => Math.round(Number(v) * 100)
const fromCents = (c: number) => c / 100
const num = (v: string | null) => (v == null ? null : Number(v))

/**
 * A session row with no pay is Unpriced. A Manual Entry never is: the entry IS
 * its amount, so a null there would be a labelled ghost rather than a decision
 * still to make — and the create path refuses one.
 */
const isUnpriced = (e: MoneyEvent) => e.kind === 'instructor_pay' && e.paySgd == null

function serialize(e: MoneyEvent): FinanceLine {
  const list = e.listPriceSgd == null ? null : toCents(e.listPriceSgd)
  const paid = e.paidSgd == null ? null : toCents(e.paidSgd)
  return {
    kind: e.kind,
    id: e.id,
    occurred_at: e.occurredAt.toISOString(),
    ends_at: e.endsAt?.toISOString() ?? null,
    label: e.label,
    location_id: e.locationId,
    location_name: e.locationName,
    unattributed: e.locationId == null,
    list_price_sgd: list == null ? null : fromCents(list),
    paid_sgd: paid == null ? null : fromCents(paid),
    discount_sgd: list == null || paid == null ? null : fromCents(list - paid),
    promo_code: e.promoCode,
    refunded: e.refunded,
    instructor_id: e.instructorId,
    instructor_name: e.instructorName,
    pay_sgd: num(e.paySgd),
    unpriced: isUnpriced(e),
    pay_kind: e.payKind,
    class_type_id: e.classTypeId,
    session_type: e.sessionType,
    duration_minutes: e.endsAt
      ? Math.round((e.endsAt.getTime() - e.occurredAt.getTime()) / 60000)
      : null,
    editable: isEditable(e.kind),
  }
}

export function summarizeFinance(events: readonly MoneyEvent[]): FinanceSummary {
  const byInstructor = new Map<string, FinanceInstructorTotal & { cents: number }>()
  let grossCents = 0
  let discountCents = 0
  let refundCents = 0
  let payCents = 0
  let unpricedCount = 0

  for (const e of events) {
    if (isMoneyIn(e.kind)) {
      // Both columns are NOT NULL on a real purchase; a source that can't supply
      // one contributes nothing rather than poisoning the total with NaN.
      if (e.listPriceSgd == null || e.paidSgd == null) continue
      const list = toCents(e.listPriceSgd)
      const paid = toCents(e.paidSgd)
      grossCents += list
      discountCents += list - paid
      continue
    }

    if (e.kind === 'refund') {
      // Carried negative on the row so the table reads as money leaving; the
      // tile states a magnitude, and Net subtracts it.
      if (e.paidSgd != null) refundCents += Math.abs(toCents(e.paidSgd))
      continue
    }

    // -- money out: Instructor Pay and Manual Entries -------------------------
    if (isUnpriced(e)) {
      unpricedCount += 1
      continue
    }
    if (e.paySgd == null || e.instructorId == null) continue

    const cents = toCents(e.paySgd)
    payCents += cents
    const t =
      byInstructor.get(e.instructorId) ??
      {
        instructor_id: e.instructorId,
        instructor_name: e.instructorName ?? '',
        total_sgd: 0,
        session_count: 0,
        cents: 0,
      }
    t.cents += cents
    t.session_count += 1
    byInstructor.set(e.instructorId, t)
  }

  const instructorTotals = Array.from(byInstructor.values())
    .map(({ cents, ...t }) => ({ ...t, total_sgd: fromCents(cents) }))
    .sort((a, b) => a.instructor_name.localeCompare(b.instructor_name))

  return {
    rows: [...events]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .map(serialize),
    totals: {
      gross_sgd: fromCents(grossCents),
      discounts_sgd: fromCents(discountCents),
      refunds_sgd: fromCents(refundCents),
      instructor_pay_sgd: fromCents(payCents),
      net_sgd: fromCents(grossCents - discountCents - refundCents - payCents),
    },
    instructor_totals: instructorTotals,
    unpriced_count: unpricedCount,
  }
}
