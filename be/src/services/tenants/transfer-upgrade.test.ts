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
    { id: ANNA, role: 'admin', photo_r2_key: null },
  ])

  const current = {
    staff_users: [{ id: ADA, role: 'instructor', photo_r2_key: `t/${ADA}/avatars/newer.jpg` }],
    instructors: [{ staff_user_id: ADA, photo_r2_key: photo }],
  }
  assert.deepEqual(upgradeArchiveRows(current).staff_users, current.staff_users, 'a picture of their own is kept')
})

test("the caller's archive is not changed", () => {
  const archive = { leave_pools: [{ instructor_id: ADA }] }
  upgradeArchiveRows(archive)
  assert.deepEqual(archive, { leave_pools: [{ instructor_id: ADA }] })
})
