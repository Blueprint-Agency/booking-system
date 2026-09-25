import assert from 'node:assert'
import { test } from 'node:test'
import { adminCanCancel, adminCancelNotice, type AdminCancelInput } from './admin-cancel-notice'

const booked: AdminCancelInput = {
  kind: 'class',
  state: 'confirmed',
  checkInState: 'pending',
  creditsUsed: 1,
  packageName: '10-Class Pass',
  packageKind: 'credit_bundle',
}

test('an admin cancel of a class paid in credits says the credits go back', () => {
  assert.equal(adminCancelNotice(booked), '1 credit goes back to 10-Class Pass.')
  assert.equal(adminCancelNotice({ ...booked, creditsUsed: 2 }), '2 credits go back to 10-Class Pass.')
})

test('an admin cancel of a class on an Unlimited plan only frees the place', () => {
  assert.equal(
    adminCancelNotice({ ...booked, creditsUsed: 0, packageName: 'Unlimited', packageKind: 'unlimited' }),
    'Their plan is unlimited, so nothing goes back — the place is freed.',
  )
})

test('only a still-booked class is offered a cancel', () => {
  assert.equal(adminCanCancel(booked), true)
  for (const b of [
    { ...booked, kind: 'workshop' as const },
    { ...booked, kind: 'pt' as const },
    { ...booked, state: 'cancelled' as const },
    { ...booked, checkInState: 'attended' as const },
  ]) {
    assert.equal(adminCanCancel(b), false)
    assert.equal(adminCancelNotice(b), null)
  }
})
