import assert from 'node:assert/strict'
import { test } from 'node:test'
import { soldTermsFromMetadata, soldTermsMetadata, type SoldTerms } from './sold-terms'

const dropEmpty = (meta: Record<string, string>) => Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== ''))

const bundle: SoldTerms = { creditsOrSessions: 10, validityDays: 90, durationMonths: null, listPriceSgd: '150.00' }
const plan: SoldTerms = { creditsOrSessions: null, validityDays: null, durationMonths: 3, listPriceSgd: '300.00' }

test('PAY-71 the terms a checkout froze read back the same, whether its empty values are kept or dropped', () => {
  for (const terms of [bundle, plan]) {
    const written = { kind: 'class_package', ...soldTermsMetadata(terms) }
    assert.deepEqual(soldTermsFromMetadata(written), terms)
    assert.deepEqual(soldTermsFromMetadata(dropEmpty(written)), terms)
  }
})

test('PAY-73 a session from before checkout froze its terms, carrying only a List Price, reads as no frozen terms', () => {
  assert.equal(soldTermsFromMetadata({ kind: 'class_package', package_id: 'p-1', list_price_sgd: '150.00' }), null)
})
