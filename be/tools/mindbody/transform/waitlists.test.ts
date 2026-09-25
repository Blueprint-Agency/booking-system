import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { packArchive } from '../../../src/services/tenants/transfer-archive'
import { WAITLIST_FLAG as APP_FLAG } from '../../../src/services/waitlist/line'
import { writeXlsx } from '../download/xlsx-write'
import { ConfigError, starterConfig, validateConfig } from './config'
import { constraintViolations } from './constraints'
import { figuresOf } from './figures'
import { mapStudio, renderPreflight, WAITLIST_FLAG, type MindbodyReports } from './mapper'
import { readWaitlists, type WaitlistRow } from './readers'
import { readReports, verifyImport } from './transform'
import { readXlsxTable } from './xlsx'

/**
 * The live waitlists and their capacity (#311, spec-waitlist.md §12a): decision
 * 21 in the config, the scraped Class Waitlists file in, `waiting` entries,
 * `capacity_waitlist` and the `waitlist_enabled` flag out. The import and the
 * first promotion after it are `waitlist-import.test.ts`.
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const fixtureConfig = () => JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as Record<string, any>
const TENANT = '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a'
const reports = () => readReports(path.join(FIXTURES, 'reports'))

/** A waiting client, on the fixture's Hatha at 7pm on 2 January 2090 unless said otherwise. */
const waiting = (clientId: string, position: number, over: Partial<WaitlistRow> = {}): WaitlistRow => ({
  date: { year: 2090, month: 1, day: 2 },
  start: { hour: 19, minute: 0 },
  description: 'Hatha',
  staff: 'IVY INSTRUCTOR',
  clientId,
  client: '',
  position,
  paymentStatus: 'Unpaid',
  ...over,
})

const HATHA = '2090-01-02T11:00:00.000Z'

const mapped = async (waitlists: WaitlistRow[] | null, config = fixtureConfig()) => {
  const r: MindbodyReports = { ...(await reports()), waitlists }
  return mapStudio(r, validateConfig(config), TENANT)
}

test('the scraped workbook reads back one row per waiting client; a guest keeps an empty id, a row with no place is none', async () => {
  const bytes = await writeXlsx([
    ['Class date', 'Start', 'Description', 'Staff', 'Client ID', 'Client', 'Position', 'Payment status'],
    ['2090-01-02', '19:00', 'Hatha', 'IVY INSTRUCTOR', '100000003', 'Poe, Pat', '1', 'Unpaid'],
    ['2090-01-02', '19:00', 'Hatha', 'IVY INSTRUCTOR', '100000004', 'Lee, Sam', '2', 'Class Pack'],
    ['2090-01-02', '19:00', 'Hatha', 'IVY INSTRUCTOR', '', 'A guest', '3', ''],
    ['2090-01-02', '19:00', 'Hatha', 'IVY INSTRUCTOR', '100000005', 'Lee, Kim', '', ''],
  ])
  const rows = readWaitlists(await readXlsxTable(bytes))
  assert.deepEqual(rows, [
    { ...waiting('100000003', 1), client: 'Poe, Pat' },
    { ...waiting('100000004', 2), client: 'Lee, Sam', paymentStatus: 'Class Pack' },
    { ...waiting('', 3), client: 'A guest', paymentStatus: '' },
  ])
  assert.throws(() => readWaitlists(readHtmlLess([['Name', 'Rate']])), /Class Waitlists: no header row/)
})

const readHtmlLess = (cells: string[][]) => cells.map(c => ({ cells: c, links: c.map(() => null) }))

test('decision 21 is never open, and a figure for a Class Type that does not exist is refused', async () => {
  // Every class has a waitlist; with no figure named, it starts at 0 for staff to set.
  const starter = starterConfig(await reports())
  assert.deepEqual(starter.waitlist, { enabled: true, capacity: 0, classTypes: {} })
  assert.throws(
    () => validateConfig(starter),
    (err: unknown) => err instanceof ConfigError && !err.problems.some(p => p.startsWith('waitlist')),
    'the starter is refused for its other open fields, never for the waitlist',
  )
  const unset = fixtureConfig()
  delete unset.waitlist
  assert.deepEqual(validateConfig(unset).waitlist, { enabled: true, capacity: 0, classTypes: {} })

  const typo = fixtureConfig()
  typo.waitlist.classTypes = { Yin: 4 }
  assert.throws(() => validateConfig(typo), /waitlist\.classTypes: "Yin" is no Class Type/)
})

test('future classes and series take the configured waitlist, a Class Type its own; PT and workshop days stay 0', async () => {
  const { archive } = await mapped([])
  const typeName = new Map(archive.rows.class_types!.map(t => [t.id, t.name]))
  const sizes = archive.rows.classes!.map(c => `${typeName.get(c.class_type_id)} ${c.capacity_waitlist}`)
  assert.deepEqual([...new Set(sizes)].sort(), ['Hatha 5', 'Vinyasa Flow 3'])
  assert.deepEqual(archive.rows.class_series!.map(s => s.capacity_waitlist), [5])
  assert.ok(archive.rows.pt_sessions!.length > 0 && archive.rows.pt_sessions!.every(s => s.capacity_waitlist === 0))
  assert.ok(archive.rows.workshop_days!.length > 0 && archive.rows.workshop_days!.every(d => d.capacity_waitlist === 0))
})

test('history keeps its classes at a waitlist of 0: nobody can join a class already held', async () => {
  const config = fixtureConfig()
  config.history = { from: '2026-06-01', purchases: false }
  const { archive } = await mapped([], config)
  const past = archive.rows.classes!.filter(c => String(c.starts_at) < '2026-09-17')
  assert.ok(past.length > 0)
  assert.ok(past.every(c => c.capacity_waitlist === 0))
})

test('the studio switch comes across as its feature flag, on or off', async () => {
  assert.equal(WAITLIST_FLAG, APP_FLAG, 'the flag the app reads')
  const on = await mapped([])
  assert.deepEqual(on.archive.rows.feature_flags, [
    { tenant_id: TENANT, key: 'waitlist_enabled', enabled: true, updated_at: '2026-09-16T18:00:00.000Z', updated_by_staff_id: null },
  ])
  const config = fixtureConfig()
  config.waitlist.enabled = false
  const off = await mapped([], config)
  assert.equal(off.archive.rows.feature_flags![0]!.enabled, false)
  // Off, the classes keep their size: the portal still shows it, and it is ready for when the switch goes on.
  assert.ok(off.archive.rows.classes!.every(c => Number(c.capacity_waitlist) > 0))
})

test('each waiting client is a waiting entry on the right class, in Mindbody\'s order, joined just before the download', async () => {
  // Read out of order: the queue is the positions, not the file's order.
  const { archive, ids, preflight } = await mapped([
    waiting('100000005', 3),
    waiting('100000003', 1),
    // The roster and the schedule disagree about who teaches: the lone Hatha at that minute is still the class.
    waiting('100000004', 2, { staff: 'OLIVE OWNER', description: 'HATHA ' }),
  ])
  const hatha = archive.rows.classes!.find(c => c.starts_at === HATHA)!
  const entries = archive.rows.waitlist_entries!
  assert.equal(entries.length, 3)
  const byJoin = [...entries].sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)))
  assert.deepEqual(
    byJoin.map(e => e.client_id),
    ['100000003', '100000004', '100000005'].map(id => ids.clients![id]),
  )
  for (const e of entries) {
    assert.equal(e.class_id, hatha.id)
    assert.deepEqual([e.status, e.resolved_at, e.booking_id, e.resolved_by, e.tenant_id], ['waiting', null, null, null, TENANT])
    assert.ok(String(e.joined_at) < '2026-09-16T18:00:00.000Z', 'every place predates the freeze')
  }
  assert.deepEqual(byJoin.map(e => e.joined_at), ['2026-09-16T17:59:57.000Z', '2026-09-16T17:59:58.000Z', '2026-09-16T17:59:59.000Z'])
  assert.equal(Object.keys(ids.waitlist_entries!).length, 3)
  assert.deepEqual(constraintViolations(archive), [])
  // Two seats are taken of fifteen: a queue with room is named, for staff to add from.
  // Named as the timetable spells the class.
  assert.ok(preflight.schedule.some(n => /HATHA on 2090-01-02 at 19:00: 3 waiting with 13 seat\(s\) free/.test(n)), preflight.schedule.join('\n'))
})

test('a waiting client who cannot be placed is a named preflight line and no entry', async () => {
  const { archive, preflight } = await mapped([
    waiting('100000001', 1), // Jane already holds a seat on it
    waiting('999999999', 2, { client: 'Stranger, A' }), // not in the member list
    waiting('100000003', 1, { date: { year: 2090, month: 1, day: 5 }, start: { hour: 8, minute: 0 }, description: 'Mystery Class' }),
    waiting('100000004', 1, { date: { year: 2090, month: 1, day: 7 }, start: { hour: 9, minute: 0 }, description: 'Handstand Workshop - Day 1' }),
    waiting('100000005', 1, { date: { year: 2026, month: 9, day: 1 }, start: { hour: 19, minute: 0 } }),
    waiting('100000006', 3),
    waiting('100000006', 4),
    waiting('', 5, { client: 'A guest' }), // no profile on the screen
  ])
  assert.equal(archive.rows.waitlist_entries!.length, 1, 'only Ada, once')
  const text = renderPreflight(preflight)
  for (const line of [
    // A class that came across is named as the timetable spells it; one that did not, as the waitlist does.
    '100000001 Jane Doe: waiting on HATHA on 2090-01-02 at 19:00 and already Reserved on it',
    '999999999 Stranger, A: waiting on Hatha on 2090-01-02 at 19:00 and is not in the member list',
    '100000003 Pat Poe: waiting on Mystery Class on 2090-01-05 at 08:00, which did not come across as a class',
    'waitlists: 1 waiting on Handstand Workshop - Day 1 on 2090-01-07 at 09:00, a workshop day — workshop waitlists are not migrated',
    '100000005 Kim Lee: waiting on Hatha on 2026-09-01 at 19:00, which had started by the download',
    '100000006 Ada Reuse: on the waitlist of HATHA on 2090-01-02 at 19:00 twice — one place was imported',
    'waitlists: past waitlist promotions are not re-created as promoted entries',
    'A guest: waiting on Hatha on 2090-01-02 at 19:00 with no Mindbody client id',
  ]) {
    assert.ok(text.includes(line), `${line}\n---\n${text}`)
  }
})

test('a download with no Class Waitlists file brings no queue, and says so', async () => {
  const { archive, preflight } = await mapped(null)
  assert.deepEqual(archive.rows.waitlist_entries, [])
  assert.ok(preflight.schedule.some(n => n.startsWith('waitlists: this download has no Class Waitlists file')))
})

test('a line longer than its class\'s waitlist comes across whole, and is named', async () => {
  const config = fixtureConfig()
  config.waitlist.capacity = 1
  const { archive, preflight } = await mapped([waiting('100000003', 1), waiting('100000004', 2)], config)
  assert.equal(archive.rows.waitlist_entries!.length, 2)
  assert.ok(preflight.schedule.some(n => n.includes('2 waiting, more than its waitlist of 1')))
})

test('verify counts the waiting in total and per member, so a lost place is named', async () => {
  const { archive } = await mapped([waiting('100000003', 1), waiting('100000004', 2)])
  const expected = figuresOf(archive)
  assert.equal(expected.waitlisted, 2)
  assert.deepEqual(await verifyImport(expected, await packArchive(archive)), [])

  archive.rows.waitlist_entries = archive.rows.waitlist_entries!.slice(0, 1)
  archive.manifest.counts.waitlist_entries = 1
  const differences = await verifyImport(expected, await packArchive(archive))
  assert.ok(differences.includes('members waiting on a waitlist, in total: expected 2, found 1'), differences.join(' | '))
  assert.ok(differences.some(d => /Sam Lee .*: waitlist places: expected 1, found 0/.test(d)), differences.join(' | '))
})

test('a studio with no queue has no waitlist figure, and verify compares it as 0', async () => {
  const { archive } = await mapped([])
  const expected = figuresOf(archive)
  assert.equal(expected.waitlisted, undefined)
  assert.deepEqual(await verifyImport(expected, await packArchive(archive)), [])
})

test('the database\'s rule on a promoted entry is checked before a zip is written', async () => {
  const { archive } = await mapped([waiting('100000003', 1)])
  archive.rows.waitlist_entries![0]!.status = 'promoted'
  assert.deepEqual(constraintViolations(archive), [
    `waitlist_entries.waitlist_entries_promoted_booking: 1 row(s) (first id ${archive.rows.waitlist_entries![0]!.id})`,
  ])
})
