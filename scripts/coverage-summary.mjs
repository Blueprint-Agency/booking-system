#!/usr/bin/env node
/**
 * Summarises the backend's lcov coverage per service folder, as markdown.
 *
 * The backend CI job runs its suite with Node's built-in coverage and the lcov
 * reporter; this turns that file into one row per `src/services/<feature>/`
 * (and one per other top-level `src/` folder) for the job summary. A report,
 * never a gate: there is no threshold, so there is nothing to write hollow
 * tests towards.
 *
 *   node scripts/coverage-summary.mjs be/lcov.info >> "$GITHUB_STEP_SUMMARY"
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function parseLcov(text) {
  const files = []
  let current = null
  const count = () => ({ hit: 0, found: 0 })
  for (const line of text.split(/\r?\n/)) {
    const [key, value] = [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)]
    if (key === 'SF') {
      current = { file: value.replace(/\\/g, '/'), lines: count(), functions: count(), branches: count() }
    } else if (line === 'end_of_record' && current) {
      files.push(current)
      current = null
    } else if (current) {
      const field = { LF: ['lines', 'found'], LH: ['lines', 'hit'], FNF: ['functions', 'found'], FNH: ['functions', 'hit'], BRF: ['branches', 'found'], BRH: ['branches', 'hit'] }[key]
      if (field) current[field[0]][field[1]] = Number(value)
    }
  }
  return files
}

export function areaOf(file) {
  const service = file.match(/(?:^|\/)src\/services\/([^/]+)\//)
  if (service) return `services/${service[1]}`
  const top = file.match(/(?:^|\/)src\/([^/]+)\//)
  return top ? top[1] : 'src'
}

const METRICS = ['lines', 'branches', 'functions']

function add(into, from) {
  for (const m of METRICS) {
    into[m].hit += from[m].hit
    into[m].found += from[m].found
  }
}

function empty(area) {
  return { area, lines: { hit: 0, found: 0 }, branches: { hit: 0, found: 0 }, functions: { hit: 0, found: 0 } }
}

/** One row per folder — services first, then the rest, each alphabetical — and a total. */
export function summarise(files) {
  const byArea = new Map()
  const total = empty('total')
  for (const f of files) {
    const area = areaOf(f.file)
    if (!byArea.has(area)) byArea.set(area, empty(area))
    add(byArea.get(area), f)
    add(total, f)
  }
  const rows = [...byArea.values()].sort((a, b) => {
    const rank = (r) => (r.area.startsWith('services/') ? 0 : 1)
    return rank(a) - rank(b) || a.area.localeCompare(b.area)
  })
  return [...rows, total]
}

function cell({ hit, found }) {
  return found === 0 ? '—' : `${((hit / found) * 100).toFixed(1)}% (${hit}/${found})`
}

export function formatSummary(rows) {
  const out = [
    '### Backend coverage by folder',
    '',
    'Reported, not gated. From Node’s built-in test coverage; files no test loads are not listed.',
    '',
    '| Folder | Lines | Branches | Functions |',
    '|---|---:|---:|---:|',
  ]
  for (const row of rows) {
    const cells = [row.area, ...METRICS.map((m) => cell(row[m]))]
    const bold = row.area === 'total' ? cells.map((c) => (c === '—' ? c : `**${c}**`)) : cells
    out.push(`| ${bold.join(' | ')} |`)
  }
  return out.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: node scripts/coverage-summary.mjs <lcov.info>')
    process.exit(2)
  }
  console.log(formatSummary(summarise(parseLcov(readFileSync(path, 'utf8')))))
}
