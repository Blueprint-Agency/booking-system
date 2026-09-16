import test from 'node:test'
import assert from 'node:assert/strict'
import { is } from 'drizzle-orm'
import { PgTable, getTableConfig, pgTable, uuid, text } from 'drizzle-orm/pg-core'
import * as schema from '../../db/schema'
import { tenantIdColumn } from '../../db/schema/tenancy'
import { MEMBER_TABLES, UNEXPORTED_MEMBER_COLUMNS, unlistedMemberColumns } from './member-tables'

const schemaTables = Object.values(schema).filter((v): v is PgTable => is(v, PgTable))

test('every column in the schema that names a member is in the member list, or set aside with a reason', () => {
  assert.deepEqual(unlistedMemberColumns(schemaTables), [])
})

test('a new table with a member column is caught until it is listed', () => {
  const memberNotes = pgTable('member_notes', {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey(),
    clientId: uuid('client_id').references(() => schema.clients.id),
    body: text('body'),
  })
  const renamed = pgTable('guest_passes', {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey(),
    // No foreign key, so only the name gives it away.
    giftedToClientId: uuid('gifted_to_client_id'),
  })

  const byAccount = pgTable('device_tokens', {
    tenantId: tenantIdColumn(),
    id: uuid('id').primaryKey(),
    // The sign-in account rather than the studio record names them just as well.
    userId: text('user_id').references(() => schema.clientAuthUsers.id),
    memberId: uuid('member_id'),
  })

  assert.deepEqual(unlistedMemberColumns([...schemaTables, memberNotes, renamed, byAccount]), [
    'member_notes.client_id',
    'guest_passes.gifted_to_client_id',
    'device_tokens.user_id',
    'device_tokens.member_id',
  ])
})

test('every listed column exists, so a rename cannot quietly empty a table in the export', () => {
  const known = new Map(
    schemaTables.map(t => {
      const { name, columns } = getTableConfig(t)
      return [name, new Set(columns.map(c => c.name))]
    }),
  )
  for (const entry of MEMBER_TABLES) {
    const cols = known.get(entry.table)
    assert.ok(cols, `${entry.table} is not a table in the schema`)
    for (const column of entry.columns) assert.ok(cols.has(column), `${entry.table}.${column} does not exist`)
  }
  for (const { table, column } of UNEXPORTED_MEMBER_COLUMNS) {
    assert.ok(known.get(table)?.has(column), `${table}.${column} does not exist`)
  }
})
