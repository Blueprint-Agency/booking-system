/**
 * The CSV export — a projection of the rows the screen already got.
 *
 * Not a second query and not a second shape: the file a bookkeeper opens and
 * the table an admin was looking at come out of one read, so they cannot
 * describe different periods.
 */
import type { FinanceSummary } from './totals'

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
