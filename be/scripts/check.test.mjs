import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASE_FLAGS, DEFAULT_PATTERNS, nodeArgs, nodeRefusal, resetsDatabase, testDatabaseUrl } from './check.mjs'

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

test('only the Node major .nvmrc names runs the suite', () => {
  assert.equal(nodeRefusal('v22.11.0', '22\n'), null)
  assert.equal(nodeRefusal('v22.11.0', 'v22.3.0'), null)
  assert.match(nodeRefusal('v23.11.1', '22\n'), /this is Node v23\.11\.1, and CI runs Node 22/)
  assert.match(nodeRefusal('v20.19.1', '22'), /nvm use 22/)
})

test("the test database is the shell's, else be/.env's, else none", () => {
  const dotenv = 'POSTGRES_DB=reservetoday\nTEST_DATABASE_URL=postgres://u@localhost/reservetoday-test-a\n'
  assert.equal(
    testDatabaseUrl({ TEST_DATABASE_URL: 'postgres://ci@localhost/booking_test' }, dotenv),
    'postgres://ci@localhost/booking_test',
  )
  assert.equal(testDatabaseUrl({}, dotenv), 'postgres://u@localhost/reservetoday-test-a')
  assert.equal(testDatabaseUrl({ TEST_DATABASE_URL: '  ' }, 'TEST_DATABASE_URL=\n'), null)
  assert.equal(testDatabaseUrl({}, ''), null)
})

test('a full local run starts from an empty database; a run of named files, and CI, do not reset it', () => {
  assert.equal(resetsDatabase([], {}), true)
  assert.equal(resetsDatabase(['--test-reporter=spec'], {}), true)
  assert.equal(resetsDatabase(['src/test/refunds.test.ts'], {}), false)
  assert.equal(resetsDatabase([], { CI: 'true' }), false)
})

test('named files replace the default patterns', () => {
  assert.deepEqual(nodeArgs(['--test-reporter=spec', 'src/test/refunds.test.ts', 'src/test/rls.test.ts']), [
    ...BASE_FLAGS,
    '--test-reporter=spec',
    'src/test/refunds.test.ts',
    'src/test/rls.test.ts',
  ])
})
