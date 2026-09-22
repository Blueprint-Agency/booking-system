import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { starterConfig, validateConfig } from './config'
import { reportFacts, staffFacts } from './facts'
import { fillConfigs, type StudioAnswers } from './fill'
import { readReports } from './transform'
import { dateOfIso } from './values'

const FIXTURES = path.join(__dirname, 'fixtures')
const AS_OF = '2026-09-17T02:00:00+08:00'
/** The invented fixture studio's own spellings, as its reports have them. */
const FIXTURE = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as {
  rooms: { name: string; mindbodyNames: string[] }[]
  catalogue: { name: string; kind: string | null; migrate: string }[]
}
const secondRoomSpellings = FIXTURE.rooms[0]!.mindbodyNames
const packOnSale = FIXTURE.catalogue.find(e => e.kind === 'credit_bundle' && e.migrate === 'sell')!.name

/** An invented studio's answers: the shape a real one's private answers.json has. */
const ANSWERS: StudioAnswers = {
  studio: {
    displayName: 'Northwind Yoga',
    timezone: 'Asia/Singapore',
    ownerEmail: 'owner@northwind.test',
    admins: [{ email: 'owner@northwind.test', name: 'Northwind Owner' }],
  },
  locations: [
    { key: 'location-1', name: 'Main Hall', address: null, phone: null, mindbodyIds: ['1'] },
    { key: 'location-2', name: 'Riverside', address: null, phone: null, mindbodyIds: ['2'] },
  ],
  defaultLocation: 'location-1',
  rooms: [
    { name: 'Studio 1 - Hot Room', location: 'location-1', mindbodyNames: ['Studio 1 - Hot Room'], classTypesMatching: '\\bhot\\b' },
    { name: 'Second Room', location: 'location-1', mindbodyNames: secondRoomSpellings },
  ],
  offSiteVenues: ['Park'],
  roomlessCapacity: 25,
  notWorkshopCategories: 'classes|category \\d+',
  workshopsMigrate: false,
  staffOnboarding: 'active',
  catalogue: {
    sell: [packOnSale, 'Drop-In'],
    merge: [],
    add: [{ name: 'Drop-In', mindbodyNames: ['Drop-In'], migrate: null, kind: 'credit_bundle', credits: 1, validityDays: null, durationMonths: null, priceSgd: 30, sessionType: null, location: null }],
    accessPassLocations: [{ match: 'riverside', location: 'location-2' }],
    defaults: { credits: 1, validityDays: 30, ptSessionType: '1on1', unlimitedMonths: 1 },
  },
  history: { from: '2026-01-01', purchases: true },
  outputs: {
    staging: { slug: 'northwind-rehearsal' },
    local: { slug: 'northwind', originPatterns: 'http://*.localhost:3000,http://*.portal.localhost:3001' },
  },
}

async function filled() {
  const reports = await readReports(path.join(FIXTURES, 'reports'))
  const asOf = dateOfIso(AS_OF.slice(0, 10))
  const starter = starterConfig(reports, AS_OF) as Record<string, any>
  const facts = reportFacts(reports, asOf, { offSiteVenues: ANSWERS.offSiteVenues })
  return { starter, configs: fillConfigs(starter, ANSWERS, facts, staffFacts(reports, asOf)), facts }
}

test('fill writes one config per output, differing only in slug and origins', async () => {
  const { configs } = await filled()
  assert.deepEqual(Object.keys(configs), ['staging', 'local'])
  assert.equal(configs.staging!.studio.slug, 'northwind-rehearsal')
  assert.equal(configs.local!.studio.slug, 'northwind')
  assert.equal(configs.local!.originPatterns, ANSWERS.outputs.local!.originPatterns)
  const strip = (c: Record<string, any>) => ({ ...c, studio: { ...c.studio, slug: null }, originPatterns: null })
  assert.deepEqual(strip(configs.staging!), strip(configs.local!))
})

test('fill takes every value from the answers and leaves the starter as it was', async () => {
  const { starter, configs } = await filled()
  const before = structuredClone(starter)
  const c = configs.local!
  assert.equal(c.studio.displayName, 'Northwind Yoga')
  assert.equal(c.studio.ownerEmail, 'owner@northwind.test')
  assert.deepEqual(c.locations, ANSWERS.locations)
  assert.deepEqual(c.history, ANSWERS.history)
  assert.equal(c.staffOnboarding, 'active')
  assert.deepEqual(starter, before, 'the starter is not edited in place')
})

test('fill sizes each Room by its largest class, and gives a pattern Room the class types it matches', async () => {
  const { configs, facts } = await filled()
  const rooms = configs.local!.rooms as { name: string; capacity?: number; classTypes?: string[] }[]
  assert.equal(rooms[0]!.capacity, facts.maxByRoom['Studio 1 - Hot Room'])
  assert.ok(rooms[0]!.classTypes!.every(t => /\bhot\b/i.test(t)))
  assert.equal(rooms[1]!.classTypes, undefined)
})

test('fill puts on sale only what the answers name, and adds what nobody holds', async () => {
  const { configs } = await filled()
  const catalogue = configs.local!.catalogue as { name: string; migrate: string; kind: string; location?: string; priceSgd: number | null }[]
  const sell = catalogue.filter(e => e.migrate === 'sell').map(e => e.name).sort()
  assert.deepEqual(sell, [packOnSale, 'Drop-In'].sort())
  assert.equal(catalogue.find(e => e.name === 'Drop-In')!.priceSgd, 30, 'no sale in the reports: the answer\'s price stands')
  for (const pass of catalogue.filter(e => e.kind === 'access_pass')) {
    assert.equal(pass.migrate, 'legacy')
    assert.equal(pass.location, /riverside/i.test(pass.name) ? 'location-2' : 'location-1')
  }
})

test('a filled config, once a person sizes what the roster could not, is one the transform accepts', async () => {
  const { configs } = await filled()
  const c = structuredClone(configs.local!)
  // Left to a person: a Room whose own name the roster never shows, and class types held in no Room.
  for (const r of c.rooms) r.capacity ??= 20
  for (const t of c.classTypes) if (t.capacity == null) t.capacity = 20
  assert.doesNotThrow(() => validateConfig(c))
})
