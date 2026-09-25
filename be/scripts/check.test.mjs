import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASE_FLAGS, DEFAULT_PATTERNS, nodeArgs } from './check.mjs'

test('a bare run tests every default pattern', () => {
  assert.deepEqual(nodeArgs([]), [...BASE_FLAGS, ...DEFAULT_PATTERNS])
})

test('flags go before the patterns, where node --test still reads them', () => {
  assert.deepEqual(nodeArgs(['--test-reporter=tap', '--test-reporter-destination=stdout']), [
    ...BASE_FLAGS,
    '--test-reporter=tap',
    '--test-reporter-destination=stdout',
    ...DEFAULT_PATTERNS,
  ])
})

test("a flag's value written after a space is refused, not run as a pattern", () => {
  assert.throws(() => nodeArgs(['--test-reporter', 'tap']), /not a test file: tap/)
})

test('named files replace the default patterns', () => {
  assert.deepEqual(nodeArgs(['--test-reporter=spec', 'src/test/refunds.test.ts', 'src/test/rls.test.ts']), [
    ...BASE_FLAGS,
    '--test-reporter=spec',
    'src/test/refunds.test.ts',
    'src/test/rls.test.ts',
  ])
})
