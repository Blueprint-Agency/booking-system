/**
 * Rebuilds the fixtures that are not text: the workbooks.
 *
 *   npx tsx tools/mindbody/transform/fixtures/build-workbook.ts
 *
 * Their rows live in the `*.rows.json` files beside this one, where they can be
 * read and reviewed; this writes them the way Mindbody writes a workbook — one
 * sheet, shared strings, numbers as numbers, and no cell at all where a value
 * is empty. Visits Remaining keeps its dates as text, as Mindbody does. The
 * roster's and the attendance report's are real workbook values, so a
 * `YYYY-MM-DD` there is written as a day count and an `HH:MM` as a fraction of a
 * day. `readers.test.ts` holds the workbooks and the rows to each other.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

type Cell = string | number

const WORKBOOKS = [
  { rows: 'visits-remaining.rows.json', sheet: 'Visits Remaining', out: ['Clients', '15 Visits Remaining', '15 Visits Remaining - Detail.xlsx'], typed: false },
  { rows: 'roster.rows.json', sheet: 'Schedule at a Glance', out: ['Clients', '17 Schedule at a Glance', '17 Schedule at a Glance - 2090.xlsx'], typed: true },
  { rows: 'pay-rates.rows.json', sheet: 'Pay Rates', out: ['Staff', '38 Pay Rates', '38 Pay Rates.xlsx'], typed: false },
  { rows: 'attendance.rows.json', sheet: 'Attendance', out: ['Clients', '16 Attendance', '16 Attendance - Date - 2026.xlsx'], typed: true },
]

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const column = (i: number) => (i < 26 ? '' : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26))

/** A date as Excel counts it — days since 30 December 1899 — and a time as the fraction of a day gone. */
function typed(value: Cell): Cell {
  if (typeof value !== 'string') return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return (Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000
  const time = /^(\d{2}):(\d{2})$/.exec(value)
  return time ? (Number(time[1]) * 60 + Number(time[2])) / 1440 : value
}

async function build(book: (typeof WORKBOOKS)[number]) {
  const rows = JSON.parse(readFileSync(path.join(__dirname, book.rows), 'utf8')) as Cell[][]
  const shared: string[] = []
  const sheetRows = rows.map((row, r) => {
    const cells = row.flatMap((raw, c) => {
      const ref = `${column(c)}${r + 1}`
      // The header row is text whatever it looks like.
      const value = book.typed && r > 0 ? typed(raw) : raw
      if (value === '') return []
      if (typeof value === 'number') return [`<c r="${ref}"><v>${value}</v></c>`]
      shared.push(value)
      return [`<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`]
    })
    return `<row r="${r + 1}">${cells.join('')}</row>`
  })

  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml" /></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml" /></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="utf-8"?><workbook xmlns:r="${REL}" xmlns="${NS}"><sheets><sheet name="${book.sheet}" sheetId="1" r:id="rId1" /></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml" /><Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml" /></Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="utf-8"?><worksheet xmlns:r="${REL}" xmlns="${NS}"><sheetData>${sheetRows.join('')}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><sst xmlns="${NS}" count="${shared.length}" uniqueCount="${shared.length}">${shared.map(s => `<si><t xml:space="preserve">${escape(s)}</t></si>`).join('')}</sst>`,
  }

  const zip = new JSZip()
  // A fixed date, so rebuilding from unchanged rows changes no bytes. A zip
  // keeps it as a DOS date, which JSZip reads off the *local* clock — so the
  // date is built local, or the same rows give different bytes in each timezone.
  for (const [name, content] of Object.entries(files)) zip.file(name, content, { date: new Date(2026, 0, 1) })
  const out = path.join(__dirname, 'reports', ...book.out)
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  console.log(`Wrote ${out}`)
}

async function main() {
  for (const book of WORKBOOKS) await build(book)
}

void main()
