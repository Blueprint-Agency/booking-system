import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tierEffectivePrice } from './book'
import type { workshopTiers } from '../../db/schema/schedule'
import { TENANT_ONE_ID } from '../../db/schema/tenancy'

const CUTOFF = new Date('2026-06-01T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const tier: typeof workshopTiers.$inferSelect = {
  id: 'tier',
  tenantId: TENANT_ONE_ID,
  workshopId: 'workshop',
  name: 'Full pass',
  description: null,
  regularPriceSgd: '200.00',
  earlyBirdPriceSgd: '150.00',
  earlyBirdQuota: null,
  earlyBirdCutoffAt: CUTOFF,
  ord: 1,
}

test('WSP-09 the early-bird price applies before its cutoff and the regular price from it on', () => {
  const before = tierEffectivePrice(tier, [], new Date(CUTOFF.getTime() - 1))
  assert.equal(before.baseSgd, '150.00')
  assert.equal(before.appliedPromotionId, null)

  assert.equal(Number(tierEffectivePrice(tier, [], CUTOFF).baseSgd), 200)
  assert.equal(Number(tierEffectivePrice(tier, [], new Date(CUTOFF.getTime() + DAY)).baseSgd), 200)
})
