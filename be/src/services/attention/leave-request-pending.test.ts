import assert from 'node:assert'
import { test } from 'node:test'
import { toItem } from './leave-request-pending'
import type { AttentionContext } from './types'
import type { PendingLeaveForDecision } from '../leave/pending'

const context = (timezone: string, now: string): AttentionContext => ({
  tenantId: 't',
  staffId: 's',
  role: 'admin',
  permissions: new Set(),
  locations: [],
  timezone,
  now: new Date(now),
})

const request = (over: Partial<PendingLeaveForDecision> = {}): PendingLeaveForDecision => ({
  id: 'r1',
  applicantName: 'Anna',
  type: 'annual',
  startDate: '2026-10-16',
  endDate: '2026-10-16',
  halfDay: 'none',
  days: 1,
  createdAt: new Date('2026-10-10T00:00:00Z'),
  flag: null,
  ...over,
})

test('TEN-75 a pending leave request\'s deadline is the start of its first day on the studio\'s clock, which moves with daylight saving', () => {
  const sydney = context('Australia/Sydney', '2026-10-15T14:30:00Z')
  // Sydney on 16 October 2026 is UTC+11: midnight is 13:00 UTC on the 15th.
  assert.strictEqual(toItem(sydney, request()).deadlineAt?.toISOString(), '2026-10-15T13:00:00.000Z')
  // The same date before daylight saving began (4 October) is UTC+10.
  assert.strictEqual(toItem(sydney, request({ startDate: '2026-09-16', endDate: '2026-09-16' })).deadlineAt?.toISOString(), '2026-09-15T14:00:00.000Z')
  // A Singapore studio's midnight is 16:00 UTC the day before.
  const singapore = context('Asia/Singapore', '2026-10-15T14:30:00Z')
  assert.strictEqual(toItem(singapore, request()).deadlineAt?.toISOString(), '2026-10-15T16:00:00.000Z')
})

test('TEN-76 "starts today" counts the studio\'s calendar days: 00:30 in Sydney is the evening before in Singapore', () => {
  const now = '2026-10-15T14:30:00Z'
  assert.strictEqual(toItem(context('Australia/Sydney', now), request()).detail, '1 day · starts today')
  assert.strictEqual(toItem(context('Asia/Singapore', now), request()).detail, '1 day · starts in 1 day')
})
