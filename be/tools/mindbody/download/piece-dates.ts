import type { TableRow } from '../transform/html-table'
import { ymd } from './plan'

/**
 * A date-split piece checked against its own range. Mindbody sometimes answers
 * one year's request with another year's rows (Attendance without Revenue has
 * returned 2025 for 2026, and 2024 for 2023), and the file still downloads as
 * a good one. A piece whose `Date` column names a day outside the range it
 * asked for is that answer.
 *
 * Read off the header row's `Date` column: a workbook day number (`46022`) or
 * `M/D/YYYY`. A table with no `Date` column, or a cell that is neither, is not
 * checked: this only refuses what it can read.
 */
export function strayDates(rows: TableRow[], win: { from: Date; to: Date }): string | null {
  const header = rows.findIndex(r => r.cells.some(c => /^date$/i.test(c.trim())))
  if (header < 0) return null
  const col = rows[header]!.cells.findIndex(c => /^date$/i.test(c.trim()))
  const from = ymd(win.from)
  const to = ymd(win.to)
  let outside = 0
  let first: string | null = null
  for (const row of rows.slice(header + 1)) {
    const day = calendarDay(row.cells[col] ?? '')
    if (!day || (day >= from && day <= to)) continue
    outside++
    first ??= day
  }
  return outside ? `${outside} row(s) dated outside ${from}..${to} (first ${first})` : null
}

/** `46022` (a workbook day number) or `12/31/2025`, as `YYYY-MM-DD`; anything else null. */
function calendarDay(cell: string): string | null {
  const text = cell.trim()
  if (/^\d{5}(\.\d+)?$/.test(text)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86_400_000).toISOString().slice(0, 10)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  return m ? `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null
}
