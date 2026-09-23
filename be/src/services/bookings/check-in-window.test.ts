import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { checkInOpensAt, checkInWindow } from './check-in-window'

const TZ = 'Asia/Singapore'
// 09:00 in Singapore.
const startsAt = new Date('2026-09-22T01:00:00Z')
const at = (iso: string) => new Date(iso)
const scan = (now: Date, minutesBefore = 30) =>
  checkInWindow({ now, startsAt, minutesBefore, timezone: TZ, closesWithTheDay: true })

describe('checkInWindow', () => {
  test('opens exactly the window before the start', () => {
    assert.equal(checkInOpensAt(startsAt, 30).toISOString(), '2026-09-22T00:30:00.000Z')
    assert.equal(scan(at('2026-09-22T00:29:59Z')), 'not_open')
    assert.equal(scan(at('2026-09-22T00:30:00Z')), 'open')
    assert.equal(scan(at('2026-09-22T00:45:00Z')), 'open')
  })

  test('a zero window opens at the start', () => {
    assert.equal(scan(at('2026-09-22T00:59:59Z'), 0), 'not_open')
    assert.equal(scan(at('2026-09-22T01:00:00Z'), 0), 'open')
  })

  test("a scan stays open to the end of the session's local day, then closes", () => {
    // 23:59 in Singapore is 15:59 UTC.
    assert.equal(scan(at('2026-09-22T15:59:00Z')), 'open')
    assert.equal(scan(at('2026-09-22T16:00:00Z')), 'closed')
    assert.equal(scan(at('2026-09-25T01:00:00Z')), 'closed')
  })

  test('a class the day after is not open yet, whatever the clock says', () => {
    assert.equal(scan(at('2026-09-21T01:00:00Z')), 'not_open')
  })

  test('a tick never closes', () => {
    const now = at('2026-09-30T01:00:00Z')
    assert.equal(
      checkInWindow({ now, startsAt, minutesBefore: 30, timezone: TZ, closesWithTheDay: false }),
      'open',
    )
  })
})
