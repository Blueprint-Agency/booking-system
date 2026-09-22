import JSZip from 'jszip'
import { decodeEntities, type TableRow } from './html-table'

/**
 * The rows of a Mindbody `.xlsx` export's first sheet, in the same shape the
 * HTML reports are read into, so a reader does not care which it was given.
 *
 * The newer Mindbody reports download as real workbooks. They are plain ones —
 * one sheet, shared strings, numbers as numbers, dates as text — so this reads
 * just that much of the format rather than bringing in a spreadsheet library:
 *
 *  - A cell is placed by its reference (`C7`), not by its position in the row,
 *    because an empty cell is simply absent from the XML.
 *  - A string is its shared-string entry, runs of rich text joined; an inline
 *    string is read where it stands. Anything else is its `<v>` as written.
 *  - Text is tidied exactly as the HTML reader tidies it.
 */

/** A workbook writes a control character as `_x0008_`; none of them is ever data. */
function text(raw: string): string {
  return decodeEntities(raw)
    .replace(/_x00[01][0-9a-f]_/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every `<t>` inside one string item, joined: a rich-text string is several runs. */
function runs(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]!).join('')
}

/** `A` → 0, `Z` → 25, `AA` → 26. */
function columnIndex(ref: string): number {
  let n = 0
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export async function readXlsxTable(bytes: Buffer | Uint8Array): Promise<TableRow[]> {
  const zip = await JSZip.loadAsync(bytes)
  const sheet = await zip.file('xl/worksheets/sheet1.xml')?.async('string')
  if (!sheet) throw new Error('not a workbook: it has no first sheet')
  const sharedXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? ''
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => text(runs(m[1]!)))

  const rows: TableRow[] = []
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const c of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1]!)?.[1]
      if (!ref) continue
      const type = /\bt="(\w+)"/.exec(c[1]!)?.[1]
      const body = c[2] ?? ''
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
      cells[columnIndex(ref)] = type === 's' ? (shared[Number(value)] ?? '') : type === 'inlineStr' ? text(runs(body)) : text(value)
    }
    const filled = Array.from(cells, cell => cell ?? '')
    rows.push({ cells: filled, links: filled.map(() => null) })
  }
  return rows
}
