import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { backendTestFiles } from './backend-tests.mjs'

/** A throwaway `be/` with these files. */
function be(files) {
  const dir = mkdtempSync(join(tmpdir(), 'be-scripts-'))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), body)
  }
  return dir
}

// `npm run check` runs `scripts/**/*.test.mjs` too, so the Stop hook has to pick them.
const SCRIPTS = {
  'scripts/test-db.mjs': '',
  'scripts/test-db.test.mjs': "import { testDatabaseName } from './test-db.mjs'\n",
  'scripts/check.mjs': '',
  'scripts/check.test.mjs': "import { nodeArgs } from './check.mjs'\n",
  'src/services/money.ts': '',
  'src/services/money.test.ts': "import { money } from './money'\n",
}

test('a changed script runs the script tests that import it, and no others', () => {
  assert.deepEqual(backendTestFiles(be(SCRIPTS), ['scripts/test-db.mjs']), ['scripts/test-db.test.mjs'])
})

test('a changed script test runs itself', () => {
  assert.deepEqual(backendTestFiles(be(SCRIPTS), ['scripts/check.test.mjs']), ['scripts/check.test.mjs'])
})

test('a change under src/ still picks only src/ tests', () => {
  assert.deepEqual(backendTestFiles(be(SCRIPTS), ['src/services/money.ts']), ['src/services/money.test.ts'])
})
