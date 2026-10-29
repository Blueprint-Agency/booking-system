import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CorruptSoldTermsError,
  soldListPriceFromMetadata,
  soldTermsForKind,
  soldTermsFromMetadata,
  soldTermsMetadata,
  type SoldTerms,
} from './sold-terms'

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

const pt: SoldTerms = { creditsOrSessions: 5, validityDays: 90, durationMonths: null, listPriceSgd: '400.00' }
const written = (terms: SoldTerms, override: Record<string, string | null> = {}): Record<string, string> => {
  const meta: Record<string, string> = { ...soldTermsMetadata(terms) }
  for (const [key, value] of Object.entries(override)) {
    if (value === null) delete meta[key]
    else meta[key] = value
  }
  return meta
}

test('PAY-74 terms that are complete for the package kind they were sold as read back, whether the empty values are kept or dropped', () => {
  const sold: Array<[Parameters<typeof soldTermsForKind>[1], SoldTerms]> = [
    ['credit_bundle', bundle],
    ['trial', { ...bundle, listPriceSgd: '0.00' }],
    ['unlimited', plan],
    ['pt', pt],
  ]
  for (const [kind, terms] of sold) {
    assert.deepEqual(soldTermsForKind(soldTermsMetadata(terms), kind), terms, kind)
    assert.deepEqual(soldTermsForKind(dropEmpty(soldTermsMetadata(terms)), kind), terms, kind)
  }
})

test('PAY-74 a sale none of whose credits, validity or Duration carries a value is an old sale, whatever its kind', () => {
  for (const kind of ['credit_bundle', 'trial', 'unlimited', 'pt'] as const) {
    assert.equal(soldTermsForKind({ list_price_sgd: '150.00' }, kind), null, kind)
    assert.equal(soldTermsForKind({ credits_or_sessions: '', validity_days: '', duration_months: '' }, kind), null, kind)
    assert.equal(soldTermsForKind({}, kind), null, kind)
  }
})

test('PAY-74 terms incomplete or malformed for the kind they were sold as are corrupt, naming the key at fault', () => {
  const corrupt: Array<[string, Parameters<typeof soldTermsForKind>[1], SoldTerms, Record<string, string | null>, string]> = [
    ['a length but no credits', 'credit_bundle', bundle, { credits_or_sessions: null }, 'credits_or_sessions'],
    ['credits but no length', 'credit_bundle', bundle, { validity_days: null }, 'validity_days'],
    ['a trial with a length but no credits', 'trial', bundle, { credits_or_sessions: '' }, 'credits_or_sessions'],
    ['a Duration on a Credit Bundle', 'credit_bundle', bundle, { duration_months: '3' }, 'duration_months'],
    ['a Duration on a PT package', 'pt', pt, { duration_months: '3' }, 'duration_months'],
    ['a PT package with no sessions', 'pt', pt, { credits_or_sessions: null }, 'credits_or_sessions'],
    ['an Unlimited Plan with no Duration', 'unlimited', plan, { duration_months: null, validity_days: '30' }, 'duration_months'],
    ['an Unlimited Plan with credits', 'unlimited', plan, { credits_or_sessions: '5' }, 'credits_or_sessions'],
    ['an Unlimited Plan with a validity', 'unlimited', plan, { validity_days: '30' }, 'validity_days'],
    ['zero credits', 'credit_bundle', bundle, { credits_or_sessions: '0' }, 'credits_or_sessions'],
    ['negative credits', 'credit_bundle', bundle, { credits_or_sessions: '-3' }, 'credits_or_sessions'],
    ['fractional credits', 'credit_bundle', bundle, { credits_or_sessions: '2.5' }, 'credits_or_sessions'],
    ['credits that are not a number', 'credit_bundle', bundle, { credits_or_sessions: 'abc' }, 'credits_or_sessions'],
    ['a validity that is not a number', 'credit_bundle', bundle, { validity_days: 'abc' }, 'validity_days'],
    ['a zero validity', 'pt', pt, { validity_days: '0' }, 'validity_days'],
    ['a count too large for the column', 'credit_bundle', bundle, { credits_or_sessions: '99999999999' }, 'credits_or_sessions'],
    ['a zero Duration', 'unlimited', plan, { duration_months: '0' }, 'duration_months'],
    ['no List Price', 'credit_bundle', bundle, { list_price_sgd: null }, 'list_price_sgd'],
    ['an empty List Price', 'unlimited', plan, { list_price_sgd: '' }, 'list_price_sgd'],
    ['a List Price that is not money', 'credit_bundle', bundle, { list_price_sgd: 'free' }, 'list_price_sgd'],
    ['a negative List Price', 'credit_bundle', bundle, { list_price_sgd: '-1.00' }, 'list_price_sgd'],
    ['a List Price to a tenth of a cent', 'credit_bundle', bundle, { list_price_sgd: '150.001' }, 'list_price_sgd'],
  ]
  for (const [what, kind, terms, override, key] of corrupt) {
    assert.throws(
      () => soldTermsForKind(written(terms, override), kind),
      (err: unknown) => err instanceof CorruptSoldTermsError && err.key === key,
      what,
    )
  }
})

test('PAY-74 the catalogue upper bounds are not applied to terms already sold', () => {
  const long = { ...bundle, creditsOrSessions: 5000, validityDays: 20000 }
  assert.deepEqual(soldTermsForKind(soldTermsMetadata(long), 'credit_bundle'), long)
})

test('PAY-74 a List Price too large for the price column is corrupt terms naming the key, not an overflow at the insert', () => {
  assert.equal(soldListPriceFromMetadata({ list_price_sgd: '99999999.99' }), '99999999.99')
  for (const tooBig of ['100000000', '100000000.00', '123456789.50']) {
    assert.throws(
      () => soldListPriceFromMetadata({ list_price_sgd: tooBig }),
      (err: unknown) => err instanceof CorruptSoldTermsError && err.key === 'list_price_sgd',
      tooBig,
    )
  }
})

test('WSP-34 a workshop place reads its List Price as money to the cent, no value as an old sale, and anything else as corrupt', () => {
  assert.equal(soldListPriceFromMetadata({ list_price_sgd: '150.00' }), '150.00')
  assert.equal(soldListPriceFromMetadata({ list_price_sgd: '0.00' }), '0.00')
  assert.equal(soldListPriceFromMetadata({ list_price_sgd: '150' }), '150')
  assert.equal(soldListPriceFromMetadata({}), null)
  assert.equal(soldListPriceFromMetadata({ list_price_sgd: '' }), null)
  for (const bad of ['abc', '-5.00', '150.001', '1e2', ' 150.00']) {
    assert.throws(
      () => soldListPriceFromMetadata({ list_price_sgd: bad }),
      (err: unknown) => err instanceof CorruptSoldTermsError && err.key === 'list_price_sgd',
      bad,
    )
  }
})
