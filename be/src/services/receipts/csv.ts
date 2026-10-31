/**
 * The studio's Receipts as a CSV for its bookkeeper: one row per
 * Receipt the admin's filters keep, in the list's own order. A projection of
 * the rows `exportStudioReceipts` reads, as Finance's export is of its screen
 * (`services/finance/csv.ts`). Pure.
 */
import { zoneFormat } from '../../lib/studio-time'
import { billToAddressLines } from '../billing-details/address'
import type { StudioReceiptSummary } from './read'

// The studio's own calendar day, sortable as text in a spreadsheet.
const studioDate = (timezone: string) =>
  zoneFormat(timezone, 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })

/** Each kind as the admin's Receipts page names it (fe-portal `receiptKindLabel`). */
const KIND_LABELS: Record<StudioReceiptSummary['kind'], string> = {
  class_package: 'Class package',
  pt_package: 'Private sessions',
  workshop: 'Workshop',
  merch: 'Merch',
  cross_location_add_on: 'Cross-Location Add-On',
  corporate_package: 'Corporate package',
}

const RECEIPTS_CSV_HEADER = [
  'number',
  'date',
  'member',
  'email',
  'kind',
  'item',
  'total_sgd',
  'status',
  'bill_to_name',
  'bill_to_address',
] as const

/** A Bill to's address on one line, the lines the Receipt prints joined by commas. */
const oneLine = (bill: StudioReceiptSummary['billTo']): string | null => (bill ? billToAddressLines(bill).join(', ') : null)

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
 * member, email and Bill to empty as the Receipt now has them. A Receipt whose
 * Purchase chose no Billing details has the Bill to columns empty. Each date
 * is the day the Receipt was issued on the studio's clock, `timezone`.
 */
export function receiptsCsv(rows: readonly StudioReceiptSummary[], timezone: string): string {
  const date = studioDate(timezone)
  const lines = rows.map(r =>
    [
      r.number,
      date.format(r.issuedAt),
      r.buyerName,
      r.buyerEmail,
      KIND_LABELS[r.kind],
      r.item,
      r.totalSgd,
      r.status,
      r.billTo?.name ?? null,
      oneLine(r.billTo),
    ]
      .map(cell)
      .join(','),
  )
  return [RECEIPTS_CSV_HEADER.join(','), ...lines].join('\r\n')
}
