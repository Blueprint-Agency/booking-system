/**
 * The studio's Receipts as a CSV for its bookkeeper (#390): one row per
 * Receipt the admin's filters keep, in the list's own order. A projection of
 * the rows `exportStudioReceipts` reads, as Finance's export is of its screen
 * (`services/finance/csv.ts`). Pure.
 */
import { sgFormat } from '../../lib/time'
import type { StudioReceiptSummary } from './read'

// The studio's own calendar day, sortable as text in a spreadsheet.
const sgDate = sgFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })

/** Each kind as the admin's Receipts page names it (fe-portal `receiptKindLabel`). */
const KIND_LABELS: Record<StudioReceiptSummary['kind'], string> = {
  class_package: 'Class package',
  pt_package: 'Private sessions',
  workshop: 'Workshop',
  merch: 'Merch',
  cross_location_add_on: 'Cross-Location Add-On',
  corporate_package: 'Corporate package',
}

export const RECEIPTS_CSV_HEADER = ['number', 'date', 'member', 'email', 'kind', 'item', 'total_sgd', 'status'] as const

/**
 * One cell. A value a spreadsheet would run as a formula (`=`, `+`, `-`, `@`,
 * or a tab or carriage return first) is kept as text by a leading apostrophe:
 * a member names themselves, and their name must not become a formula on the
 * bookkeeper's machine. Quoted when it holds a comma, quote or line break.
 */
function cell(value: string | null): string {
  if (value == null) return ''
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * The file. A permanently deleted member's Receipt keeps its row, with the
 * member and email empty as the Receipt now has them.
 */
export function receiptsCsv(rows: readonly StudioReceiptSummary[]): string {
  const lines = rows.map(r =>
    [
      r.number,
      sgDate.format(r.issuedAt),
      r.buyerName,
      r.buyerEmail,
      KIND_LABELS[r.kind],
      r.item,
      r.totalSgd,
      r.status,
    ]
      .map(cell)
      .join(','),
  )
  return [RECEIPTS_CSV_HEADER.join(','), ...lines].join('\r\n')
}
