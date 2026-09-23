import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { affectedSuites, decide, failureExcerpt, lockDatabase, skippedCount, unlockDatabase } from './affected-tests.mjs'

const ids = (paths) => affectedSuites(paths).map((s) => s.id)

test('a change picks the suite of the app it is in', () => {
  assert.deepEqual(ids(['be/src/services/billing/refund.ts']), ['be'])
  assert.deepEqual(ids(['fe-client/src/app/page.tsx']), ['fe-client'])
  assert.deepEqual(ids(['fe-portal/src/lib/x.ts']), ['fe-portal'])
  assert.deepEqual(ids(['e2e/journeys/buy-and-book.spec.ts']), ['e2e'])
  assert.deepEqual(ids(['scripts/check-error-codes.mjs']), ['scripts'])
  assert.deepEqual(ids(['.claude/hooks/protect-tests.mjs']), ['scripts'])
})

test('several apps changed run several suites, each once, in a fixed order', () => {
  assert.deepEqual(ids(['fe-portal/a.ts', 'be/src/a.ts', 'be/src/b.ts', 'scripts/x.mjs']), ['be', 'fe-portal', 'scripts'])
})

test('docs, ignore files and files outside any suite run nothing', () => {
  assert.deepEqual(ids(['docs/md/prd.md', 'be/CONTEXT.md', 'CLAUDE.md', 'cdn/api/proxy.ts', '.github/workflows/e2e.yml']), [])
  assert.deepEqual(ids(['be/.gitignore', 'e2e/.gitignore']), [])
})

test('a lockfile or config change still runs the suite', () => {
  assert.deepEqual(ids(['be/package-lock.json']), ['be'])
  assert.deepEqual(ids(['e2e/playwright.config.ts']), ['e2e'])
})

test('skipped tests are read from the spec reporter summary', () => {
  assert.equal(skippedCount('ℹ tests 715\nℹ pass 694\nℹ skipped 21\nℹ todo 0\n'), 21)
  assert.equal(skippedCount('ℹ tests 3\nℹ skipped 0\n'), 0)
  assert.equal(skippedCount('no summary here'), 0)
})

test('a failing run is cut to its failures section', () => {
  const output = [
    '▶ bookings',
    '  ✔ books a class (10ms)',
    '  ✖ cancels a class (12ms)',
    'ℹ tests 2',
    'ℹ fail 1',
    '',
    '✖ failing tests:',
    '',
    'test at src/test/bookings.test.ts:20:3',
    '✖ cancels a class (12ms)',
    '  AssertionError: expected 200, got 409',
  ].join('\n')
  assert.equal(
    failureExcerpt(output),
    ['✖ failing tests:', '', 'test at src/test/bookings.test.ts:20:3', '✖ cancels a class (12ms)', '  AssertionError: expected 200, got 409'].join('\n'),
  )
})

test('output without a failures section keeps its tail, and a long one is cut', () => {
  assert.equal(failureExcerpt('a\nb\nerror TS2322: nope'), 'a\nb\nerror TS2322: nope')
  const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')
  const cut = failureExcerpt(long).split('\n')
  assert.equal(cut[0], '… (300 lines above cut)')
  assert.equal(cut.at(-1), 'line 499')
  assert.equal(cut.length, 201)
})

test('one backend run at a time holds the test database', () => {
  const lock = join(mkdtempSync(join(tmpdir(), 'db-lock-')), 'lock')
  assert.equal(lockDatabase(lock, 0), true)
  assert.equal(readFileSync(join(lock, 'pid'), 'utf8'), String(process.pid))
  // A live holder (this process) keeps it; a second run waits, then gives up.
  assert.equal(lockDatabase(lock, 100), false)
  unlockDatabase(lock)
  assert.equal(existsSync(lock), false)
  assert.equal(lockDatabase(lock, 0), true)
  unlockDatabase(lock)
})

test('a lock left by a run that died is taken over', () => {
  const lock = join(mkdtempSync(join(tmpdir(), 'db-lock-')), 'lock')
  mkdirSync(lock)
  writeFileSync(join(lock, 'pid'), '999999999')
  assert.equal(lockDatabase(lock, 100), true)
  assert.equal(readFileSync(join(lock, 'pid'), 'utf8'), String(process.pid))
  unlockDatabase(lock)
})

test('a failure blocks the stop; a clean run lets it through', () => {
  assert.deepEqual(decide({ failures: [], known: [], stopHookActive: false }), { action: 'allow' })
  assert.equal(decide({ failures: ['be'], known: [], stopHookActive: false }).action, 'block')
})

test('after one block, failures nothing has changed since let the agent stop, with a warning', () => {
  // The agent was sent back, changed nothing, and is stopping again: it has
  // given up, or needs the human. Blocking again would loop forever.
  assert.deepEqual(decide({ failures: [], known: ['be'], stopHookActive: true }), { action: 'warn', suites: ['be'] })
  // But a new failure — code changed since the last block — still blocks.
  assert.equal(decide({ failures: ['fe-portal'], known: ['be'], stopHookActive: true }).action, 'block')
  // Without having been blocked just now, a known failure blocks again.
  assert.equal(decide({ failures: [], known: ['be'], stopHookActive: false }).action, 'block')
})
