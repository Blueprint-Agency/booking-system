import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { effectiveStatus, isIsoDate, localDate, termEndDate, termEnded } from './term-dates'

describe('term dates', () => {
  test('a date must exist to be one', () => {
    assert.equal(isIsoDate('2026-02-28'), true)
    assert.equal(isIsoDate('2028-02-29'), true)
    assert.equal(isIsoDate('2026-02-29'), false)
    assert.equal(isIsoDate('2026-13-01'), false)
    assert.equal(isIsoDate('2026-1-01'), false)
    assert.equal(isIsoDate('yesterday'), false)
  })

  test('the end is the start plus the duration, across a year', () => {
    assert.equal(termEndDate('2026-01-15', 3), '2026-04-15')
    assert.equal(termEndDate('2026-01-15', 6), '2026-07-15')
    assert.equal(termEndDate('2026-01-15', 12), '2027-01-15')
    assert.equal(termEndDate('2026-11-30', 3), '2027-02-28')
  })

  test('a day the target month lacks is clamped to its last day', () => {
    assert.equal(termEndDate('2026-08-31', 6), '2027-02-28')
    assert.equal(termEndDate('2027-08-31', 6), '2028-02-29')
    assert.equal(termEndDate('2028-02-29', 12), '2029-02-28')
  })

  test('the local date is the studio’s, not UTC’s', () => {
    // 16:30 UTC is already the next day in Singapore (+08:00).
    const at = new Date('2026-03-31T16:30:00Z')
    assert.equal(localDate('UTC', at), '2026-03-31')
    assert.equal(localDate('Asia/Singapore', at), '2026-04-01')
  })

  test('a Term ends on its end date, on the studio’s clock', () => {
    const studio = { timezone: 'Asia/Singapore', termEndDate: '2026-04-01' }
    assert.equal(termEnded(studio, new Date('2026-03-31T15:59:00Z')), false, 'still 31 March locally')
    assert.equal(termEnded(studio, new Date('2026-03-31T16:00:00Z')), true, 'midnight, 1 April, locally')
    assert.equal(termEnded({ ...studio, termEndDate: null }, new Date('2099-01-01')), false, 'open-ended')
  })

  test('an active studio past its Term is effectively suspended; other statuses stand', () => {
    const at = new Date('2026-05-01T00:00:00Z')
    const ended = { timezone: 'UTC', termEndDate: '2026-04-01' }
    assert.equal(effectiveStatus({ ...ended, status: 'active' }, at), 'suspended')
    assert.equal(effectiveStatus({ ...ended, status: 'archived' }, at), 'archived')
    assert.equal(effectiveStatus({ ...ended, termEndDate: '2026-06-01', status: 'active' }, at), 'active')
  })

  test('an unreadable zone reads as UTC rather than throwing', () => {
    assert.equal(termEnded({ timezone: 'Not/AZone', termEndDate: '2026-04-01' }, new Date('2026-04-01T00:00:00Z')), true)
  })
})
