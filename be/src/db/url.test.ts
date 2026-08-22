import assert from 'node:assert'
import { buildDatabaseUrl } from './url'

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
console.log('url.test ok')
