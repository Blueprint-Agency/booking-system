import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { readHtmlTable, type TableRow } from '../transform/html-table'
import { readXlsxTable } from '../transform/xlsx'

/**
 * Print the shape of downloaded report files — row count, row widths, sample
 * rows — read exactly the way the transform reads them. For working out what a
 * report holds before writing a reader for it.
 *
 * The rows are real people's data: print them to a terminal, never into a file in the repo.
 */
export async function inspectFiles(targets: string[], opts: { rows: number; all: boolean }): Promise<void> {
  for (const target of targets) {
    const files = statSync(target).isDirectory() ? readdirSync(target).map(f => path.join(target, f)) : [target]
    for (const file of files) {
      const ext = path.extname(file).toLowerCase()
      if (ext !== '.xls' && ext !== '.xlsx') continue
      try {
        const rows: TableRow[] = ext === '.xlsx' ? await readXlsxTable(readFileSync(file)) : readHtmlTable(readFileSync(file, 'utf8'))
        const widths: Record<number, number> = {}
        for (const r of rows) widths[r.cells.length] = (widths[r.cells.length] ?? 0) + 1
        console.log(`\n=== ${path.basename(file)}  (${(statSync(file).size / 1024).toFixed(0)} KB, ${rows.length} rows; row widths ${JSON.stringify(widths)})`)
        const n = opts.rows
        const shown = opts.all ? rows : rows.length > n + 6 ? [...rows.slice(0, n + 3), null, ...rows.slice(-3)] : rows
        for (const r of shown) console.log(r ? `  | ${r.cells.join(' | ')}` : '  ...')
      } catch (e) {
        console.log(`!! ${file}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}
