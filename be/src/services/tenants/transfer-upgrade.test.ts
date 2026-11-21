import assert from 'node:assert/strict'
import { test } from 'node:test'
import { upgradeArchiveRows } from './transfer-upgrade'

const ADA = '11111111-1111-4111-8111-111111111111'
const ANNA = '22222222-2222-4222-8222-222222222222'

test('an archive from before #315 has its leave rows re-keyed to the staff member', () => {
  const rows = upgradeArchiveRows({
    leave_requests: [{ id: 'r1', instructor_id: ADA, days: '1.0' }],
    leave_pools: [{ instructor_id: ADA, type: 'annual', leave_year: 2026 }],
  })
  assert.deepEqual(rows.leave_requests, [{ id: 'r1', staff_user_id: ADA, days: '1.0' }])
  assert.deepEqual(rows.leave_pools, [{ staff_user_id: ADA, type: 'annual', leave_year: 2026 }])
})

test("an instructor's Assigned Days move onto their staff row, and admins keep theirs", () => {
  const rows = upgradeArchiveRows({
    staff_users: [
      { id: ADA, role: 'instructor' },
      { id: ANNA, role: 'admin' },
    ],
    instructors: [
      { staff_user_id: ADA, photo_r2_key: null, annual_leave_days: 20, medical_leave_days: 10, study_leave_days: 3 },
    ],
  })
  assert.deepEqual(rows.staff_users, [
    { id: ADA, role: 'instructor', annual_leave_days: 20, medical_leave_days: 10, study_leave_days: 3 },
    { id: ANNA, role: 'admin' },
  ])
  assert.deepEqual(rows.instructors, [{ staff_user_id: ADA, photo_r2_key: null }])
})

test('an archive already in the current shape is returned as it was', () => {
  const current = {
    staff_users: [{ id: ANNA, role: 'admin', annual_leave_days: 14, medical_leave_days: 14, study_leave_days: 7 }],
    instructors: [{ staff_user_id: ADA, photo_r2_key: null }],
    leave_requests: [{ id: 'r1', staff_user_id: ANNA }],
    // Current means it carries Entities, as every archive has since 0142.
    entities: [{ id: 'e1', name: 'Yoga', slug: 'yoga', position: 0, archived_at: null }],
  }
  assert.deepEqual(upgradeArchiveRows(current), current)
})

test('TEN-39 an archive from before #398 restores its Legal name as the Business name, and its Receipts’ Legal name as their Business name', () => {
  const rows = upgradeArchiveRows({
    tenant_settings: [{ tenant_id: ADA, display_name: 'Shown', receipt_prefix: 'NW', receipt_legal_name: 'Northwind Pte. Ltd.' }],
    receipts: [
      { id: 'r1', seller_name: 'Shown', seller_legal_name: 'Northwind Pte. Ltd.' },
      { id: 'r2', seller_name: 'Shown', seller_legal_name: null },
    ],
  })
  assert.deepEqual(rows.tenant_settings, [
    { tenant_id: ADA, display_name: 'Shown', receipt_prefix: 'NW', business_name: 'Northwind Pte. Ltd.' },
  ])
  assert.deepEqual(rows.receipts, [
    { id: 'r1', seller_name: 'Shown', seller_business_name: 'Northwind Pte. Ltd.' },
    { id: 'r2', seller_name: 'Shown', seller_business_name: null },
  ])
})

test("TEN-40 an archive from before #398 with no Legal name trades under its display name, else the studio's name, as migration 0115 named it", () => {
  const shown = upgradeArchiveRows(
    { tenant_settings: [{ tenant_id: ADA, display_name: ' Shown ', receipt_legal_name: null }] },
    { tenantName: 'Northwind' },
  )
  assert.deepEqual(shown.tenant_settings, [{ tenant_id: ADA, display_name: ' Shown ', business_name: 'Shown' }])

  const blank = upgradeArchiveRows(
    { tenant_settings: [{ tenant_id: ADA, display_name: '  ', receipt_legal_name: '  ' }] },
    { tenantName: 'Northwind' },
  )
  assert.deepEqual(blank.tenant_settings, [{ tenant_id: ADA, display_name: '  ', business_name: 'Northwind' }])

  const unnamed = upgradeArchiveRows({ tenant_settings: [{ tenant_id: ADA, receipt_legal_name: null }] }, { tenantName: 'Northwind' })
  assert.deepEqual(unnamed.tenant_settings, [{ tenant_id: ADA, business_name: 'Northwind' }])
})

test("STF-50 an archive from before #471 restores each instructor's photo as their own picture, on their staff row", () => {
  const photo = `t/${ADA}/avatars/ada.jpg`
  const rows = upgradeArchiveRows({
    staff_users: [
      { id: ADA, role: 'instructor' },
      { id: ANNA, role: 'admin' },
    ],
    instructors: [{ staff_user_id: ADA, photo_r2_key: photo }],
  })
  assert.deepEqual(rows.staff_users, [
    { id: ADA, role: 'instructor', photo_r2_key: photo },
    { id: ANNA, role: 'admin' },
  ])

  const current = {
    staff_users: [{ id: ADA, role: 'instructor', photo_r2_key: `t/${ADA}/avatars/newer.jpg` }],
    instructors: [{ staff_user_id: ADA, photo_r2_key: photo }],
  }
  assert.deepEqual(upgradeArchiveRows(current).staff_users, current.staff_users, 'a picture of their own is kept')
})

test('TEN-52 an archive from before migration 0140 restores a request whose session is not in it as one with no session, and leaves every real one', () => {
  const SESSION = '33333333-3333-4333-8333-333333333333'
  const GONE = '44444444-4444-4444-8444-444444444444'
  const rows = upgradeArchiveRows({
    pt_sessions: [{ id: SESSION, pt_request_id: 'r1' }],
    pt_requests: [
      { id: 'r1', status: 'scheduled', scheduled_pt_session_id: SESSION },
      { id: 'r2', status: 'scheduled', scheduled_pt_session_id: GONE },
      { id: 'r3', status: 'pending', scheduled_pt_session_id: null },
      { id: 'r4', status: 'pending' },
    ],
  })
  assert.deepEqual(rows.pt_requests, [
    { id: 'r1', status: 'scheduled', scheduled_pt_session_id: SESSION },
    { id: 'r2', status: 'scheduled', scheduled_pt_session_id: null },
    { id: 'r3', status: 'pending', scheduled_pt_session_id: null },
    { id: 'r4', status: 'pending' },
  ])

  const noSessions = upgradeArchiveRows({
    pt_requests: [{ id: 'r2', status: 'scheduled', scheduled_pt_session_id: GONE }],
  })
  assert.deepEqual(noSessions.pt_requests, [{ id: 'r2', status: 'scheduled', scheduled_pt_session_id: null }])
})

test('TEN-142 an archive from before migration 0145 restores each Class Type, sub-types too, in the studio’s first live Entity, and one that carries an Entity is left as it is', () => {
  const upgraded = upgradeArchiveRows({
    entities: [
      { id: 'old', name: 'Old', slug: 'old', position: 0, archived_at: '2026-01-01T00:00:00Z' },
      { id: 'second', name: 'Barre', slug: 'barre', position: 2, archived_at: null },
      { id: 'first', name: 'Yoga', slug: 'yoga', position: 1, archived_at: null },
    ],
    class_types: [
      { id: 'root', name: 'Yoga', parent_id: null },
      { id: 'sub', name: 'Hatha', parent_id: 'root' },
    ],
  })
  assert.deepEqual(
    upgraded.class_types!.map(r => [r.id, r.entity_id]),
    [['root', 'first'], ['sub', 'first']],
  )

  // An archive from before the Entities table gets the one every studio starts with, and its Class Types go to it.
  const older = upgradeArchiveRows({ class_types: [{ id: 'root', name: 'Yoga' }] })
  assert.equal(older.entities!.length, 1)
  assert.equal(older.class_types![0]!.entity_id, older.entities![0]!.id)

  // A row that has the column keeps it, null included.
  const current = upgradeArchiveRows({
    entities: [{ id: 'first', name: 'Yoga', slug: 'yoga', position: 0, archived_at: null }],
    class_types: [
      { id: 'a', entity_id: 'first' },
      { id: 'b', entity_id: null },
    ],
  })
  assert.deepEqual(current.class_types!.map(r => r.entity_id), ['first', null])
})

test('SUP-44 an archive whose packages name no Entity puts them in the first live Entity, and one whose packages already name theirs is left alone', () => {
  const packages = { class_packages: [{ id: 'c1' }, { id: 'c2' }], pt_packages: [{ id: 'p1' }], corporate_packages: [{ id: 'k1' }] }

  // Before Entities: the one synthesised "All classes" holds every package.
  const old = upgradeArchiveRows(packages)
  const [all] = old.entities!
  assert.equal(all!.name, 'All classes')
  for (const table of ['class_packages', 'pt_packages', 'corporate_packages']) {
    for (const row of old[table]!) assert.equal(row.entity_id, all!.id, `${table} lands in it`)
  }

  // Entities, but taken before packages carried one: the first live Entity by position, archived ones passed over.
  const between = upgradeArchiveRows({
    ...packages,
    entities: [
      { id: 'barre', position: 0, archived_at: '2026-01-01T00:00:00Z' },
      { id: 'pilates', position: 2, archived_at: null },
      { id: 'yoga', position: 1, archived_at: null },
    ],
  })
  assert.deepEqual(between.class_packages, [
    { id: 'c1', entity_id: 'yoga' },
    { id: 'c2', entity_id: 'yoga' },
  ])
  assert.deepEqual(between.corporate_packages, [{ id: 'k1', entity_id: 'yoga' }])

  // Current: a package's own Entity, even one since archived, or none, is the studio's choice.
  const current = {
    entities: [{ id: 'yoga', position: 0, archived_at: null }, { id: 'barre', position: 1, archived_at: '2026-01-01T00:00:00Z' }],
    class_packages: [{ id: 'c1', entity_id: 'barre' }, { id: 'c2', entity_id: null }],
  }
  assert.deepEqual(upgradeArchiveRows(current), current)
})

test('TEN-144 an archive from before migration 0151 restores a package of kind trial as a Credit Bundle trial, and leaves every other package as it is', () => {
  const archive = {
    class_packages: [
      { id: 'c1', kind: 'trial' },
      { id: 'c2', kind: 'trial', is_trial: true },
      { id: 'c3', kind: 'credit_bundle', is_trial: false },
      { id: 'c4', kind: 'unlimited', is_trial: true },
    ],
    client_packages: [{ id: 'h1', kind: 'trial' }, { id: 'h2', kind: 'pt', is_trial: true }],
  }
  const out = upgradeArchiveRows(archive)
  assert.deepEqual(out.class_packages, [
    { id: 'c1', kind: 'credit_bundle', is_trial: true },
    { id: 'c2', kind: 'credit_bundle', is_trial: true },
    { id: 'c3', kind: 'credit_bundle', is_trial: false },
    { id: 'c4', kind: 'unlimited', is_trial: true },
  ])
  assert.deepEqual(out.client_packages, [{ id: 'h1', kind: 'credit_bundle', is_trial: true }, { id: 'h2', kind: 'pt', is_trial: true }])
})

test("the caller's archive is not changed", () => {
  const archive = { leave_pools: [{ instructor_id: ADA }] }
  upgradeArchiveRows(archive)
  assert.deepEqual(archive, { leave_pools: [{ instructor_id: ADA }] })
})
