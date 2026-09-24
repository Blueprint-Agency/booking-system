import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describePlan, exportDir, plannedFiles, profileReports, runDates } from './plan'

/**
 * 44 Sales (Reports → Sales → Sales), Detail view on the accrual basis: the one
 * report with each sale's payment method. The cutover download fetches it as a
 * single file over the whole history range, posted to its Excel endpoint.
 */

const planned = () => plannedFiles(profileReports('cutover')).find(f => f.report.kind === 'saleMethods')

test('the cutover download fetches Sales (Detail, Accrual) as one file the transform reads as saleMethods', () => {
  const f = planned()
  assert.ok(f, 'the cutover profile downloads the sales-method report')
  assert.equal(f.folder, 'Sales/44 Sales')
  assert.equal(f.file, '44 Sales - Detail Accrual.xlsx')
  assert.equal(f.type, 'post')
  assert.equal(f.path, '/Report/Sales/Sales')
  assert.equal(f.report.single, true)
  assert.ok(!f.report.optional, 'a failure fails the cutover download')
})

test('Sales is asked for every sale: every location and method, Detail, accrual only, history cutoff to today', () => {
  const { set } = planned()!
  assert.equal(set.optDisMode, 'Detail')
  assert.equal(set.optBasis, 'AccrualBasis')
  // "Accrual & cash combined" is left off: on, it lists a sale twice.
  assert.ok(!('optAllCombined' in set))
  for (const every of ['optSaleLoc', 'optHomeStudio', 'optPayMethod', 'optCategory']) assert.equal(set[every], '*', every)
  assert.equal(set.optIncludeAutoRenews, 'Include')
  assert.equal(set.requiredtxtDateStart, '$START')
  assert.equal(set.requiredtxtDateEnd, '$TODAY')
})

test('the dry run lists Sales under reports/Sales with the history range', () => {
  const started = new Date(2026, 8, 17, 2, 5)
  const lines = describePlan('cutover', exportDir('exports', started), profileReports('cutover'), runDates(started, new Date(2023, 0, 1)))
  const at = lines.findIndex(l => l.endsWith('reports/Sales/44 Sales/44 Sales - Detail Accrual.xlsx'))
  assert.ok(at >= 0, 'Sales is in the plan')
  assert.ok(lines[at + 1]!.includes('post /Report/Sales/Sales'))
  assert.ok(lines[at + 1]!.includes('requiredtxtDateStart=1/1/2023 requiredtxtDateEnd=17/9/2026'))
  assert.ok(lines[at + 1]!.includes('transform reads it as saleMethods, single file'))
})
