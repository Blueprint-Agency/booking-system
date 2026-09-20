/**
 * Rebuilds the one fixture that is not text: the Visits Remaining workbook.
 *
 *   npx tsx src/mindbody/fixtures/build-workbook.ts
 *
 * Its rows live in `visits-remaining.rows.json`, where they can be read and
 * reviewed; this writes them the way Mindbody writes a workbook — one sheet,
 * shared strings, numbers as numbers, dates as text, and no cell at all where a
 * value is empty. `readers.test.ts` holds the two to each other.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const rows = JSON.parse(readFileSync(path.join(__dirname, 'visits-remaining.rows.json'), 'utf8')) as (string | number)[][]
const OUT = path.join(__dirname, 'reports', 'Clients', '15 Visits Remaining', '15 Visits Remaining - Detail.xlsx')

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const column = (i: number) => (i < 26 ? '' : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26))

const shared: string[] = []
const sheetRows = rows.map((row, r) => {
  const cells = row.flatMap((value, c) => {
    const ref = `${column(c)}${r + 1}`
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
  'xl/workbook.xml': `<?xml version="1.0" encoding="utf-8"?><workbook xmlns:r="${REL}" xmlns="${NS}"><sheets><sheet name="Visits Remaining" sheetId="1" r:id="rId1" /></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml" /><Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml" /></Relationships>`,
  'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="utf-8"?><worksheet xmlns:r="${REL}" xmlns="${NS}"><sheetData>${sheetRows.join('')}</sheetData></worksheet>`,
  'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><sst xmlns="${NS}" count="${shared.length}" uniqueCount="${shared.length}">${shared.map(s => `<si><t xml:space="preserve">${escape(s)}</t></si>`).join('')}</sst>`,
}

async function main() {
  const zip = new JSZip()
  // A fixed date, so rebuilding from unchanged rows changes no bytes.
  for (const [name, content] of Object.entries(files)) zip.file(name, content, { date: new Date('2026-01-01T00:00:00Z') })
  writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  console.log(`Wrote ${OUT}`)
}

void main()
