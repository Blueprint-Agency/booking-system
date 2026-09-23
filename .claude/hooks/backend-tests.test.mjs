import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { backendTestFiles, GUARDS, HUB_LIMIT } from './backend-tests.mjs'

/** A throwaway `be/` with these files. */
function be(files) {
  const dir = mkdtempSync(join(tmpdir(), 'be-'))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), body)
  }
  return dir
}

const APP = {
  'src/app.ts': "import client from './routes/client'\napp.route('/api/v1/me', client)\n",
  'src/routes/client/index.ts':
    "import me from './me'\nimport bookings from './bookings'\nexport default new Hono().route('/', me).route('/bookings', bookings)\n",
  'src/routes/client/me.ts': "import { profile } from '../../services/profile'\n",
  'src/routes/client/bookings.ts': "import { cancel } from '../../services/cancel'\n",
  'src/services/cancel.ts': "import { money } from './money'\n",
  'src/services/money.ts': '',
  'src/services/profile.ts': '',
  'src/services/money.test.ts': "import { money } from './money'\n",
  'src/test/harness.ts': "await import('../app')\n",
  'src/test/cancel-http.test.ts': "import './harness'\nrequest('/api/v1/me/bookings/1/cancel')\n",
  'src/test/profile-http.test.ts': "import './harness'\nrequest('/api/v1/me')\n",
}

test('a changed test runs itself', () => {
  assert.deepEqual(backendTestFiles(be(APP), ['src/test/profile-http.test.ts']), ['src/test/profile-http.test.ts'])
})

test('a change runs the tests that import it, however far down', () => {
  assert.deepEqual(backendTestFiles(be(APP), ['src/services/money.ts']), [
    'src/services/money.test.ts',
    'src/test/cancel-http.test.ts',
  ])
})

test("a change reaching a route runs the tests that call that route's URL, not its whole audience", () => {
  // Through the harness and app.ts every test reaches everything, so those
  // are not followed: the profile test calls /api/v1/me, not /bookings.
  assert.deepEqual(backendTestFiles(be(APP), ['src/services/cancel.ts']), ['src/test/cancel-http.test.ts'])
})

test('a route mounted at its parent URL picks no tests by URL', () => {
  // `/api/v1/me` is in every member test; picking by it would run them all.
  assert.deepEqual(backendTestFiles(be(APP), ['src/services/profile.ts']), [])
})

test('docs and files outside be/src and be/tools pick nothing', () => {
  assert.deepEqual(backendTestFiles(be(APP), ['README.md', 'package.json']), [])
})

test('a hub, reached by more tests than the limit, runs the isolation guards instead', () => {
  const files = { ...APP, 'src/db/schema.ts': '' }
  for (const g of GUARDS) files[g] = ''
  for (let i = 0; i <= HUB_LIMIT; i++) files[`src/test/t${i}.test.ts`] = "import '../db/schema'\n"
  assert.deepEqual(backendTestFiles(be(files), ['src/db/schema.ts']), [...GUARDS].sort())
})
