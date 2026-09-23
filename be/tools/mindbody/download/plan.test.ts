import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { REPORTS as TRANSFORM_READS } from '../transform/transform'
import { writeXlsx } from './xlsx-write'
import { readXlsxTable } from '../transform/xlsx'
import {
  describePlan,
  exportDir,
  exportStamp,
  manifestPattern,
  plannedFiles,
  profileReports,
  readManifest,
  runDates,
  type ManifestEntry,
} from './plan'

const manifest = readManifest()

test('the cutover download writes exactly the files report-files.json lists, each under its own kind', () => {
  const planned = plannedFiles(profileReports('cutover', manifest))
  const read = planned.filter(f => f.report.kind)
  // Worked out from the report's number, name, views and page type — not copied from the manifest.
  assert.deepEqual(
    read.map(f => f.file).sort(),
    manifest.map(m => m.file).sort(),
  )
  for (const f of read) {
    const m = manifest.find(x => x.kind === f.report.kind)!
    assert.equal(f.file, m.file, `${m.kind} is written under the name the manifest gives it`)
    assert.equal(f.report.single, m.single, `${m.kind}: the single rule is the manifest's`)
    assert.equal(/<year>|<group>|<piece>/.test(f.file), !m.single, `${m.kind}: a single report is one file`)
  }
  // The extras are downloaded for a person, and the transform reads none of them.
  for (const f of planned.filter(x => !x.report.kind)) {
    assert.ok(f.report.optional, `${f.file} is optional`)
    const sample = f.file.replace(/<[a-z]+>/g, '2026')
    assert.deepEqual(Object.entries(TRANSFORM_READS).filter(([, r]) => r.test(sample)).map(([k]) => k), [], sample)
  }
})

test('a manifest line nothing downloads, or a profile kind the manifest does not list, stops the plan', () => {
  const extra: ManifestEntry = { kind: 'newReport', file: '99 New Report.xls', single: true, required: true }
  assert.throws(() => profileReports('cutover', [...manifest, extra]), /not downloaded: newReport/)
  assert.throws(() => profileReports('cutover', manifest.filter(m => m.kind !== 'members')), /not in the manifest: members/)
})

test('a written file is checked against its manifest name, whichever extension Mindbody sent', () => {
  const year = manifestPattern('17 Schedule at a Glance - <year>.xlsx')
  assert.ok(year.test('17 Schedule at a Glance - 2026.xlsx'))
  assert.ok(year.test('17 Schedule at a Glance - 2026.xls'))
  assert.ok(!year.test('17 Schedule at a Glance - 2026-Q1.xlsx'), 'a year refused and split smaller is not the file the transform expects')
  assert.ok(manifestPattern('21 Referral Types - <group>.xls').test('21 Referral Types - Other.xls'))
  assert.ok(manifestPattern('08 Cancellations - Individual records - <piece>.xls').test('08 Cancellations - Individual records - 2024-03.xls'))
  assert.ok(!manifestPattern('35 Phone Book.xls').test('35 Phone Book - Old.xls'))
})

test('every download goes into a fresh folder named for when it started', () => {
  const started = new Date(2026, 8, 17, 2, 5)
  assert.equal(exportStamp(started), '2026-09-17 0205')
  assert.equal(exportDir(path.join('x', 'exports'), started), path.join('x', 'exports', '2026-09-17 0205'))
})

test('the dry run lists every cutover file under <export>/reports, with the run date\'s ranges', () => {
  const started = new Date(2026, 8, 17, 2, 5)
  const folder = exportDir('exports', started)
  const lines = describePlan('cutover', folder, profileReports('cutover', manifest), runDates(started, new Date(2023, 0, 1)))
  assert.ok(lines.includes(`Reports: ${path.join(folder, 'reports')}`))
  assert.ok(lines.some(l => l.includes('reports/Clients/02 Mailing Lists/02 Mailing Lists - Mailing List.xls')))
  assert.ok(lines.some(l => l.includes('reports/Staff/34 Staff Schedule/34 Staff Schedule - ALL - Scheduled.xls')))
  assert.ok(lines.some(l => l.endsWith('reports/Clients/23 Promotions/23 Promotions - Detail.xls')), 'Promotions: what each past sale was discounted')
  assert.ok(lines.some(l => l.includes('requiredtxtDateStart=1/1/2023 requiredtxtDateEnd=17/9/2027')), 'Schedule at a Glance runs 12 months ahead')
  // The classes the studio called off: one file over the whole range, beside the Individual records.
  const group = lines.findIndex(l => l.endsWith('reports/Clients/08 Cancellations/08 Cancellations - Group cancellations.xls'))
  assert.ok(group >= 0, 'Group cancellations is downloaded')
  assert.ok(lines[group + 1]!.includes('requiredtxtDateStart=1/1/2023 requiredtxtDateEnd=17/9/2026'), 'from the history cutoff to today')
  assert.ok(lines[group + 1]!.includes('transform reads it as groupCancellations, single file'))
  for (const m of manifest) assert.ok(lines.some(l => l.endsWith(`/${m.file}`)), m.file)
})

test('a scraped table is written as a workbook the transform reads back cell for cell', async () => {
  const rows = [['Staff', 'Rate'], ['A & B <c>', '12.50'], [], ['', 'after a gap']]
  const back = await readXlsxTable(await writeXlsx(rows, 'Pay Rates'))
  assert.deepEqual(back.map(r => r.cells), [['Staff', 'Rate'], ['A & B <c>', '12.50'], [], ['', 'after a gap']])
})
