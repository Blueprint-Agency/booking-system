import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.pt-request-session-fk.test`
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0139_pt_requests_scheduled_session_fk.sql')
const CONSTRAINT = 'pt_requests_scheduled_pt_session_id_pt_sessions_id_fk'

/** The SQLSTATE of a failed statement, wherever the driver or drizzle left it. */
const sqlState = (err: unknown): string | undefined => {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.cause?.code ?? e.code
}

describe('pt_requests.scheduled_pt_session_id names a session that exists', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let tenantId!: string
  let clientId!: string
  let staffId!: string
  let locationId!: string

  /** Runs `statement` in a transaction that is rolled back, and answers how it ended. */
  async function attempt(statement: ReturnType<typeof sql>): Promise<string | 'ok'> {
    try {
      await harness.db.transaction(async tx => {
        await tx.execute(statement)
        throw new Rollback()
      })
    } catch (err) {
      return err instanceof Rollback ? 'ok' : (sqlState(err) ?? String(err))
    }
    return 'ok'
  }
  class Rollback extends Error {}

  async function request(scheduledPtSessionId: string | null): Promise<string> {
    const [row] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO pt_requests (tenant_id, client_id, location_id, session_type, status, scheduled_pt_session_id)
      VALUES (${tenantId}, ${clientId}, ${locationId}, '1on1', ${scheduledPtSessionId ? 'scheduled' : 'pending'}::pt_request_status, ${scheduledPtSessionId})
      RETURNING id
    `)
    return row!.id
  }

  async function session(requestId: string): Promise<string> {
    const [row] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO pt_sessions (tenant_id, pt_request_id, instructor_id, location_id, starts_at, ends_at, session_type,
                               capacity_online, scheduled_at, scheduled_by_staff_id)
      VALUES (${tenantId}, ${requestId}, ${staffId}, ${locationId}, now() + interval '2 days', now() + interval '2 days 1 hour',
              '1on1', 1, now(), ${staffId})
      RETURNING id
    `)
    return row!.id
  }

  /** The migration, statement by statement, as the migrator runs it. */
  async function migrate() {
    for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
      await harness.db.execute(sql.raw(statement))
    }
  }

  before(async () => {
    harness = await startTestApp()
    tenantId = harness.tenants.one.id
    const email = `desk@${DOMAIN}`
    const [staff] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO staff_users (tenant_id, auth_user_id, email, name, role, status)
      VALUES (${tenantId}, ${randomUUID()}, ${email}, 'Desk', 'admin', 'active') RETURNING id
    `)
    staffId = staff!.id
    await harness.db.execute(sql`INSERT INTO instructors (tenant_id, staff_user_id) VALUES (${tenantId}, ${staffId})`)
    const [client] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO clients (tenant_id, auth_user_id, email, name, phone)
      VALUES (${tenantId}, ${randomUUID()}, ${`member@${DOMAIN}`}, 'Mia', '+6580000000') RETURNING id
    `)
    clientId = client!.id
    const [location] = await harness.db.execute<{ id: string }>(
      sql`SELECT id FROM locations WHERE tenant_id = ${tenantId} ORDER BY id LIMIT 1`,
    )
    locationId = location!.id
  })

  after(async () => {
    if (!harness) return
    try {
      const ours = `%@${DOMAIN}`
      const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (SELECT id FROM clients WHERE email LIKE ${ours})`
      await harness.db.execute(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${requests})`)
      await harness.db.execute(sql`DELETE FROM pt_sessions WHERE pt_request_id IN (${requests})`)
      await harness.db.execute(sql`DELETE FROM pt_requests WHERE id IN (${requests})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id = ${staffId}`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      // A test below drops the constraint and runs the migration to put it back.
      await migrate()
    } finally {
      await harness.close()
    }
  })

  test('TEN-49 a request names the session that scheduled it: a session that does not exist is refused, a request naming none is fine, and a session a request names cannot be deleted from under it', async () => {
    assert.equal(
      await attempt(sql`
        INSERT INTO pt_requests (tenant_id, client_id, location_id, session_type, status, scheduled_pt_session_id)
        VALUES (${tenantId}, ${clientId}, ${locationId}, '1on1', 'scheduled', ${randomUUID()})
      `),
      '23503',
      'a request cannot name a session that is not there',
    )

    const pending = await request(null)
    const scheduled = await request(null)
    const sessionId = await session(scheduled)
    await harness.db.execute(sql`UPDATE pt_requests SET scheduled_pt_session_id = ${sessionId}, status = 'scheduled' WHERE id = ${scheduled}`)

    assert.equal(
      await attempt(sql`DELETE FROM pt_sessions WHERE id = ${sessionId}`),
      '23503',
      'a session is cancelled, not deleted, while its request names it',
    )
    const [still] = await harness.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pt_sessions WHERE id = ${sessionId}`)
    assert.equal(still!.n, 1)

    const [pendingRow] = await harness.db.execute<{ scheduled_pt_session_id: string | null }>(
      sql`SELECT scheduled_pt_session_id FROM pt_requests WHERE id = ${pending}`,
    )
    assert.equal(pendingRow!.scheduled_pt_session_id, null)
  })

  test('TEN-50 the migration clears an id that already names no session, leaves every real one and every empty one, and a second run changes nothing', async () => {
    const real = await request(null)
    const realSession = await session(real)
    await harness.db.execute(sql`UPDATE pt_requests SET scheduled_pt_session_id = ${realSession}, status = 'scheduled' WHERE id = ${real}`)
    const empty = await request(null)

    // The database as it was before the migration: no constraint to stop a dangling id.
    await harness.db.execute(sql.raw(`ALTER TABLE "pt_requests" DROP CONSTRAINT IF EXISTS "${CONSTRAINT}"`))
    const dangling = await request(randomUUID())
    const alsoDangling = await request(randomUUID())

    await migrate()

    const named = async () =>
      new Map(
        (
          await harness.db.execute<{ id: string; scheduled_pt_session_id: string | null; status: string }>(
            sql`SELECT id, scheduled_pt_session_id, status::text AS status FROM pt_requests WHERE id IN (${sql.join([real, empty, dangling, alsoDangling].map(id => sql`${id}`), sql`, `)})`,
          )
        ).map(r => [r.id, [r.scheduled_pt_session_id, r.status] as const]),
      )
    const expected = new Map([
      [real, [realSession, 'scheduled']],
      [empty, [null, 'pending']],
      [dangling, [null, 'scheduled']],
      [alsoDangling, [null, 'scheduled']],
    ])
    assert.deepEqual(await named(), expected, 'a dangling id is cleared and nothing else about the request changes')

    const [constraint] = await harness.db.execute<{ def: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${CONSTRAINT}
    `)
    assert.match(constraint?.def ?? '', /FOREIGN KEY \(scheduled_pt_session_id\) REFERENCES pt_sessions\(id\) ON DELETE RESTRICT/)

    await migrate()
    assert.deepEqual(await named(), expected, 'a second run changes nothing')
  })
})
