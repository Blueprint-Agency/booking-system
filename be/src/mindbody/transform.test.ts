import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { unpackArchive } from '../services/tenants/transfer-archive'
import { ConfigError, starterConfig, validateConfig } from './config'
import { readReports, transformMindbody } from './transform'

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
