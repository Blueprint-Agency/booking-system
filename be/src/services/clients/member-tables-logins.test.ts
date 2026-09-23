import test from 'node:test'
import assert from 'node:assert/strict'
import { getTableName, is } from 'drizzle-orm'
import { PgTable, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import * as schema from '../../db/schema'
import { tenantIdColumn } from '../../db/schema/tenancy'
import { UNEXPORTED_MEMBER_TABLES, unlistedMemberColumns } from './member-tables'

const schemaTables = Object.values(schema).filter((v): v is PgTable => is(v, PgTable))

test('every client login table is set aside as deliberately unexported, with a reason', () => {
  const pool = schemaTables.map(getTableName).filter(t => t.startsWith('client_auth_')).sort()
  assert.ok(pool.length > 0)
  assert.deepEqual(UNEXPORTED_MEMBER_TABLES.map(t => t.table).sort(), pool)
  for (const { table, why } of UNEXPORTED_MEMBER_TABLES) assert.ok(why.trim(), `${table} says why`)
})

test('a client login table stays accounted for once it carries tenant_id', () => {
  // As the pool will look once logins are per studio.
  const perStudioSessions = pgTable('client_auth_sessions', {
    tenantId: tenantIdColumn(),
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => schema.clientAuthUsers.id),
  })
  const perStudioUsers = pgTable('client_auth_users', {
    tenantId: tenantIdColumn(),
    id: text('id').primaryKey(),
    memberId: uuid('member_id'),
  })
  const others = schemaTables.filter(t => !['client_auth_sessions', 'client_auth_users'].includes(getTableName(t)))
  assert.deepEqual(unlistedMemberColumns([...others, perStudioSessions, perStudioUsers]), [])
})
