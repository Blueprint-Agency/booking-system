/**
 * The CSV export — a projection of the rows the screen already got.
 *
 * Not a second query and not a second shape: the file a bookkeeper opens and
 * the table an admin was looking at come out of one read, so they cannot
 * describe different periods.
 */
import { sgFormat } from '../../lib/time'
import type { FinanceSummary } from './totals'

// Date and time are split into two columns, both in studio time — a spreadsheet
// sorts and groups them, which it cannot do with one ISO instant in UTC.
const sgDate = sgFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
const sgTime = sgFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

export function financeCsv(summary: FinanceSummary): string {
  // Columns in the order the screen shows them, so a reader who scanned the
  // table isn't re-learning the layout in their spreadsheet.
  const header = [
    'date',
    'time',
    'user',
    'type',
    'variant',
    'price_sgd',
    'location',
    'discount_sgd',
    'promo_code',
    'money_in_sgd',
    'money_out_sgd',
    'refunded',
  ]
  const cell = (v: string | number | boolean | null) => {
    if (v == null) return ''
    const s = String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = summary.rows.map(r => {
    const at = new Date(r.occurred_at)
    return [
      sgDate.format(at),
      sgTime.format(at),
      r.user_name,
      r.type,
      r.variant,
      r.list_price_sgd,
      r.unattributed ? 'Unattributed' : r.location_name,
      r.discount_sgd,
      r.promo_code,
      r.paid_sgd,
      r.pay_sgd,
      r.refunded ? 'yes' : '',
    ]
      .map(cell)
      .join(',')
  })
  return [header.join(','), ...lines].join('\r\n')
}
