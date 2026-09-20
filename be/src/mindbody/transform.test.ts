import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { packArchive, unpackArchive } from '../services/tenants/transfer-archive'
import { ConfigError, starterConfig, validateConfig } from './config'
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
})

test('verify: the archive adds up to its own expected figures, and an altered balance is named by member', async () => {
  const { archive, expected, zip } = await run()
  assert.deepEqual(
    { ...expected, perMember: undefined },
    {
      members: 8,
      staffByRole: { admin: 2, instructor: 2 },
      livePackagesByKind: { credit_bundle: 3, unlimited: 1, pt: 1, trial: 1 },
      creditsLeft: 28,
      sessionsLeft: 7,
      perMember: undefined,
    },
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
