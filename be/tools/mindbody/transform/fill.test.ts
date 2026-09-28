import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { starterConfig, validateConfig } from './config'
import { cancellationWindow, reportFacts, staffFacts } from './facts'
import { fillConfigs, type StudioAnswers } from './fill'
import { readReports, transformMindbody } from './transform'
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

test('an email the answers give a teacher Mindbody holds none for brings them across with a login; Mindbody\'s own email wins', async () => {
  const reports = await readReports(path.join(FIXTURES, 'reports'))
  const asOf = dateOfIso(AS_OF.slice(0, 10))
  const starter = starterConfig(reports, AS_OF) as Record<string, any>
  const facts = reportFacts(reports, asOf, { offSiteVenues: ANSWERS.offSiteVenues })
  const staff = staffFacts(reports, asOf)
  const teachers = (fillConfigs(starter, ANSWERS, facts, staff).local!.staff as Record<string, any>[]).filter(s => s.migrate === 'active' && s.email && s.teaches)
  assert.ok(teachers.length >= 2, 'the fixture has two active teachers with an email')
  const [noLogin, withEmail] = teachers as [Record<string, any>, Record<string, any>]
  // Mindbody holds no email for the first: in the starter, as the reports would have it.
  for (const s of starter.staff) if (s.mindbodyName === noLogin.mindbodyName) s.email = null
  const before = fillConfigs(starter, ANSWERS, facts, staff).local!.staff as Record<string, any>[]
  assert.equal(before.find(s => s.mindbodyName === noLogin.mindbodyName)!.noLogin, true, 'with no email, a teacher comes across with no login')

  const notes: string[] = []
  const answers = { ...ANSWERS, staffEmails: { [noLogin.mindbodyName.toUpperCase()]: ' given@northwind.test ', [withEmail.mindbodyName]: 'other@northwind.test', 'Nobody Here': 'x@northwind.test' } }
  const after = fillConfigs(starter, answers, facts, staff, notes).local!.staff as Record<string, any>[]
  const given = after.find(s => s.mindbodyName === noLogin.mindbodyName)!
  assert.equal(given.email, 'given@northwind.test', 'matched on the name however it is cased, and trimmed')
  assert.equal(given.noLogin, false)
  assert.equal(given.migrate, 'active')
  assert.equal(after.find(s => s.mindbodyName === withEmail.mindbodyName)!.email, withEmail.email)
  assert.ok(notes.some(n => n.includes('"Nobody Here"')), 'a name matching no staff member is reported, not silently dropped')
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

test('reply-to and footer in the answers reach the studio\'s settings and every email', async () => {
  const answers: StudioAnswers = {
    ...ANSWERS,
    studio: { ...ANSWERS.studio, mailReplyTo: 'hello@northwind.test', emailFooter: 'Northwind Yoga, 1 Invented Lane' },
  }
  const reports = await readReports(path.join(FIXTURES, 'reports'))
  const asOf = dateOfIso(AS_OF)
  const facts = reportFacts(reports, asOf, { offSiteVenues: answers.offSiteVenues })
  const filledStudio = fillConfigs(starterConfig(reports, AS_OF), answers, facts, staffFacts(reports, asOf)).staging!.studio
  assert.equal(filledStudio.mailReplyTo, 'hello@northwind.test')
  assert.equal(filledStudio.emailFooter, 'Northwind Yoga, 1 Invented Lane')

  // The fixture studio, with the two values as fill writes them.
  const config = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8'))
  Object.assign(config.studio, { mailReplyTo: filledStudio.mailReplyTo, emailFooter: filledStudio.emailFooter })
  const { archive } = await transformMindbody({ reportsDir: path.join(FIXTURES, 'reports'), config, tenantId: '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a' })
  assert.equal(archive.rows.tenant_settings![0]!.mail_reply_to, 'hello@northwind.test')
  assert.ok(archive.rows.email_templates!.every(t => String(t.body_html).includes('1 Invented Lane')), 'the footer is on every email')
})

test('the Cancellations report proposes the class cancellation window: the cut-off between members\' early and late cancels', async () => {
  // The fixture's members cancel late 90 minutes before a class, and early a day and more before one.
  const { facts, configs } = await filled()
  assert.equal(facts.classWindow?.hours, 2)
  assert.equal(configs.local!.policy.classWindowHours, 2, 'the report\'s cut-off, not the 24-hour default')
})

/**
 * The fixture's answers with the studio's own decisions on top: a policy, PT
 * bound to an instructor but for one package, and instructors who may not
 * schedule classes — all but one, who may do everything.
 */
const DECIDED: StudioAnswers = {
  ...ANSWERS,
  locations: ANSWERS.locations.map((l, i) =>
    i === 0 ? { ...l, address: '1 Invented Lane', gmapsUrl: 'https://maps.example.test/main-hall', phone: '+6560000000' } : l,
  ),
  catalogue: {
    ...ANSWERS.catalogue,
    add: [
      ...ANSWERS.catalogue.add,
      { name: 'PT Open 5', mindbodyNames: ['PT Open 5'], migrate: null, kind: 'pt', credits: 5, validityDays: null, durationMonths: null, priceSgd: 400, sessionType: null, location: null },
    ],
  },
  policy: { cancelCapCount: 7, classWindowHours: 24 },
  ptInstructorBound: { bound: true, except: ['open 5', 'no such package'] },
  instructorPermissions: {
    default: ['take_pt_bookings', 'manage_rosters'],
    byName: { 'IVY INSTRUCTOR': ['schedule_classes', 'take_pt_bookings', 'manage_rosters'], 'Nobody Here': ['manage_rosters'] },
  },
}

async function decided(notes?: string[]) {
  const reports = await readReports(path.join(FIXTURES, 'reports'))
  const asOf = dateOfIso(AS_OF.slice(0, 10))
  const facts = reportFacts(reports, asOf, { offSiteVenues: DECIDED.offSiteVenues })
  return fillConfigs(starterConfig(reports, AS_OF), DECIDED, facts, staffFacts(reports, asOf), notes).local!
}

test('the policy the answers decide wins over the window the reports suggest and over the defaults', async () => {
  const c = await decided()
  assert.equal(c.policy.classWindowHours, 24, 'the answer, not the report\'s 2-hour cut-off')
  assert.equal(c.policy.cancelCapCount, 7)
  assert.equal(c.policy.cancelCapCycleDays, 30, 'a figure the answers leave out keeps its default')
})

test('every PT package is Instructor-Bound but those the answers except; instructors take the default permissions but those named', async () => {
  const notes: string[] = []
  const c = await decided(notes)
  const pt = (c.catalogue as Record<string, any>[]).filter(e => e.kind === 'pt')
  assert.deepEqual(
    Object.fromEntries(pt.map(e => [e.name, e.instructorBound])),
    { 'PT - Bundle of 10': true, 'PT Open 5': false },
  )
  assert.deepEqual(c.instructorPermissions, ['take_pt_bookings', 'manage_rosters'])
  const staff = c.staff as Record<string, any>[]
  assert.deepEqual(staff.find(s => s.mindbodyName === 'Ivy Instructor')!.permissions, ['schedule_classes', 'take_pt_bookings', 'manage_rosters'], 'matched on the name however it is cased')
  // Another teacher coming across, whom the answers do not name.
  const other = staff.find(s => s.migrate !== 'skip' && s.teaches && s.mindbodyName !== 'Ivy Instructor')!
  assert.ok(other, 'the fixture has a second teacher coming across')
  assert.equal(other.permissions, null, 'everyone else takes the default')
  assert.ok(notes.some(n => n.includes('"no such package"')), 'an exception matching no PT package is reported')
  assert.ok(notes.some(n => n.includes('"Nobody Here"')), 'a name matching no staff member is reported')

  // And the archive carries them: the catalogue's flag, and each instructor's permissions.
  const config = structuredClone(c)
  for (const r of config.rooms) r.capacity ??= 20
  for (const t of config.classTypes) if (t.capacity == null) t.capacity = 20
  const { archive, ids } = await transformMindbody({ reportsDir: path.join(FIXTURES, 'reports'), config, tenantId: '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a', local: true })
  assert.deepEqual(
    Object.fromEntries(archive.rows.pt_packages!.map(p => [p.name, p.instructor_bound])),
    { 'PT - Bundle of 10': true, 'PT Open 5': false },
  )
  const permissionsOf = (name: string) =>
    archive.rows.instructors!.find(i => i.staff_user_id === ids.staff_users![name])?.permissions
  assert.deepEqual(permissionsOf('Ivy Instructor'), ['schedule_classes', 'take_pt_bookings', 'manage_rosters'])
  assert.deepEqual(permissionsOf(other.mindbodyName), ['take_pt_bookings', 'manage_rosters'])
  assert.ok(archive.rows.instructors!.every(i => Array.isArray(i.permissions)), 'every instructor row says its permissions')
  const [mainHall] = archive.rows.locations!
  assert.deepEqual(
    { address: mainHall!.address, gmaps_url: mainHall!.gmaps_url, phone: mainHall!.phone },
    { address: '1 Invented Lane', gmaps_url: 'https://maps.example.test/main-hall', phone: '+6560000000' },
    'a Location\'s address, map link and phone reach its row',
  )
  assert.equal(archive.rows.global_policy![0]!.cancel_cap_count, 7)
  assert.equal(archive.rows.global_policy![0]!.class_window_hours, 24)
})

test('the cut-off is the smallest whole hour that parts early from late self-cancels; staff cancels do not count', () => {
  const at = (day: number, hour: number, minute = 0) => ({ year: 2026, month: 7, day, hour, minute, second: 0 })
  const row = (cancelled: ReturnType<typeof at>, method: string, by = 'Jane Doe') => ({
    cancelledAt: cancelled, cancelledBy: by, date: { year: 2026, month: 7, day: 10 }, start: { hour: 19, minute: 0 },
    description: 'Hatha', client: 'Jane Doe', method,
  })
  const window = cancellationWindow([
    row(at(10, 17, 1), 'late'), // 1h59 before
    row(at(10, 18, 30), 'late'),
    row(at(10, 16, 59), 'early'), // 2h01 before
    row(at(9, 19), 'early'),
    row(at(10, 18), 'early', 'Front Desk'), // a staff member's cancel says nothing of the members' rule
  ])
  assert.deepEqual(window, { hours: 2, early: 2, late: 2, misfits: 0 })
  assert.equal(cancellationWindow([row(at(10, 18), 'late')]), null, 'no early self-cancel: no cut-off to see')
})
