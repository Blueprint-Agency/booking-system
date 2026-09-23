import assert from 'node:assert/strict'
import { test } from 'node:test'
import { areaOf, formatSummary, parseLcov, summarise } from './coverage-summary.mjs'

const lcov = [
  'TN:',
  'SF:src\\services\\billing\\refund.ts',
  'FN:3,refund',
  'FNDA:1,refund',
  'FNF:4',
  'FNH:3',
  'BRF:10',
  'BRH:5',
  'DA:1,1',
  'LH:80',
  'LF:100',
  'end_of_record',
  'TN:',
  'SF:src/services/billing/purchase.ts',
  'FNF:0',
  'FNH:0',
  'BRF:0',
  'BRH:0',
  'LH:20',
  'LF:100',
  'end_of_record',
  'SF:src/services/packages/credits.ts',
  'FNF:2',
  'FNH:2',
  'BRF:4',
  'BRH:4',
  'LH:50',
  'LF:50',
  'end_of_record',
  'SF:src/routes/portal/admin/classes.ts',
  'LH:0',
  'LF:10',
  'end_of_record',
  '',
].join('\n')

test('lcov records are read per file, with Windows paths made forward-slashed', () => {
  assert.deepEqual(parseLcov(lcov)[0], {
    file: 'src/services/billing/refund.ts',
    lines: { hit: 80, found: 100 },
    functions: { hit: 3, found: 4 },
    branches: { hit: 5, found: 10 },
  })
  assert.equal(parseLcov(lcov).length, 4)
  assert.deepEqual(parseLcov(lcov)[3].functions, { hit: 0, found: 0 })
})

test('a service file belongs to its service folder; anything else to its top-level src folder', () => {
  assert.equal(areaOf('src/services/billing/refund.ts'), 'services/billing')
  assert.equal(areaOf('src/services/pt-sessions/lifecycle/approve.ts'), 'services/pt-sessions')
  assert.equal(areaOf('src/routes/portal/admin/classes.ts'), 'routes')
  assert.equal(areaOf('src/server.ts'), 'src')
})

test('files are summed per folder, services first, with a total', () => {
  const rows = summarise(parseLcov(lcov))
  assert.deepEqual(
    rows.map((r) => [r.area, r.lines.hit, r.lines.found]),
    [
      ['services/billing', 100, 200],
      ['services/packages', 50, 50],
      ['routes', 0, 10],
      ['total', 150, 260],
    ],
  )
})

test('the summary is a markdown table of percentages and counts, with no pass/fail', () => {
  const out = formatSummary(summarise(parseLcov(lcov)))
  const lines = out.split('\n')
  assert.equal(lines[0], '### Backend coverage by folder')
  assert.ok(lines.includes('| Folder | Lines | Branches | Functions |'))
  assert.ok(lines.includes('| services/billing | 50.0% (100/200) | 50.0% (5/10) | 75.0% (3/4) |'))
  assert.ok(lines.includes('| routes | 0.0% (0/10) | — | — |'))
  assert.ok(lines.includes('| **total** | **57.7% (150/260)** | **64.3% (9/14)** | **83.3% (5/6)** |'))
})
