import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { MEMBER_TABLES, type MemberKey, type MemberTable } from '../services/clients/member-tables'
import JSZip from 'jszip'
import { unpackArchive } from '../services/tenants/transfer-archive'
import { ArchiveError, type MemberManifest } from '../services/tenants/transfer-shape'

/**
 * An admin downloads everything a studio holds about one member (#143).
 *
 * The fixture is built from `MEMBER_TABLES` itself: a row in every listed table
 * for the member being exported, the same for another member of the same
 * studio, and the same again for the *same person* as a member of the second
 * studio — one auth user, two `clients` rows. That last one is the case a
 * member export is most likely to get wrong, because the sign-in log names the
 * person rather than the studio's record of them.
 *
 * Rows are made by `insertRow`, which reads the table's shape from the catalogue
 * and fills whatever the table requires, parents included. So a table added to
 * the list is covered here without this file changing.
 */
describe('member export', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `member-export-${run}.test`
  const at = (name: string) => `${name}@${DOMAIN}`

  const send = (path: string, headers: Record<string, string>) => harness.app.request(path, { headers })

  type Staff = { headers: Record<string, string>; row: { id: string }; authUserId: string }

  const staffAt = async (tenant: { id: string; slug: string }, email: string, role: 'admin' | 'instructor'): Promise<Staff> => {
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: email, role, status: 'active', authUserId: user!.id })
      .returning()
    return { headers, row: row!, authUserId: user!.id }
  }

  /** A member added through the portal and signed in once, so the sign-in log names them. */
  const memberAt = async (tenant: { id: string; slug: string }, admin: Record<string, string>, email: string): Promise<MemberKey> => {
    const res = await harness.app.request('/api/v1/portal/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin },
      body: JSON.stringify({ name: 'Ada Lovelace', email, phone: '+6591234567' }),
    })
    const body = (await res.json()) as { id: string }
    assert.equal(res.status, 201, JSON.stringify(body))
    await harness.signInAs('client', email, tenant)
    const [row] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, body.id))
    return { clientId: row!.id, authUserId: row!.authUserId }
  }

  /* ── a row in any table ─────────────────────────────────────────────── */

  type Column = { name: string; type: string; typtype: string; notnull: boolean; has_default: boolean; first_label: string | null }
  type ForeignKey = { cols: string[]; ref: string; refcols: string[] }
  type Row = Record<string, unknown>

  /** Every row made, in order, so `after` can take them out in reverse. */
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
    corporate_sessions: async () =>({ starts_at: new Date().toISOString(), ends_at: later() }),
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
        assert.deepEqual(entry.columns, ['client_id'], `teach this test how a ${entry.table} row names a member`)
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

  /* ── the fixture ────────────────────────────────────────────────────── */

  let admin!: Staff
  let instructor!: Staff
  let adminTwo!: Staff
  let member!: MemberKey
  let neighbour!: MemberKey
  let elsewhere!: MemberKey
  let memberRows!: Map<string, Row>

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ one, two } = harness.tenants)
    admin = await staffAt(one, at('admin'), 'admin')
    instructor = await staffAt(one, at('instructor'), 'instructor')
    adminTwo = await staffAt(two, at('admin-two'), 'admin')

    member = await memberAt(one, admin.headers, at('member'))
    neighbour = await memberAt(one, admin.headers, at('neighbour'))
    // The same person, a member of the second studio too.
    elsewhere = await memberAt(two, adminTwo.headers, at('member'))
    assert.equal(elsewhere.authUserId, member.authUserId)

    memberRows = await fixturesFor(one.id, member)
    await fixturesFor(one.id, neighbour)
    await fixturesFor(two.id, elsewhere)
  })

  after(async () => {
    if (!harness) return
    for (const { table, key } of made.reverse()) {
      const where = Object.entries(key).map(([k, v]) => sql`${sql.identifier(k)} = ${v}`)
      await harness.db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.join(where, sql` AND `)}`)
    }
    const staff = await harness.db.select({ id: schema.staffUsers.id }).from(schema.staffUsers).where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const staffIds = staff.map(s => s.id)
    const authIds = [
      ...(await harness.db.select({ id: schema.staffAuthUsers.id }).from(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))),
      ...(await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))),
    ].map(u => u.id)
    if (authIds.length) {
      await harness.db.delete(schema.authEvents).where(inArray(schema.authEvents.actorUserId, authIds))
      await harness.db.delete(schema.authEvents).where(inArray(schema.authEvents.subjectUserId, authIds))
    }
    if (staffIds.length) await harness.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    await harness.db.delete(schema.clients).where(like(schema.clients.email, `%@${DOMAIN}`))
    if (staffIds.length) await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  const exportPath = (clientId: string) => `/api/v1/portal/admin/clients/${clientId}/export`

  const download = async (headers: Record<string, string>, clientId = member.clientId) => {
    const res = await send(exportPath(clientId), headers)
    assert.equal(res.status, 200, await res.clone().text())
    assert.equal(res.headers.get('Content-Type'), 'application/zip')
    assert.match(res.headers.get('Content-Disposition') ?? '', /^attachment; filename=".+\.zip"$/)
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as MemberManifest
    const rows: Record<string, Row[]> = {}
    for (const table of manifest.tables) {
      rows[table] = JSON.parse(await zip.file(`tables/${table}.json`)!.async('string')) as Row[]
      assert.equal(rows[table].length, manifest.counts[table], `${table} count`)
    }
    return { manifest, rows }
  }

  test('a member export cannot be restored as a studio', async () => {
    const res = await send(exportPath(member.clientId), admin.headers)
    await assert.rejects(unpackArchive(new Uint8Array(await res.arrayBuffer())), ArchiveError)
  })

  /** A row's identity, for tables whose key is not a single `id`. */
  const identify = (table: string, row: Row) =>
    table === 'pt_session_clients' ? `${row.pt_session_id}/${row.client_id}` : String(row.id)

  test('the archive has every row that names the member, in every listed table', async () => {
    const archive = await download(admin.headers)

    assert.deepEqual(archive.manifest.tables, MEMBER_TABLES.map(t => t.table))
    for (const [table, fixture] of memberRows) {
      const ids = (archive.rows[table] ?? []).map(r => identify(table, r))
      assert.ok(ids.includes(identify(table, fixture)), `${table} is missing the member's row`)
    }
    assert.deepEqual(archive.rows.clients!.map(r => r.id), [member.clientId])
  })

  test('the archive has no row about another member, and nothing from another studio', async () => {
    const archive = await download(admin.headers)
    const exported = (table: string) => archive.rows[table] ?? []

    for (const entry of MEMBER_TABLES) {
      for (const row of exported(entry.table)) {
        assert.equal(row.tenant_id, one.id, `${entry.table} row from another studio`)

        const values = entry.columns.map(c => (c === 'payload' ? (row.payload as Row | null)?.clientId : row[c]))
        const named = values.some(v => v === member.clientId || v === member.authUserId)
        if (entry.via === 'bookings') {
          assert.ok(exported('bookings').some(b => b.id === row.booking_id), `check_ins row for someone else's booking`)
        } else if (entry.via === 'pt_requests') {
          assert.ok(exported('pt_requests').some(p => p.id === row.pt_request_id), `pt_request_slots row for someone else's request`)
        } else if (entry.via === 'pt_session_clients') {
          assert.ok(exported('pt_session_clients').some(p => p.pt_session_id === row.id), `pt_sessions row the member is not in`)
        } else {
          assert.ok(named, `${entry.table} row does not name the member: ${JSON.stringify(row)}`)
        }
        for (const v of values) {
          assert.ok(v !== neighbour.clientId && v !== neighbour.authUserId, `${entry.table} row names another member`)
          assert.notEqual(v, elsewhere.clientId, `${entry.table} row names the member's record at another studio`)
        }
      }
    }
  })

  test('the export is recorded as a staff act on the member', async () => {
    await download(admin.headers)
    const [event] = await harness.db
      .select()
      .from(schema.authEvents)
      .where(and(eq(schema.authEvents.subjectUserId, member.authUserId), eq(schema.authEvents.kind, 'member_data_exported')))
      .orderBy(desc(schema.authEvents.createdAt))
      .limit(1)
    assert.ok(event, 'no member_data_exported event')
    assert.equal(event.pool, 'staff')
    assert.equal(event.tenantId, one.id)
    assert.equal(event.actorUserId, admin.authUserId)
  })

  test('an instructor cannot download it', async () => {
    const res = await send(exportPath(member.clientId), instructor.headers)
    assert.equal(res.status, 403)
  })

  test('a member of another studio is not found here', async () => {
    const res = await send(exportPath(elsewhere.clientId), admin.headers)
    assert.equal(res.status, 404)
    const unknown = await send(exportPath(randomUUID()), admin.headers)
    assert.equal(unknown.status, 404)
  })
})
