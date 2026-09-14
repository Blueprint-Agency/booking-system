import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bcryptDigestsFromCsv,
  emptyPoolReport,
  productionRefusal,
  reportIsClean,
  type ImportReport,
} from './clerk-import'

const cleanPools = (): ImportReport['pools'] => ({
  client: { ...emptyPoolReport('client'), exported: 3, inserted: 3, mapped: 3 },
  staff: { ...emptyPoolReport('staff'), exported: 2, inserted: 1, alreadyPresent: 1, mapped: 2 },
  platform: { ...emptyPoolReport('platform'), exported: 1, inserted: 1 },
})

const report = (appEnv: string, pools = cleanPools()): ImportReport => ({ appEnv, ranAt: '2026-09-14T00:00:00Z', pools })

test('a report is clean when every pool accounts for every export and leaves nothing unmapped', () => {
  assert.equal(reportIsClean(report('staging')), true)

  const unmapped = cleanPools()
  unmapped.staff.unmapped = [{ table: 'staff_users', tenantId: 't', rowId: 'r', clerkUserId: 'user_x' }]
  assert.equal(reportIsClean(report('staging', unmapped)), false)

  const lost = cleanPools()
  lost.client.inserted = 2
  assert.equal(reportIsClean(report('staging', lost)), false, 'exported 3, only 2 accounted for')

  const empty = { client: emptyPoolReport('client'), staff: emptyPoolReport('staff'), platform: emptyPoolReport('platform') }
  assert.equal(reportIsClean(report('staging', empty)), false, 'a run that exported nobody read the wrong applications')
})

test('production is refused without a clean staging report, and only production is gated', () => {
  assert.equal(productionRefusal('staging', null), null)
  assert.equal(productionRefusal('development', null), null)
  assert.match(productionRefusal('prod', null)!, /APP_ENV/, 'a typo is refused, not waved through as non-production')

  assert.match(productionRefusal('production', null)!, /staging report/)
  assert.match(productionRefusal('production', report('development'))!, /staging/)

  const dirty = cleanPools()
  dirty.client.unmapped = [{ table: 'clients', tenantId: 't', rowId: 'r', clerkUserId: 'user_y' }]
  assert.match(productionRefusal('production', report('staging', dirty))!, /not clean/)

  assert.equal(productionRefusal('production', report('staging')), null)
})

test("a Clerk CSV export yields each user's bcrypt digest by Clerk id, and nothing else", () => {
  const csv = [
    'id,first_name,last_name,primary_email_address,password_digest,password_hasher',
    'user_a,Ann,Lee,ann@example.test,$2a$10$abcdefghijklmnopqrstuv,bcrypt',
    'user_b,"Bo, Jr",Tan,bo@example.test,,',
    'user_c,Cy,Ng,cy@example.test,$argon2id$v=19$xyz,argon2id',
  ].join('\n')
  const digests = bcryptDigestsFromCsv(csv)
  assert.deepEqual([...digests], [['user_a', '$2a$10$abcdefghijklmnopqrstuv']])
})
