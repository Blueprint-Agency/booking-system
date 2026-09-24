import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readSaleMethods } from './readers'
import { readReports } from './transform'
import { readXlsxTable } from './xlsx'

/**
 * 44 Sales (Detail, Accrual): how each Mindbody sale was paid. The fixture is an
 * invented workbook shaped like the real export (`fixtures/sale-methods.rows.json`,
 * built by `fixtures/build-workbook.ts`): one row per item line × payment, so a
 * sale paid two ways repeats its line with each part in "Total Paid w/ Payment Method".
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'reports')
const WORKBOOK = path.join(FIXTURES, 'Sales', '44 Sales', '44 Sales - Detail Accrual.xlsx')

const read = async () => readSaleMethods(await readXlsxTable(readFileSync(WORKBOOK)))

test('sale methods: a sale paid one way is one row, its lines added up', async () => {
  const rows = await read()
  assert.deepEqual(rows.filter(r => r.saleId === '15001'), [{ saleId: '15001', methodLabel: 'Cash', amount: 120 }])
  // Two items on one card: still one sale paid one way.
  assert.deepEqual(rows.filter(r => r.saleId === '15002'), [{ saleId: '15002', methodLabel: 'Credit card (Test Card-Keyed)', amount: 120 }])
})

test('sale methods: a sale split across two methods is a row per method, each with its own part', async () => {
  const rows = await read()
  assert.deepEqual(rows.filter(r => r.saleId === '25003'), [
    { saleId: '25003', methodLabel: 'Cash', amount: 50 },
    { saleId: '25003', methodLabel: 'Credit card (Test Card-Keyed)', amount: 150 },
  ])
  // Two payments by the same method are that method once, for both parts.
  assert.deepEqual(rows.filter(r => r.saleId === '25004'), [{ saleId: '25004', methodLabel: 'Misc. (Test Wallet)', amount: 80.5 }])
})

test('sale methods: a refund line is its sale with the money going back', async () => {
  const rows = await read()
  assert.deepEqual(rows.filter(r => r.saleId === '35005'), [{ saleId: '35005', methodLabel: 'Cash', amount: -120 }])
  // A return that moved no money has no method, and nothing to record.
  assert.deepEqual(rows.filter(r => r.saleId === '35006'), [])
  // A $0 sale keeps the method Mindbody gave it; the transform decides what a comp is.
  assert.deepEqual(rows.filter(r => r.saleId === '35007'), [{ saleId: '35007', methodLabel: 'Misc. (Test Comp)', amount: 0 }])
})

test('sale methods: header, group, blank and total rows are skipped', async () => {
  const rows = await read()
  assert.deepEqual(rows.map(r => r.saleId), ['15001', '15002', '25003', '25003', '25004', '35005', '35007'])
})

test('sale methods: a paid line with no method is refused, not read as some method', () => {
  const header = ['Sale Date', 'Client ID', 'Sale ID', 'Item Total', 'Total Paid w/ Payment Method', 'Payment Method']
  const table = [header, ['69459', '100000001', '15001', '60', '60', '']].map(cells => ({ cells, links: cells.map(() => null) }))
  assert.throws(() => readSaleMethods(table), /15001.*no payment method/)
})

test('sale methods: a workbook that is not the Sales report is refused by name', () => {
  const table = [['Client', 'Total']].map(cells => ({ cells, links: cells.map(() => null) }))
  assert.throws(() => readSaleMethods(table), /Sales \(detail\).*Payment Method/)
})

test('sale methods: a download folder holding the report reads it', async () => {
  const reports = await readReports(FIXTURES)
  assert.deepEqual(reports.saleMethods, await read())
})
