import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { packArchive } from '../../../src/services/tenants/transfer-archive'
import { starterConfig, validateConfig } from './config'
import { constraintViolations } from './constraints'
import { figuresOf } from './figures'
import { mapStudio } from './mapper'
import type { AttendanceRow, PayrollRow, SaleRow, ScheduledClassRow } from './readers'
import { readReports, verifyImport } from './transform'

/**
 * Past workshops and retreats (#225), and the future places dated on their
 * sale: fixture reports, with a past run of the fixture's Handstand Workshop
 * added in memory, through the transform to archive rows and preflight lines.
 * The studio and its people are invented (`fixtures/`).
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const REPORTS = path.join(FIXTURES, 'reports')
const TENANT = '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a'
const JANE = '100000001'
const RICK = '100000002'

const fixtureConfig = () => JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as Record<string, any>
const withHistory = (purchases = true) => {
  const config = fixtureConfig()
  config.history = { from: '2026-06-01', purchases }
  return config
}

const august = (day: number) => ({ year: 2026, month: 8, day })

/** A day of the workshop on the staff schedule, as its reader returns one. */
const workshopDay = (day: number, n: number): ScheduledClassRow => ({
  staff: 'IVY INSTRUCTOR',
  date: august(day),
  start: { hour: 9, minute: 0 },
  end: { hour: 17, minute: 0 },
  description: `Handstand Workshop - Day ${n}`,
  substitute: false,
  location: 'Main Hall',
  serviceCategory: 'Handstand Workshop',
  room: 'Studio 1 - Hot Room',
})

const visit = (clientId: string, day: number, n: number, option: string, status = 'Signed in'): AttendanceRow => ({
  date: august(day),
  start: { hour: 9, minute: 0 },
  end: null,
  description: `Handstand Workshop - Day ${n}`,
  staff: 'Instructor, Ivy',
  room: '',
  location: 'Main Hall',
  clientId,
  status,
  option,
  saleLocation: '',
  fromFlags: true,
})

const sale = (clientId: string, saleId: string, soldAt: { year: number; month: number; day: number }, description: string, total: number): SaleRow => ({
  clientId,
  saleId,
  soldAt: { ...soldAt, hour: 0, minute: 0, second: 0 },
  description,
  location: 'Main Hall',
  quantity: 1,
  total,
})

const payLine = (over: Partial<PayrollRow>): PayrollRow => ({
  staff: 'Instructor, Ivy',
  date: august(15),
  start: { hour: 9, minute: 0 },
  description: '',
  earnings: 0,
  table: 'class',
  rate: { name: 'Per Class', percent: null },
  basePay: null,
  ...over,
})

/**
 * The fixture, plus a Handstand Workshop that ran on 15 and 16 August: Jane on
 * a single room both days, Rick on a twin the first day, each sold in July, and
 * Ivy and Olive paid for it in Payroll.
 */
async function withPastWorkshop() {
  const reports = await readReports(REPORTS)
  return {
    ...reports,
    schedule: [...reports.schedule, workshopDay(15, 1), workshopDay(16, 2)],
    attendance: [
      ...reports.attendance,
      visit(JANE, 15, 1, 'Handstand Workshop - Single'),
      visit(JANE, 16, 2, 'Handstand Workshop - Single'),
      visit(RICK, 15, 1, 'Handstand Workshop - Twin'),
    ],
    sales: [
      ...reports.sales,
      sale(JANE, '9001', { year: 2026, month: 7, day: 20 }, 'Handstand Workshop - Single', 700),
      sale(RICK, '9002', { year: 2026, month: 7, day: 25 }, 'Handstand Workshop - Twin', 500),
    ],
    payroll: [
      ...reports.payroll,
      payLine({ description: 'Handstand Workshop - Day 1', earnings: 150 }),
      payLine({ date: august(16), description: 'Handstand Workshop - Day 2', earnings: 150 }),
      // A revenue share at no set time, on one of its days.
      payLine({ staff: 'Owner, Olive', date: august(16), start: null, earnings: 60, rate: { name: 'Percentage Rate', percent: 20 } }),
    ],
  }
}

/** The fixture's workshop, with its Twin room covering only the first day. */
const twinDayOne = (config: Record<string, any>) => {
  config.workshops[0].tiers[0].days = [1]
  return config
}

const pastWorkshopOf = (archive: { rows: Record<string, Record<string, unknown>[]> }) =>
  archive.rows.workshops!.find(w => String(w.name).includes('2026-08-15'))!

test('a past workshop comes across with its Days, its Tiers, and a booking per attendee at their tier and price', async () => {
  const reports = await withPastWorkshop()
  const { archive, ids, preflight } = mapStudio(reports, validateConfig(twinDayOne(withHistory())), TENANT)

  // Two Workshops of one category: the one that ran, named by its first day, and the one to come.
  assert.deepEqual(archive.rows.workshops!.map(w => w.name).sort(), ['Handstand Workshop', 'Handstand Workshop (2026-08-15)'])
  const past = pastWorkshopOf(archive)
  assert.equal(past.lifecycle, 'active', 'held, not called off')
  const days = archive.rows.workshop_days!.filter(d => d.workshop_id === past.id)
  assert.deepEqual(
    days.map(d => `${d.ord} ${d.starts_at}–${d.ends_at}`),
    ['1 2026-08-15T01:00:00.000Z–2026-08-15T09:00:00.000Z', '2 2026-08-16T01:00:00.000Z–2026-08-16T09:00:00.000Z'],
  )

  // A tier grants only the days it covers: the Twin room the first, the Single room both.
  const tiers = archive.rows.workshop_tiers!.filter(t => t.workshop_id === past.id)
  const dayOrd = new Map(days.map(d => [d.id, d.ord]))
  const covers = (name: string) =>
    archive.rows.workshop_tier_days!
      .filter(td => td.workshop_tier_id === tiers.find(t => t.name === name)!.id)
      .map(td => dayOrd.get(td.workshop_day_id))
  assert.deepEqual(covers('Twin room'), [1])
  assert.deepEqual(covers('Single room'), [1, 2])

  const tierName = new Map(tiers.map(t => [t.id, t.name]))
  const places = archive.rows.bookings!.filter(b => b.workshop_id === past.id)
  assert.deepEqual(
    places
      .map(b => `${b.client_id === ids.clients![JANE] ? 'Jane' : 'Rick'} ${tierName.get(b.workshop_tier_id)} paid ${b.amount_paid_sgd} of ${b.list_price_sgd} ${b.state}/${b.check_in_state} booked ${b.booked_at}`)
      .sort(),
    [
      // Dated on the sale, so Finance shows the money in the month it was taken.
      'Jane Single room paid 700.00 of 700.00 confirmed/attended booked 2026-07-19T16:00:00.000Z',
      'Rick Twin room paid 500.00 of 500.00 confirmed/attended booked 2026-07-24T16:00:00.000Z',
    ],
  )
  // Attended, so checked in, as a past class visit is.
  for (const place of places) assert.ok(archive.rows.check_ins!.some(c => c.booking_id === place.id))

  // Its sale lines are on the places, not "not placed on any package".
  assert.ok(!preflight.schedule.some(n => /a place on a workshop, which is a booking/.test(n)), preflight.schedule.join(' | '))
  // Its visits are on the places, not lost.
  assert.ok(!preflight.schedule.some(n => /Handstand Workshop - Day/.test(n) && /visit/.test(n)), preflight.schedule.join(' | '))
  assert.deepEqual(constraintViolations(archive), [])
})

test('a past workshop s payroll is its instructors pay, not Manual Entries, and Instructor Pay adds up the same', async () => {
  const reports = await withPastWorkshop()
  const migrated = mapStudio(reports, validateConfig(withHistory()), TENANT)
  const past = pastWorkshopOf(migrated.archive)
  const staffName = new Map(migrated.archive.rows.staff_users!.map(s => [s.id, s.name]))
  assert.deepEqual(
    migrated.archive.rows.workshop_instructors!
      .filter(i => i.workshop_id === past.id)
      .map(i => `${i.role} ${staffName.get(i.instructor_id)} ${i.pay_sgd}`),
    // Ivy led both days; Olive's share makes her a supporting instructor on it.
    ['main Ivy Instructor 300.00', 'supporting Olive Owner 60.00'],
  )
  const entries = migrated.archive.rows.manual_payroll_entries!
  assert.ok(
    !entries.some(e => /^2026-08-1[56]/.test(String(e.entry_date)) || /Handstand/.test(String(e.label))),
    entries.map(e => `${e.entry_date} ${e.label}`).join(' | '),
  )

  // Not migrated, the same payroll stays as Manual Entries: the total is the same either way.
  const config = withHistory()
  config.workshops[0].migrate = false
  config.catalogue.push({ name: 'Handstand places', mindbodyNames: config.workshops[0].tiers.flatMap((t: any) => t.mindbodyNames), migrate: 'skip', kind: null })
  const left = mapStudio(reports, validateConfig(config), TENANT)
  const total = (archive: Parameters<typeof figuresOf>[0]) =>
    Object.values(figuresOf(archive).payByMonth).reduce((sum, v) => sum + Math.round(Number(v) * 100), 0)
  assert.equal(total(migrated.archive), total(left.archive))
  assert.equal(figuresOf(migrated.archive).payByMonth['2026-08'], figuresOf(left.archive).payByMonth['2026-08'])
})

test('a workshop still going at the download is the one to come, not a past one as well', async () => {
  const reports = await readReports(REPORTS)
  const sept = (day: number) => ({ year: 2026, month: 9, day })
  // It began the day before the download, and its next day is the one after.
  const schedule = [
    ...reports.schedule,
    { ...workshopDay(1, 1), date: sept(16) },
    { ...workshopDay(1, 2), date: sept(18) },
  ]
  const attendance = [...reports.attendance, { ...visit(JANE, 1, 1, 'Handstand Workshop - Single'), date: sept(16) }]
  const sales = [...reports.sales, sale(JANE, '9005', august(20), 'Handstand Workshop - Twin (Deposit)', 200)]
  const { archive, ids } = mapStudio({ ...reports, schedule, attendance, sales }, validateConfig(withHistory()), TENANT)
  assert.deepEqual(archive.rows.workshops!.map(w => w.name), ['Handstand Workshop'])
  const janes = archive.rows.bookings!.filter(b => b.kind === 'workshop' && b.client_id === ids.clients![JANE])
  assert.equal(janes.length, 1, 'one place, not one on each half of it')
  // Its sale is the one to come's: dated on it, not on the download.
  assert.equal(janes[0]!.booked_at, '2026-08-19T16:00:00.000Z')
})

test('a per-client pay line at a minute an ordinary class also starts is not taken as the workshop s', async () => {
  const reports = await withPastWorkshop()
  const schedule = [
    ...reports.schedule,
    { ...workshopDay(15, 1), description: 'Vinyasa flow', serviceCategory: 'Main Programme', room: 'Studio2-Normal Room' },
  ]
  const payroll = [...reports.payroll, payLine({ table: 'class_per_client', earnings: 25, rate: { name: 'Percentage Rate', percent: 40 } })]
  const { archive } = mapStudio({ ...reports, schedule, payroll }, validateConfig(withHistory()), TENANT)
  const past = pastWorkshopOf(archive)
  const main = archive.rows.workshop_instructors!.find(i => i.workshop_id === past.id && i.role === 'main')!
  assert.equal(main.pay_sgd, '300.00')
})

test('with migrate false nothing is written, and the preflight counts the past visits, sales and pay left out', async () => {
  const reports = await withPastWorkshop()
  const config = withHistory()
  config.workshops[0].migrate = false
  config.catalogue.push({ name: 'Handstand places', mindbodyNames: config.workshops[0].tiers.flatMap((t: any) => t.mindbodyNames), migrate: 'skip', kind: null })
  const { archive, preflight } = mapStudio(reports, validateConfig(config), TENANT)

  assert.deepEqual(archive.rows.workshops, [])
  assert.deepEqual(archive.rows.workshop_days, [])
  assert.ok(!archive.rows.bookings!.some(b => b.kind === 'workshop'))
  assert.ok(
    preflight.schedule.includes(
      'workshop Handstand Workshop is not migrated (migrate: false): 3 past visit(s) on 2 day(s), 2 sale line(s) totalling 1200.00, ' +
        'and 360.00 of payroll were left out of Workshops — the payroll came across as Manual Payroll Entries',
    ),
    preflight.schedule.join(' | '),
  )
})

test('verify: a past attendee lost on the way in is named', async () => {
  const reports = await withPastWorkshop()
  const { archive } = mapStudio(reports, validateConfig(withHistory()), TENANT)
  const expected = figuresOf(archive)
  assert.deepEqual(await verifyImport(expected, await packArchive(archive)), [])

  const past = pastWorkshopOf(archive)
  const rick = archive.rows.clients!.find(c => c.name === 'Rick Roe')!
  const lost = archive.rows.bookings!.find(b => b.workshop_id === past.id && b.client_id === rick.id)!
  archive.rows.check_ins = archive.rows.check_ins!.filter(c => c.booking_id !== lost.id)
  archive.rows.bookings = archive.rows.bookings!.filter(b => b !== lost)
  archive.manifest.counts.bookings = archive.rows.bookings.length
  archive.manifest.counts.check_ins = archive.rows.check_ins.length
  const differences = await verifyImport(expected, await packArchive(archive))
  assert.ok(differences.includes('workshop Handstand Workshop (2026-08-15): members booked: expected 2, found 1'), differences.join(' | '))
  assert.ok(differences.some(d => /^Rick Roe <[^>]+>: bookings: expected \d+, found \d+$/.test(d)), differences.join(' | '))
})

test('a future paid place is dated on its sale, not on the download day', async () => {
  const reports = await readReports(REPORTS)
  const sales = [
    ...reports.sales,
    // Jane's deposit last month, and her upgrade this month: the place was bought when the deposit was.
    sale(JANE, '9003', august(20), 'Handstand Workshop - Twin (Deposit)', 200),
    sale(JANE, '9004', { year: 2026, month: 9, day: 3 }, 'Handstand Workshop - Upgrade to Single', 250),
  ]
  const { archive, ids, preflight } = mapStudio({ ...reports, sales }, validateConfig(fixtureConfig()), TENANT)
  const place = (clientId: string) => archive.rows.bookings!.find(b => b.kind === 'workshop' && b.client_id === ids.clients![clientId])!
  assert.equal(place(JANE).booked_at, '2026-08-19T16:00:00.000Z')
  assert.equal(figuresOf(archive).revenueByMonth['2026-08']! >= 45000, true)
  // Rick's place has no sale in Big Spenders: dated on the download, and said.
  assert.equal(place(RICK).booked_at, '2026-09-16T18:00:00.000Z')
  assert.ok(
    preflight.schedule.some(n => /^workshop Handstand Workshop: 1 place\(s\) have no sale in Big Spenders, so they are dated on the download day/.test(n)),
    preflight.schedule.join(' | '),
  )
})

test('the starter config proposes a workshop that has already run, and a paid retreat with no timetable row', async () => {
  const reports = await withPastWorkshop()
  const retreat = {
    ...reports.holdings[0]!,
    clientId: RICK,
    serviceCategory: 'Island Retreat',
    option: 'Island Retreat - Twin',
    totalPaid: 900,
  }
  // The fixture workshop's days to come are taken away: only its past run is left.
  const schedule = reports.schedule.filter(r => r.serviceCategory !== 'Handstand Workshop' || r.date.year === 2026)
  const starter = starterConfig({ ...reports, schedule, holdings: [...reports.holdings, retreat] }, '2026-09-17T02:00:00+08:00')
  assert.deepEqual(starter.workshopCategories, ['Handstand Workshop', 'Island Retreat'])
  assert.deepEqual(
    starter.workshops!.map(w => [w.category, w.migrate, w.tiers!.map(t => t.name)]),
    [
      ['Handstand Workshop', null, ['Handstand Workshop - Twin', 'Handstand Workshop - Twin (Deposit)', 'Handstand Workshop - Upgrade to Single']],
      ['Island Retreat', null, ['Island Retreat - Twin']],
    ],
  )
})
