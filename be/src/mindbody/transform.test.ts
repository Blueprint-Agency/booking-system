import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { packArchive, unpackArchive } from '../services/tenants/transfer-archive'
import { ConfigError, starterConfig, validateConfig } from './config'
import { mapStudio } from './mapper'
import { readReports, transformMindbody, verifyImport } from './transform'

/**
 * The transform, from the outside: fixture reports and a fixture config in, an
 * archive out. The database half — importing it and signing in — is
 * `src/test/mindbody-transform.test.ts`.
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
  assert.equal(archive.rows.email_templates!.length, 33)
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
  assert.equal(jane.phone, '91234567')
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
  assert.equal(staff('Ivy Instructor').phone, '9122220000')

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
  assert.deepEqual([running.active, running.validity_days, running.amount_paid_sgd, running.list_price_sgd], [true, 60, '250.00', '260.00'])
  assert.equal(running.purchased_at, '2026-07-31T16:00:00.000Z', 'first activation, studio-local')

  const waiting = named('100000001', 'Class Pack - Bundle of 20')
  assert.deepEqual(
    [waiting.expires_at, waiting.active, waiting.credits_or_sessions_remaining, waiting.validity_days],
    [null, true, 20, daysLeftUntil(2090, 6, 1)],
  )
  assert.equal(waiting.list_price_sgd, '450.00', 'no List Price in the config: what was paid')

  const pt = named('100000008', 'PT - Bundle of 10')
  assert.deepEqual([pt.kind, pt.credits_or_sessions_remaining, pt.expires_at, pt.source_class_package_id], ['pt', 7, '2090-04-01T15:59:59.000Z', null])
  assert.equal(pt.source_pt_package_id, ids.pt_packages!['PT - Bundle of 10'])

  const classPass = named('100000006', 'ClassPass')
  assert.deepEqual([classPass.kind, classPass.credits_or_sessions_remaining, classPass.amount_paid_sgd, classPass.list_price_sgd], ['credit_bundle', 1, '0.00', '0.00'])

  assert.deepEqual(held('AB123456'), [], 'a pack that expired years ago with credits on it is not live')
})

test('an Unlimited Plan keeps its expiry, is homed at the default Location, and a pass for the other Location is its Add-On', async () => {
  const { archive, ids } = await run()
  const [plan, ...others] = archive.rows.client_packages!.filter(r => r.client_id === ids.clients!['100000002'])
  assert.deepEqual(others, [], 'the access pass is not a package of its own')
  assert.deepEqual(
    [plan!.kind, plan!.location_id, plan!.duration_months, plan!.validity_days, plan!.credits_or_sessions_remaining, plan!.expires_at],
    ['unlimited', ids.locations!['location-1'], 12, null, null, '2090-02-01T15:59:59.000Z'],
  )
  assert.equal(plan!.cross_location_paid_sgd, '120.00', 'what the pass cost')

  // A plan whose name names a Location is homed there, whatever the default is.
  const config = fixtureConfig()
  config.catalogue.find((e: { name: string }) => e.name === 'Unlimited 12').mindbodyNames = ['Unlimited 12', 'Unlimited 12 - Riverside']
  const homed = await run(config)
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
    [null, 'credit_bundle', 10, 60, 250],
    'the commonest count, spread and price — not the one 90-day pack, the discount or the return',
  )
  const trial = proposed['2 Trial Classes for New Joiners']!
  assert.deepEqual([trial.kind, trial.mindbodyNames], ['trial', ['2 Trial Classes For New Joiners', '2 Trial Classes for New Joiners']])
  const plan = proposed['Unlimited 12']!
  assert.deepEqual([plan.kind, plan.durationMonths, plan.credits, plan.priceSgd], ['unlimited', 12, null, 1700])
  assert.equal(proposed['Riverside Studio Access']!.kind, 'access_pass')
  const pt = proposed['PT - Bundle of 10']!
  assert.deepEqual([pt.kind, pt.sessionType, pt.credits, pt.validityDays], ['pt', '1on1', 10, 90])
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
  assert.equal(session.instructor_pay_sgd, null, 'Mindbody pays PT by percentage, which no report gives')

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
    { ...expected, perMember: undefined, perClass: undefined, perWorkshop: undefined, byYear: undefined },
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
      // Ten weeks back: outside the 30-day cycle, so it was the member's own.
      '2026-07-06T11:00:00.000Z client',
      // Inside the cycle the platform counts against the cap: written as the
      // studio's, or the member would arrive having spent an allowance here.
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
  assert.equal(session.instructor_id, ids.staff_users!['Olive Owner'])
  assert.deepEqual([session.session_type, session.lifecycle, session.instructor_pay_sgd], ['1on1', 'active', null])

  const request = archive.rows.pt_requests!.find(r => r.scheduled_pt_session_id === session.id)!
  assert.equal(request.status, 'attended', 'Mei came, so the request ended attended')
  assert.equal(request.client_id, ids.clients!['100000008'])
  assert.ok(request.debited_client_package_id, 'her PT bundle paid for it')

  const booking = archive.rows.bookings!.find(b => b.pt_session_id === session.id)!
  assert.deepEqual([booking.state, booking.check_in_state], ['confirmed', 'attended'])
  assert.ok(archive.rows.check_ins!.some(c => c.booking_id === booking.id))
  assert.deepEqual(
    archive.rows.pt_session_clients!.filter(c => c.pt_session_id === session.id).map(c => c.client_id),
    [ids.clients!['100000008']],
  )
})

test('past purchases are a separate opt-in, joined to members by name and phone, and never guessed', async () => {
  const without = await run(withHistory(false))
  assert.ok(
    !without.archive.rows.client_packages!.some(p => p.amount_paid_sgd === '250.00' && p.active === false),
    'without the opt-in the studio has no pre-launch revenue',
  )

  const { archive, ids, preflight } = await run(withHistory(true))
  const who = new Map(Object.entries(ids.clients!).map(([barcode, id]) => [id as string, barcode]))
  const past = archive.rows.client_packages!.filter(p => p.active === false && p.kind === 'credit_bundle')
  assert.deepEqual(
    past.map(p => `${who.get(String(p.client_id))} ${p.amount_paid_sgd} ${p.purchased_at} ${p.credits_or_sessions_remaining}`).sort(),
    [
      '100000001 250.00 2026-06-30T16:00:00.000Z 0',
      '100000002 250.00 2026-06-30T16:00:00.000Z 0',
      // Spent but not yet expired, so Visits Remaining does not hold it either:
      // without this it would be money the studio took and nobody counted.
      '100000005 250.00 2026-06-30T16:00:00.000Z 0',
    ],
    'used up, and dated when they were bought, so Finance shows the money on that day',
  )
  assert.ok(past.every(p => p.source_class_package_id === ids.class_packages!['Class Pack - Bundle of 10']))

  // A register row that matches no member, and an option in no catalogue entry:
  // both are named for a person, and neither is guessed at.
  assert.ok(
    preflight.schedule.some(n => /Nobody, Ghost — Class Pack - Bundle of 10 — 1 purchase\(s\) match no member/.test(n)),
    preflight.schedule.join(' | '),
  )
  assert.ok(
    preflight.schedule.some(n => /"Towel Service" was sold 1 time\(s\) in the window and is in no catalogue entry/.test(n)),
    preflight.schedule.join(' | '),
  )
  // A purchase still live at the download already came across as a live package.
  assert.equal(archive.rows.client_packages!.filter(p => p.source_pt_package_id != null).length, 1)
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
    preflight.schedule.some(n => /Doe, Jane — 2 Trial Classes for New Joiners, 10\.00 — 1 trial\(s\) a member has already come across holding/.test(n)),
    preflight.schedule.join(' | '),
  )

  // A name Mindbody writes as ".,  Legacy" is the member whose surname is blank,
  // not a stranger: the fold drops the full stop the missing surname leaves.
  const legacy = archive.rows.client_packages!.filter(p => p.client_id === ids.clients!.AB123456 && p.active === false)
  assert.deepEqual(legacy.map(p => p.amount_paid_sgd), ['250.00'])
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
