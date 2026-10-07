import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASE_FLAGS,
  DEFAULT_PATTERNS,
  listTestFiles,
  nodeArgs,
  nodeRefusal,
  parseShard,
  resetsDatabase,
  shardFiles,
  testDatabaseUrl,
} from './check.mjs'

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

test('SHARD is i/n with 1 <= i <= n, or unset', () => {
  assert.equal(parseShard(undefined), null)
  assert.equal(parseShard(''), null)
  assert.deepEqual(parseShard('2/6'), { index: 2, total: 6 })
  assert.deepEqual(parseShard('1/1'), { index: 1, total: 1 })
  for (const bad of ['0/4', '5/4', '2', '2/', 'a/b', '1.5/4']) {
    assert.throws(() => parseShard(bad), /SHARD must be i\/n/, bad)
  }
})

test('the shards of a file list are disjoint, together the whole list, and the same every time', () => {
  const files = ['d.test.ts', 'b.test.ts', 'a.test.ts', 'c.test.ts', 'e.test.ts']
  assert.deepEqual(shardFiles(files, { index: 1, total: 2 }), ['a.test.ts', 'c.test.ts', 'e.test.ts'])
  assert.deepEqual(shardFiles(files, { index: 2, total: 2 }), ['b.test.ts', 'd.test.ts'])
  for (const total of [1, 2, 3, 7]) {
    const shards = Array.from({ length: total }, (_, i) => shardFiles(files, { index: i + 1, total }))
    assert.deepEqual(shards.flat().sort(), [...files].sort(), `n=${total} covers every file once`)
    assert.ok(shards.every(s => s.length >= Math.floor(files.length / total)), `n=${total} is balanced`)
  }
  // More shards than files: the surplus shards are empty, nothing is lost.
  assert.deepEqual(shardFiles(files, { index: 6, total: 6 }), [])
})

test('the checkout’s own test files shard without loss', () => {
  const all = listTestFiles(join(dirname(fileURLToPath(import.meta.url)), '..'))
  assert.ok(all.length > 100, `${all.length} test files found`)
  assert.ok(all.includes('scripts/check.test.mjs'))
  assert.ok(all.every(f => !f.includes('\\')), 'forward slashes, so the slicing is the same on every OS')
  const total = 6
  const shards = Array.from({ length: total }, (_, i) => shardFiles(all, { index: i + 1, total }))
  assert.deepEqual(shards.flat().sort(), all)
  assert.deepEqual(new Set(shards.flat()).size, all.length)
})

test('named files replace the default patterns', () => {
  assert.deepEqual(nodeArgs(['--test-reporter=spec', 'src/test/refunds.test.ts', 'src/test/rls.test.ts']), [
    ...BASE_FLAGS,
    '--test-reporter=spec',
    'src/test/refunds.test.ts',
    'src/test/rls.test.ts',
  ])
})
