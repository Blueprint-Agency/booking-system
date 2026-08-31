import assert from 'node:assert'
import { appRolePassword, buildAppDatabaseUrl, buildDatabaseUrl } from './url'
import { APP_ROLE } from './roles'

assert.strictEqual(
  buildDatabaseUrl({ POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: 'pw', POSTGRES_DB: 'yoga-sadhana', POSTGRES_PORT: '5500' }),
  'postgres://postgres:pw@localhost:5500/yoga-sadhana'
)
// password with URL-hostile characters must survive the round trip
assert.strictEqual(
  new URL(buildDatabaseUrl({ POSTGRES_USER: 'u', POSTGRES_PASSWORD: 'p@ss:/#?', POSTGRES_DB: 'd' })!).password,
  'p%40ss%3A%2F%23%3F'
)
assert.strictEqual(buildDatabaseUrl({ POSTGRES_USER: 'u', POSTGRES_DB: 'd' }), null)

// The app-role URL reaches the same database as a DIFFERENT user. Sharing the
// owner's credentials would put the app back inside the role that bypasses
// Row-Level Security, which is the whole point of having two URLs.
const appUrl = new URL(
  buildAppDatabaseUrl({
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'owner-pw',
    POSTGRES_DB: 'yoga-sadhana',
    POSTGRES_PORT: '5500',
    DB_APP_PASSWORD: 'app-pw',
  })!,
)
assert.strictEqual(appUrl.username, APP_ROLE)
assert.notStrictEqual(appUrl.username, 'postgres')
assert.strictEqual(appUrl.password, 'app-pw')
assert.strictEqual(appUrl.pathname, '/yoga-sadhana')
assert.strictEqual(appUrl.port, '5500')

// No database name, no URL — same contract as the owner builder.
assert.strictEqual(buildAppDatabaseUrl({ DB_APP_PASSWORD: 'app-pw' }), null)

// The password the role is provisioned with is the password the app connects
// with, always — a dev default rather than two values that can drift.
assert.strictEqual(appRolePassword({ DB_APP_PASSWORD: 'set' }), 'set')
assert.ok(appRolePassword({}).length > 0, 'local dev gets a default so `make init` just works')
// …but never on a server: an unset secret there must fail the migrate step, not
// silently provision a role with a password published in this repo.
assert.strictEqual(appRolePassword({ NODE_ENV: 'production' }), '')
assert.strictEqual(appRolePassword({ APP_ENV: 'staging' }), '')
assert.strictEqual(appRolePassword({ APP_ENV: 'production' }), '')
assert.strictEqual(appRolePassword({ NODE_ENV: 'production', DB_APP_PASSWORD: 'set' }), 'set')

console.log('url.test ok')
