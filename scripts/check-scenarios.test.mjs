import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countCoverage, findProblems, formatCoverage, readInventory, readTestIds } from './check-scenarios.mjs'

/** A valid row; override the fields a case is about. */
function row(fields = {}) {
  return {
    id: 'CHK-01', area: 'CHK', role: 'admin', scenario: '**Given** a **When** b **Then** c',
    risk: 'UX', level: 'integration', coveredBy: [], status: 'uncovered', line: 3, ...fields,
  }
}

const HEADER = [
  '| ID | area | role | scenario | risk | level | covered by | status |',
  '|---|---|---|---|---|---|---|---|',
].join('\n')

test('reads each Inventory row, splitting "covered by" into its test files', () => {
  const md = [
    '# Scenario Inventory',
    '',
    '## Check-in',
    '',
    HEADER,
    '| CHK-01 | CHK | admin | **Given** a booked member **When** checked in **Then** attended | UX | integration | `be/src/test/check-in.test.ts`, `e2e/journeys/day.spec.ts` | covered |',
    '| CHK-02 | CHK | instructor | **Given** x **When** y **Then** z | money | e2e |  | uncovered |',
  ].join('\n')

  assert.deepEqual(readInventory(md), [
    {
      id: 'CHK-01', area: 'CHK', role: 'admin',
      scenario: '**Given** a booked member **When** checked in **Then** attended',
      risk: 'UX', level: 'integration',
      coveredBy: ['be/src/test/check-in.test.ts', 'e2e/journeys/day.spec.ts'],
      status: 'covered', line: 7,
    },
    {
      id: 'CHK-02', area: 'CHK', role: 'instructor', scenario: '**Given** x **When** y **Then** z',
      risk: 'money', level: 'e2e', coveredBy: [], status: 'uncovered', line: 8,
    },
  ])
})

test('a row with the wrong number of cells is an error naming its line, not a dropped row', () => {
  const md = [HEADER, '| CHK-01 | CHK | admin | a stray | pipe | UX | integration |  | uncovered |'].join('\n')
  assert.throws(() => readInventory(md), /line 3/)
})

test('a test file covers the IDs in its test, it and describe names, in any quote style', () => {
  const source = [
    "describe('CHK-01: check-in', () => {",
    '  it("CHK-02, CHK-03 an instructor checks a member in", async () => {})',
    '  test.skip(`PAYR-10 payroll counts it`, () => {})',
    '})',
    "test.describe('PT-04 a PT request', () => {})",
    "test('a name with no ID', () => {})",
  ].join('\n')
  assert.deepEqual([...readTestIds(source)].sort(), ['CHK-01', 'CHK-02', 'CHK-03', 'PAYR-10', 'PT-04'])
})

test('an ID outside a test name does not count as covering', () => {
  const source = [
    "// CHK-01 is covered below — no, it is not",
    "const id = 'CHK-02'",
    "test('something else', () => { assert.equal(label, 'CHK-03') })",
  ].join('\n')
  assert.deepEqual([...readTestIds(source)], [])
})

test('a covered row whose test still carries its ID has no problem', () => {
  const tests = { 'be/src/test/check-in.test.ts': new Set(['CHK-01']) }
  const rows = [row({ status: 'covered', coveredBy: ['be/src/test/check-in.test.ts'] })]
  assert.deepEqual(findProblems(rows, tests), [])
})

test('a covered row pointing at a deleted file, or at a file whose test lost the ID, is a problem', () => {
  const tests = { 'be/src/test/check-in.test.ts': new Set(['CHK-09']) }
  const rows = [
    row({ id: 'CHK-01', status: 'covered', coveredBy: ['be/src/test/gone.test.ts'], line: 3 }),
    row({ id: 'CHK-02', status: 'failing', coveredBy: ['be/src/test/check-in.test.ts'], line: 4 }),
    row({ id: 'CHK-03', status: 'covered', coveredBy: [], line: 5 }),
  ]
  assert.deepEqual(findProblems(rows, tests), [
    { line: 3, id: 'CHK-01', message: 'covered by be/src/test/gone.test.ts, which does not exist' },
    { line: 4, id: 'CHK-02', message: 'covered by be/src/test/check-in.test.ts, which has no test named with CHK-02' },
    { line: 5, id: 'CHK-03', message: 'marked covered but names no test' },
  ])
})

test('a row missing an ID, role, risk, level or status, or with a value outside the list, is a problem', () => {
  const rows = [
    row({ id: '', line: 3 }),
    row({ id: 'CHK-2', line: 4 }),
    row({ id: 'PT-01', line: 5 }),
    row({ id: 'CHK-04', role: 'owner', risk: '', level: 'manual', status: 'done', line: 6 }),
  ]
  assert.deepEqual(findProblems(rows, {}).map(p => [p.line, p.message]), [
    [3, 'ID "" is not an area prefix and a number, like CHK-03'],
    [4, 'ID "CHK-2" is not an area prefix and a number, like CHK-03'],
    [5, 'ID "PT-01" does not start with its area CHK'],
    [6, 'role "owner" is not one of member, instructor, admin, super, system'],
    [6, 'risk "" is not one of money, tenancy, data-loss, UX'],
    [6, 'level "manual" is not one of unit, integration, e2e'],
    [6, 'status "done" is not one of uncovered, covered, failing, wont-test'],
  ])
})

test('an ID used twice is a problem on the second row', () => {
  const problems = findProblems([row({ line: 3 }), row({ line: 9 })], {})
  assert.deepEqual(problems, [{ line: 9, id: 'CHK-01', message: 'ID already used on line 3' }])
})

test('coverage is counted by status, per role and per risk, over every row', () => {
  const rows = [
    row({ role: 'member', risk: 'money', status: 'covered' }),
    row({ role: 'member', risk: 'money', status: 'uncovered' }),
    row({ role: 'member', risk: 'UX', status: 'failing' }),
    row({ role: 'admin', risk: 'tenancy', status: 'wont-test' }),
  ]
  const zero = { covered: 0, failing: 0, uncovered: 0, 'wont-test': 0, total: 0 }
  assert.deepEqual(countCoverage(rows), {
    all: { covered: 1, failing: 1, uncovered: 1, 'wont-test': 1, total: 4 },
    byRole: {
      member: { ...zero, covered: 1, failing: 1, uncovered: 1, total: 3 },
      instructor: zero,
      admin: { ...zero, 'wont-test': 1, total: 1 },
      super: zero,
      system: zero,
    },
    byRisk: {
      money: { ...zero, covered: 1, uncovered: 1, total: 2 },
      tenancy: { ...zero, 'wont-test': 1, total: 1 },
      'data-loss': zero,
      UX: { ...zero, failing: 1, total: 1 },
    },
  })
})

test('the coverage report prints a covered/uncovered line per role and per risk', () => {
  const report = formatCoverage(countCoverage([
    row({ role: 'member', risk: 'money', status: 'covered' }),
    row({ role: 'member', risk: 'money', status: 'uncovered' }),
  ]))
  assert.match(report, /^All\s+1 of 2 covered \(50%\)\s+1 uncovered$/m)
  assert.match(report, /^\s+member\s+1 of 2 covered \(50%\)\s+1 uncovered$/m)
  assert.match(report, /^\s+instructor\s+0 of 0 covered\s+0 uncovered$/m)
  assert.match(report, /^\s+money\s+1 of 2 covered \(50%\)\s+1 uncovered$/m)
})

test('an Inventory table whose header is off is an error, not a section silently skipped', () => {
  const md = [
    '| ID | area | role | scenario | risk | level | coverd by | status |',
    '|---|---|---|---|---|---|---|---|',
    '| CHK-01 | CHK | admin | x | UX | integration |  | uncovered |',
  ].join('\n')
  assert.throws(() => readInventory(md), /line 1: .*header/)
})

test('a row naming a test while not marked covered or failing is a problem', () => {
  const tests = { 'be/src/test/check-in.test.ts': new Set(['CHK-01']) }
  const rows = [row({ status: 'uncovered', coveredBy: ['be/src/test/check-in.test.ts'] })]
  assert.deepEqual(findProblems(rows, tests), [
    { line: 3, id: 'CHK-01', message: 'names a test in "covered by" but is marked uncovered' },
  ])
})

test('tables that are not the Inventory are ignored', () => {
  const md = ['| role | meaning |', '|---|---|', '| admin | runs the studio |'].join('\n')
  assert.deepEqual(readInventory(md), [])
})
