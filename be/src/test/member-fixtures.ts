import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq, inArray, like, or, sql } from 'drizzle-orm'
import type * as Schema from '../db/schema'
import { MEMBER_TABLES, type MemberKey, type MemberTable } from '../services/clients/member-tables'
import type { TestApp } from './harness'

/**
 * A member with a row in every table `MEMBER_TABLES` lists, for the tests of the
 * features that read that list: member export (#143) and member deletion (#144).
 *
 * Rows are made by `insertRow`, which reads the table's shape from the catalogue
 * and fills whatever the table requires, parents included. So a table added to
 * the list is covered by both tests without either file changing.
 *
 * Everything made is named under `domain`, which is what `cleanup` removes.
 */

export type Row = Record<string, unknown>
export type Tenant = { id: string; slug: string }
export type Staff = { headers: Record<string, string>; row: { id: string }; authUserId: string }

type Column = { name: string; type: string; typtype: string; notnull: boolean; has_default: boolean; first_label: string | null }
type ForeignKey = { cols: string[]; ref: string; refcols: string[] }

export function memberFixtures(harness: TestApp, schema: typeof Schema, domain: string) {
  const at = (name: string) => `${name}@${domain}`

  const staffAt = async (tenant: Tenant, email: string, role: 'admin' | 'instructor'): Promise<Staff> => {
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: email, role, status: 'active', authUserId: user!.id })
      .returning()
    return { headers, row: row!, authUserId: user!.id }
  }

  /** A member added through the portal and signed in once, so the sign-in log names them. */
  const memberAt = async (tenant: Tenant, admin: Record<string, string>, email: string): Promise<MemberKey & { headers: Record<string, string> }> => {
    const res = await harness.app.request('/api/v1/portal/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin },
      body: JSON.stringify({ name: 'Ada Lovelace', email, phone: '+6591234567' }),
    })
    const body = (await res.json()) as { id: string }
    assert.equal(res.status, 201, JSON.stringify(body))
    const headers = await harness.signInAs('client', email, tenant)
    const [row] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, body.id))
    return { clientId: row!.id, authUserId: row!.authUserId, email: row!.email, headers }
  }

  /* ── a row in any table ─────────────────────────────────────────────── */

  /** Every row made, in order, so `cleanup` can take them out in reverse. */
  const made: { table: string; key: Row }[] = []

  const columnsOf = (table: string) =>
    harness.db.execute<Column>(sql`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, t.typtype, a.attnotnull AS notnull,
             (ad.adbin IS NOT NULL OR a.attidentity <> '' OR a.attgenerated <> '') AS has_default,
             (SELECT enumlabel FROM pg_enum WHERE enumtypid = a.atttypid ORDER BY enumsortorder LIMIT 1) AS first_label
      FROM pg_attribute a
      JOIN pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE a.attrelid = ${`public.${table}`}::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`)

  const foreignKeysOf = (table: string) =>
    harness.db.execute<ForeignKey>(sql`
      SELECT (SELECT array_agg(a.attname ORDER BY k.i) FROM unnest(c.conkey) WITH ORDINALITY k(n, i)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS cols,
             c.confrelid::regclass::text AS ref,
             (SELECT array_agg(a.attname ORDER BY k.i) FROM unnest(c.confkey) WITH ORDINALITY k(n, i)
                JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n) AS refcols
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.conrelid = ${`public.${table}`}::regclass`)

  const primaryKeyOf = async (table: string) =>
    (
      await harness.db.execute<{ name: string }>(sql`
        SELECT a.attname AS name FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = ${`public.${table}`}::regclass AND i.indisprimary`)
    ).map(r => r.name)

  const filler = (column: Column): string => {
    if (column.first_label !== null) return column.first_label
    if (column.type.endsWith('[]')) return '{}'
    if (column.type === 'uuid') return randomUUID()
    if (column.type === 'boolean') return 'false'
    if (column.type === 'date') return '2026-01-01'
    if (column.type.startsWith('timestamp')) return new Date().toISOString()
    if (column.type.startsWith('time')) return '09:00'
    if (column.type.startsWith('json')) return '{}'
    if (/^(integer|smallint|bigint|numeric|real|double)/.test(column.type)) return '1'
    return `fixture-${randomUUID().slice(0, 8)}`
  }

  /** What a table's check constraints need beyond "not null", which the catalogue cannot fill in. */
  const later = () => new Date(Date.now() + 3_600_000).toISOString()
  const shapes: Record<string, (tenantId: string) => Promise<Row>> = {
    classes: async () => ({ starts_at: new Date().toISOString(), ends_at: later(), capacity_online: 1 }),
    pt_sessions: async () => ({ starts_at: new Date().toISOString(), ends_at: later(), capacity_online: 1 }),
    pt_request_slots: async () => ({ start_time: '09:00', end_time: '10:00' }),
    corporate_sessions: async () => ({ starts_at: new Date().toISOString(), ends_at: later() }),
    bookings: async tenantId => ({ kind: 'class', class_id: (await insertRow('classes', tenantId)).id }),
    class_packages: async () => ({ kind: 'credit_bundle', credits: 1, validity_days: 30 }),
    client_packages: async () => ({ kind: 'credit_bundle', validity_days: 30 }),
    promo_codes: async () => ({ kind: 'percent', percent_off: 10, code: `FIX-${randomUUID().slice(0, 8).toUpperCase()}` }),
  }

  /**
   * Insert a row into `table` at `tenantId`: `values` as given, every other
   * required column filled, and a fresh parent made for every required foreign
   * key that `values` does not already satisfy.
   */
  const insertRow = async (table: string, tenantId: string, values: Row = {}): Promise<Row> => {
    const columns = await columnsOf(table)
    const row: Row = { ...(await shapes[table]?.(tenantId)), ...values }
    if (columns.some(c => c.name === 'tenant_id')) row.tenant_id = tenantId

    for (const fk of await foreignKeysOf(table)) {
      const required = fk.cols.some(name => {
        const column = columns.find(c => c.name === name)!
        return column.notnull && !column.has_default && !(name in row)
      })
      if (!required || fk.cols.every(name => name in row)) continue
      const parent = await insertRow(fk.ref, tenantId)
      fk.cols.forEach((name, i) => {
        if (!(name in row)) row[name] = parent[fk.refcols[i]!]
      })
    }
    for (const column of columns) {
      if (column.name in row || !column.notnull || column.has_default) continue
      row[column.name] = filler(column)
    }

    const names = Object.keys(row)
    const cast = (name: string) => columns.find(c => c.name === name)!.type
    const [inserted] = await harness.db.execute<Row>(sql`
      INSERT INTO ${sql.identifier(table)} (${sql.join(names.map(n => sql.identifier(n)), sql`, `)})
      VALUES (${sql.join(
        names.map(n => {
          const v = row[n]
          const text = v !== null && typeof v === 'object' ? JSON.stringify(v) : v
          return sql`${text}::${sql.raw(cast(n))}`
        }),
        sql`, `,
      )})
      RETURNING *`)
    const key: Row = {}
    for (const name of await primaryKeyOf(table)) key[name] = inserted![name]
    made.push({ table, key })
    return inserted!
  }

  /** The values that make a row in `entry.table` the member's. */
  const naming = (entry: MemberTable, m: MemberKey, fixtures: Map<string, Row>): Row | undefined => {
    switch (entry.table) {
      case 'clients':
        return undefined // made through the portal
      case 'pt_sessions':
        return undefined // made as the parent of the member's pt_session_clients row
      case 'check_ins':
        return { booking_id: fixtures.get('bookings')!.id }
      case 'pt_request_slots':
        return { pt_request_id: fixtures.get('pt_requests')!.id }
      case 'pt_requests':
        return { client_id: m.clientId }
      case 'email_log':
        return { recipient_user_kind: 'client', recipient_user_id: m.clientId }
      case 'inbox_items':
        return { payload: { clientId: m.clientId } }
      case 'audit_log':
        return { target_table: 'clients', target_id: m.clientId, actor_type: 'staff' }
      case 'auth_events':
        return { pool: 'client', kind: 'sign_in', actor_user_id: m.authUserId }
      default:
        assert.deepEqual(entry.columns, ['client_id'], `teach member-fixtures how a ${entry.table} row names a member`)
        return { client_id: m.clientId }
    }
  }

  /** A row in every listed table that names `m`, keyed by table. */
  const fixturesFor = async (tenantId: string, m: MemberKey) => {
    const fixtures = new Map<string, Row>()
    for (const entry of MEMBER_TABLES) {
      const values = naming(entry, m, fixtures)
      if (values) fixtures.set(entry.table, await insertRow(entry.table, tenantId, values))
    }
    const [session] = await harness.db.execute<Row>(
      sql`SELECT * FROM pt_sessions WHERE id = ${fixtures.get('pt_session_clients')!.pt_session_id}`,
    )
    fixtures.set('pt_sessions', session!)
    return fixtures
  }

  /** Remove everything made under `domain`, children first. */
  const cleanup = async () => {
    for (const { table, key } of [...made].reverse()) {
      const where = Object.entries(key).map(([k, v]) => sql`${sql.identifier(k)} = ${v}`)
      await harness.db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.join(where, sql` AND `)}`)
    }
    const staff = await harness.db.select({ id: schema.staffUsers.id }).from(schema.staffUsers).where(like(schema.staffUsers.email, `%@${domain}`))
    const staffIds = staff.map(s => s.id)
    const authIds = [
      ...(await harness.db.select({ id: schema.staffAuthUsers.id }).from(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${domain}`))),
      ...(await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${domain}`))),
    ].map(u => u.id)
    if (authIds.length) {
      await harness.db
        .delete(schema.authEvents)
        .where(or(inArray(schema.authEvents.actorUserId, authIds), inArray(schema.authEvents.subjectUserId, authIds)))
    }
    if (staffIds.length) await harness.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${domain}`))
    await harness.db.delete(schema.clients).where(like(schema.clients.email, `%@${domain}`))
    if (staffIds.length) await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${domain}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${domain}`))
  }

  return { at, staffAt, memberAt, insertRow, fixturesFor, cleanup }
}
