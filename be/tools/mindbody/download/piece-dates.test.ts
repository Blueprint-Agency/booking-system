import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strayDates } from './piece-dates'

const table = (...rows: string[][]) => rows.map(cells => ({ cells, links: cells.map(() => null) }))
const year2026 = { from: new Date(2026, 0, 1), to: new Date(2026, 10, 11) }

test('a piece whose rows are all inside its range passes, by workbook day number or M/D/YYYY', () => {
  // 46023 is 1 Jan 2026; 46337 is 11 Nov 2026.
  const rows = table(['Date', 'Day', 'Client'], ['46023', 'Thursday', 'A'], ['46337', 'Wednesday', 'B'], ['3/4/2026', 'Wednesday', 'C'])
  assert.equal(strayDates(rows, year2026), null)
})

test('a piece holding another year\'s rows is named, with how many and the first stray day', () => {
  // The 2026 piece Mindbody answered with 2025: 46022 is 31 Dec 2025.
  const rows = table(['Date', 'Day', 'Client'], ['46022', 'Wednesday', 'A'], ['45658', 'Wednesday', 'B'], ['46023', 'Thursday', 'C'])
  assert.equal(strayDates(rows, year2026), '2 row(s) dated outside 2026-01-01..2026-11-11 (first 2025-12-31)')
})

test('a table with no Date column, or a Date cell it cannot read, is not refused', () => {
  assert.equal(strayDates(table(['Client', 'Visits'], ['A', '46022']), year2026), null)
  assert.equal(strayDates(table(['Date', 'Client'], ['Total', 'A'], ['', 'B']), year2026), null)
})
