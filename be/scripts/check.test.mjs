import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASE_FLAGS,
  LOADER,
  connectionReason,
  databaseRefusal,
  listTestFiles,
  nodeArgs,
  nodeNote,
  nodeRefusal,
  parseShard,
  resetsDatabase,
  shardFiles,
  testDatabaseUrl,
  testFiles,
} from './check.mjs'

const beDir = join(dirname(fileURLToPath(import.meta.url)), '..')

test('a bare run tests every file the default patterns match', () => {
  assert.deepEqual(nodeArgs([]), [...BASE_FLAGS, LOADER])
  assert.deepEqual(testFiles([], beDir), listTestFiles(beDir))
})

test('flags go before the file node --test runs, where it still reads them', () => {
  assert.deepEqual(nodeArgs(['--test-reporter=tap', '--test-reporter-destination=stdout']), [
    ...BASE_FLAGS,
    '--test-reporter=tap',
    '--test-reporter-destination=stdout',
    LOADER,
  ])
})

test("a flag's value written after a space is refused, not run as a pattern", () => {
  assert.throws(() => nodeArgs(['--test-reporter', 'tap']), /not a test file: tap/)
})

test('the Node major .nvmrc names runs the suite, and so does a newer one; an older one does not', () => {
  assert.equal(nodeRefusal('v22.11.0', '22\n'), null)
  assert.equal(nodeRefusal('v22.11.0', 'v22.3.0'), null)
  assert.equal(nodeRefusal('v23.11.1', '22\n'), null)
  assert.match(nodeRefusal('v20.19.1', '22'), /this is Node v20\.19\.1, and CI runs Node 22/)
  assert.match(nodeRefusal('v20.19.1', '22'), /nvm use 22/)
})

test('a newer Node runs with a note that CI s verdict is still Node 22 s', () => {
  assert.equal(nodeNote('v22.11.0', '22\n'), null)
  assert.match(nodeNote('v23.11.1', '22\n'), /Node v23\.11\.1.*CI runs Node 22/)
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
  const all = listTestFiles(beDir)
  assert.ok(all.length > 100, `${all.length} test files found`)
  assert.ok(all.includes('scripts/check.test.mjs'))
  assert.ok(all.every(f => !f.includes('\\')), 'forward slashes, so the slicing is the same on every OS')
  const total = 6
  const shards = Array.from({ length: total }, (_, i) => shardFiles(all, { index: i + 1, total }))
  assert.deepEqual(shards.flat().sort(), all)
  assert.deepEqual(new Set(shards.flat()).size, all.length)
})

test('named files replace the default patterns', () => {
  const args = ['--test-reporter=spec', 'src/test/refunds.test.ts', 'src/test/rls.test.ts']
  assert.deepEqual(nodeArgs(args), [...BASE_FLAGS, '--test-reporter=spec', LOADER])
  assert.deepEqual(testFiles(args, beDir), ['src/test/refunds.test.ts', 'src/test/rls.test.ts'])
})

test('a test database that refuses the connection is named by host and port, never by its password', () => {
  const said = databaseRefusal('postgres://postgres:s3cret@localhost:5433/reservetoday-test', 'password authentication failed for user "postgres"')
  assert.match(said, /localhost:5433/)
  assert.match(said, /password authentication failed/)
  assert.match(said, /docker ps/, 'it says how to find the port this checkout s Postgres is on')
  assert.doesNotMatch(said, /s3cret/)
})

test('a connection refused with no message is named by its code, never an empty reason', () => {
  const refused = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' })
  assert.match(databaseRefusal('postgres://u:p@localhost:5434/t', connectionReason(refused)), /refused the connection: ECONNREFUSED\./)
})

/** `npm run check` on fixture test files written to a temporary directory, so the suite never picks them up. */
function checkFixtures(fixtures) {
  const dir = mkdtempSync(join(tmpdir(), 'check-fixtures-'))
  try {
    const files = Object.entries(fixtures).map(([name, source]) => {
      writeFileSync(join(dir, name), source)
      return join(dir, name)
    })
    const { NODE_TEST_CONTEXT, ...env } = process.env
    return spawnSync(process.execPath, ['scripts/check.mjs', '--test-reporter=tap', ...files], {
      cwd: beDir,
      env,
      encoding: 'utf8',
      timeout: 60_000,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a test file whose own code fails, after a test of its own passed, fails the run', () => {
  const run = checkFixtures({
    'asserts-after-a-test.test.mjs':
      "import assert from 'node:assert'\nimport { test } from 'node:test'\n" +
      "test('passes', () => {})\nassert.strictEqual(1, 2)\ntest('below the assertion', () => {})\n",
    'fails-to-load.test.mjs': "import { test } from 'node:test'\nimport { gone } from './missing.mjs'\ntest('passes', () => {})\n",
  })
  assert.equal(run.status, 1, `npm run check exits 1\n${run.stdout}\n${run.stderr}`)
  assert.match(run.stdout, /^not ok \d+ - .*asserts-after-a-test\.test\.mjs$/m, 'the failed top-level assertion fails its file')
  assert.match(run.stdout, /^not ok \d+ - .*fails-to-load\.test\.mjs$/m, 'the file that cannot load fails')
  assert.match(run.stdout, /^# fail 2$/m, 'the TAP summary counts both files as failures')
})

test('a rejection a test file leaves unawaited fails a run whose tests all pass', () => {
  const run = checkFixtures({
    'rejects-unawaited.test.mjs':
      "import { test } from 'node:test'\n" +
      "test('passes', () => {})\nPromise.reject(new Error('rejected at the top level'))\n",
  })
  assert.equal(run.status, 1, `npm run check exits 1\n${run.stdout}\n${run.stderr}`)
  assert.match(run.stdout, /^# fail 0$/m, 'every test passed')
  assert.match(run.stdout, /rejected at the top level/, 'the unawaited rejection is reported')
})
