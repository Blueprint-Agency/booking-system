import test from 'node:test'
import assert from 'node:assert/strict'
import { getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import * as schema from '../../db/schema'
import { LOGIN_TABLES, studioTables } from './transfer-tables'

const schemaTableNames = Object.values(schema)
  .filter((v): v is PgTable => is(v, PgTable))
  .map(getTableName)

test('every staff and client login table is named as never exported', () => {
  const pools = schemaTableNames.filter(t => /^(client|staff)_auth_/.test(t)).sort()
  assert.ok(pools.length > 0)
  assert.deepEqual([...LOGIN_TABLES].sort(), pools)
})

test('a login table is left out of a studio even when the catalogue says it carries tenant_id', () => {
  // As the catalogue will answer once the pools are per studio: every table,
  // login tables included, has the column.
  const kept = studioTables(schemaTableNames)
  for (const table of LOGIN_TABLES) assert.ok(!kept.includes(table), `${table} would be exported`)
  assert.ok(kept.includes('clients'))
  assert.ok(kept.includes('staff_users'))
  assert.ok(!kept.includes('tenant_settings'))
  assert.ok(!kept.includes('tenant_imports'))
})
