import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const OPERATOR = `operator@import-jobs-${run}.test`

// Read once when the platform gate is first imported, so it is set before the app is.
process.env.PLATFORM_ADMIN_EMAIL = OPERATOR

/**
 * The super portal's import as a job: started, sent its file, and read back —
 * by this request or any later one — until it has succeeded or failed.
 *
 * Through the platform routes, as the application role with Row-Level Security
 * live, because the claim under test is twofold: the job's status is what the
 * page can resume from after a reload, and one studio's job is never visible
 * through another studio's URL or context.
 */
describe('importing a studio archive as a job', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let operator!: Record<string, string>
  let schema!: typeof import('../db/schema')
  /** A real studio archive, exported from a small studio of this file's own. */
  let zip!: Buffer

  const call = (method: string, path: string, body?: RequestInit['body'], headers: Record<string, string> = {}) =>
    harness.app.request(`/api/v1/platform${path}`, {
      method,
      headers: { Authorization: operator.Authorization!, ...headers },
      body,
    })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return JSON.parse(text) as any
  }

  const start = (tenantId: string, size: number, fileName = 'studio.zip') =>
    call('POST', `/tenants/${tenantId}/imports`, JSON.stringify({ file_name: fileName, size }), {
      'Content-Type': 'application/json',
    })

  const upload = (tenantId: string, jobId: string, bytes: Uint8Array) =>
    call('PUT', `/tenants/${tenantId}/imports/${jobId}/archive`, bytes, { 'Content-Type': 'application/zip' })

  const latest = async (tenantId: string) =>
    (await json(await call('GET', `/tenants/${tenantId}/imports/latest`), 200)).job

  /** Poll the way the page does, until the job has finished one way or the other. */
  async function settled(tenantId: string) {
    const deadline = Date.now() + 60_000
    for (;;) {
      const job = await latest(tenantId)
      if (job && (job.status === 'succeeded' || job.status === 'failed')) return job
      assert.ok(Date.now() < deadline, `import still ${job?.status}/${job?.phase} after 60s`)
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  async function emptyTenant(label: string) {
    const [row] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO tenants (slug, name, timezone, status)
      VALUES (${`${label}-${run}-${randomUUID().slice(0, 6)}`}, ${`Import ${label}`}, 'Asia/Singapore', 'active')
      RETURNING id
    `)
    return row!.id
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    operator = await harness.signInAs('platform', OPERATOR, null)

    // A studio with a member who refers another (the two-pass write) and
    // settings (the definer-function write) — enough for every phase to run.
    const source = await emptyTenant('source')
    const [referrer] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO clients (tenant_id, auth_user_id, email, name, phone)
      VALUES (${source}, ${randomUUID()}, ${`a-${run}@import.test`}, 'Member A', '+6580000001')
      RETURNING id
    `)
    await harness.db.execute(sql`
      INSERT INTO clients (tenant_id, auth_user_id, email, name, phone, referred_by_client_id)
      VALUES (${source}, ${randomUUID()}, ${`b-${run}@import.test`}, 'Member B', '+6580000002', ${referrer!.id})
    `)
    await harness.db.execute(sql`INSERT INTO locations (tenant_id, name) VALUES (${source}, 'The Room')`)
    await harness.db.execute(sql`
      INSERT INTO tenant_settings (tenant_id, display_name) VALUES (${source}, 'Import Source')
    `)
    const { exportTenant } = await import('../services/tenants/transfer')
    const { packArchive } = await import('../services/tenants/transfer-archive')
    zip = await packArchive(await exportTenant(source))
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.close()
  })

  test('starts, uploads, and reads back its progress until it has succeeded', async () => {
    const target = await emptyTenant('target')

    const started = (await json(await start(target, zip.length), 201)).job
    assert.equal(started.status, 'uploading')
    assert.equal(started.upload_bytes, zip.length)
    assert.equal(started.received_bytes, 0)
    assert.equal(started.started_by, OPERATOR)

    // The upload answers once the file is whole and handed off, not once the
    // import is done: the page is free to go away from here.
    const handed = (await json(await upload(target, started.id, zip), 202)).job
    assert.equal(handed.status, 'processing')
    assert.equal(handed.received_bytes, zip.length)

    const done = await settled(target)
    assert.equal(done.id, started.id, 'the latest import is the one this test started')
    assert.equal(done.status, 'succeeded', done.error)
    assert.equal(done.phase, 'done')
    assert.ok(done.total > 0, 'the job counts its steps')
    assert.equal(done.processed, done.total, 'a finished job has done every step it counted')
    assert.ok(done.summary.imported >= 3, JSON.stringify(done.summary))
    assert.equal(done.summary.remapped, true, 'a copy beside its source gets fresh ids')
    assert.ok(done.finished_at, 'a finished job says when')

    const [members] = await harness.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM clients WHERE tenant_id = ${target}`,
    )
    assert.equal(members!.n, 2, 'the rows the job reported are really there')

    // Finished and not yet dismissed: on the studio list. Dismissed: off it.
    const open = (await json(await call('GET', '/imports'), 200)).imports as any[]
    assert.ok(open.some(job => job.id === done.id && job.tenant_id === target))
    await json(await call('POST', `/tenants/${target}/imports/${done.id}/dismiss`), 200)
    const after = (await json(await call('GET', '/imports'), 200)).imports as any[]
    assert.ok(!after.some(job => job.id === done.id), 'a dismissed import leaves the list')
    assert.equal((await latest(target)).id, done.id, 'but is still the studio’s latest')
  })

  test('a second import is refused while one is running, and an abandoned upload reads back as interrupted', async () => {
    const target = await emptyTenant('busy')
    const first = (await json(await start(target, zip.length), 201)).job

    const second = await json(await start(target, zip.length), 409)
    assert.equal(second.error, 'import_refused')
    assert.match(second.message, /already running/)
    assert.equal(second.job.id, first.id, 'the refusal names the import in the way')

    // The one-request route cannot race it either.
    const form = new FormData()
    form.append('archive', new File([new Uint8Array(zip)], 'studio.zip', { type: 'application/zip' }))
    const sync = await json(await call('POST', `/tenants/${target}/import`, form), 409)
    assert.equal(sync.error, 'import_refused')

    // The page that started it was reloaded: no bytes, no heartbeat. Once the
    // heartbeat is old enough the next read says so, in words that say what to do.
    await harness.db.execute(
      sql`UPDATE tenant_imports SET updated_at = now() - interval '5 minutes' WHERE id = ${first.id}`,
    )
    const read = await latest(target)
    assert.equal(read.status, 'failed')
    assert.equal(read.error_code, 'upload_interrupted')
    assert.match(read.error, /choose the file again/i)

    // And the studio is free for the next attempt.
    await json(await start(target, zip.length), 201)
  })

  test('an upload cut short fails as interrupted rather than importing half a file', async () => {
    const target = await emptyTenant('short')
    const job = (await json(await start(target, zip.length), 201)).job

    const res = await json(await upload(target, job.id, zip.subarray(0, Math.floor(zip.length / 2))), 400)
    assert.equal(res.job.status, 'failed')
    assert.equal(res.job.error_code, 'upload_interrupted')

    const read = await latest(target)
    assert.equal(read.status, 'failed')
    const [members] = await harness.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM clients WHERE tenant_id = ${target}`,
    )
    assert.equal(members!.n, 0, 'nothing was written')
  })

  test('an upload whose connection drops mid-file is recorded as interrupted at once', async () => {
    // What a reload does to the request: some bytes, then the stream errors.
    const target = await emptyTenant('dropped')
    const job = (await json(await start(target, zip.length), 201)).job
    const half = zip.subarray(0, Math.floor(zip.length / 2))
    // Pull-based, so the first chunk is read before the error: erroring a
    // stream discards whatever is still queued in it.
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(new Uint8Array(half))
        else controller.error(new Error('client went away'))
      },
    })
    const res = await harness.app.request(`/api/v1/platform/tenants/${target}/imports/${job.id}/archive`, {
      method: 'PUT',
      headers: { Authorization: operator.Authorization!, 'Content-Type': 'application/zip' },
      body,
      duplex: 'half',
    } as RequestInit)
    assert.equal(res.status, 400, await res.text())

    const read = await latest(target)
    assert.equal(read.status, 'failed')
    assert.equal(read.error_code, 'upload_interrupted')
    assert.equal(read.received_bytes, half.length, 'it says how much had arrived')
  })

  test('a file that is not a studio archive fails with a reason the operator can act on', async () => {
    const target = await emptyTenant('garbage')
    const bytes = new TextEncoder().encode('this is not a zip file at all')
    const job = (await json(await start(target, bytes.length, 'notes.txt'), 201)).job
    await json(await upload(target, job.id, bytes), 202)

    const done = await settled(target)
    assert.equal(done.status, 'failed')
    assert.equal(done.error_code, 'unreadable_archive')
    assert.equal(done.error, 'That file is not a zip archive.')
  })

  test('one studio’s import is invisible through another studio’s URL and context', async () => {
    const mine = await emptyTenant('mine')
    const theirs = await emptyTenant('theirs')
    const job = (await json(await start(mine, zip.length), 201)).job

    // Through the other studio's URL: not there, and not reachable by id.
    assert.equal(await latest(theirs), null, 'another studio has no import')
    await json(await upload(theirs, job.id, zip), 404)
    await json(await call('POST', `/tenants/${theirs}/imports/${job.id}/dismiss`), 404)
    // The job is untouched by those attempts.
    const still = await latest(mine)
    assert.equal(still.id, job.id)
    assert.equal(still.status, 'uploading')
    assert.equal(still.received_bytes, 0)

    // The list names each job under its own studio.
    const open = (await json(await call('GET', '/imports'), 200)).imports as any[]
    assert.deepEqual(
      open.filter(j => j.id === job.id).map(j => j.tenant_id),
      [mine],
    )

    // And the database itself refuses it: as the application role, the row is
    // visible in its own studio's context only — not another's, not none.
    const { db, withTenant } = await import('../db')
    const seen = (tenantId: string) =>
      withTenant(tenantId, () =>
        db.select({ id: schema.tenantImports.id }).from(schema.tenantImports).where(eq(schema.tenantImports.id, job.id)),
      )
    assert.equal((await seen(mine)).length, 1)
    assert.equal((await seen(theirs)).length, 0, 'Row-Level Security hides it from another studio')
    const outside = await db
      .select({ id: schema.tenantImports.id })
      .from(schema.tenantImports)
      .where(eq(schema.tenantImports.id, job.id))
    assert.equal(outside.length, 0, 'and from a query with no studio in context')

    // Nor can a write in another context land a row under this studio.
    await assert.rejects(
      withTenant(theirs, () =>
        db.insert(schema.tenantImports).values({ tenantId: mine, fileName: 'x.zip', uploadBytes: 1, startedBy: OPERATOR }),
      ),
      (err: unknown) => {
        // Drizzle wraps the driver's error; the policy's refusal is on the cause.
        for (let e: any = err; e; e = e.cause) if (/row-level security/i.test(String(e.message))) return true
        return false
      },
    )
  })

  test('the job routes are the platform’s alone', async () => {
    const target = await emptyTenant('gate')
    const anonymous = await harness.app.request(`/api/v1/platform/tenants/${target}/imports/latest`)
    assert.equal(anonymous.status, 404)
    const staff = await harness.signInAs('staff', `staff-${run}@import.test`, harness.tenants.one)
    const asStaff = await harness.app.request(`/api/v1/platform/tenants/${target}/imports/latest`, { headers: staff })
    assert.equal(asStaff.status, 404)
  })

  test('the job table is not studio data: not exported, and not what makes a studio non-empty', async () => {
    const { tenantTableOrder } = await import('../services/tenants/transfer')
    const { order } = await tenantTableOrder()
    assert.ok(!order.includes('tenant_imports'))
  })
})
