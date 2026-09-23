#!/usr/bin/env node
/**
 * Traces the Scenario Inventory (docs/md/test-scenarios.md) to the tests.
 *
 * Every Inventory row has a stable ID (`CHK-03`). A test covers a row when its
 * name — the title string of a `test(…)`, `it(…)` or `describe(…)` — carries
 * that ID. This reads the Inventory and every test file in be/, fe-client/,
 * fe-portal/ and e2e/, then prints covered/uncovered counts by role and by
 * risk.
 *
 * It fails when a row marked covered (or failing) names a test file that does
 * not exist, or that no longer has a test carrying the row's ID — so the table
 * cannot quietly claim coverage that was deleted. It also fails on a row it
 * cannot read, so a typo cannot drop a row from the counts unseen.
 *
 * No dependencies and no TypeScript loader: every file is read as text.
 *
 *   node scripts/check-scenarios.mjs [inventory.md]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const INVENTORY = 'docs/md/test-scenarios.md'

/**
 * Where product tests live; each is searched recursively. Not `scripts/`: its
 * tests prove tooling, and this script's own test names example IDs.
 */
const TEST_ROOTS = ['be/src', 'fe-client/src', 'fe-portal/src', 'e2e']
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mjs|js)$/
const SKIP_DIRS = new Set(['node_modules', '.next', 'test-results', 'playwright-report'])

const COLUMNS = ['ID', 'area', 'role', 'scenario', 'risk', 'level', 'covered by', 'status']

export const ROLES = ['member', 'instructor', 'admin', 'super', 'system']
export const RISKS = ['money', 'tenancy', 'data-loss', 'UX']
export const LEVELS = ['unit', 'integration', 'e2e']
export const STATUSES = ['uncovered', 'covered', 'failing', 'wont-test']

/** Statuses that claim a test exists — `failing` is a test that exists and is red. */
const CLAIMS_A_TEST = ['covered', 'failing']

/** `CHK-03`, `PAYR-12`: an area prefix and a two- or three-digit number. */
const ID = /\b[A-Z]{2,5}-\d{2,3}\b/g

/** The title of a `test(…)`, `it(…)` or `describe(…)` call, including `test.skip(…)` and `test.describe(…)`. */
const TEST_NAME = /(?<![\w.])(?:test|it|describe)(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g

/** The Inventory IDs a test file's test names carry. An ID anywhere else in the file does not count. */
export function readTestIds(source) {
  const ids = new Set()
  for (const [, , name] of source.matchAll(TEST_NAME)) {
    for (const [id] of name.matchAll(ID)) ids.add(id)
  }
  return ids
}

/**
 * What is wrong with the Inventory, in row order: rows it cannot trust (a bad
 * ID or a value outside its list), IDs used twice, and rows claiming a test
 * that does not exist. `testIdsByFile` maps each test file's repo path to the
 * IDs its test names carry (`readTestIds`). No problems is an empty list.
 */
export function findProblems(rows, testIdsByFile) {
  const problems = []
  const firstLine = new Map()
  for (const r of rows) {
    const problem = message => problems.push({ line: r.line, id: r.id, message })
    if (!new RegExp(`^${ID.source}$`).test(r.id)) {
      problem(`ID "${r.id}" is not an area prefix and a number, like CHK-03`)
    } else if (r.id.split('-')[0] !== r.area) {
      problem(`ID "${r.id}" does not start with its area ${r.area}`)
    }
    if (firstLine.has(r.id)) problem(`ID already used on line ${firstLine.get(r.id)}`)
    else firstLine.set(r.id, r.line)
    for (const [field, allowed] of [['role', ROLES], ['risk', RISKS], ['level', LEVELS], ['status', STATUSES]]) {
      if (!allowed.includes(r[field])) problem(`${field} "${r[field]}" is not one of ${allowed.join(', ')}`)
    }
    if (!CLAIMS_A_TEST.includes(r.status)) {
      if (r.coveredBy.length) problem(`names a test in "covered by" but is marked ${r.status}`)
      continue
    }
    if (!r.coveredBy.length) problem(`marked ${r.status} but names no test`)
    for (const file of r.coveredBy) {
      const ids = testIdsByFile[file]
      if (!ids) problem(`covered by ${file}, which does not exist`)
      else if (!ids.has(r.id)) problem(`covered by ${file}, which has no test named with ${r.id}`)
    }
  }
  return problems
}

/** How many rows are in each status, over all rows and per role and per risk. */
export function countCoverage(rows) {
  const tally = () => ({ ...Object.fromEntries(STATUSES.map(s => [s, 0])), total: 0 })
  const all = tally()
  const byRole = Object.fromEntries(ROLES.map(r => [r, tally()]))
  const byRisk = Object.fromEntries(RISKS.map(r => [r, tally()]))
  for (const r of rows) {
    for (const t of [all, byRole[r.role], byRisk[r.risk]]) {
      if (!t) continue // an unknown role or risk is reported by findProblems
      if (!(r.status in t)) continue // an unknown status is reported by findProblems
      t[r.status]++
      t.total++
    }
  }
  return { all, byRole, byRisk }
}

export function formatCoverage({ all, byRole, byRisk }) {
  const line = (label, t) => {
    const pct = t.total ? ` (${Math.round((t.covered / t.total) * 100)}%)` : ''
    const extra = [
      t.failing ? `${t.failing} failing` : '',
      t['wont-test'] ? `${t['wont-test']} won't test` : '',
    ].filter(Boolean)
    return `${label.padEnd(14)}${`${t.covered} of ${t.total} covered${pct}`.padEnd(28)}${t.uncovered} uncovered${extra.length ? `, ${extra.join(', ')}` : ''}`
  }
  return [
    line('All', all),
    '',
    'By role',
    ...Object.entries(byRole).map(([role, t]) => line(`  ${role}`, t)),
    '',
    'By risk',
    ...Object.entries(byRisk).map(([risk, t]) => line(`  ${risk}`, t)),
  ].join('\n')
}

/** Splits `| a | b |` into its trimmed cells. */
function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

/**
 * The rows of every Inventory table in the markdown. A table is one whose
 * header row is exactly `COLUMNS`; other tables in the file are left alone.
 */
export function readInventory(markdown) {
  const rows = []
  let inTable = false
  markdown.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1
    if (!text.trim().startsWith('|')) {
      inTable = false
      return
    }
    const row = cells(text)
    if (!inTable) {
      inTable = row.join('|') === COLUMNS.join('|')
      // A table that starts like the Inventory but whose header is off would
      // otherwise drop its whole section from the counts unseen.
      if (!inTable && row[0] === COLUMNS[0]) {
        throw new Error(`line ${line}: an Inventory table header must read | ${COLUMNS.join(' | ')} |`)
      }
      return
    }
    if (row.every(c => /^:?-+:?$/.test(c))) return
    if (row.length !== COLUMNS.length) {
      throw new Error(`line ${line}: ${row.length} cells, expected ${COLUMNS.length} (a stray "|"?)`)
    }
    const [id, area, role, scenario, risk, level, coveredBy, status] = row
    rows.push({
      id, area, role, scenario, risk, level,
      coveredBy: coveredBy.split(',').map(p => p.trim().replace(/^`|`$/g, '')).filter(Boolean),
      status, line,
    })
  })
  return rows
}

/** Every test file under `TEST_ROOTS`, as a repo path with forward slashes. */
function listTestFiles(root) {
  const files = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name))
      } else if (TEST_FILE.test(entry.name)) {
        files.push(relative(root, join(dir, entry.name)).split('\\').join('/'))
      }
    }
  }
  for (const dir of TEST_ROOTS) walk(join(root, dir))
  return files.sort()
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const inventory = process.argv[2] ?? INVENTORY
  let rows
  try {
    rows = readInventory(readFileSync(resolve(root, inventory), 'utf8'))
  } catch (err) {
    console.error(`${inventory}: ${err.message}`)
    process.exit(1)
  }
  const testIdsByFile = Object.fromEntries(
    listTestFiles(root).map(file => [file, readTestIds(readFileSync(join(root, file), 'utf8'))]),
  )

  console.log(`Scenario Inventory: ${inventory} (${rows.length} rows)\n`)
  console.log(formatCoverage(countCoverage(rows)))

  // Not failures: a test naming an ID the Inventory lacks is likely a typo, and
  // a test carrying an ID its row does not credit yet is coverage to record.
  const known = new Map(rows.map(r => [r.id, r]))
  const notes = []
  for (const [file, ids] of Object.entries(testIdsByFile)) {
    for (const id of ids) {
      const r = known.get(id)
      if (!r) notes.push(`${file}: a test is named with ${id}, which is not in the Inventory`)
      else if (!r.coveredBy.includes(file)) notes.push(`${id}: ${file} has a test named with it; add it to "covered by"`)
    }
  }
  if (notes.length) console.log(`\nNotes\n${notes.map(n => `  ${n}`).join('\n')}`)

  const problems = findProblems(rows, testIdsByFile)
  if (problems.length) {
    console.error(`\nProblems\n${problems.map(p => `  ${inventory}:${p.line} ${p.id}: ${p.message}`).join('\n')}`)
    console.error(`\n${problems.length} problem(s). A row marked covered must name a test file whose test name carries its ID.`)
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
