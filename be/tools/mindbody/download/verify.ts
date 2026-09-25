import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { readWaitlists } from '../transform/readers'
import { isoClock, isoDay } from '../transform/values'
import { readXlsxTable } from '../transform/xlsx'
import { reportPrefix, reportsDir, type PlannedReport } from './plan'

/**
 * Check a finished download: every report present, nothing capped or errored,
 * and no two views of a report identical (a view that silently fell back to
 * another). Returns the number of reports that need a look.
 */

const BAD = /too many results|only the first [\d,]+ .{0,40}have been listed|not all results have been listed|so sorry|something's not working/i

export async function verifyExport(exportDir: string, reports: PlannedReport[]): Promise<number> {
  const root = reportsDir(exportDir)
  let total = 0
  let problems = 0
  for (const r of reports) {
    const prefix = reportPrefix(r)
    const dir = path.join(root, r.cat, prefix)
    const mine = existsSync(dir) ? readdirSync(dir) : []
    total += mine.length
    const empty = mine.filter(f => f.endsWith('.EMPTY.txt')).length
    const failed = mine.filter(f => /\.FAILED\./.test(f))
    const bad = mine.filter(f => /\.(xls|html?)$/.test(f) && BAD.test(readFileSync(path.join(dir, f), 'utf8')))
    // Identical content across different views (date pieces aside: whole-view files only).
    const byHash: Record<string, string[]> = {}
    for (const f of mine.filter(f => !/ - \d{4}(-|\.| wk)/.test(f) && !f.endsWith('.txt'))) {
      const bytes = readFileSync(path.join(dir, f))
      const text = /\.xlsx$/.test(f)
        ? bytes
        : bytes.toString('latin1').replace(/<[^>]+>/g, '').replace(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d+:\d+(:\d+)?\s*(am|pm)?/gi, '').replace(/\s+/g, '')
      const h = createHash('md5').update(text).digest('hex')
      ;(byHash[h] ??= []).push(f)
    }
    const dupes = Object.values(byHash).filter(g => g.length > 1)
    const flag = !mine.length || failed.length > 0 || bad.length > 0 || dupes.length > 0
    if (flag) problems++
    // A scraped waitlist file says how many are waiting, and on how many classes.
    const waiting = r.perClass ? await countWaiting(mine.filter(f => f.endsWith('.xlsx')).map(f => path.join(dir, f))) : null
    console.log(
      `${flag ? '!!' : 'ok'} ${prefix.padEnd(31)} files ${String(mine.length).padStart(4)}  empty ${empty}` +
        (waiting ? `  waiting ${waiting.rows} on ${waiting.classes} class(es)` : '') +
        (failed.length ? `  FAILED ${failed.length}` : '') +
        (bad.length ? `  CAPPED/ERROR ${bad.length}: ${bad.slice(0, 2).join(', ')}` : '') +
        (dupes.length ? `  IDENTICAL: ${dupes.map(g => g.map(f => f.replace(`${prefix} - `, '')).join(' = ')).join(' ; ')}` : ''),
    )
  }
  const cats = new Set(reports.map(r => r.cat))
  const stray = existsSync(root) ? readdirSync(root).filter(f => !cats.has(f as PlannedReport['cat'])) : []
  if (stray.length) console.log(`\nNot in a report folder: ${stray.join(', ')}`)
  console.log(`\n${total} files, ${problems} reports need a look (identical empty views are expected).`)
  return problems
}

/** Waiting clients in the Class Waitlists workbooks, and the classes they wait on. */
async function countWaiting(files: string[]): Promise<{ rows: number; classes: number }> {
  const rows = []
  for (const f of files) rows.push(...readWaitlists(await readXlsxTable(readFileSync(f))))
  return { rows: rows.length, classes: new Set(rows.map(w => `${isoDay(w.date)} ${isoClock(w.start)} ${w.description}`)).size }
}
