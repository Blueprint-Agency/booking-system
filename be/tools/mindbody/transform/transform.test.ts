import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { packArchive, unpackArchive } from '../../../src/services/tenants/transfer-archive'
import { ConfigError, starterConfig, validateConfig } from './config'
import { mapStudio, renderPreflight } from './mapper'
import { readAutopayDetail, type OptionSaleRow } from './readers'
import { registerMatcher } from './register'
import { constraintViolations } from './constraints'
import { REPORTS as REPORT_FILES, REPORT_RULES, readReports, transformMindbody, verifyImport } from './transform'

/**
 * The transform, from the outside: fixture reports and a fixture config in, an
 * archive out. The database half — importing it and signing in — is
 * `import.test.ts`, beside this file.
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const REPORTS = path.join(FIXTURES, 'reports')
const fixtureConfig = () => JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as Record<string, any>
const TENANT = '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a'

const run = (config: unknown = fixtureConfig(), tenantId = TENANT) =>
  transformMindbody({ reportsDir: REPORTS, config, tenantId })

test('the same inputs give the same zip, byte for byte', async () => {
  const [a, b] = [await run(), await run()]
  assert.ok(a.zip.equals(b.zip), 'two runs on the same inputs must write identical archives')
  assert.deepEqual(a.ids, b.ids)
})

test('the archive is for the Tenant it was built for, and asks for accounts to be ensured', async () => {
  const { zip, ids } = await run()
  const archive = await unpackArchive(zip)
  assert.equal(archive.manifest.tenant.id, TENANT)
  assert.equal(archive.manifest.ensureAccounts, true)
  // Every template a provisioned studio gets, class_waitlist_promoted (#308) included.
  assert.equal(archive.rows.email_templates!.length, 34)
  assert.equal(archive.rows.global_policy!.length, 1)
  assert.equal(archive.rows.pt_booking_config!.length, 1)
  assert.ok(archive.rows.clients!.every(r => r.auth_user_id === null), 'accounts are the importer s to make')

  // The id mapping traces each row to its Mindbody key.
  const jane = archive.rows.clients!.find(r => r.id === ids.clients!['100000001'])
  assert.equal(jane?.email, 'jane.doe@example.test')

  // Another target Tenant, other ids: two rehearsals on one database never collide.
  const other = await run(fixtureConfig(), '5c3a0e1f-2b4d-4e6f-8a9b-0c1d2e3f4a5b')
  assert.notEqual(other.ids.clients!['100000001'], ids.clients!['100000001'])
})

test('members: every profile, lower-cased email, join date in the studio timezone, placeholders gone', async () => {
  const { archive, ids } = await run()
  const byId = (barcode: string) => archive.rows.clients!.find(r => r.id === ids.clients![barcode])!
  assert.equal(archive.rows.clients!.length, 8)

  const jane = byId('100000001')
  assert.equal(jane.name, 'Jane Doe')
  assert.equal(jane.phone, '+6591234567')
  assert.equal(jane.gender, 'female')
  // 24/4/2023 8:38:19 am in Singapore.
  assert.equal(jane.joined_at, '2023-04-24T00:38:19.000Z')

  const rick = byId('100000002')
  assert.equal(rick.phone, '', "Mindbody's placeholder phone is no phone")
  assert.equal(rick.gender, 'male')

  const legacy = byId('AB123456')
  assert.equal(legacy.name, 'Legacy', 'a "." surname is no surname')
  assert.equal(legacy.email, 'legacy.member@example.test')

  assert.equal(byId('100000008').name, 'Mei 林')
})

test('members with no email or a shared one get placeholders, and the preflight names them', async () => {
  const { archive, ids, preflight, preflightText } = await run()
  const email = (barcode: string) => archive.rows.clients!.find(r => r.id === ids.clients![barcode])!.email as string

  assert.deepEqual(preflight.noEmail.map(m => m.id), ['100000003'])
  assert.match(email('100000003'), /@no-email\.invalid$/)

  // Kim visited more recently than Sam, so Kim keeps the address.
  assert.equal(preflight.sharedEmails.length, 1)
  assert.equal(preflight.sharedEmails[0]!.email, 'family@example.test')
  assert.equal(preflight.sharedEmails[0]!.keeper.id, '100000005')
  assert.deepEqual(preflight.sharedEmails[0]!.others.map(o => o.id), ['100000004'])
  assert.equal(email('100000005'), 'family@example.test')
  assert.match(email('100000004'), /@no-email\.invalid$/)

  const emails = archive.rows.clients!.map(r => r.email)
  assert.equal(new Set(emails).size, emails.length, 'no two members share an address')

  assert.match(preflightText, /100000003 Pat Poe/)
  assert.match(preflightText, /family@example\.test: kept by 100000005 Kim Lee/)
})

test('the config can name who keeps a shared email', async () => {
  const config = fixtureConfig()
  config.sharedEmailKeepers = { 'family@example.test': '100000004' }
  const { preflight } = await run(config)
  assert.equal(preflight.sharedEmails[0]!.keeper.id, '100000004')
})

test('staff: the owner an active admin, the others pending with invitations, former teachers archived', async () => {
  const { archive, ids } = await run()
  const staff = (name: string) => archive.rows.staff_users!.find(r => r.id === ids.staff_users![name])!

  assert.equal(archive.rows.staff_users!.length, 4, 'the skipped clerk stays behind')
  assert.deepEqual([staff('Olive Owner').role, staff('Olive Owner').status], ['admin', 'active'])
  assert.deepEqual([staff('Ivy Instructor').role, staff('Ivy Instructor').status], ['instructor', 'pending'])
  assert.deepEqual([staff('Frank Front').role, staff('Frank Front').status], ['admin', 'pending'])
  assert.equal(staff('Old Teacher').status, 'archived')
  assert.match(staff('Old Teacher').email as string, /@no-email\.invalid$/)
  assert.equal(staff('Ivy Instructor').phone, '+9122220000')

  const invited = archive.rows.staff_invitations!.map(r => r.staff_user_id).sort()
  assert.deepEqual(invited, [ids.staff_users!['Frank Front'], ids.staff_users!['Ivy Instructor']].sort())
  const teachers = archive.rows.instructors!.map(r => r.staff_user_id).sort()
  assert.deepEqual(
    teachers,
    [ids.staff_users!['Olive Owner'], ids.staff_users!['Ivy Instructor'], ids.staff_users!['Old Teacher']].sort(),
  )
})

test('the studio shell: locations, merged rooms with capacity, class types, policy', async () => {
  const { archive, ids } = await run()
  assert.deepEqual(archive.rows.locations!.map(r => r.name), ['Main Hall', 'Riverside'])
  assert.equal(archive.rows.rooms!.length, 3)
  assert.equal(ids.rooms!['Studio2-Normal Room'], ids.rooms!['Studio 2 - Normal Room'], 'two spellings, one Room')
  assert.equal(archive.rows.rooms!.find(r => r.name === 'Hot Room')?.capacity, 15)
  assert.equal(ids.rooms!['Outdoor Yoga'], undefined, 'an off-site venue is not a Room')
  assert.equal(ids.class_types!['HATHA '], ids.class_types!.Hatha)
  assert.equal(archive.rows.global_policy![0]!.class_window_hours, 12)
  assert.equal(archive.rows.tenant_settings![0]!.display_name, 'Mindbody Fixture Studio')
})

test('an unfinished config is refused, every open field named', async () => {
  const config = fixtureConfig()
  config.studio.slug = null
  config.staff[1].email = null
  config.rooms[0].capacity = null
  await assert.rejects(run(config), (err: unknown) => {
    assert.ok(err instanceof ConfigError)
    assert.deepEqual(err.problems.sort(), [
      'rooms[0] (Studio 2 - Normal Room).capacity is open',
      'staff[1] (Ivy Instructor).email is open',
      'studio.slug is open',
    ])
    return true
  })
})

test('the owner must be one of the staff coming across, as an admin', () => {
  const config = fixtureConfig()
  config.studio.ownerEmail = 'nobody@example.test'
  assert.throws(() => validateConfig(config), /ownerEmail nobody@example\.test is not the email of any staff/)
})

test('two staff records with one name must be told apart in the config', () => {
  const config = fixtureConfig()
  config.staff.push({ mindbodyName: 'Instructor, Ivy', migrate: 'active', email: 'ivy2@example.test', role: 'instructor' })
  assert.throws(() => validateConfig(config), /two staff records share this name/)
})

test('the starter config is filled from the reports and refused until a person completes it', async () => {
  const starter = starterConfig(await readReports(REPORTS))
  assert.deepEqual(
    starter.locations.map(l => l.mindbodyIds),
    [['1'], ['2']],
    'one Location per id the member reports print',
  )
  const staff = Object.fromEntries(starter.staff.map(s => [s.mindbodyName, s]))
  assert.deepEqual(
    [staff['Olive Owner']!.migrate, staff['Olive Owner']!.email, staff['Olive Owner']!.role],
    ['active', 'owner@example.test', 'instructor'],
  )
  assert.equal(staff['Frank Front']!.role, null, 'the reports only say "staff", so the role is a decision')
  assert.equal(staff['Frank Front']!.email, null)
  assert.equal(staff['Old Teacher']!.migrate, 'archived')
  assert.equal(staff['Gone Clerk']!.migrate, 'skip')

  assert.throws(
    () => validateConfig(starter),
    (err: unknown) =>
      err instanceof ConfigError &&
      ['studio.slug is open', 'studio.timezone is open', 'asOf is open', 'staff[2] (Frank Front).email is open', 'staff[2] (Frank Front).role is open'].every(p =>
        err.problems.includes(p),
      ),
  )
})

/* ── The catalogue and what members hold of it (#178) ─────────────────────── */

const AS_OF_DAY = Date.UTC(2026, 8, 17)
/** Days a package good until `y-m-d` still had on the day of the download, that day included. */
const daysLeftUntil = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - AS_OF_DAY) / 86_400_000 + 1

test('the catalogue: sell is active at the config price, legacy is archived, skip and access passes are no row', async () => {
  const { archive } = await run()
  const classes = Object.fromEntries(archive.rows.class_packages!.map(r => [r.name, r]))
  assert.deepEqual(Object.keys(classes).sort(), ['2 Trial Classes', 'Class Pack - Bundle of 10', 'Class Pack - Bundle of 20', 'ClassPass', 'Unlimited 12'])

  const ten = classes['Class Pack - Bundle of 10']!
  assert.deepEqual([ten.kind, ten.credits, ten.validity_days, ten.duration_months, ten.price_sgd, ten.status], ['credit_bundle', 10, 60, null, '260.00', 'active'])
  const twenty = classes['Class Pack - Bundle of 20']!
  assert.deepEqual([twenty.status, twenty.price_sgd, twenty.archived_at], ['archived', '0.00', '2026-09-16T18:00:00.000Z'])
  const plan = classes['Unlimited 12']!
  assert.deepEqual([plan.kind, plan.credits, plan.validity_days, plan.duration_months], ['unlimited', null, null, 12])
  const classPass = classes['ClassPass']!
  assert.deepEqual([classPass.kind, classPass.price_sgd, classPass.status], ['credit_bundle', '0.00', 'archived'], 'an ordinary archived $0 bundle')

  const [pt] = archive.rows.pt_packages!
  assert.equal(archive.rows.pt_packages!.length, 1)
  assert.deepEqual([pt!.name, pt!.session_type, pt!.num_sessions, pt!.validity_days, pt!.price_sgd, pt!.status], ['PT - Bundle of 10', '1on1', 10, 90, '1200.00', 'active'])
})

test('live packages: the soonest-ending runs with its expiry and unbooked balance; the other waits with the days it had left', async () => {
  const { archive, ids } = await run()
  const held = (barcode: string) => archive.rows.client_packages!.filter(r => r.client_id === ids.clients![barcode])
  const named = (barcode: string, key: string) => archive.rows.client_packages!.find(r => r.id === ids.client_packages![`${barcode}/${key}`])!

  const running = named('100000001', 'Class Pack - Bundle of 10')
  assert.equal(running.credits_or_sessions_remaining, 5, 'unbooked, not remaining: the visit already booked has spent its credit')
  assert.equal(running.expires_at, '2090-03-01T15:59:59.000Z', 'the end of its last day, at the studio')
  // List Price is what was paid: the catalogue's price today is no discount this member was given.
  assert.deepEqual([running.active, running.validity_days, running.amount_paid_sgd, running.list_price_sgd], [true, 60, '250.00', '250.00'])
  assert.equal(running.purchased_at, '2026-07-31T16:00:00.000Z', 'first activation, studio-local')

  const waiting = named('100000001', 'Class Pack - Bundle of 20')
  assert.deepEqual(
    [waiting.expires_at, waiting.active, waiting.credits_or_sessions_remaining, waiting.validity_days],
    [null, true, 20, daysLeftUntil(2090, 6, 1)],
  )
  assert.equal(waiting.list_price_sgd, '500.00', 'what was paid, and the 50.00 a promotion took off it (Promotions)')

  const pt = named('100000008', 'PT - Bundle of 10')
  assert.deepEqual([pt.kind, pt.credits_or_sessions_remaining, pt.expires_at, pt.source_class_package_id], ['pt', 7, '2090-04-01T15:59:59.000Z', null])
  assert.equal(pt.source_pt_package_id, ids.pt_packages!['PT - Bundle of 10'])

  const classPass = named('100000006', 'ClassPass')
  assert.deepEqual([classPass.kind, classPass.credits_or_sessions_remaining, classPass.amount_paid_sgd, classPass.list_price_sgd], ['credit_bundle', 1, '0.00', '0.00'])

  assert.deepEqual(held('AB123456'), [], 'a pack that expired years ago with credits on it is not live')
})

/** The fixture's reports, with Rick placed at another Location (a Mindbody location id, `0` for none) in Retention Management. */
const rickAt = (reports: Awaited<ReturnType<typeof readReports>>, location: string) => ({
  ...reports,
  retention: reports.retention.map(r => (r.id === '100000002' ? { ...r, location } : r)),
})

test('an Unlimited Plan keeps its expiry, is homed where its member is, and a pass for the other Location is its Add-On', async () => {
  const reports = await readReports(REPORTS)
  const { archive, ids } = mapStudio(rickAt(reports, '1'), validateConfig(fixtureConfig()), TENANT)
  const [plan, ...others] = archive.rows.client_packages!.filter(r => r.client_id === ids.clients!['100000002'])
  assert.deepEqual(others, [], 'the access pass is not a package of its own')
  assert.deepEqual(
    [plan!.kind, plan!.location_id, plan!.duration_months, plan!.validity_days, plan!.credits_or_sessions_remaining, plan!.expires_at],
    ['unlimited', ids.locations!['location-1'], 12, null, null, '2090-02-01T15:59:59.000Z'],
  )
  assert.equal(plan!.cross_location_paid_sgd, '120.00', 'what the pass cost')

  // Where no report places the member, a plan whose name names a Location is homed there.
  const config = fixtureConfig()
  config.catalogue.find((e: { name: string }) => e.name === 'Unlimited 12').mindbodyNames = ['Unlimited 12', 'Unlimited 12 - Riverside']
  const homed = mapStudio(rickAt(reports, '0'), validateConfig(config), TENANT)
  const moved = homed.archive.rows.client_packages!.find(r => r.kind === 'unlimited')!
  assert.equal(moved.location_id, homed.ids.locations!['location-2'])
  assert.equal(moved.cross_location_paid_sgd, null, 'a pass for the Location the plan is already homed at adds nothing')
})

test('a trial held under two spellings is one trial, and a trial used up years ago is still a trial used', async () => {
  const { archive, ids } = await run()
  const trials = archive.rows.client_packages!.filter(r => r.kind === 'trial')
  assert.equal(new Set(trials.map(r => r.client_id)).size, trials.length, 'one trial per member, ever')

  const live = trials.find(r => r.client_id === ids.clients!['100000004'])!
  assert.deepEqual([live.active, live.credits_or_sessions_remaining, live.expires_at, live.amount_paid_sgd], [true, 2, '2090-01-02T15:59:59.000Z', '20.00'])

  const spent = trials.find(r => r.client_id === ids.clients!['100000001'])!
  assert.deepEqual([spent.active, spent.credits_or_sessions_remaining, spent.expires_at], [false, 0, '2023-04-30T15:59:59.000Z'])
})

test('the preflight lists what is live in Mindbody and does not come across', async () => {
  const { preflight, preflightText } = await run()
  assert.deepEqual(
    preflight.notMigrated.map(n => [n.clientId, n.option, n.left, n.expires]),
    [
      ['100000003', 'Class Pack - Bundle of 20', '4 left', 'no expiry date'],
      ['100000005', 'MAT STORAGE (1 Year)', '1 left', '2090-05-31'],
      ['100000005', 'Riverside Studio Access', 'unlimited', '2089-12-01'],
    ],
  )
  assert.match(preflight.notMigrated[2]!.reason, /no Unlimited Plan/)
  assert.deepEqual(preflight.balances, [{ clientId: '100000005', name: 'Kim Lee', balance: '-10.00' }])
  assert.match(preflightText, /Kim Lee: MAT STORAGE \(1 Year\) — 1 left, until 2090-05-31/)
  assert.match(preflightText, /Kim Lee: -10\.00/)
})

/**
 * Mindbody lets a pricing option be sold with no expiration at all. Such a
 * holding is not live by the rule the ticket sets — "not expired at download
 * time" has no answer without a date — and the platform has no package that
 * never ends. It must still be a line in the preflight: what it must not do is
 * disappear, leaving a member holding credits nobody knows about.
 */
test('a holding with credits and no expiry at all is listed, not dropped in silence', async () => {
  const { preflight, preflightText, archive, ids } = await run()
  const open = preflight.notMigrated.find(n => n.clientId === '100000003')
  assert.ok(open, 'a holding with no Last Expiration Date must reach the preflight')
  assert.equal(open.option, 'Class Pack - Bundle of 20')
  assert.equal(open.left, '4 left')
  assert.equal(open.expires, 'no expiry date')
  assert.match(open.reason, /no expiry date/i)
  assert.match(preflightText, /Pat Poe: Class Pack - Bundle of 20 — 4 left, until no expiry date/)

  // And it is genuinely not migrated: Pat holds no package row.
  const theirs = archive.rows.client_packages!.filter(p => p.client_id === ids.clients!['100000003'])
  assert.deepEqual(theirs, [])
})

test('a pricing option somebody still holds must be in the catalogue', async () => {
  const config = fixtureConfig()
  config.catalogue = config.catalogue.filter((e: { name: string }) => e.name !== 'ClassPass')
  await assert.rejects(run(config), (err: unknown) => err instanceof ConfigError && err.problems.includes('catalogue: "ClassPass" is still held by 1 member(s) and is not listed'))
})

test('a catalogue entry must carry what its kind needs, and a spelling belongs to one entry', () => {
  const config = fixtureConfig()
  config.catalogue.push(
    { name: 'Open', mindbodyNames: ['Open'], migrate: null, kind: null },
    { name: 'Pack', mindbodyNames: ['Pack', 'unlimited  12'], migrate: 'sell', kind: 'credit_bundle', credits: 5 },
    { name: 'Pass', mindbodyNames: ['Pass'], migrate: 'sell', kind: 'access_pass', location: 'nowhere' },
  )
  assert.throws(
    () => validateConfig(config),
    (err: unknown) =>
      err instanceof ConfigError &&
      [
        'catalogue[8] (Open).migrate is open',
        'catalogue[9] (Pack): "unlimited  12" is also listed under catalogue[3]',
        'catalogue[9] (Pack).validityDays is open',
        'catalogue[9] (Pack).priceSgd is open',
        'catalogue[10] (Pass).location "nowhere" names no Location',
      ].every(p => err.problems.includes(p)) &&
      err.problems.some(p => /access pass is not sold here/.test(p)),
  )
})

test('the starter config proposes the catalogue from what was sold', async () => {
  const starter = starterConfig(await readReports(REPORTS), '2026-09-17T02:00:00+08:00')
  assert.equal(starter.asOf, '2026-09-17T02:00:00+08:00')
  const proposed = Object.fromEntries(starter.catalogue!.map(e => [e.name, e]))
  assert.deepEqual(Object.keys(proposed).sort(), [
    '2 Trial Classes for New Joiners',
    'Class Pack - Bundle of 10',
    'Class Pack - Bundle of 20',
    'ClassPass',
    // Places on a workshop are proposed like anything else held, and skipped:
    // a person moves them into `workshops[].tiers` instead.
    'Handstand Workshop - Twin',
    'Handstand Workshop - Twin (Deposit)',
    'Handstand Workshop - Upgrade to Single',
    'MAT STORAGE (1 Year)',
    'PT - Bundle of 10',
    'Riverside Studio Access',
    'Unlimited 12',
  ])

  const ten = proposed['Class Pack - Bundle of 10']!
  assert.deepEqual(
    [ten.migrate, ten.kind, ten.credits, ten.validityDays, ten.priceSgd],
    // The fixture's packs run 1 July to 30 August: 61 days, both counted.
    [null, 'credit_bundle', 10, 61, 250],
    'the commonest count, spread and price — not the one 90-day pack, the discount or the return',
  )
  const trial = proposed['2 Trial Classes for New Joiners']!
  assert.deepEqual([trial.kind, trial.mindbodyNames], ['trial', ['2 Trial Classes For New Joiners', '2 Trial Classes for New Joiners']])
  const plan = proposed['Unlimited 12']!
  assert.deepEqual([plan.kind, plan.durationMonths, plan.credits, plan.priceSgd], ['unlimited', 12, null, 1700])
  assert.equal(proposed['Riverside Studio Access']!.kind, 'access_pass')
  const pt = proposed['PT - Bundle of 10']!
  assert.deepEqual([pt.kind, pt.sessionType, pt.credits, pt.validityDays], ['pt', '1on1', 10, 91], '5 July to 3 October')
  assert.deepEqual([proposed['ClassPass']!.migrate, proposed['ClassPass']!.priceSgd], ['legacy', 0])
  assert.equal(proposed['MAT STORAGE (1 Year)']!.migrate, 'skip')
  assert.equal(proposed['Handstand Workshop - Twin']!.migrate, 'skip')
})

/* ── The timetable to come (#179) ─────────────────────────────────────────── */

/** A class by what it is and when, as the timetable would read it. */
const timetable = (archive: { rows: Record<string, Record<string, unknown>[]> }, ids: Record<string, Record<string, string>>) => {
  const typeName = new Map(archive.rows.class_types!.map(t => [t.id, t.name]))
  const roomName = new Map(archive.rows.rooms!.map(r => [r.id, r.name]))
  const staffName = new Map(archive.rows.staff_users!.map(s => [s.id, s.name]))
  return archive.rows.classes!.map(c => ({
    what: `${typeName.get(c.class_type_id)} ${c.starts_at}`,
    teacher: staffName.get(c.main_instructor_id),
    room: c.room_id === null ? null : roomName.get(c.room_id),
    location: Object.keys(ids.locations!).find(k => ids.locations![k] === c.location_id),
    capacity: c.capacity_online,
    pay: c.instructor_pay_sgd,
    credit: c.credit_cost,
    series: c.series_id,
  }))
}

test('future classes: the whole timetable, empty ones and all, with room, capacity and pay', async () => {
  const { archive, ids } = await run()
  const classes = timetable(archive, ids)
  assert.equal(classes.length, 5, 'only what is still to come, and nothing under a workshop category')

  // 7pm Singapore on 2 January 2090.
  const hatha = classes.find(c => c.what === 'Hatha 2090-01-02T11:00:00.000Z')!
  assert.deepEqual(hatha, {
    what: 'Hatha 2090-01-02T11:00:00.000Z',
    teacher: 'Ivy Instructor',
    room: 'Hot Room',
    location: 'location-1',
    capacity: 15,
    pay: '35.00',
    credit: 1,
    series: hatha.series,
  })
  assert.ok(hatha.series, 'it repeats weekly, so it belongs to the imported series')

  // Nobody booked it, and it is still on the timetable.
  assert.ok(classes.some(c => c.what === 'Hatha 2090-01-23T11:00:00.000Z'))

  // Olive is paid per head, which the platform has no rate for.
  const covered = classes.find(c => c.what === 'Vinyasa Flow 2090-01-03T02:00:00.000Z')!
  assert.deepEqual([covered.teacher, covered.pay], ['Olive Owner', null], 'the substitute *** row is taught by the substitute, Unpriced')

  // Held outdoors: no Room, so the capacity comes from the Class Type.
  const outdoors = classes.find(c => c.what === 'Vinyasa Flow 2090-01-03T23:00:00.000Z')!
  assert.deepEqual([outdoors.room, outdoors.capacity, outdoors.location], [null, 25, 'location-1'])

  assert.ok(!archive.rows.classes!.some(c => c.starts_at! < '2026-09-17'), 'a class already held is the studio s history, not its timetable')
})

test('future bookings: a seat per member, paid by their running package, with a code of its own', async () => {
  const { archive, ids } = await run()
  const classIdOf = (at: string) => archive.rows.classes!.find(c => c.starts_at === at)!.id
  const seats = archive.rows.bookings!.filter(b => b.class_id != null)
  assert.equal(seats.length, 3)

  const jane = seats.find(b => b.client_id === ids.clients!['100000001'])!
  assert.equal(jane.class_id, classIdOf('2090-01-02T11:00:00.000Z'))
  assert.deepEqual([jane.kind, jane.state, jane.check_in_state, jane.refund_outcome], ['class', 'confirmed', 'pending', 'n_a'])
  assert.equal(jane.credits_or_sessions_used, 1, 'cancelling it gives the credit back')
  assert.ok(jane.client_package_id, 'paid by the package the member is running')
  assert.match(String(jane.code), /^RT-[0-9A-Z]{6}$/)
  assert.equal(String(jane.qr_token).length, 43)

  // Rick is on an Unlimited Plan: the seat cost him no credit, so cancelling returns none.
  const rick = seats.find(b => b.client_id === ids.clients!['100000002'])!
  assert.equal(rick.credits_or_sessions_used, 0)

  assert.equal(new Set(archive.rows.bookings!.map(b => b.code)).size, archive.rows.bookings!.length, 'a code is unique within the Tenant')
  assert.equal(new Set(archive.rows.bookings!.map(b => b.qr_token)).size, archive.rows.bookings!.length)

  // One member, two roster rows for the same class (a guest booked beside them): one seat.
  assert.equal(seats.filter(b => b.client_id === ids.clients!['100000001']).length, 1)
  // A Late Cancel is not a seat held.
  assert.ok(!seats.some(b => b.client_id === ids.clients!['100000006']))
})

test('future PT: a scheduled request, a session and a booking, for the member and the instructor', async () => {
  const { archive, ids } = await run()
  assert.equal(archive.rows.pt_sessions!.length, 1)
  const session = archive.rows.pt_sessions![0]!
  const request = archive.rows.pt_requests![0]!
  const booking = archive.rows.bookings!.find(b => b.kind === 'pt')!

  assert.equal(session.starts_at, '2090-01-02T01:00:00.000Z', '9am Singapore')
  assert.equal(session.instructor_id, ids.staff_users!['Olive Owner'])
  assert.deepEqual([session.session_type, session.capacity_online, session.lifecycle], ['1on1', 1, 'active'])
  // Olive is on PT (50%) in Payroll, and Mei's pack cost 1,200.00 for 10 sessions.
  assert.equal(session.instructor_pay_sgd, '60.00', 'the trainer s percentage of what one session of the package is worth')

  assert.equal(request.status, 'scheduled')
  assert.equal(request.scheduled_pt_session_id, session.id)
  assert.equal(request.client_id, ids.clients!['100000008'])
  assert.ok(request.debited_client_package_id, 'their PT bundle paid for it')
  // The focus of a PT request is a Class Type, made where the config has none by that name.
  assert.equal(archive.rows.class_types!.find(t => t.id === request.class_type_id)!.name, 'Personal Training')

  assert.deepEqual(
    archive.rows.pt_session_clients!.map(c => c.client_id),
    [ids.clients!['100000008']],
    'the member is on the session, so it shows on their side too',
  )
  assert.deepEqual([booking.pt_session_id, booking.class_id, booking.state], [session.id, null, 'confirmed'])
})

test('Class Series: a confirmed weekly class is written with its imported classes linked and the last one as its end', async () => {
  const { archive, ids } = await run()
  assert.equal(archive.rows.class_series!.length, 1)
  const series = archive.rows.class_series![0]!
  assert.deepEqual(
    [series.weekday, series.start_time, series.end_time, series.credit_cost, series.capacity_online],
    [1, '19:00:00', '20:00:00', 1, 15],
  )
  assert.equal(series.main_instructor_id, ids.staff_users!['Ivy Instructor'])
  assert.equal(series.instructor_pay_sgd, '35.00')
  // Launch day starts with an extend: the series ends on the last class that came across.
  assert.deepEqual([series.first_date, series.last_date], ['2090-01-02', '2090-01-23'])
  // The 16th has no class, so the series skips it rather than inventing one.
  assert.deepEqual(series.excluded_dates, ['2090-01-16'])

  const linked = archive.rows.classes!.filter(c => c.series_id === series.id)
  assert.deepEqual(
    linked.map(c => c.starts_at).sort(),
    ['2090-01-02T11:00:00.000Z', '2090-01-09T11:00:00.000Z', '2090-01-23T11:00:00.000Z'],
    'extending the series must not duplicate a class that already came across',
  )
})

test('a Class Series whose teacher has no known rate is Unpriced, never 0; one whose rate really is 0 pays 0', async () => {
  const reports = await readReports(REPORTS)
  const seriesPay = (payRates: typeof reports.payRates) => {
    const { archive, preflight } = mapStudio({ ...reports, payRates }, validateConfig(fixtureConfig()), TENANT)
    return { pay: archive.rows.class_series![0]!.instructor_pay_sgd, classes: archive.rows.classes!, preflight }
  }
  const unknown = seriesPay(reports.payRates.filter(r => r.staff !== 'Instructor, Ivy'))
  assert.equal(unknown.pay, null, 'no rate is Unpriced, so its classes show up for pricing')
  assert.ok(unknown.classes.filter(c => c.series_id).every(c => c.instructor_pay_sgd === null))
  assert.ok(
    unknown.preflight.schedule.some(n => /series Hatha, weekday 1 at 19:00: Ivy Instructor has no per-class rate, so the series is Unpriced — its classes, and every class an extend adds, need their pay set/.test(n)),
    unknown.preflight.schedule.join(' | '),
  )
  const unpaid = seriesPay(reports.payRates.map(r => (r.staff === 'Instructor, Ivy' ? { ...r, perClass: 0 } : r)))
  assert.equal(unpaid.pay, '0.00', 'a rate of 0 is a rate')
})

test('future PT: priced from the trainer s PT rate in Payroll — a percentage of the package, or flat — and Unpriced with none', async () => {
  const reports = await readReports(REPORTS)
  const ptPay = (payroll: typeof reports.payroll) => {
    const { archive, preflight } = mapStudio({ ...reports, payroll }, validateConfig(fixtureConfig()), TENANT)
    return { pay: archive.rows.pt_sessions!.find(s => String(s.starts_at) > '2090')!.instructor_pay_sgd, preflight }
  }
  assert.equal(ptPay(reports.payroll).pay, '60.00')

  // A flat PT rate, paid later than the percentage one: the latest rate is the one she is on.
  const flat = {
    staff: 'Owner, Olive',
    date: day(2026, 9, 12),
    start: { hour: 9, minute: 0 },
    description: '',
    earnings: 45,
    table: 'appointment' as const,
    rate: { name: 'PT', percent: null },
    basePay: 45,
  }
  assert.equal(ptPay([...reports.payroll, flat]).pay, '45.00')

  const none = ptPay(reports.payroll.filter(p => p.table !== 'appointment'))
  assert.equal(none.pay, null, 'no PT rate known: Unpriced')
  assert.ok(
    none.preflight.schedule.some(n => /pay: Owner, Olive has 1 future PT session\(s\) and no PT rate in Payroll, so they are Unpriced/.test(n)),
    none.preflight.schedule.join(' | '),
  )
})

test('a per-head class rate the platform cannot hold is named in the preflight, with the classes it leaves Unpriced', async () => {
  const { preflight } = await run()
  assert.ok(
    preflight.schedule.some(n =>
      /pay: Owner, Olive is paid 5\.00 per client in Mindbody, which the platform has no pay rule for — 2 future class\(es\) came across Unpriced/.test(n),
    ),
    preflight.schedule.join(' | '),
  )
})

test('the preflight names a booking with no class, and a member who is not in the member list', async () => {
  const { preflight, preflightText } = await run()
  assert.ok(
    preflight.schedule.some(n => /Mystery Class on 2090-01-05 at 08:00, which is not on the timetable/.test(n)),
    preflight.schedule.join(' | '),
  )
  // Under a workshop category: the workshop import's, not a loose booking.
  assert.ok(
    !preflight.schedule.some(n => /Handstand Workshop.*not on the timetable/.test(n)),
    preflight.schedule.join(' | '),
  )
  assert.ok(preflight.schedule.some(n => /booked twice/.test(n)))
  assert.match(preflightText, /## The timetable and bookings/)
})

test('a series must name a Room, a Class Type and an instructor who is coming across', () => {
  const config = fixtureConfig()
  config.series.push(
    { className: 'Nowhere', weekday: 2, startTime: '10:00', endTime: '09:00', room: 'Nowhere Room', teacher: 'Frank Front', migrate: true },
    { className: 'Hatha', weekday: 3, startTime: '10:00', endTime: '11:00', room: 'Hot Room', teacher: 'Ivy Instructor', migrate: null },
  )
  assert.throws(
    () => validateConfig(config),
    (err: unknown) =>
      err instanceof ConfigError &&
      [
        'series[1] (Nowhere, weekday 2 at 10:00) ends before it starts',
        'series[1] (Nowhere, weekday 2 at 10:00).room "Nowhere Room" names no Room',
        'series[1] (Nowhere, weekday 2 at 10:00).className is in no Class Type',
        'series[1] (Nowhere, weekday 2 at 10:00).teacher "Frank Front" is not a staff member coming across as an active instructor',
        'series[2] (Hatha, weekday 3 at 10:00).migrate is open',
      ].every(p => err.problems.includes(p)),
  )
})

test('the starter config proposes Rooms, class names, workshops, PT names and the weekly classes', async () => {
  const starter = starterConfig(await readReports(REPORTS), '2026-09-17T02:00:00+08:00')
  assert.deepEqual(
    starter.rooms!.map(r => r.name),
    ['Outdoor Yoga', 'Studio 1 - Hot Room', 'Studio2-Normal Room'],
    'one entry per spelling on the timetable — no report says which of them is really an off-site venue, so a person moves that one',
  )
  assert.ok(starter.rooms!.every(r => r.capacity === null && r.location === null))
  assert.deepEqual(starter.classTypes!.map(t => t.name).sort(), ['Hatha', 'Vinyasa flow'])
  assert.deepEqual(starter.classTypes!.find(t => t.name === 'Hatha')!.mindbodyNames, ['HATHA', 'Hatha'])
  assert.deepEqual(starter.workshopCategories, ['Handstand Workshop'])
  assert.deepEqual(starter.ptAppointmentNames, ['Personal Training / PT'])

  // One workshop per category with something still to come, with the room
  // types it was sold by. Everything a person has to decide is left open.
  assert.deepEqual(starter.workshops, [
    {
      category: 'Handstand Workshop',
      name: 'Handstand Workshop',
      location: null,
      capacity: null,
      migrate: null,
      tiers: [
        { name: 'Handstand Workshop - Twin', mindbodyNames: ['Handstand Workshop - Twin'], priceSgd: null },
        {
          name: 'Handstand Workshop - Twin (Deposit)',
          mindbodyNames: ['Handstand Workshop - Twin (Deposit)'],
          priceSgd: null,
        },
        {
          name: 'Handstand Workshop - Upgrade to Single',
          mindbodyNames: ['Handstand Workshop - Upgrade to Single'],
          priceSgd: null,
        },
      ],
    },
  ])

  // Weekly for each of the four weeks up to the download; Vinyasa ran twice, so it is not proposed.
  assert.deepEqual(starter.series, [
    {
      className: 'Hatha',
      weekday: 1,
      startTime: '19:00',
      endTime: '20:00',
      room: 'Studio 1 - Hot Room',
      teacher: 'Ivy Instructor',
      migrate: null,
    },
  ])
})

/* ── Workshops and retreats to come (#180) ────────────────────────────────── */

test('a future workshop: one Day per occurrence, one Tier per room type, and its instructors', async () => {
  const { archive, ids } = await run()
  const [workshop, ...others] = archive.rows.workshops!
  assert.deepEqual(others, [])
  assert.equal(workshop!.name, 'Handstand Workshop')
  assert.equal(workshop!.location_id, ids.locations!['location-1'])
  assert.equal(workshop!.lifecycle, 'active')

  const roomName = new Map(archive.rows.rooms!.map(r => [r.id, r.name]))
  assert.deepEqual(
    archive.rows.workshop_days!.map(d => `${d.ord} ${d.starts_at}–${d.ends_at} ${roomName.get(d.room_id)} ${d.capacity_online}`),
    [
      '1 2090-01-07T01:00:00.000Z–2090-01-07T09:00:00.000Z Hot Room 12',
      '2 2090-01-08T01:00:00.000Z–2090-01-08T09:00:00.000Z Hot Room 12',
    ],
    'both days of it, in order, each in the Room the schedule report gives',
  )

  assert.deepEqual(
    archive.rows.workshop_tiers!.map(t => `${t.ord} ${t.name} ${t.regular_price_sgd}`),
    ['1 Twin room 500.00', '2 Single room 700.00'],
  )
  // A room type is the whole workshop, so every tier grants every day.
  assert.equal(archive.rows.workshop_tier_days!.length, 4)

  // Ivy leads both days and Olive one, so Ivy is the main instructor.
  const staffName = new Map(archive.rows.staff_users!.map(s => [s.id, s.name]))
  assert.deepEqual(
    archive.rows.workshop_instructors!.map(i => `${i.role} ${staffName.get(i.instructor_id)} ${i.pay_sgd}`),
    ['main Ivy Instructor null', 'supporting Olive Owner null'],
  )
})

test('a paid attendee is one booking at the tier they bought, for what they paid', async () => {
  const { archive, ids } = await run()
  const tierName = new Map(archive.rows.workshop_tiers!.map(t => [t.id, t.name]))
  const clientName = new Map(archive.rows.clients!.map(c => [c.id, c.name]))
  const places = archive.rows.bookings!.filter(b => b.kind === 'workshop')

  assert.deepEqual(
    places.map(b => `${clientName.get(b.client_id)} ${tierName.get(b.workshop_tier_id)} paid ${b.amount_paid_sgd} of ${b.list_price_sgd}`),
    [
      // A deposit of 200 on a twin and a 250 top-up to a single: one place, at
      // the single room, for the 450 that was actually paid.
      'Jane Doe Single room paid 450.00 of 700.00',
      'Rick Roe Twin room paid 500.00 of 500.00',
    ],
  )
  for (const place of places) {
    assert.equal(place.workshop_id, archive.rows.workshops![0]!.id)
    assert.deepEqual([place.class_id, place.pt_session_id, place.client_package_id], [null, null, null])
    assert.equal(place.state, 'confirmed')
    // Bought outright: there is no credit to give back.
    assert.equal(place.credits_or_sessions_used, null)
    assert.match(String(place.code), /^RT-[0-9A-Z]{6}$/)
  }
  // Every booking in the studio has a reference of its own, classes and places alike.
  const codes = archive.rows.bookings!.map(b => b.code)
  assert.equal(new Set(codes).size, codes.length)

  const jane = places.find(b => b.client_id === ids.clients!['100000001'])!
  assert.equal(ids.bookings![`${archive.rows.workshops![0]!.id}/100000001`], jane.id)
})

test('a place on a workshop is not a package, and is not left behind either', async () => {
  const { archive, preflight } = await run()
  assert.ok(
    !archive.rows.client_packages!.some(p => /Handstand/i.test(String(p.id))),
    'no package is written for a workshop place',
  )
  assert.ok(
    !preflight.notMigrated.some(n => /Handstand/.test(n.option)),
    `a place that came across as a booking is not "not migrated": ${JSON.stringify(preflight.notMigrated)}`,
  )
  // Two tiers held by one member is something for a person to look at.
  assert.ok(
    preflight.schedule.some(n => /Jane Doe: holds 2 tiers of Handstand Workshop — imported once at Single room, for 450\.00/.test(n)),
    preflight.schedule.join(' | '),
  )
})

test('a workshop with nothing left to come is a preflight line, not an empty Workshop', async () => {
  const config = fixtureConfig()
  // Its days are in 2090; asking for them as of 2091 leaves none.
  config.asOf = '2091-09-17T02:00:00+08:00'
  const { archive, preflight } = await run(config)
  assert.deepEqual(archive.rows.workshops, [])
  assert.deepEqual(archive.rows.workshop_days, [])
  assert.ok(
    preflight.schedule.some(n => /workshop Handstand Workshop: nothing under the service category "Handstand Workshop" is still to come/.test(n)),
    preflight.schedule.join(' | '),
  )

  // Its options are kept out of the catalogue and out of "not migrated" on the
  // promise that they arrive as bookings. With no day left to book, the promise
  // is kept here instead — money still held is never passed over in silence.
  const reports = await readReports(REPORTS)
  const stillGood = reports.holdings.map(h =>
    /^Handstand/.test(h.option) ? { ...h, lastExpiration: { ...h.lastExpiration!, year: 2095 } } : h,
  )
  const late = mapStudio({ ...reports, holdings: stillGood }, validateConfig(config), TENANT)
  assert.deepEqual(
    late.preflight.schedule.filter(n => /which did not come across/.test(n)),
    [
      '100000001 Jane Doe: holds a place on Handstand Workshop worth 450.00, which did not come across',
      '100000002 Rick Roe: holds a place on Handstand Workshop worth 500.00, which did not come across',
    ],
  )
})

test('a place that is spent, or sold with no expiry date, is named rather than silently dropped', async () => {
  const reports = await readReports(REPORTS)
  // Rick's twin place, spent: live no longer, and still 500 of his money.
  const holdings = reports.holdings.map(h =>
    h.clientId === '100000002' && h.option === 'Handstand Workshop - Twin'
      ? { ...h, remaining: { unlimited: false as const, count: 0 }, unbooked: { unlimited: false as const, count: 0 } }
      : h,
  )
  const { archive, preflight } = mapStudio({ ...reports, holdings }, validateConfig(fixtureConfig()), TENANT)

  const places = archive.rows.bookings!.filter(b => b.kind === 'workshop')
  assert.equal(places.length, 1, 'only Jane keeps a place')
  assert.ok(
    preflight.schedule.some(n =>
      /100000002 Rick Roe: paid 500\.00 towards Handstand Workshop and holds nothing live against it, so no place was imported/.test(n),
    ),
    preflight.schedule.join(' | '),
  )
})

test('a workshop coming across must name its Location, capacity and tier prices, and keep its category off the timetable', () => {
  const config = fixtureConfig()
  config.workshopCategories = []
  config.workshops.push({
    category: 'Handstand Workshop',
    name: null,
    location: 'nowhere',
    capacity: null,
    migrate: true,
    tiers: [{ name: null, mindbodyNames: ['Class Pack - Bundle of 20'], priceSgd: null }],
  })
  assert.throws(
    () => validateConfig(config),
    (err: unknown) =>
      err instanceof ConfigError &&
      [
        'workshops[1] (Handstand Workshop): workshops[0] already claims the category "Handstand Workshop"',
        'workshops[0] (Handstand Workshop).category "Handstand Workshop" is not in workshopCategories, so its days would be imported as classes too',
        'workshops[1] (Handstand Workshop).name is open',
        'workshops[1] (Handstand Workshop).location "nowhere" names no Location',
        'workshops[1] (Handstand Workshop).capacity is open',
        'workshops[1] (Handstand Workshop).tiers[0].name is open',
        'workshops[1] (Handstand Workshop).tiers[0].priceSgd is open',
        'workshops[1] (Handstand Workshop).tiers[0]: "Class Pack - Bundle of 20" is also catalogue[1], which is not skipped — a workshop place is not a package',
      ].every(p => err.problems.includes(p)),
  )
})

test('verify: an attendee lost on the way in is named by workshop', async () => {
  const { archive, expected } = await run()
  archive.rows.bookings!.find(b => b.kind === 'workshop')!.state = 'cancelled'
  const differences = await verifyImport(expected, await packArchive(archive))
  assert.ok(
    differences.includes('workshop Handstand Workshop: members booked: expected 2, found 1'),
    differences.join(' | '),
  )
})

test('verify: the archive adds up to its own expected figures, and an altered balance is named by member', async () => {
  const { archive, expected, zip } = await run()
  assert.deepEqual(
    { ...expected, perMember: undefined, perClass: undefined, perWorkshop: undefined, byYear: undefined, revenueByMonth: undefined, refunds: undefined },
    {
      members: 8,
      staffByRole: { admin: 2, instructor: 2 },
      livePackagesByKind: { credit_bundle: 3, unlimited: 1, pt: 1, trial: 1 },
      creditsLeft: 28,
      sessionsLeft: 7,
      classes: 5,
      ptSessions: 1,
      workshops: 1,
      // Four class and PT seats, and the two workshop places.
      bookings: 6,
      perMember: undefined,
      perClass: undefined,
      perWorkshop: undefined,
      byYear: undefined,
      revenueByMonth: undefined,
      refunds: undefined,
      // Three Hatha at 35.00 and Olive's PT at 60.00; her per-head classes are Unpriced.
      payByMonth: { '2090-01': '165.00' },
      // No history is asked for, so no past sale is a Purchase.
      purchasesByMonth: {},
    },
  )
  // No history is asked for, so every class the studio has is still to come.
  assert.deepEqual(expected.byYear, { 2090: { classes: 5, attended: 0, noShows: 0 } })
  // Every class is counted, booked or not, and named by what and when it is.
  assert.deepEqual(
    Object.values(expected.perClass)
      .map(c => `${c.name}: ${c.booked}`)
      .sort(),
    [
      'Hatha at 2090-01-02T11:00:00.000Z: 2',
      'Hatha at 2090-01-09T11:00:00.000Z: 1',
      'Hatha at 2090-01-23T11:00:00.000Z: 0',
      'Vinyasa Flow at 2090-01-03T02:00:00.000Z: 0',
      'Vinyasa Flow at 2090-01-03T23:00:00.000Z: 0',
    ],
  )
  assert.deepEqual(
    Object.values(expected.perWorkshop).map(w => `${w.name}: ${w.booked}`),
    ['workshop Handstand Workshop: 2'],
  )
  assert.deepEqual(await verifyImport(expected, zip), [])

  const jane = archive.rows.client_packages!.find(r => r.credits_or_sessions_remaining === 5)!
  jane.credits_or_sessions_remaining = 4
  const differences = await verifyImport(expected, await packArchive(archive))
  assert.deepEqual(differences, [
    'class credits left, in total: expected 28, found 27',
    'Jane Doe <jane.doe@example.test>: class credits left: expected 25, found 24',
  ])
})

test('verify: a class that lost a seat, and a class that lost itself, are both named', async () => {
  const { archive, expected } = await run()
  const cancelled = archive.rows.bookings!.find(b => b.class_id != null)!
  cancelled.state = 'cancelled'
  archive.rows.classes!.at(-1)!.lifecycle = 'cancelled'
  const differences = await verifyImport(expected, await packArchive(archive))

  assert.ok(
    differences.includes('bookings, in total: expected 6, found 5'),
    `bookings in total must be compared: ${differences.join(' | ')}`,
  )
  assert.ok(differences.some(d => /^classes: expected 5, found 4$/.test(d)), 'a missing class must be counted')
  assert.ok(differences.some(d => /^2090: classes held: expected 5, found 4$/.test(d)), 'and counted against its year')
  assert.ok(differences.some(d => /: in the archive, and not on the timetable$/.test(d)), 'and named')
  assert.ok(differences.some(d => /members booked: expected \d+, found \d+$/.test(d)), 'a lost seat is named by class')
  assert.ok(differences.some(d => /: bookings: expected \d+, found \d+$/.test(d)), 'and by member')
})

/* ── The studio's past (#181) ─────────────────────────────────────────────── */

/** The fixture with history from a cutoff. Purchases are the studio's separate decision. */
const withHistory = (purchases = false, from = '2026-06-01') => {
  const config = fixtureConfig()
  config.history = { from, purchases }
  return config
}

const startsAt = (rows: Record<string, any>[], at: string) => rows.find(r => r.starts_at === at)!

test('no history is asked for by default, so a studio starts on launch day with nothing behind it', async () => {
  const { archive } = await run()
  assert.ok(
    !archive.rows.classes!.some(c => String(c.starts_at) < '2026-09-17'),
    'a class already held is the studio s history, and nobody asked for it',
  )
  assert.deepEqual(archive.rows.check_ins, [])
  assert.deepEqual(archive.rows.cancellations, [])
  assert.ok(archive.rows.client_packages!.every(p => !String(p.id).startsWith('past/')))
})

test('past classes: the schedule report, the sessions only the roster reached, and payroll s own pay', async () => {
  const { archive, ids } = await run(withHistory())
  const past = archive.rows.classes!.filter(c => String(c.starts_at) < '2026-09-17')
  const typeName = new Map(archive.rows.class_types!.map(t => [t.id, t.name]))
  assert.deepEqual(
    past.map(c => `${c.starts_at} ${typeName.get(c.class_type_id)} pay ${c.instructor_pay_sgd}`).sort(),
    [
      // Only the roster knows this one ran: the schedule report was downloaded
      // from August, and a class a member sat in must not be lost to that.
      '2026-07-06T11:00:00.000Z Hatha pay 35.00',
      '2026-08-24T11:00:00.000Z Hatha pay 35.00',
      '2026-08-31T11:00:00.000Z Hatha pay 35.00',
      // What payroll paid that night, not the teacher's standing rate.
      '2026-09-07T11:00:00.000Z Hatha pay 38.00',
      '2026-09-08T02:00:00.000Z Vinyasa Flow pay 48.00',
      '2026-09-10T11:00:00.000Z Hatha pay 40.00',
      // Payroll has no line for it, so it is Unpriced for an admin to settle.
      '2026-09-14T11:00:00.000Z Hatha pay null',
      '2026-09-15T02:00:00.000Z Vinyasa Flow pay 8.00',
    ],
  )
  // Olive is paid per head, and the future has no rate for her at all — yet her
  // past classes carry real money, because payroll says what she was paid.
  assert.equal(startsAt(past, '2026-09-08T02:00:00.000Z').main_instructor_id, ids.staff_users!['Olive Owner'])
  // A past class is a class: the same Room, capacity and credit cost as any other.
  assert.equal(startsAt(past, '2026-08-24T11:00:00.000Z').room_id, ids.rooms!['Hot Room'])
  assert.deepEqual([startsAt(past, '2026-08-24T11:00:00.000Z').capacity_online, startsAt(past, '2026-08-24T11:00:00.000Z').credit_cost], [15, 1])
  assert.ok(past.every(c => c.series_id === null), 'a Class Series is extended forwards, never backwards')
})

test('past bookings: attended is checked in, absent is a no-show, a late cancel is cancelled and forfeited', async () => {
  const { archive, ids } = await run(withHistory())
  const classAt = (at: string) => startsAt(archive.rows.classes!, at).id
  const seat = (barcode: string, at: string) =>
    archive.rows.bookings!.find(b => b.client_id === ids.clients![barcode] && b.class_id === classAt(at))!

  const attended = seat('100000001', '2026-08-24T11:00:00.000Z')
  assert.deepEqual([attended.state, attended.check_in_state, attended.refund_outcome], ['confirmed', 'attended', 'n_a'])
  const checkIn = archive.rows.check_ins!.find(c => c.booking_id === attended.id)!
  assert.deepEqual([checkIn.method, checkIn.checked_in_by_staff_id], ['manual', ids.staff_users!['Olive Owner']])
  assert.equal(checkIn.checked_in_at, '2026-08-24T11:00:00.000Z')

  const absent = seat('100000001', '2026-08-31T11:00:00.000Z')
  assert.deepEqual([absent.state, absent.check_in_state, absent.refund_outcome], ['no_show', 'no_show', 'forfeited'])
  assert.ok(!archive.rows.check_ins!.some(c => c.booking_id === absent.id), 'nobody came, so nobody was checked in')

  const late = seat('100000006', '2026-09-07T11:00:00.000Z')
  assert.deepEqual([late.state, late.check_in_state, late.refund_outcome], ['cancelled', 'n_a', 'forfeited'])
  assert.equal(late.cancelled_at, '2026-09-07T11:00:00.000Z')

  // Booked and never marked either way: a real seat, and not a visit.
  const unmarked = seat('100000005', '2026-09-15T02:00:00.000Z')
  assert.deepEqual([unmarked.state, unmarked.check_in_state], ['confirmed', 'pending'])

  // An early cancellation is a thing that did not happen.
  assert.ok(
    !archive.rows.bookings!.some(b => b.client_id === ids.clients!['100000003'] && b.class_id === classAt('2026-09-08T02:00:00.000Z')),
    'an early cancel is not imported',
  )

  // Every booking in the studio still has a reference of its own, past and future.
  const codes = archive.rows.bookings!.map(b => b.code)
  assert.equal(new Set(codes).size, codes.length)
  assert.equal(new Set(archive.rows.bookings!.map(b => b.qr_token)).size, codes.length)
})

test('an imported late cancel inside the current cap cycle is the studio s, so no member starts over their allowance', async () => {
  const { archive, ids } = await run(withHistory())
  const cancelled = archive.rows.cancellations!
  assert.deepEqual(
    cancelled.map(c => `${c.cancelled_at} ${c.source}`).sort(),
    [
      // Ten weeks back: outside the 30-day cycle, so it was the member's own —
      // at the time the Cancellations report says she cancelled, 90 minutes before class.
      '2026-07-06T09:30:00.000Z client',
      // Inside the cycle the platform counts against the cap: written as the
      // studio's, or the member would arrive having spent an allowance here.
      // The report has no line for it, so it is dated at the class's start.
      '2026-09-07T11:00:00.000Z admin',
    ],
  )
  for (const c of cancelled) {
    assert.deepEqual([c.kind, c.was_within_window, c.was_within_cap, c.refund_fired], ['class', false, true, false])
    assert.ok(archive.rows.bookings!.some(b => b.id === c.booking_id && b.client_id === c.client_id))
  }
  assert.equal(cancelled.find(c => c.source === 'admin')!.client_id, ids.clients!['100000006'])
})

test('a past booking points at the package that paid for it, and only at one that came across', async () => {
  const { archive, ids } = await run(withHistory(true))
  const classAt = (at: string) => startsAt(archive.rows.classes!, at).id
  const seat = (barcode: string, at: string) =>
    archive.rows.bookings!.find(b => b.client_id === ids.clients![barcode] && b.class_id === classAt(at))!
  const packageOf = (booking: Record<string, any>) =>
    archive.rows.client_packages!.find(p => p.id === booking.client_package_id)

  // Jane's July visit was taken from the pack she had that July, not the one
  // she holds today: the purchase whose own run covered the day.
  const july = packageOf(seat('100000001', '2026-07-06T11:00:00.000Z'))!
  assert.deepEqual([july.active, july.amount_paid_sgd], [false, '250.00'])
  assert.equal(july.expires_at, '2026-08-30T15:59:59.000Z')
  // Her August visit falls outside it, so it points at the pack she still holds.
  assert.equal(packageOf(seat('100000001', '2026-08-31T11:00:00.000Z'))!.active, true)

  // An Unlimited Plan was never charged a credit, so there is none to give back.
  assert.equal(seat('100000002', '2026-08-24T11:00:00.000Z').credits_or_sessions_used, 0)
  assert.equal(seat('100000001', '2026-08-24T11:00:00.000Z').credits_or_sessions_used, 1)

  // Mindbody recorded no option for this visit, so the seat names no package
  // rather than guessing one.
  assert.equal(seat('100000005', '2026-09-15T02:00:00.000Z').client_package_id, null)
})

test('past PT is a session, a request that says how it ended, and a booking per member', async () => {
  const { archive, ids } = await run(withHistory())
  const session = archive.rows.pt_sessions!.find(s => String(s.starts_at) < '2026-09-17')!
  assert.equal(session.starts_at, '2026-09-01T01:00:00.000Z', '9am Singapore')
  // The roster booked it for ninety minutes; the attendance report's hour is not the appointment's.
  assert.equal(session.ends_at, '2026-09-01T02:30:00.000Z')
  assert.equal(session.instructor_id, ids.staff_users!['Olive Owner'])
  assert.deepEqual([session.session_type, session.lifecycle, session.instructor_pay_sgd], ['1on1', 'active', null])
  // Ivy booked it for her, and Ivy is coming across.
  assert.equal(session.scheduled_by_staff_id, ids.staff_users!['Ivy Instructor'])

  const request = archive.rows.pt_requests!.find(r => r.scheduled_pt_session_id === session.id)!
  assert.equal(request.status, 'attended', 'Mei came, so the request ended attended')
  assert.equal(request.client_id, ids.clients!['100000008'])
  assert.ok(request.debited_client_package_id, 'her PT bundle paid for it')
  assert.equal(request.message, 'Left knee: no deep lunges', 'the appointment s notes')
  assert.equal(request.resolved_by_staff_id, ids.staff_users!['Ivy Instructor'])

  const booking = archive.rows.bookings!.find(b => b.pt_session_id === session.id)!
  assert.deepEqual([booking.state, booking.check_in_state], ['confirmed', 'attended'])
  assert.ok(archive.rows.check_ins!.some(c => c.booking_id === booking.id))
  assert.deepEqual(
    archive.rows.pt_session_clients!.filter(c => c.pt_session_id === session.id).map(c => c.client_id),
    [ids.clients!['100000008']],
  )
})

test('past purchases are a separate opt-in, one per sale line, on the member whose id is on the sale, dated when it was sold', async () => {
  const without = await run(withHistory(false))
  assert.ok(
    !without.archive.rows.client_packages!.some(p => p.amount_paid_sgd === '250.00' && p.active === false),
    'without the opt-in the studio has no pre-launch revenue',
  )
  assert.deepEqual(without.archive.rows.purchases, [])

  const { archive, ids } = await run(withHistory(true))
  const who = new Map(Object.entries(ids.clients!).map(([barcode, id]) => [id as string, barcode]))
  const past = archive.rows.client_packages!.filter(p => p.active === false && p.kind === 'credit_bundle')
  assert.deepEqual(
    past
      .map(p => `${who.get(String(p.client_id))} ${p.amount_paid_sgd} ${p.list_price_sgd} ${p.purchased_at} ${p.expires_at} ${p.complimentary}`)
      .sort(),
    [
      '100000001 250.00 250.00 2026-06-30T16:00:00.000Z 2026-08-30T15:59:59.000Z false',
      // Two sales of one pack on two dates are two packages, each on its own
      // sale date. The June one is in no register row, so it runs its validity
      // from the day it was sold.
      '100000002 0.00 0.00 2026-07-03T16:00:00.000Z 2026-07-13T15:59:59.000Z true',
      '100000002 240.00 240.00 2026-06-01T16:00:00.000Z 2026-07-31T15:59:59.000Z false',
      '100000002 250.00 250.00 2026-06-30T16:00:00.000Z 2026-08-30T15:59:59.000Z false',
      // Spent but not yet expired, so Visits Remaining does not hold it either:
      // without this it would be money the studio took and nobody counted.
      '100000005 250.00 250.00 2026-06-30T16:00:00.000Z 2026-09-30T15:59:59.000Z false',
    ],
    'List Price is what was paid; the $0 ClassPass the register never listed is Complimentary, not a pack at 100% off',
  )
  assert.equal(past.filter(p => p.source_class_package_id === ids.class_packages!['Class Pack - Bundle of 10']).length, 4)
  // A purchase still live at the download already came across as a live package.
  assert.equal(archive.rows.client_packages!.filter(p => p.source_pt_package_id != null).length, 1)
})

test('two members of one name are never swapped: each past purchase is on the member whose id is on the sale', async () => {
  const reports = await readReports(REPORTS)
  // A second Rick Roe, with no phone to tell the two apart in the register.
  reports.members.push({ id: '100000009', firstName: 'Rick', lastName: 'Roe', email: 'rick.two@example.test', phone: '', mobile: '', country: '' })
  const day = (year: number, month: number, d: number) => ({ year, month, day: d, hour: 0, minute: 0, second: 0 })
  reports.sales.push({
    clientId: '100000009',
    saleId: '7650',
    soldAt: day(2026, 7, 10),
    description: 'Class Pack -  Bundle of 10',
    location: 'Main Hall',
    quantity: 1,
    total: 230,
  })
  reports.optionSales.push({
    client: 'Roe, Rick',
    phone: '',
    option: 'Class Pack -  Bundle of 10',
    activation: day(2026, 7, 10),
    expiration: day(2026, 9, 7),
    paid: 230,
    remaining: { unlimited: false, count: 0 },
  })
  const { archive, ids } = mapStudio(reports, validateConfig(withHistory(true)), TENANT)
  const paidBy = (barcode: string) =>
    archive.rows.client_packages!
      .filter(p => p.client_id === ids.clients![barcode] && p.active === false && p.kind === 'credit_bundle')
      .map(p => `${p.amount_paid_sgd} ${p.purchased_at} ${p.expires_at}`)
      .sort()
  assert.deepEqual(paidBy('100000009'), ['230.00 2026-07-09T16:00:00.000Z 2026-09-07T15:59:59.000Z'])
  assert.deepEqual(paidBy('100000002'), [
    '0.00 2026-07-03T16:00:00.000Z 2026-07-13T15:59:59.000Z',
    '240.00 2026-06-01T16:00:00.000Z 2026-07-31T15:59:59.000Z',
    '250.00 2026-06-30T16:00:00.000Z 2026-08-30T15:59:59.000Z',
  ])
})

test('a sale and its return are one past purchase with one Refund, on a Purchase no payment provider ever saw', async () => {
  const { archive, ids, preflight } = await run(withHistory(true))
  const returned = archive.rows.client_packages!.find(
    p => p.client_id === ids.clients!['100000002'] && p.purchased_at === '2026-06-30T16:00:00.000Z' && p.kind === 'credit_bundle',
  )!
  assert.equal(returned.active, false, 'a refunded purchase is not a live package')
  assert.ok(returned.purchase_id)
  // Every paid past sale is a Purchase now (#284); the return closes this one as refunded.
  assert.deepEqual(archive.rows.purchases!.filter(p => p.status === 'refunded'), [
    {
      id: returned.purchase_id,
      tenant_id: TENANT,
      client_id: ids.clients!['100000002'],
      kind: 'class_package',
      total_sgd: '250.00',
      amount_paid_sgd: '0.00',
      status: 'refunded',
      settled_at: '2026-06-30T16:00:00.000Z',
      // 3 July, the day of the return, at the studio.
      refunded_at: '2026-07-02T16:00:00.000Z',
      created_at: '2026-06-30T16:00:00.000Z',
      source_sale_id: '7620',
      // The fixture's Sales report has no row for this sale.
      offline_method: null,
      offline_method_label: null,
    },
  ])
  // No second package for the return: the one it reverses is the only one on its Purchase.
  assert.equal(archive.rows.client_packages!.filter(p => p.purchase_id === returned.purchase_id).length, 1)
  assert.ok(preflight.schedule.includes('history purchases: 1 return(s) came across as a Refund on the purchase each reverses'), preflight.schedule.join(' | '))
  // A return with nothing in the window to reverse is named, not guessed onto another sale.
  assert.ok(
    preflight.schedule.includes(
      'history purchases: a return of "Class Pack - Bundle of 20" on 2026-07-20 for Kim Lee (100000005), -450.00, reverses no sale, so no Refund was written',
    ),
    preflight.schedule.join(' | '),
  )
  assert.deepEqual(constraintViolations(archive), [])
})

test('sale lines that cannot be placed are counted in the preflight with their money', async () => {
  const { preflight } = await run(withHistory(true))
  const lines = preflight.schedule.filter(n => n.startsWith('history purchases:'))
  assert.ok(lines.includes('history purchases: 2 sale line(s) totalling 265.00 were not placed on any member\'s package'), lines.join(' | '))
  assert.ok(lines.includes('history purchases: "Class Pack - Bundle of 10" — client 100000099 is not in the member list — 1 sale line(s), 250.00'), lines.join(' | '))
  assert.ok(lines.includes('history purchases: "Towel Service" — in no catalogue entry — 1 sale line(s), 15.00'), lines.join(' | '))
  // Only a plan holds a Location here; a pack's sale Location is said to be lost, not quietly dropped.
  assert.ok(lines.some(l => /^history purchases: 5 past package\(s\) were sold at a Location, which is not recorded/.test(l)), lines.join(' | '))

  // A return whose sale is before the cutoff has nothing here to refund, and is counted rather than lost.
  const cut = await run(withHistory(true, '2025-01-15'))
  assert.ok(
    cut.preflight.schedule.includes(
      'history purchases: "Class Pack - Bundle of 10" — returns a sale from before 2025-01-15, which did not come across — 1 sale line(s), -250.00',
    ),
    cut.preflight.schedule.join(' | '),
  )
})

test('a promotion is the only discount: a promo sale s List Price is what was paid plus what the promotion took off', async () => {
  const { archive, ids } = await run()
  const promoted = archive.rows.client_packages!.find(r => r.id === ids.client_packages!['100000001/Class Pack - Bundle of 20'])!
  assert.deepEqual([promoted.amount_paid_sgd, promoted.list_price_sgd, promoted.complimentary], ['450.00', '500.00', false])
  const discounted = archive.rows.client_packages!.filter(p => p.list_price_sgd !== p.amount_paid_sgd)
  assert.deepEqual(discounted.map(p => p.id), [promoted.id], 'no other package shows a discount')

  // Without the Promotions report the sale reads as sold at what was paid.
  const reports = await readReports(REPORTS)
  const plain = mapStudio({ ...reports, promotions: [] }, validateConfig(fixtureConfig()), TENANT)
  const again = plain.archive.rows.client_packages!.find(r => r.id === plain.ids.client_packages!['100000001/Class Pack - Bundle of 20'])!
  assert.equal(again.list_price_sgd, '450.00')
})

test('verify: a lost refund, and a month whose revenue moved, are each named', async () => {
  const { archive, expected, zip } = await run(withHistory(true))
  assert.deepEqual(await verifyImport(expected, zip), [])
  assert.equal(
    expected.revenueByMonth['2026-07'],
    3 * 25000 + 120000,
    'three class packs sold in July and a PT pack that started then; the $0 ClassPass is not revenue',
  )
  assert.deepEqual(Object.values(expected.refunds), [{ name: 'the refund to Rick Roe <rick.roe@example.test> on 2026-07-03', cents: 25000 }])

  const moved = archive.rows.client_packages!.find(p => p.purchased_at === '2026-06-01T16:00:00.000Z' && p.kind === 'credit_bundle')!
  moved.purchased_at = '2026-07-01T16:00:00.000Z'
  archive.rows.purchases = []
  archive.manifest.counts.purchases = 0
  const differences = await verifyImport(expected, await packArchive(archive))
  assert.ok(differences.includes('2026-06: revenue: expected 1940.00, found 1700.00'), differences.join(' | '))
  assert.ok(differences.includes('2026-07: revenue: expected 1950.00, found 2190.00'), differences.join(' | '))
  assert.ok(
    differences.includes('the refund to Rick Roe <rick.roe@example.test> on 2026-07-03: 250.00 in the archive, and no such refund in the studio'),
    differences.join(' | '),
  )
})

test('history reaching back to a member s trial does not write them a second one', async () => {
  // A trial bought in 2023, in the window and long used up. A member has one
  // trial ever — the platform holds them to it — and it came across already.
  const { archive, ids, preflight } = await run(withHistory(true, '2023-01-01'))
  const trials = archive.rows.client_packages!.filter(p => p.kind === 'trial')
  assert.equal(new Set(trials.map(p => p.client_id)).size, trials.length, 'no member holds two trials')
  assert.equal(trials.filter(p => p.client_id === ids.clients!['100000001']).length, 1)
  // The money it took is named, so it is not simply missing from Finance.
  assert.ok(
    preflight.schedule.includes(
      'history purchases: Jane Doe (100000001) — 2 Trial Classes for New Joiners, 10.00 — a trial for a member who already came across holding one, so the money is not in Finance; a member may hold only one trial ever',
    ),
    preflight.schedule.join(' | '),
  )

  // A name Mindbody writes as ".,  Legacy" in the register is the member whose
  // surname is blank: the sale's id says so, and the register lends its dates.
  const legacy = archive.rows.client_packages!.filter(p => p.client_id === ids.clients!.AB123456 && p.active === false)
  assert.deepEqual(legacy.map(p => [p.amount_paid_sgd, p.expires_at]), [['250.00', '2023-12-31T15:59:59.000Z']])
})

test('the cutoff is the only thing that decides how far back the studio goes', async () => {
  const early = await run(withHistory(false, '2026-06-01'))
  const late = await run(withHistory(false, '2026-09-01'))
  const pastOf = (archive: { rows: Record<string, Record<string, unknown>[]> }) =>
    archive.rows.classes!.filter(c => String(c.starts_at) < '2026-09-17').length
  assert.equal(pastOf(early.archive), 8)
  assert.equal(pastOf(late.archive), 5, 'only September')

  await assert.rejects(run(withHistory(false, '2027-01-01')), (err: unknown) => {
    assert.ok(err instanceof ConfigError)
    assert.ok(err.problems.some(p => /history\.from "2027-01-01" is after the download/.test(p)), err.problems.join(' | '))
    return true
  })
})

test('history that could not be placed is a preflight line, not a refusal', async () => {
  const { preflight } = await run(withHistory())
  assert.ok(
    preflight.schedule.some(n => /history: 1 visit\(s\) on Ghost Class on 2026-08-20 at 08:00, which is not among the classes that came across/.test(n)),
    preflight.schedule.join(' | '),
  )
  // A seat on a class that has been and gone and was never marked either way
  // is a real seat, and not a visit. It comes across, and it is named.
  assert.ok(
    preflight.schedule.some(n =>
      /history: 1 seat\(s\) on a class that has been and gone are still "Reserved" in Mindbody, so they came across booked and never checked in/.test(n),
    ),
    preflight.schedule.join(' | '),
  )
})

test('history asked for without the two reports it is made of says so, rather than arriving empty in silence', async () => {
  const reports = await readReports(REPORTS)
  const { archive, preflight } = mapStudio(
    { ...reports, attendance: [], payroll: [] },
    validateConfig(withHistory()),
    TENANT,
  )
  // The classes still came across — the schedule report has them — with nobody
  // on them and no pay, which is exactly what the two lines say.
  assert.ok(archive.rows.classes!.some(c => String(c.starts_at) < '2026-09-17'))
  assert.deepEqual(archive.rows.check_ins, [])
  assert.ok(preflight.schedule.some(n => /no Attendance \(Date\) report was downloaded/.test(n)), preflight.schedule.join(' | '))
  assert.ok(preflight.schedule.some(n => /no Payroll \(Detail\) report was downloaded/.test(n)), preflight.schedule.join(' | '))
})

test('the expected figures gain the studio s past, year by year, and verify compares them', async () => {
  const { archive, expected, zip } = await run(withHistory())
  assert.deepEqual(expected.byYear, {
    // Eight classes held, three visits, two no-shows — the year the studio is
    // leaving behind, as its own reports add it up.
    2026: { classes: 8, attended: 3, noShows: 2 },
    2090: { classes: 5, attended: 0, noShows: 0 },
  })
  assert.deepEqual(await verifyImport(expected, zip), [])

  // A year lost on the way in is named by its year, not buried in one total.
  const lost = archive.rows.bookings!.find(b => b.check_in_state === 'attended' && b.class_id != null)!
  lost.check_in_state = 'pending'
  const differences = await verifyImport(expected, await packArchive(archive))
  assert.ok(differences.includes('2026: visits attended: expected 3, found 2'), differences.join(' | '))
})

test('with history, the same inputs still give the same zip, byte for byte', async () => {
  const [a, b] = [await run(withHistory(true)), await run(withHistory(true))]
  assert.ok(a.zip.equals(b.zip))
})

/* ── Admins, shared room spellings, which file is which ───────────────────── */

test('admins: each an active Admin with no invitation, and one Mindbody never listed is a staff row of their own', async () => {
  const config = fixtureConfig()
  config.studio.admins = [
    { email: 'Frank@example.test', name: null },
    { email: 'helper@agency.example', name: 'Agency Helper' },
  ]
  const { archive, ids } = await run(config)
  const byEmail = (email: string) => archive.rows.staff_users!.find(r => r.email === email)!

  const frank = byEmail('frank@example.test')
  assert.deepEqual([frank.role, frank.status, frank.invited_at], ['admin', 'active', null], 'a migrated staff member listed as an admin')
  const helper = byEmail('helper@agency.example')
  assert.deepEqual([helper.role, helper.status, helper.name, helper.invited_at], ['admin', 'active', 'Agency Helper', null])
  assert.equal(ids.staff_users!['helper@agency.example'], helper.id)
  assert.equal(archive.rows.staff_users!.length, 5, 'the four migrated staff, and the one admin Mindbody never listed')
  assert.deepEqual(
    archive.rows.staff_invitations!.map(r => r.email),
    ['ivy@example.test'],
    'nobody who can already sign in is sent an invitation',
  )
  assert.ok(!archive.rows.instructors!.some(r => r.staff_user_id === helper.id), 'an admin who teaches nothing is no instructor')
})

test('staffOnboarding active: staff with an email are active with no invitation; one with none is active by name with no login', async () => {
  const config = fixtureConfig()
  config.staffOnboarding = 'active'
  config.staff.push({ mindbodyName: 'Nora Noemail', migrate: 'active', email: null, role: 'instructor', teaches: true, noLogin: true })
  const { archive, ids, preflight, preflightText } = await run(config)
  const staff = (name: string) => archive.rows.staff_users!.find(r => r.id === ids.staff_users![name])!

  assert.deepEqual([staff('Ivy Instructor').status, staff('Ivy Instructor').invited_at], ['active', null])
  assert.deepEqual([staff('Frank Front').status, staff('Frank Front').role], ['active', 'admin'])
  assert.equal(archive.rows.staff_invitations!.length, 0, 'nobody is sent an invitation')

  const nora = staff('Nora Noemail')
  assert.deepEqual([nora.name, nora.status, nora.role, nora.invited_at], ['Nora Noemail', 'active', 'instructor', null])
  assert.match(nora.email as string, /@no-email\.invalid$/, 'an address nobody receives, so nobody can sign in as her')
  assert.ok(archive.rows.instructors!.some(r => r.staff_user_id === nora.id), 'she can lead a class')
  assert.deepEqual(preflight.staffWithoutLogin.map(s => s.name), ['Nora Noemail'])
  assert.match(preflightText, /Staff with no email: imported by name, with no login \(1\)/)

  // The default still invites, and a staff member with no email is never invited.
  const invited = await run((() => {
    const c = fixtureConfig()
    c.staff.push({ mindbodyName: 'Nora Noemail', migrate: 'active', email: null, role: 'instructor', teaches: true, noLogin: true })
    return c
  })())
  assert.deepEqual(invited.archive.rows.staff_invitations!.map(r => r.email).sort(), ['frank@example.test', 'ivy@example.test'])
})

test('the owner may be an admin Mindbody never listed, and is who created what the import writes', async () => {
  const config = fixtureConfig()
  config.studio.ownerEmail = 'boss@agency.example'
  config.studio.admins = [{ email: 'boss@agency.example', name: 'Boss Person' }]
  const { archive } = await run(config)
  const boss = archive.rows.staff_users!.find(r => r.email === 'boss@agency.example')!
  assert.deepEqual([boss.role, boss.status], ['admin', 'active'])
  assert.ok(archive.rows.classes!.every(c => c.created_by_staff_id === boss.id))
  const olive = archive.rows.staff_users!.find(r => r.email === 'owner@example.test')!
  assert.deepEqual([olive.role, olive.status], ['admin', 'pending'], 'no longer the owner, so invited like everyone else')

  const unlisted = fixtureConfig()
  unlisted.studio.ownerEmail = 'boss@agency.example'
  assert.throws(() => validateConfig(unlisted), /boss@agency\.example is not the email of any staff member being migrated as active, nor one of studio\.admins/)
  const teaching = fixtureConfig()
  teaching.studio.admins = [{ email: 'ivy@example.test', name: null }]
  assert.throws(() => validateConfig(teaching), /Ivy Instructor\) is in studio\.admins, so their role must be admin/)
})

test('two Rooms Mindbody files under one spelling are told apart by Class Type', async () => {
  const config = fixtureConfig()
  // "Studio2-Normal Room" is now also where Mindbody files the Flow Room's classes.
  config.rooms.push({ name: 'Flow Room', location: 'location-2', capacity: 9, mindbodyNames: ['Studio2-Normal Room'], classTypes: ['Vinyasa flow'] })
  const { archive, ids } = await run(config)
  const classes = timetable(archive, ids)
  const flow = classes.find(c => c.what === 'Vinyasa Flow 2090-01-03T02:00:00.000Z')!
  assert.deepEqual([flow.room, flow.location, flow.capacity], ['Flow Room', 'location-2', 25], 'the Class Type decides, and the Room its Location')
  assert.ok(classes.filter(c => c.what.startsWith('Hatha')).every(c => c.room === 'Hot Room'), 'a spelling one Room holds alone is untouched')

  const twoFallbacks = fixtureConfig()
  twoFallbacks.rooms.push({ name: 'Flow Room', location: 'location-2', capacity: 9, mindbodyNames: ['Studio2-Normal Room'] })
  assert.throws(() => validateConfig(twoFallbacks), /room spelling "studio2-normal room" is mapped to two Rooms/)
  const unknownType = fixtureConfig()
  unknownType.rooms.push({ name: 'Flow Room', location: 'location-2', capacity: 9, mindbodyNames: ['Studio2-Normal Room'], classTypes: ['Yin'] })
  assert.throws(() => validateConfig(unknownType), /rooms\[3\] \(Flow Room\)\.classTypes: "Yin" is in no Class Type/)
})

test('the starter config names the Locations the timetable names, oldest first, and puts each Room at its own', async () => {
  const reports = await readReports(REPORTS)
  // The fixture's Outdoor Yoga classes are at a second Location, opened later.
  const schedule = reports.schedule.map(r => (r.room === 'Outdoor Yoga' ? { ...r, location: 'Riverside' } : r))
  const starter = starterConfig({ ...reports, schedule }, '2026-09-17T02:00:00+08:00')
  assert.deepEqual(
    starter.locations.map(l => [l.key, l.name, l.mindbodyIds, l.mindbodyNames]),
    [
      ['location-1', 'Main Hall', ['1'], ['Main Hall']],
      ['location-2', 'Riverside', ['2'], ['Riverside']],
    ],
  )
  assert.deepEqual(
    starter.rooms!.map(r => [r.name, r.location]),
    [
      ['Outdoor Yoga', 'location-2'],
      ['Studio 1 - Hot Room', 'location-1'],
      ['Studio2-Normal Room', 'location-1'],
    ],
  )
})

test('report-files.json: every file the cutover download writes matches exactly its own report, and the rules agree', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', 'report-files.json'), 'utf8')) as {
    files: { kind: keyof typeof REPORT_FILES; file: string; single: boolean; required: boolean }[]
  }
  // Every report the transform reads is in the manifest once, with the transform's own rules.
  assert.deepEqual(manifest.files.map(f => f.kind).sort(), Object.keys(REPORT_FILES).sort())
  for (const entry of manifest.files) {
    assert.deepEqual({ single: entry.single, required: entry.required }, REPORT_RULES[entry.kind], entry.kind)
    // A per-year or per-group file is several files; a single report is never one.
    assert.equal(/<year>|<group>|<piece>/.test(entry.file), !entry.single, `${entry.kind}: ${entry.file}`)
    for (const sample of ['2023', '2027', 'Other', 'Unassigned', '2024-03', '2023-Q2', '2024-01-15 wk']) {
      const name = entry.file.replace('<year>', sample).replace('<group>', sample).replace('<piece>', sample)
      const matched = Object.entries(REPORT_FILES).filter(([, r]) => r.test(name)).map(([k]) => k)
      assert.deepEqual(matched, [entry.kind], `${name} must be read as ${entry.kind} and nothing else`)
    }
  }
  // The files the download also writes and nothing reads stay unread.
  for (const extra of [
    '21 Referral Types - All Referrers-Summary.xls',
    '01 Membership - Old Version (totals).xls',
  ]) {
    assert.deepEqual(Object.entries(REPORT_FILES).filter(([, r]) => r.test(extra)), [], extra)
  }
})

test('history reads the Date view of Attendance without Revenue, and none of the views that repeat it', () => {
  const attendance = (f: string) => REPORT_FILES.attendance.test(f)
  assert.ok(attendance('16 Attendance without Revenue - Date.xlsx'))
  assert.ok(attendance('16 Attendance - Date - 2026.xlsx'), 'one file per year')
  for (const copy of ['Client', 'Staff member', 'Visit type', 'No-shows-late cancels', 'Service category', 'Summary', 'Roll sheet']) {
    assert.ok(!attendance(`16 Attendance without Revenue - ${copy}.xlsx`), copy)
  }
  assert.ok(!attendance('12 Attendance Analysis - Day and Time - Detail.xlsx'))
  assert.ok(REPORT_FILES.payroll.test('32 Payroll - Detail - 2026.xls'))
  assert.ok(!REPORT_FILES.payroll.test('32 Payroll - Summary by Pay Rate.xls'))
})

/* ── The database's rules, checked before the zip is written ─────────────── */

test('a past Unlimited Plan purchase keeps a Home Location, and the archive keeps every CHECK rule', async () => {
  const { archive, ids } = await run(withHistory(true))
  const past = archive.rows.client_packages!.filter(p => p.kind === 'unlimited' && p.active === false)
  assert.ok(past.length > 0, 'the fixture has a past plan purchase')
  assert.ok(past.every(p => p.location_id === ids.locations!['location-2']), 'homed where it was sold: the platform requires a Home Location')
  assert.deepEqual(constraintViolations(archive), [])
})

test('a row the database would refuse stops the transform, naming the rule and the rows', async () => {
  const { archive } = await run(withHistory(true))
  const broken = structuredClone(archive)
  broken.rows.client_packages![0]!.credits_or_sessions_remaining = -1
  const plan = broken.rows.client_packages!.find(p => p.kind === 'unlimited')!
  plan.location_id = null
  broken.rows.classes![0]!.ends_at = broken.rows.classes![0]!.starts_at
  assert.deepEqual(
    constraintViolations(broken).map(v => v.replace(/ \(first id .*\)$/, '')),
    [
      'client_packages.client_packages_non_negative_balance: 1 row(s)',
      'client_packages.client_packages_kind_fields: 1 row(s)',
      'classes.classes_ends_after_starts: 1 row(s)',
    ],
  )
})

/* ── The register, set-aside credits, payroll, cancellations, PT rooms ─────── */

const day = (year: number, month: number, d: number, hour = 0, minute = 0) => ({ year, month, day: d, hour, minute, second: 0 })
const sale = (over: Partial<OptionSaleRow>): OptionSaleRow => ({
  client: 'Doe, Jane',
  phone: '+6591234567',
  option: 'Class Pack -  Bundle of 10',
  activation: day(2026, 8, 1),
  expiration: day(2090, 3, 1),
  paid: 250,
  remaining: { unlimited: false, count: 1 },
  ...over,
})

test('the register is joined to members by name, and by phone only where a name is shared; nothing else is guessed', () => {
  const members = [
    { id: '1', firstName: 'Jane', lastName: 'Doe', email: null, phone: '+6591234567' },
    { id: '2', firstName: 'Kim', lastName: 'Lee', email: null, phone: '+6590000001' },
    { id: '3', firstName: 'Kim', lastName: 'Lee', email: null, phone: '+6590000002' },
  ].map(m => ({ ...m, mobile: m.phone, country: 'SG' }))
  const who = registerMatcher(members)
  assert.deepEqual(who(sale({ client: 'Doe, Jane', phone: '' })), { clientId: '1', outcome: 'matched' }, 'one member of that name')
  assert.deepEqual(who(sale({ client: 'Lee, Kim', phone: '+6590000002' })), { clientId: '3', outcome: 'matched' }, 'the phone tells two apart')
  assert.deepEqual(who(sale({ client: 'Lee, Kim', phone: '' })), { clientId: null, outcome: 'ambiguous' })
  assert.deepEqual(who(sale({ client: 'Lee, Kim', phone: '+6599999999' })), { clientId: null, outcome: 'ambiguous' })
  assert.deepEqual(who(sale({ client: 'Nobody, Ghost' })), { clientId: null, outcome: 'unmatched' })
})

test('credits Mindbody set aside for future bookings that did not come across are given back, and the preflight says why', async () => {
  const reports = await readReports(REPORTS)
  // Jane's pack: Mindbody set aside 3 credits (8 left, 5 unbooked); only one booking on it came across.
  const holdings = reports.holdings.map(h =>
    h.clientId === '100000001' && /bundle of 10/i.test(h.option) ? { ...h, remaining: { unlimited: false as const, count: 8 } } : h,
  )
  const { archive, ids, preflight } = mapStudio({ ...reports, holdings, roster: [] }, validateConfig(fixtureConfig()), TENANT)
  const pack = archive.rows.client_packages!.find(r => r.id === ids.client_packages!['100000001/Class Pack - Bundle of 10'])!
  assert.equal(pack.credits_or_sessions_remaining, 8, 'no roster: every credit set aside is given back')
  assert.ok(
    preflight.schedule.some(n => /3 credit\(s\) on 1 package\(s\).*given back.*Schedule at a Glance ends \(not downloaded\)/.test(n)),
    preflight.schedule.join(' | '),
  )

  // With the roster, the one booking that came across keeps its credit spent.
  const withRoster = mapStudio({ ...reports, holdings }, validateConfig(fixtureConfig()), TENANT)
  const again = withRoster.archive.rows.client_packages!.find(r => r.id === withRoster.ids.client_packages!['100000001/Class Pack - Bundle of 10'])!
  assert.equal(again.credits_or_sessions_remaining, 7, '5 unbooked, 1 spent by the booking that came across, 2 given back')
})

test('a holding Mindbody combined is split back into its purchases, each with its own expiry, credits and price', async () => {
  const reports = await readReports(REPORTS)
  // Jane's 6 credits (5 unbooked) are two purchases: 2 ending sooner, 4 later.
  const optionSales = [
    ...reports.optionSales.filter(s => !(s.client === 'Doe, Jane' && /bundle of 10/i.test(s.option))),
    sale({ activation: day(2026, 8, 1), expiration: day(2090, 2, 1), paid: 240, remaining: { unlimited: false, count: 2 } }),
    sale({ activation: day(2026, 9, 1), expiration: day(2090, 3, 1), paid: 260, remaining: { unlimited: false, count: 4 } }),
  ]
  const { archive, ids, preflight } = mapStudio({ ...reports, optionSales }, validateConfig(fixtureConfig()), TENANT)
  const first = archive.rows.client_packages!.find(r => r.id === ids.client_packages!['100000001/Class Pack - Bundle of 10'])!
  const second = archive.rows.client_packages!.find(r => r.id === ids.client_packages!['100000001/Class Pack - Bundle of 10#2'])!
  assert.deepEqual(
    [first.credits_or_sessions_remaining, first.expires_at, first.amount_paid_sgd],
    [1, '2090-02-01T15:59:59.000Z', '240.00'],
    'the sooner purchase runs, and the credit set aside for the booking comes off it',
  )
  assert.deepEqual([second.credits_or_sessions_remaining, second.expires_at, second.amount_paid_sgd], [4, null, '260.00'], 'the later one waits')
  assert.ok(preflight.schedule.some(n => /1 holding\(s\) Mindbody combined were split back into their 2 purchases/.test(n)))

  // A register that does not account for the holding exactly leaves it combined, as Mindbody shows it.
  const short = mapStudio({ ...reports, optionSales: optionSales.slice(0, -1) }, validateConfig(fixtureConfig()), TENANT)
  assert.equal(short.ids.client_packages!['100000001/Class Pack - Bundle of 10#2'], undefined)
})

test('history: PT carries what payroll paid, and its Room from the roster; payroll with nothing to belong to is reported', async () => {
  const reports = await readReports(REPORTS)
  const pt = { description: '', table: 'appointment' as const, rate: { name: 'PT', percent: 50 }, basePay: null }
  const payroll = [
    ...reports.payroll,
    { ...pt, staff: 'Owner, Olive', date: day(2026, 9, 1), start: { hour: 9, minute: 0 }, earnings: 60 },
    { ...pt, staff: 'Owner, Olive', date: day(2026, 8, 30), start: null, earnings: 1000 },
    // Paid to somebody who is not coming across: nobody to write it against.
    { ...pt, staff: 'Gone, Greta', date: day(2026, 8, 30), start: null, earnings: 7 },
  ]
  const roster = [
    ...reports.roster,
    {
      date: { year: 2026, month: 9, day: 1 },
      start: { hour: 9, minute: 0 },
      end: { hour: 10, minute: 0 },
      description: 'Personal Training / PT',
      staff: 'Owner, Olive',
      room: 'Studio 1 - Hot Room',
      location: 'Main Hall',
      clientId: '100000008',
      status: 'Signed in',
      notes: '',
      scheduledBy: 'Client',
    },
  ]
  const { archive, ids, preflight } = mapStudio({ ...reports, payroll, roster }, validateConfig(withHistory()), TENANT)
  const session = archive.rows.pt_sessions!.find(s => s.starts_at === '2026-09-01T01:00:00.000Z')!
  assert.equal(session.instructor_pay_sgd, '60.00')
  assert.equal(session.room_id, ids.rooms!['Hot Room'])
  assert.ok(
    archive.rows.manual_payroll_entries!.some(e => e.amount_sgd === '1100.00' && e.instructor_id === ids.staff_users!['Olive Owner']),
    'a retreat share at no set time is a Manual Entry, with the other one of that day',
  )
  assert.ok(
    preflight.schedule.some(n => /history payroll: 7\.00 Gone, Greta — is not coming across, so it was not imported/.test(n)),
    preflight.schedule.join(' | '),
  )
  assert.ok(
    preflight.schedule.some(n =>
      /history payroll: 1490\.00 paid from 2026-06-01; 299\.00 is on the classes and PT sessions that came across, 1184\.00 on 3 Manual Payroll Entries, 7\.00 is not/.test(n),
    ),
    preflight.schedule.join(' | '),
  )
})

test('history: a late cancel carries its real time and who made it, from the Cancellations report', async () => {
  const reports = await readReports(REPORTS)
  const cancel = (cancelledBy: string, at: ReturnType<typeof day>) => ({
    cancelledAt: at,
    cancelledBy,
    date: { year: 2026, month: 7, day: 6 },
    start: { hour: 19, minute: 0 },
    description: 'Hatha',
    client: 'Jane Doe',
    method: 'late',
  })
  const run = (cancellations: ReturnType<typeof cancel>[]) => {
    const { archive } = mapStudio({ ...reports, cancellations }, validateConfig(withHistory()), TENANT)
    const row = archive.rows.cancellations!.find(c => c.client_id === archive.rows.clients!.find(m => m.email === 'jane.doe@example.test')!.id)!
    const booking = archive.rows.bookings!.find(b => b.id === row.booking_id)!
    return { row, booking }
  }
  const self = run([cancel('Jane Doe', day(2026, 7, 6, 17, 30))])
  assert.deepEqual([self.row.cancelled_at, self.row.source, self.booking.cancelled_at], ['2026-07-06T09:30:00.000Z', 'client', '2026-07-06T09:30:00.000Z'])
  assert.ok(String(self.booking.booked_at) <= String(self.booking.cancelled_at), 'never cancelled before it was booked')
  assert.equal(run([cancel('Frank Front', day(2026, 7, 6, 18, 0))]).row.source, 'admin', 'the studio cancelled it')
  assert.equal(run([cancel('_ClassPass API', day(2026, 7, 6, 18, 0))]).row.source, 'client', 'ClassPass, on the member s behalf')
  assert.equal(run([]).row.cancelled_at, '2026-07-06T11:00:00.000Z', 'no report: dated at the class s start, as before')
})

/* ── Past classes, visits and PT as Mindbody recorded them (#219) ────────── */

/** A past Hatha from the fixture's timetable, moved to another day. */
const pastHatha = (reports: Awaited<ReturnType<typeof readReports>>, d: number, month = 8) => {
  const hatha = reports.schedule.find(r => r.date.month === 8 && r.date.day === 24 && /hatha/i.test(r.description))!
  return { ...hatha, date: { year: 2026, month, day: d } }
}

const groupLine = (date: { year: number; month: number; day: number }, description: string, by = 'Frank Front') => ({
  cancelledAt: day(date.year, date.month, date.day - 1, 10, 0),
  cancelledBy: by,
  date,
  start: { hour: 19, minute: 0 },
  description,
  client: 'Jane Doe',
  method: 'early',
  group: `${date.month}-${date.day}`,
  location: 'Main Hall',
  teacher: 'Ivy Instructor',
})

test('history: a past class the studio called off, with nobody on it and no pay, arrives cancelled and not Unpriced', async () => {
  const reports = await readReports(REPORTS)
  const schedule = [...reports.schedule, pastHatha(reports, 18), pastHatha(reports, 19)]
  const groupCancellations = [
    // Mindbody cuts the class name to 14 characters, and writes it in whatever case.
    groupLine({ year: 2026, month: 8, day: 18 }, 'HATHA'),
    // Called off in the report, and yet payroll paid for it and a member late-cancelled it: it ran.
    groupLine({ year: 2026, month: 9, day: 7 }, 'Hatha'),
  ]
  const { archive, ids, preflight } = mapStudio({ ...reports, schedule, groupCancellations }, validateConfig(withHistory()), TENANT)
  const at = (iso: string) => startsAt(archive.rows.classes!, iso)

  const calledOff = at('2026-08-18T11:00:00.000Z')
  assert.deepEqual(
    [calledOff.lifecycle, calledOff.cancelled_at, calledOff.cancelled_by_staff_id],
    ['cancelled', '2026-08-17T02:00:00.000Z', ids.staff_users!['Frank Front']],
  )
  assert.equal(calledOff.instructor_pay_sgd, null, 'a cancelled class is on nobody s Unpriced list: payroll counts active classes only')
  assert.deepEqual([at('2026-09-07T11:00:00.000Z').lifecycle, at('2026-09-07T11:00:00.000Z').instructor_pay_sgd], ['active', '38.00'])
  // Nobody on it and no pay, but nothing says it was called off: it stays, and is named.
  assert.equal(at('2026-08-19T11:00:00.000Z').lifecycle, 'active')
  assert.ok(preflight.schedule.some(n => /history: 1 past class\(es\) the studio called off .*came across cancelled/.test(n)), preflight.schedule.join(' | '))
  assert.ok(
    preflight.schedule.some(n => /history: 1 past class\(es\) had nobody on them, no payroll line and no group cancellation/.test(n)),
    preflight.schedule.join(' | '),
  )
})

test('history: a class a substitute taught records the substitute, and the preflight counts the covers', async () => {
  const reports = await readReports(REPORTS)
  const cover = { ...pastHatha(reports, 18), staff: 'OLIVE OWNER', substitute: true }
  const { archive, ids, preflight } = mapStudio({ ...reports, schedule: [...reports.schedule, cover] }, validateConfig(withHistory()), TENANT)
  assert.equal(startsAt(archive.rows.classes!, '2026-08-18T11:00:00.000Z').main_instructor_id, ids.staff_users!['Olive Owner'])
  assert.ok(
    preflight.schedule.some(n => /history: 1 past class\(es\) were taught by a substitute \(\*\*\* in Mindbody\)/.test(n)),
    preflight.schedule.join(' | '),
  )
})

test('history: a visit is attended unless a flag says otherwise, an unpaid visit is attended with no package, and the roster tells an unmarked seat', async () => {
  const reports = await readReports(REPORTS)
  const visit = (clientId: string, status: string, option: string, fromFlags = true) => ({
    date: { year: 2026, month: 8, day: 24 },
    start: { hour: 19, minute: 0 },
    end: null,
    description: 'Hatha',
    staff: 'Instructor, Ivy',
    room: '',
    location: 'Main Hall',
    clientId,
    status,
    option,
    saleLocation: '',
    fromFlags,
  })
  const attendance = [
    ...reports.attendance,
    // Staff Paid = No, and neither flag: what the reader makes of it.
    visit('100000004', 'Signed in', ''),
    // Mindbody's "unpaid": she came, and nothing paid for it.
    visit('100000003', 'Unpaid', 'Class Pack - Bundle of 20', false),
    // Neither flag, and the roster never marked the seat either.
    visit('100000005', 'Signed in', ''),
    // A report with its own Status column already said: the roster does not overrule it.
    visit('100000006', 'Signed in', 'ClassPass', false),
  ]
  const roster = [
    ...reports.roster,
    ...['100000005', '100000006'].map(clientId => ({ ...reports.roster[0]!, date: { year: 2026, month: 8, day: 24 }, clientId, status: 'Reserved' })),
  ]
  const { archive, ids } = mapStudio({ ...reports, attendance, roster }, validateConfig(withHistory(true)), TENANT)
  const cls = startsAt(archive.rows.classes!, '2026-08-24T11:00:00.000Z').id
  const seat = (barcode: string) => archive.rows.bookings!.find(b => b.class_id === cls && b.client_id === ids.clients![barcode])!
  const checkedIn = (b: Record<string, any>) => archive.rows.check_ins!.some(c => c.booking_id === b.id)

  assert.deepEqual([seat('100000004').state, seat('100000004').check_in_state, checkedIn(seat('100000004'))], ['confirmed', 'attended', true])
  const unpaid = seat('100000003')
  assert.deepEqual([unpaid.state, unpaid.check_in_state, checkedIn(unpaid)], ['confirmed', 'attended', true], 'not a no-show')
  assert.deepEqual([unpaid.client_package_id, unpaid.credits_or_sessions_used], [null, 0], 'and no package paid for it')
  assert.deepEqual([seat('100000005').state, seat('100000005').check_in_state], ['confirmed', 'pending'])
  assert.equal(seat('100000006').check_in_state, 'attended')
})

test('history: past PT ends as it did — a no-show stays one, a late cancel is cancelled, a Sharing package seats two', async () => {
  const reports = await readReports(REPORTS)
  const pt = (d: number, status: string, option: string, end: { hour: number; minute: number } | null = { hour: 10, minute: 0 }) => ({
    date: { year: 2026, month: 9, day: d },
    start: { hour: 9, minute: 0 },
    end,
    description: 'Personal Training / PT',
    staff: 'Owner, Olive',
    room: '',
    location: 'Main Hall',
    clientId: '100000008',
    status,
    option,
    saleLocation: '',
  })
  const attendance = [
    ...reports.attendance,
    pt(4, 'Signed in', 'PT - Sharing Bundle of 10'),
    // The flagged report has no end time, and the roster has no line for it.
    pt(5, 'Signed in', 'PT - Bundle of 10', null),
    pt(6, 'Late Cancel', 'PT - Bundle of 10'),
  ]
  const roster = [...reports.roster, { ...reports.roster[0]!, ...pt(4, 'Completed', ''), notes: '', scheduledBy: 'Client' }]
  const config = withHistory()
  config.catalogue.push({
    name: 'PT - Sharing Bundle of 10',
    mindbodyNames: ['PT - Sharing Bundle of 10'],
    migrate: 'legacy',
    kind: 'pt',
    credits: 10,
    validityDays: 90,
    priceSgd: null,
    sessionType: '2on1',
  })
  const { archive, ids, preflight } = mapStudio({ ...reports, attendance, roster }, validateConfig(config), TENANT)
  const session = (d: number) => archive.rows.pt_sessions!.find(s => s.starts_at === `2026-09-0${d}T01:00:00.000Z`)!
  const request = (d: number) => archive.rows.pt_requests!.find(r => r.scheduled_pt_session_id === session(d).id)!
  const booking = (d: number) => archive.rows.bookings!.find(b => b.pt_session_id === session(d).id)!

  // A no-show: the booking says so, and the request is already where the
  // platform's own end-of-session job leaves one — so that job has nothing to move.
  assert.deepEqual([booking(3).state, booking(3).check_in_state], ['no_show', 'no_show'])
  assert.equal(request(3).status, 'attended')
  assert.equal(session(3).lifecycle, 'active')

  // Paid from a two-person package: two places, the second empty because Mindbody named nobody —
  // so the request, which names a partner whenever it says 2on1, stays 1on1.
  assert.deepEqual(
    [session(4).session_type, session(4).capacity_online, request(4).session_type, request(4).co_client_id],
    ['2on1', 2, '1on1', null],
  )
  assert.equal(archive.rows.pt_session_clients!.filter(c => c.pt_session_id === session(4).id).length, 1)

  // No end time anywhere: an hour, and counted.
  assert.equal(session(5).ends_at, '2026-09-05T02:00:00.000Z')
  assert.ok(
    preflight.schedule.some(n => /history: 1 past PT session\(s\) have no end time in the roster or the attendance report, so they are one hour long/.test(n)),
    preflight.schedule.join(' | '),
  )

  // Late-cancelled: the session is cancelled, as the portal cancels one.
  assert.deepEqual([session(6).lifecycle, session(6).cancelled_at], ['cancelled', '2026-09-06T01:00:00.000Z'])
  assert.deepEqual([request(6).status, booking(6).state, booking(6).check_in_state], ['cancelled_after_scheduled', 'cancelled', 'n_a'])
  assert.ok(archive.rows.cancellations!.some(c => c.booking_id === booking(6).id && c.kind === 'pt'))

  // Booked by the member, or with no roster line: the owner stands in, and the preflight says how often.
  assert.equal(session(4).scheduled_by_staff_id, ids.staff_users!['Olive Owner'])
  assert.ok(
    preflight.schedule.some(n => /history: 1 past PT session\(s\) were booked by "Client", who is not staff coming across/.test(n)),
    preflight.schedule.join(' | '),
  )
  assert.ok(
    preflight.schedule.some(n => /history: 3 past PT session\(s\) have no roster line to say who booked them/.test(n)),
    preflight.schedule.join(' | '),
  )
})

/* ── Members, packages and weekly Class Series from report data (#220) ───── */

/** A visit in the Attendance report, as its reader returns one. */
const attended = (clientId: string, date: { year: number; month: number; day: number }, over: Record<string, unknown> = {}) => ({
  date,
  start: { hour: 19, minute: 0 },
  end: null,
  description: 'Hatha',
  staff: 'Instructor, Ivy',
  room: '',
  location: 'Main Hall',
  clientId,
  status: 'Signed in',
  option: '',
  saleLocation: '',
  fromFlags: true,
  ...over,
})

test('an Unlimited Plan is homed where its member is: Retention Management, then Membership, then where their visits were sold, then its name, then the default', async () => {
  const reports = await readReports(REPORTS)
  const config = validateConfig(fixtureConfig())
  const homeOf = (r: typeof reports) => {
    const { archive, ids, preflight } = mapStudio(r, config, TENANT)
    const plan = archive.rows.client_packages!.find(p => p.kind === 'unlimited' && p.client_id === ids.clients!['100000002'])!
    return { home: Object.keys(ids.locations!).find(k => ids.locations![k] === plan.location_id), preflight }
  }

  // Rick at Mindbody location 2 in Retention Management, and the plan's name says nothing.
  const retained = homeOf(rickAt(reports, '2'))
  assert.equal(retained.home, 'location-2')
  assert.ok(
    retained.preflight.schedule.some(n => /Unlimited Plan Home Locations: 1 from Retention Management, 0 from Membership, 0 from where the member's visits were sold, 0 from the plan, 0 at defaultLocation/.test(n)),
    retained.preflight.schedule.join(' | '),
  )

  const nowhere = rickAt(reports, '0')
  assert.equal(homeOf(nowhere).home, 'location-1', 'no report places him: the default')
  assert.ok(homeOf(nowhere).preflight.schedule.some(n => /0 from the plan, 1 at defaultLocation/.test(n)))
  assert.equal(homeOf({ ...nowhere, membership: [{ id: '100000002', status: 'Active', location: 'Riverside' }] }).home, 'location-2', 'Membership s Location')

  // Where his visits were sold, most often: twice at Riverside, once online, once at Main Hall.
  const attendance = [
    ...nowhere.attendance,
    attended('100000002', { year: 2026, month: 9, day: 1 }, { saleLocation: 'Riverside' }),
    attended('100000002', { year: 2026, month: 9, day: 2 }, { saleLocation: 'Riverside ' }),
    attended('100000002', { year: 2026, month: 9, day: 3 }, { saleLocation: 'Online Store' }),
    attended('100000002', { year: 2026, month: 9, day: 4 }, { saleLocation: 'Main Hall' }),
  ]
  const sold = homeOf({ ...nowhere, attendance })
  assert.equal(sold.home, 'location-2')
  assert.ok(sold.preflight.schedule.some(n => /1 from where the member's visits were sold/.test(n)), sold.preflight.schedule.join(' | '))
})

test('a shared email is kept by the profile that visited last, by the attendance history', async () => {
  const reports = await readReports(REPORTS)
  // Kim's last visit in Retention Management is later than Sam's, but Sam came to class after it.
  const attendance = [...reports.attendance, attended('100000004', { year: 2026, month: 9, day: 16 })]
  const { preflight } = mapStudio({ ...reports, attendance }, validateConfig(fixtureConfig()), TENANT)
  assert.equal(preflight.sharedEmails[0]!.keeper.id, '100000004')

  // A no-show or a cancel is no visit.
  const noShow = [...reports.attendance, attended('100000004', { year: 2026, month: 9, day: 16 }, { status: 'No Show' })]
  assert.equal(mapStudio({ ...reports, attendance: noShow }, validateConfig(fixtureConfig()), TENANT).preflight.sharedEmails[0]!.keeper.id, '100000005')
})

test('phones are formatted with the member s country; the dummy is empty; a number that cannot be is listed', async () => {
  const reports = await readReports(REPORTS)
  const members = reports.members.map(m =>
    m.id === '100000001'
      ? { ...m, mobile: '012-345 6789', country: 'MY' }
      : m.id === '100000003'
        ? { ...m, mobile: '0412 345 678', country: '' }
        : m,
  )
  const { archive, ids, preflight } = mapStudio({ ...reports, members }, validateConfig(fixtureConfig()), TENANT)
  const preflightText = renderPreflight(preflight)
  const phone = (barcode: string) => archive.rows.clients!.find(r => r.id === ids.clients![barcode])!.phone
  assert.equal(phone('100000001'), '+60123456789', 'Malaysia s calling code, the trunk 0 dropped')
  assert.equal(phone('100000005'), '+6598765432')
  assert.equal(phone('100000002'), '', 'Mindbody s dummy phone')
  // No Country: the config's default, where this number is too long to be one.
  assert.equal(phone('100000003'), '')
  assert.deepEqual(preflight.badPhones, [{ id: '100000003', name: 'Pat Poe', phone: '0412 345 678', country: 'SG' }])
  assert.match(preflightText, /## Phones that could not be formatted \(1\)/)
  assert.match(preflightText, /100000003 Pat Poe: "0412 345 678" \(SG\)/)

  const config = fixtureConfig()
  config.defaultCountry = 'AU'
  const australian = mapStudio({ ...reports, members }, validateConfig(config), TENANT)
  assert.equal(australian.archive.rows.clients!.find(r => r.id === australian.ids.clients!['100000003'])!.phone, '+61412345678')
})

test('proposed Validity counts both the first and the last day: a 60-day pack proposes 60', async () => {
  const reports = await readReports(REPORTS)
  const optionSales = [
    ...reports.optionSales.filter(s => !/bundle of 10/i.test(s.option)),
    sale({ activation: day(2026, 7, 1), expiration: day(2026, 8, 29) }),
    sale({ activation: day(2026, 5, 1), expiration: day(2026, 6, 29) }),
  ]
  const starter = starterConfig({ ...reports, optionSales }, '2026-09-17T02:00:00+08:00')
  assert.equal(starter.catalogue!.find(e => e.name === 'Class Pack - Bundle of 10')!.validityDays, 60)
})

test('a future booking beyond the running package s expiry is paid by the package waiting behind it', async () => {
  const reports = await readReports(REPORTS)
  // Jane's running pack ends on 3 January; her Bundle of 20 waits behind it.
  const holdings = reports.holdings.map(h =>
    h.clientId === '100000001' && /bundle of 10/i.test(h.option) ? { ...h, lastExpiration: day(2090, 1, 3) } : h,
  )
  const seat = (clientId: string) => ({ ...reports.roster.find(r => r.date.year === 2090 && r.clientId === '100000001')!, date: { year: 2090, month: 1, day: 9 }, clientId, status: 'Reserved' })
  const roster = [...reports.roster, seat('100000001'), seat('100000004')]
  const { archive, ids, preflight } = mapStudio({ ...reports, holdings, roster }, validateConfig(fixtureConfig()), TENANT)
  const classOn = (at: string) => archive.rows.classes!.find(c => c.starts_at === at)!.id
  const booking = (barcode: string, at: string) =>
    archive.rows.bookings!.find(b => b.client_id === ids.clients![barcode] && b.class_id === classOn(at))!

  assert.equal(booking('100000001', '2090-01-02T11:00:00.000Z').client_package_id, ids.client_packages!['100000001/Class Pack - Bundle of 10'])
  const later = booking('100000001', '2090-01-09T11:00:00.000Z')
  assert.equal(later.client_package_id, ids.client_packages!['100000001/Class Pack - Bundle of 20'])
  assert.equal(later.credits_or_sessions_used, 1)

  // What is still unpaid is split: Sam's trial ends before the class in Mindbody too;
  // Pat holds a pack in Mindbody (with no expiry) that is not a package here.
  const notes = preflight.schedule.join(' | ')
  assert.match(notes, /100000004 Sam Lee: booked into HATHA on 2090-01-09 at 19:00 with no class package to pay for it — unpaid in Mindbody too/)
  assert.match(notes, /100000003 Pat Poe: booked into Hatha on 2090-01-09 at 19:00 with no class package to pay for it — unmatched: Mindbody has something to pay for it/)
  assert.match(notes, /future bookings with no package: 1 unpaid in Mindbody too, 1 unmatched/)
})

test('a Class Type with no future class and no Class Series arrives archived; the ones in use stay active', async () => {
  const config = fixtureConfig()
  config.classTypes.push({ name: 'Yin', mindbodyNames: ['Yin'], capacity: null })
  const { archive, ids } = await run(config)
  const type = (name: string) => archive.rows.class_types!.find(t => t.name === name)!
  assert.equal(type('Yin').archived_at, '2026-09-16T18:00:00.000Z')
  assert.equal(type('Hatha').archived_at, null)
  assert.equal(type('Vinyasa Flow').archived_at, null)
  assert.equal(type('Personal Training').archived_at, null, 'the PT focus is what every new PT request is for')
  assert.ok(ids.class_types!.Yin)
})

/** A class on the staff schedule, as its reader returns one. */
const scheduled = (date: { year: number; month: number; day: number }, over: Record<string, unknown> = {}) => ({
  staff: 'IVY INSTRUCTOR',
  date,
  start: { hour: 7, minute: 0 },
  end: { hour: 8, minute: 0 },
  description: 'Vinyasa flow',
  substitute: false,
  location: 'Main Hall',
  serviceCategory: 'Classes',
  room: 'Studio2-Normal Room',
  ...over,
})

test('a weekly slot with no class since the download is proposed from its recurring pattern and, once confirmed, written', async () => {
  const reports = await readReports(REPORTS)
  const schedule = [
    ...reports.schedule,
    // Fridays at 7, last held six days before the download: Olive, then Ivy took it over.
    scheduled({ year: 2026, month: 8, day: 21 }, { staff: 'OLIVE OWNER' }),
    scheduled({ year: 2026, month: 8, day: 28 }, { staff: 'OLIVE OWNER' }),
    scheduled({ year: 2026, month: 9, day: 4 }),
    scheduled({ year: 2026, month: 9, day: 11 }),
    // Wednesdays at 7: Olive's, and one week Ivy covered with no *** — no clear change.
    // The last week a substitute covered, flagged.
    ...[26, 2, 9, 16].map((d, i) =>
      scheduled({ year: 2026, month: d > 20 ? 8 : 9, day: d }, { staff: i === 2 ? 'IVY INSTRUCTOR' : 'OLIVE OWNER', substitute: i === 3, description: 'Hatha', room: 'Studio 1 - Hot Room' }),
    ),
    // Tuesdays at 7: stopped three weeks before the download.
    scheduled({ year: 2026, month: 8, day: 18 }, { description: 'Hatha', room: 'Studio 1 - Hot Room' }),
    scheduled({ year: 2026, month: 8, day: 25 }, { description: 'Hatha', room: 'Studio 1 - Hot Room' }),
  ]
  const starter = starterConfig({ ...reports, schedule }, '2026-09-17T02:00:00+08:00')
  assert.deepEqual(
    starter.series!.map(s => `${s.className} ${s.weekday} ${s.startTime}-${s.endTime} ${s.room} ${s.teacher}`),
    [
      'Hatha 1 19:00-20:00 Studio 1 - Hot Room Ivy Instructor',
      'Hatha 3 07:00-08:00 Studio 1 - Hot Room Olive Owner',
      'Vinyasa flow 5 07:00-08:00 Studio2-Normal Room Ivy Instructor',
    ],
    'the teacher who took the slot over; a one-off cover or a substitute is not a hand-over; nothing for the Tuesdays that stopped',
  )

  const config = fixtureConfig()
  config.series.push({ ...starter.series!.find(s => s.weekday === 5), migrate: true })
  const { archive } = mapStudio({ ...reports, schedule }, validateConfig(config), TENANT)
  assert.equal(archive.rows.class_series!.length, 2)
  const fridays = archive.rows.class_series!.find(s => s.weekday === 5)!
  // Nothing of it came across to link, so it ends on its last class before the download: launch day extends it.
  assert.deepEqual(
    [fridays.first_date, fridays.last_date, fridays.excluded_dates, fridays.start_time, fridays.instructor_pay_sgd],
    ['2026-09-11', '2026-09-11', [], '07:00:00', '35.00'],
  )
  assert.ok(!archive.rows.classes!.some(c => c.series_id === fridays.id))
  assert.deepEqual(constraintViolations(archive), [])
})

test('an archive whose email links would point at this machine is refused, unless the target is said to be local', async () => {
  const local = { ...fixtureConfig(), originPatterns: 'http://*.localhost:3000,http://*.portal.localhost:3001' }
  await assert.rejects(run(local), /originPatterns.*localhost/)
  const loopback = { ...fixtureConfig(), originPatterns: 'http://*.127.0.0.1.nip.io:3000,http://127.0.0.1:3001' }
  await assert.rejects(run(loopback), /originPatterns/)
  const lookalike = { ...fixtureConfig(), originPatterns: 'https://*.notlocalhost.example,https://*.portal.notlocalhost.example' }
  await assert.doesNotReject(run(lookalike), 'a host that only contains the word is not this machine')
  const built = await transformMindbody({ reportsDir: REPORTS, config: local, tenantId: TENANT, local: true })
  assert.ok(built.archive.rows.email_templates!.some(t => String(t.body_html).includes('localhost:3000')))
})

test('each live autopay in Autopay Detail is a preflight line, to stop in Mindbody; none gives none', async () => {
  const { preflight, preflightText } = await run()
  assert.equal(preflight.autopays.length, 1)
  assert.match(preflightText, /100000001 Doe, Jane .*Unlimited Monthly, next due 1\/10\/2026.*Scheduled; 1 run scheduled/)

  const reports = await readReports(REPORTS)
  // A monthly autopay is a row per run: still one autopay to stop.
  reports.autopay = [reports.autopay[0]!, { ...reports.autopay[0]!, date: '1/11/2026' }]
  const monthly = mapStudio(reports, validateConfig(fixtureConfig()), TENANT).preflight.autopays
  assert.deepEqual(monthly.map(a => [a.clientId, a.next, a.runs]), [['100000001', '1/10/2026', 2]])

  reports.autopay = readAutopayDetail(`<table><tr><td>Date</td><td>Client</td><td>Item</td><td>Status</td></tr>
    <tr><td colspan="7">No autopay transactions found with the specified parameters.</td></tr></table>`)
  const none = mapStudio(reports, validateConfig(fixtureConfig()), TENANT)
  assert.deepEqual(none.preflight.autopays, [])
  assert.match(renderPreflight(none.preflight), /## Autopays still live in Mindbody \(0\)\n\n[^\n]+\n$/)
})

/* ── Instructor Pay from the reports (#218) ──────────────────────────────── */

test('historical Instructor Pay adds up to the Payroll Detail total: class pay, session pay and Manual Entries', async () => {
  const { archive, ids } = await run(withHistory())
  const cents = (v: unknown) => (v == null ? 0 : Math.round(Number(v) * 100))
  const past = (at: unknown) => String(at) < '2026-09-17'
  const onClasses = archive.rows.classes!.filter(c => past(c.starts_at)).reduce((n, c) => n + cents(c.instructor_pay_sgd), 0)
  const onSessions = archive.rows.pt_sessions!.filter(s => past(s.starts_at)).reduce((n, s) => n + cents(s.instructor_pay_sgd), 0)
  const entries = archive.rows.manual_payroll_entries!
  const manual = entries.reduce((n, e) => n + cents(e.amount_sgd), 0)
  // 35 × 3 + 38 + 40 + 48 + 8 on classes, and 30 + 54 + 100 that fits none.
  assert.equal(onClasses + onSessions + manual, 42300)

  const staff = (name: string) => ids.staff_users![name]
  assert.deepEqual(
    entries.map(e => `${e.entry_date} ${e.instructor_id === staff('Ivy Instructor') ? 'Ivy' : 'Olive'} ${e.amount_sgd} ${e.label}`).sort(),
    [
      // A PT line with no session to sit on, at its own time.
      '2026-08-20T03:00:00.000Z Olive 54.00 Mindbody payroll: PT appointment at 11:00 (PT 50%)',
      // A revenue share at no set time: on its day.
      '2026-08-29T16:00:00.000Z Olive 100.00 Mindbody payroll: PT appointment, no set time (PT 50%)',
      // A workshop's per-client lines, added up.
      '2026-09-05T06:00:00.000Z Ivy 30.00 Mindbody payroll: class paid per client at 14:00 (Percentage Rate 40%)',
    ],
  )
  for (const e of entries) {
    assert.equal(e.created_by_staff_id, staff('Olive Owner'))
    assert.ok(archive.rows.instructors!.some(i => i.staff_user_id === e.instructor_id), 'paid, so an instructor')
  }
  assert.deepEqual(constraintViolations(archive), [])
})

test('a past PT session Mindbody marked unpaid is $0, not Unpriced', async () => {
  const reports = await readReports(REPORTS)
  const attendance = reports.attendance.map(v =>
    /personal training/i.test(v.description) ? { ...v, status: 'No Show', staffPaid: false } : v,
  )
  const { archive } = mapStudio({ ...reports, attendance }, validateConfig(withHistory()), TENANT)
  const session = archive.rows.pt_sessions!.find(s => s.starts_at === '2026-09-01T01:00:00.000Z')!
  assert.equal(session.instructor_pay_sgd, '0.00')
  // Without the mark, payroll simply has no line for it: Unpriced, for an admin to settle.
  const unmarked = mapStudio(reports, validateConfig(withHistory()), TENANT)
  assert.equal(unmarked.archive.rows.pt_sessions!.find(s => s.starts_at === '2026-09-01T01:00:00.000Z')!.instructor_pay_sgd, null)
})

test('verify: Instructor Pay is compared month by month, and a changed month is named', async () => {
  const { archive, expected, zip } = await run(withHistory())
  assert.deepEqual(expected.payByMonth, {
    '2026-07': '35.00',
    '2026-08': '224.00',
    '2026-09': '164.00',
    // The timetable to come: the per-class rate, and Olive's PT at her percentage.
    '2090-01': '165.00',
  })
  assert.deepEqual(await verifyImport(expected, zip), [])

  // One Manual Entry lost on the way in, and the manifest none the wiser.
  archive.rows.manual_payroll_entries!.pop()
  archive.manifest.counts.manual_payroll_entries = archive.rows.manual_payroll_entries!.length
  const differences = await verifyImport(expected, await packArchive(archive))
  assert.ok(differences.some(d => /^2026-\d\d: Instructor Pay: expected [\d.]+, found [\d.]+$/.test(d)), differences.join(' | '))
})
