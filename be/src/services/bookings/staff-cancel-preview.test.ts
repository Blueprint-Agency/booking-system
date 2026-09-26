import assert from 'node:assert'
import { test } from 'node:test'
import { staffCanCancel, staffCancelPreview, type StaffCancelInput } from './staff-cancel-preview'

const HOUR = 3_600_000
const now = new Date('2026-10-01T09:00:00Z')
const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * HOUR)

const booked: StaffCancelInput = {
  kind: 'class',
  state: 'confirmed',
  checkInState: 'pending',
  creditsUsed: 1,
  packageName: '10-Class Pass',
  packageKind: 'credit_bundle',
  startsAt: at(48),
}

test('a staff cancel of a class paid in credits previews the credits and the package they came from', () => {
  assert.deepEqual(staffCancelPreview(booked, 24, now), {
    credits: 1,
    packageName: '10-Class Pass',
    unlimited: false,
    late: false,
  })
  assert.equal(staffCancelPreview({ ...booked, creditsUsed: 2 }, 24, now)?.credits, 2)
})

test('a class on an Unlimited plan previews nothing spent', () => {
  const preview = staffCancelPreview(
    { ...booked, creditsUsed: 0, packageName: 'Unlimited', packageKind: 'unlimited' },
    24,
    now,
  )
  assert.equal(preview?.credits, 0)
  assert.equal(preview?.unlimited, true)
})

test('the preview says whether the class is already inside its Cancellation Window', () => {
  assert.equal(staffCancelPreview({ ...booked, startsAt: at(25) }, 24, now)?.late, false)
  assert.equal(staffCancelPreview({ ...booked, startsAt: at(23) }, 24, now)?.late, true)
  // The class's own window, not the studio's, is the one passed in.
  assert.equal(staffCancelPreview({ ...booked, startsAt: at(23) }, 12, now)?.late, false)
  // Started: inside by any window.
  assert.equal(staffCancelPreview({ ...booked, startsAt: at(-1) }, 0, now)?.late, true)
})

test('only a still-booked, unattended class is offered a staff cancel', () => {
  assert.equal(staffCanCancel(booked), true)
  for (const b of [
    { ...booked, kind: 'workshop' as const },
    { ...booked, kind: 'pt' as const },
    { ...booked, state: 'cancelled' as const },
    { ...booked, state: 'no_show' as const },
    { ...booked, checkInState: 'attended' as const },
  ]) {
    assert.equal(staffCanCancel(b), false)
    assert.equal(staffCancelPreview(b, 24, now), null)
  }
})
