import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, desc, eq } from 'drizzle-orm'
import JSZip from 'jszip'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures, type Row, type Staff } from './member-fixtures'
import { MEMBER_TABLES, type MemberKey } from '../services/clients/member-tables'
import { unpackArchive } from '../services/tenants/transfer-archive'
import { ArchiveError, type MemberManifest } from '../services/tenants/transfer-shape'

/**
 * An admin downloads everything a studio holds about one member (#143).
 *
 * The fixture is built from `MEMBER_TABLES` itself (`member-fixtures.ts`): a row
 * in every listed table for the member being exported, the same for another
 * member of the same studio, and the same again for the *same person* as a
 * member of the second studio — one auth user, two `clients` rows. That last one
 * is the case a member export is most likely to get wrong, because the sign-in
 * log names the person rather than the studio's record of them.
 */
describe('member export', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fixtures!: ReturnType<typeof memberFixtures>
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const DOMAIN = `member-export-${Date.now().toString(36)}.test`

  const send = (path: string, headers: Record<string, string>) => harness.app.request(path, { headers })

  let admin!: Staff
  let instructor!: Staff
  let member!: MemberKey
  let neighbour!: MemberKey
  let elsewhere!: MemberKey
  let memberRows!: Map<string, Row>

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    fixtures = memberFixtures(harness, schema, DOMAIN)
    const { at, staffAt, memberAt, fixturesFor } = fixtures
    ;({ one, two } = harness.tenants)
    admin = await staffAt(one, at('admin'), 'admin')
    instructor = await staffAt(one, at('instructor'), 'instructor')
    const adminTwo = await staffAt(two, at('admin-two'), 'admin')

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
    await fixtures?.cleanup()
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

        const payload = row.payload as Row | null
        const values = entry.columns.map(c =>
          c === 'payload' ? (payload?.clientId ?? payload?.impersonatedClientId) : c === 'action' ? undefined : row[c],
        )
        const named =
          values.some(v => v === member.clientId || v === member.authUserId || v === member.email) ||
          (typeof row.action === 'string' && row.action.includes(member.clientId))
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
          assert.ok(v !== neighbour.clientId && v !== neighbour.authUserId && v !== neighbour.email, `${entry.table} row names another member`)
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
