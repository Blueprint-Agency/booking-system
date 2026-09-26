import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { starterConfig, validateConfig } from './config'
import { reportFacts, staffFacts } from './facts'
import { fillConfigs, type StudioAnswers } from './fill'
import { mapStudio } from './mapper'
import type { SaleRow, ScheduledClassRow } from './readers'
import { readReports } from './transform'
import { dateOfIso } from './values'

/**
 * Every workshop comes across whole: `fill` gives each workshop category an
 * entry and completes it from the reports, and a past run's places include
 * whoever paid for one where Mindbody kept the run as a placeholder slot
 * nobody was signed in to — a retreat. From the outside: fixture reports and
 * config in (the studio and its people are invented), config and archive rows out.
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const REPORTS = path.join(FIXTURES, 'reports')
const TENANT = '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a'
const AS_OF = '2026-09-17T02:00:00+08:00'
const JANE = '100000001'
const RICK = '100000002'

const fixtureConfig = () => {
  const c = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as Record<string, any>
  c.history = { from: '2026-06-01', purchases: true }
  c.paymentMethods = { Cash: 'cash', 'Credit card (Visa-Keyed)': 'card', 'Misc. (PayNow QR)': 'paynow', 'Misc. (Bank)': 'bank_transfer' }
  return c
}

const august = (day: number) => ({ year: 2026, month: 8, day })

/** The retreat's one day on the timetable: a quarter-hour placeholder, as Mindbody keeps one. */
const retreatDay: ScheduledClassRow = {
  staff: 'IVY INSTRUCTOR',
  date: august(15),
  start: { hour: 7, minute: 0 },
  end: { hour: 7, minute: 15 },
  description: 'Handstand Retreat',
  substitute: false,
  location: 'Main Hall',
  serviceCategory: 'Handstand Workshop',
  room: 'Studio 1 - Hot Room',
}

const sale = (clientId: string, saleId: string, day: number, description: string, total: number): SaleRow => ({
  clientId,
  saleId,
  soldAt: { year: 2026, month: 7, day, hour: 0, minute: 0, second: 0 },
  description,
  location: 'Main Hall',
  quantity: 1,
  total,
})

/** The fixture with a past run of its workshop nobody was signed in to, and Jane and Rick's July sales for it. */
async function withPlaceholderRun() {
  const reports = await readReports(REPORTS)
  return {
    ...reports,
    schedule: [...reports.schedule, retreatDay],
    sales: [...reports.sales, sale(JANE, '9101', 20, 'Handstand Workshop - Single', 700), sale(RICK, '9102', 25, 'Handstand Workshop - Twin', 500)],
  }
}

const placesOn = (archive: { rows: Record<string, Record<string, unknown>[]> }, workshopId: unknown) =>
  archive.rows.bookings!.filter(b => b.kind === 'workshop' && b.workshop_id === workshopId)

test('a past run nobody was signed in to comes across with a confirmed place for each member who paid, at what they paid', async () => {
  const { archive, ids, preflight } = mapStudio(await withPlaceholderRun(), validateConfig(fixtureConfig()), TENANT)

  const past = archive.rows.workshops!.find(w => String(w.name).includes('2026-08-15'))!
  const tierName = new Map(archive.rows.workshop_tiers!.map(t => [t.id, t.name]))
  const places = placesOn(archive, past.id).map(b => [b.client_id, tierName.get(b.workshop_tier_id), b.amount_paid_sgd, b.state, b.check_in_state])
  assert.deepEqual(
    places.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [
      [ids.clients![JANE], 'Single room', '700.00', 'confirmed', 'pending'],
      [ids.clients![RICK], 'Twin room', '500.00', 'confirmed', 'pending'],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )
  assert.ok(preflight.schedule.some(n => /2 place\(s\) were paid for and nobody was signed in to its days/.test(n)), preflight.schedule.join(' | '))
})

test('a workshop seats at least everyone who has a place on it, whatever capacity the config gave it', async () => {
  const config = fixtureConfig()
  config.workshops[0].capacity = 1
  const { archive } = mapStudio(await withPlaceholderRun(), validateConfig(config), TENANT)

  const past = archive.rows.workshops!.find(w => String(w.name).includes('2026-08-15'))!
  const confirmed = placesOn(archive, past.id).filter(b => b.state === 'confirmed').length
  assert.equal(confirmed, 2)
  for (const day of archive.rows.workshop_days!.filter(d => d.workshop_id === past.id)) assert.equal(day.capacity_online, 2)
})

/** An invented studio's answers, every workshop coming across. */
const ANSWERS: StudioAnswers = {
  studio: { displayName: 'Northwind Yoga', timezone: 'Asia/Singapore', ownerEmail: 'owner@northwind.test', admins: [] },
  locations: [
    { key: 'location-1', name: 'Main Hall', address: null, phone: null, mindbodyIds: ['1'] },
    { key: 'location-2', name: 'Riverside', address: null, phone: null, mindbodyIds: ['2'] },
  ],
  defaultLocation: 'location-1',
  rooms: [],
  offSiteVenues: [],
  roomlessCapacity: 25,
  notWorkshopCategories: 'classes|category \\d+',
  workshopsMigrate: true,
  staffOnboarding: 'active',
  catalogue: {
    sell: [],
    merge: [],
    add: [],
    accessPassLocations: [],
    defaults: { credits: 1, validityDays: 30, ptSessionType: '1on1', unlimitedMonths: 1 },
  },
  history: null,
  outputs: { staging: { slug: 'northwind' } },
}

test('fill completes every workshop coming across from the reports, and its places are no packages', async () => {
  const reports = await readReports(REPORTS)
  const starter = starterConfig(reports, AS_OF) as Record<string, any>
  // A starter from an older download, which proposed no workshop at all.
  starter.workshops = []
  const facts = reportFacts(reports, dateOfIso(AS_OF.slice(0, 10)), { offSiteVenues: [] })
  const notes: string[] = []
  const config = fillConfigs(starter, ANSWERS, facts, staffFacts(reports, dateOfIso(AS_OF.slice(0, 10))), notes).staging!

  const workshop = config.workshops.find((w: { category: string }) => w.category === 'Handstand Workshop')
  assert.equal(workshop.migrate, true)
  // A category nothing was ever sold under has no room type to book, so it does not come across.
  for (const w of config.workshops.filter((w: { tiers: unknown[] }) => w.tiers.length === 0)) assert.equal(w.migrate, false, w.category)
  assert.equal(workshop.location, 'location-1')
  assert.ok(workshop.capacity >= 1)
  assert.ok(workshop.tiers.length > 0)
  for (const tier of workshop.tiers) assert.equal(typeof tier.priceSgd, 'number', `${tier.name} is priced`)
  const spellings = new Set(workshop.tiers.flatMap((t: { mindbodyNames: string[] }) => t.mindbodyNames.map(n => n.toLowerCase())))
  for (const e of config.catalogue.filter((e: { mindbodyNames: string[] }) => e.mindbodyNames.some(n => spellings.has(n.toLowerCase())))) {
    assert.equal(e.migrate, 'skip', `${e.name} buys a place, so it is no package`)
  }
  assert.ok(notes.some(n => /^workshops: \d+ coming across/.test(n)), notes.join(' | '))
})
