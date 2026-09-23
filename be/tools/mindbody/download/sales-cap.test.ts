import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSalesCap } from './sales-cap'

test('the Big Spenders cap: refused where it could have cut a member off, a warning near it, quiet well under it', () => {
  assert.equal(checkSalesCap({ cap: 10_000, members: 3_000, clientsListed: 1_700 }).level, 'ok')

  const near = checkSalesCap({ cap: 10_000, members: 9_200, clientsListed: 4_000 })
  assert.equal(near.level, 'warn')
  assert.match(near.message, /9200 members.*10000/)

  // More members than the report will list: whoever is past the cap lost every sale.
  const over = checkSalesCap({ cap: 10_000, members: 10_400, clientsListed: 6_000 })
  assert.equal(over.level, 'refuse')
  assert.match(over.message, /10400 members/)

  // The file itself is full: it stopped at the cap, so somebody was cut off.
  const full = checkSalesCap({ cap: 10_000, members: 9_000, clientsListed: 10_000 })
  assert.equal(full.level, 'refuse')
  assert.match(full.message, /lists 10000 clients/)
})
