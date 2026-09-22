import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { db, withTenant } from '../../db'
import { tenantImports, tenants, type TenantImportRow } from '../../db/schema/tenancy'
import { isUniqueViolation } from '../../db/unique-violation'
import { AppError, BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { activateAfterFirstStaff, loadTenantById } from './tenants'
import { importTenant, type ImportPhase as WritePhase } from './transfer'
import { ArchiveError, unpackArchive } from './transfer-archive'

/**
 * Restoring a studio archive as a job the server owns.
 *
 * The import used to be one request that held the archive, wrote the studio and
 * answered with the summary. Everything about it lived in that request: a
 * reload lost the answer, a closed tab lost the answer, and nothing could say
 * how far it had got. Now it is three steps, each of which leaves the job row
 * (`tenant_imports`, migration 0073) saying where things stand:
 *
 *   1. **Start** — the operator names the file and its size. The row is
 *      written `uploading`, and the partial unique index refuses a second one
 *      for the same studio while it is.
 *   2. **Upload** — the archive's bytes, streamed into memory with the count
 *      written back as they arrive. When the last byte lands the row turns
 *      `processing` and the request returns; the import carries on in this
 *      process with no browser attached.
 *   3. **Process** — unpack, then `importTenant`, whose progress listener
 *      advances `processed` of `total`. The row ends `succeeded` with the
 *      summary, or `failed` with a sentence the operator can act on.
 *
 * **The heartbeat is what makes a lost job visible.** While this process holds
 * a job it touches `updated_at` every few seconds. A job still `uploading` or
 * `processing` whose heartbeat has stopped belongs to an upload that was cut
 * off (the page was reloaded) or a process that died (a deploy), and is marked
 * failed the next time anybody reads it — no sweep, no cron, and no cross-tenant
 * read, because it is always read inside the one studio's context. The import
 * writes every row in one transaction, so a job that died part-way wrote
 * nothing, and the message can say so.
 *
 * Every read and write here opens its own `withTenant`. Progress is written
 * from *inside* the import's transaction, and a write through that
 * transaction's `db` would be invisible to the page until the commit — which is
 * the whole of the time the page wants to see it. `withTenant` always opens a
 * fresh transaction on its own pooled connection, so these commit at once.
 */

export type ImportStatus = 'uploading' | 'processing' | 'succeeded' | 'failed'
/** `uploading`, `unpacking`, then `importTenant`'s phases, then `finishing`. */
export type ImportJobPhase = 'uploading' | 'unpacking' | WritePhase | 'finishing' | 'done'

/** The archive is held in memory while it is imported. Beyond this, refuse. */
export const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024

/** How often a live job touches `updated_at`, and how long without it means dead. */
const HEARTBEAT_MS = 5_000
const STALE_AFTER_MS = 30_000
/** An upload with no bytes for this long is given up on rather than held open. */
const UPLOAD_IDLE_MS = 60_000
/** Progress is written at most this often; the last value always lands. */
const PROGRESS_EVERY_MS = 500

export const UPLOAD_INTERRUPTED =
  'The upload stopped before the whole file arrived — the page was reloaded or closed, or the connection dropped. Nothing was written. Choose the file again to restart the import.'
export const SERVER_STOPPED =
  'The server stopped while this import was running. The import writes the studio in a single transaction, so nothing from this attempt was kept — restore the archive again.'

/** The jobs this process is holding right now: never expired as stale by it. */
const live = new Set<string>()

/** A job as the super portal sees it. */
export interface ImportJobView {
  id: string
  tenant_id: string
  status: ImportStatus
  phase: ImportJobPhase
  file_name: string
  upload_bytes: number
  received_bytes: number
  processed: number
  total: number | null
  summary: RestoreSummary | null
  error_code: string | null
  error: string | null
  started_by: string
  created_at: string
  updated_at: string
  finished_at: string | null
  dismissed_at: string | null
}

/** What a finished restore says — the body the synchronous route has always answered with. */
export interface RestoreSummary {
  imported: number
  tables: Record<string, number>
  from: { slug: string; name: string }
  remapped: boolean
  /** True when the archive is what let this studio open for business. */
  opened: boolean
}

function view(row: TenantImportRow): ImportJobView {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    status: row.status as ImportStatus,
    phase: row.phase as ImportJobPhase,
    file_name: row.fileName,
    upload_bytes: row.uploadBytes,
    received_bytes: row.receivedBytes,
    processed: row.processed,
    total: row.total,
    summary: (row.summary as RestoreSummary | null) ?? null,
    error_code: row.errorCode,
    error: row.error,
    started_by: row.startedBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
    dismissed_at: row.dismissedAt?.toISOString() ?? null,
  }
}

const RUNNING: ImportStatus[] = ['uploading', 'processing']

/**
 * Mark this studio's jobs whose heartbeat stopped as failed. Runs inside the
 * caller's `withTenant`. Conditional on the heartbeat, so a job that is in fact
 * alive in another request of this process — or wrote a heartbeat a moment ago —
 * is left alone.
 */
async function expireStale(tenantId: string) {
  const conditions: SQL[] = [
    eq(tenantImports.tenantId, tenantId),
    inArray(tenantImports.status, RUNNING),
    lt(tenantImports.updatedAt, sql`now() - make_interval(secs => ${STALE_AFTER_MS / 1000})`),
  ]
  if (live.size > 0) conditions.push(notInArray(tenantImports.id, [...live]))
  await db
    .update(tenantImports)
    .set({
      status: 'failed',
      errorCode: sql`CASE WHEN ${tenantImports.status} = 'uploading' THEN 'upload_interrupted' ELSE 'server_stopped' END`,
      error: sql`CASE WHEN ${tenantImports.status} = 'uploading' THEN ${UPLOAD_INTERRUPTED} ELSE ${SERVER_STOPPED} END`,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(...conditions))
}

async function loadJob(tenantId: string, jobId: string): Promise<TenantImportRow | null> {
  const [row] = await db
    .select()
    .from(tenantImports)
    .where(and(eq(tenantImports.tenantId, tenantId), eq(tenantImports.id, jobId)))
    .limit(1)
  return row ?? null
}

/** One patch to a job, committed on its own. */
async function patchJob(
  tenantId: string,
  jobId: string,
  patch: Partial<typeof tenantImports.$inferInsert>,
): Promise<TenantImportRow | null> {
  return withTenant(tenantId, async () => {
    const [row] = await db
      .update(tenantImports)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(and(eq(tenantImports.tenantId, tenantId), eq(tenantImports.id, jobId)))
      .returning()
    return row ?? null
  })
}

function refusedBusy(job: TenantImportRow): ConflictError {
  return new ConflictError('import_refused', {
    message: `An import into this studio is already running (${job.fileName}). Wait for it to finish before starting another.`,
    job: view(job),
  })
}

/**
 * The synchronous route's import, under a job row of its own. The row is what
 * the partial unique index sees, so a portal import into the same studio is
 * refused while this one runs — and this one while a portal import runs.
 */
export async function importNow(input: {
  tenantId: string
  fileName: string
  bytes: Buffer
  by: string
}): Promise<RestoreSummary> {
  const { tenantId, bytes } = input
  const job = await startImport({ tenantId, fileName: input.fileName, size: bytes.byteLength, by: input.by })
  // Live for the whole request, so expiry never takes it for a dead upload.
  live.add(job.id)
  try {
    await patchJob(tenantId, job.id, { status: 'processing', phase: 'unpacking', receivedBytes: bytes.byteLength })
    const summary = await restoreArchive(tenantId, bytes)
    await patchJob(tenantId, job.id, { status: 'succeeded', phase: 'done', summary, finishedAt: new Date() })
    return summary
  } catch (err) {
    const { code, message } = describeFailure(err)
    await patchJob(tenantId, job.id, {
      status: 'failed',
      errorCode: code,
      error: message,
      finishedAt: new Date(),
    }).catch(writeErr => logger.error({ tenantId, jobId: job.id, err: writeErr }, 'tenant import: could not record failure'))
    throw err
  } finally {
    live.delete(job.id)
  }
}

/** Step 1: a job, `uploading`, waiting for its bytes. */
export async function startImport(input: {
  tenantId: string
  fileName: string
  size: number
  by: string
}): Promise<ImportJobView> {
  const tenant = await loadTenantById(input.tenantId)
  if (!tenant) throw new NotFoundError('not_found')
  if (input.size > MAX_ARCHIVE_BYTES) {
    throw new BadRequestError('archive_required', {
      message: `That file is ${formatBytes(input.size)}; an archive can be at most ${formatBytes(MAX_ARCHIVE_BYTES)}.`,
    })
  }

  return withTenant(input.tenantId, async () => {
    await expireStale(input.tenantId)
    const [running] = await db
      .select()
      .from(tenantImports)
      .where(and(eq(tenantImports.tenantId, input.tenantId), inArray(tenantImports.status, RUNNING)))
      .limit(1)
    if (running) throw refusedBusy(running)

    try {
      const [row] = await db
        .insert(tenantImports)
        .values({
          tenantId: input.tenantId,
          fileName: input.fileName,
          uploadBytes: input.size,
          startedBy: input.by,
        })
        .returning()
      return view(row!)
    } catch (err) {
      // Two starts at once: the partial unique index is the arbiter.
      if (isUniqueViolation(err, 'tenant_imports_one_running')) {
        throw new ConflictError('import_refused', {
          message: 'An import into this studio is already running. Wait for it to finish before starting another.',
        })
      }
      throw err
    }
  })
}

/**
 * Step 2: the archive's bytes. Returns once the whole file has arrived and the
 * import has been handed off — not once the import is done.
 */
export async function receiveArchive(input: {
  tenantId: string
  jobId: string
  body: ReadableStream<Uint8Array> | null
  signal?: AbortSignal
}): Promise<ImportJobView> {
  const { tenantId, jobId } = input
  const job = await withTenant(tenantId, () => loadJob(tenantId, jobId))
  if (!job) throw new NotFoundError('not_found')
  if (job.status !== 'uploading' || live.has(jobId)) {
    throw new ConflictError('import_refused', {
      message:
        job.status === 'uploading'
          ? 'This import is already receiving its file.'
          : 'This import is no longer waiting for a file. Start a new one.',
      job: view(job),
    })
  }
  if (!input.body) {
    throw new BadRequestError('archive_required', { message: 'Send the studio zip as the request body.' })
  }

  live.add(jobId)
  const progress = new ProgressWriter(tenantId, jobId)
  // Bytes can pause for longer than the stale window on a poor connection;
  // the heartbeat is what says the request is still open.
  const heartbeat = setInterval(() => progress.touch(), HEARTBEAT_MS)
  const chunks: Uint8Array[] = []
  let received = 0
  let tooBig = false
  const reader = input.body.getReader()
  let idle: NodeJS.Timeout | undefined
  const giveUp = () => void reader.cancel().catch(() => {})
  const resetIdle = () => {
    clearTimeout(idle)
    idle = setTimeout(giveUp, UPLOAD_IDLE_MS)
  }
  input.signal?.addEventListener('abort', giveUp, { once: true })

  try {
    resetIdle()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      received += value.byteLength
      if (received > job.uploadBytes) {
        tooBig = true
        giveUp()
        break
      }
      chunks.push(value)
      progress.set({ receivedBytes: received })
    }
  } catch (err) {
    // The client went away mid-body: the stream errors rather than ending.
    logger.info({ tenantId, jobId, received, err }, 'tenant import: upload cut off')
  } finally {
    clearTimeout(idle)
    clearInterval(heartbeat)
    input.signal?.removeEventListener('abort', giveUp)
  }
  await progress.close()

  if (tooBig || received !== job.uploadBytes) {
    live.delete(jobId)
    const error = tooBig
      ? `More than the announced ${formatBytes(job.uploadBytes)} arrived, so the upload was stopped. Choose the file again.`
      : UPLOAD_INTERRUPTED
    const row = await patchJob(tenantId, jobId, {
      status: 'failed',
      phase: 'uploading',
      receivedBytes: received,
      errorCode: 'upload_interrupted',
      error,
      finishedAt: new Date(),
    })
    throw new BadRequestError('archive_required', { message: error, job: row ? view(row) : undefined })
  }

  let row: TenantImportRow | null
  try {
    row = await patchJob(tenantId, jobId, {
      status: 'processing',
      phase: 'unpacking',
      receivedBytes: received,
    })
  } catch (err) {
    live.delete(jobId)
    throw err
  }

  // Handed off: nothing below waits on this request, or on the browser.
  void runImport(tenantId, jobId, Buffer.concat(chunks), job.startedBy)
  return view(row!)
}

/** Step 3, in the background. Always ends the job one way or the other. */
async function runImport(tenantId: string, jobId: string, archive: Buffer, by: string): Promise<void> {
  const progress = new ProgressWriter(tenantId, jobId)
  const heartbeat = setInterval(() => progress.touch(), HEARTBEAT_MS)
  try {
    const summary = await restoreArchive(tenantId, archive, p =>
      progress.set({ phase: p.phase, processed: p.processed, total: p.total }),
    )
    clearInterval(heartbeat)
    await progress.close()
    await patchJob(tenantId, jobId, {
      status: 'succeeded',
      phase: 'done',
      summary,
      finishedAt: new Date(),
    })
    logger.info({ tenantId, jobId, rows: summary.imported, opened: summary.opened, by }, 'tenant imported')
  } catch (err) {
    clearInterval(heartbeat)
    await progress.close()
    const { code, message } = describeFailure(err)
    logger.warn({ tenantId, jobId, err, by }, 'tenant import refused')
    await patchJob(tenantId, jobId, {
      status: 'failed',
      errorCode: code,
      error: message,
      finishedAt: new Date(),
    }).catch(writeErr => logger.error({ tenantId, jobId, err: writeErr }, 'tenant import: could not record failure'))
  } finally {
    live.delete(jobId)
  }
}

/**
 * Unpack an archive, write it into the studio and open the studio if it
 * brought staff — what both the job and the synchronous route do.
 */
export async function restoreArchive(
  tenantId: string,
  bytes: Buffer,
  onProgress: (p: { phase: ImportJobPhase; processed: number; total: number | null }) => void = () => {},
): Promise<RestoreSummary> {
  onProgress({ phase: 'unpacking', processed: 0, total: null })
  const archive = await unpackArchive(bytes)
  const summary = await importTenant(tenantId, archive, onProgress)

  onProgress({ phase: 'finishing', processed: summary.total, total: summary.total })
  // A studio provisioned to receive an archive opens `suspended`, because until
  // the archive lands nobody can sign in to it. It just landed, and it brought
  // the studio's own staff, so the reason for the suspension is gone.
  // The rows are already committed by here, so failing to open is not a failed
  // import: say so as `opened: false` and let the operator open it by hand.
  let opened = false
  if ((summary.written.staff_users ?? 0) > 0) {
    try {
      opened = Boolean(await activateAfterFirstStaff(tenantId))
    } catch (err) {
      logger.error({ tenantId, err }, 'tenant import: restored but could not open the studio')
    }
  }

  return {
    imported: summary.total,
    tables: summary.written,
    from: { slug: summary.sourceTenant.slug, name: summary.sourceTenant.name },
    remapped: summary.remapped,
    opened,
  }
}

/** A failure, as a code and a sentence for the operator. */
export function describeFailure(err: unknown): { code: string; message: string } {
  if (err instanceof ArchiveError) return { code: 'unreadable_archive', message: err.message }
  if (err instanceof AppError) {
    const detail = err.details?.message
    return {
      code: err.code,
      message: typeof detail === 'string' ? detail : 'The import was refused.',
    }
  }
  // Anything else the database refused mid-import. Still the operator's to look
  // at, and worth saying out loud rather than a bare "failed".
  return { code: 'import_refused', message: refusalMessage(err) }
}

/**
 * What the operator is told when the database refuses an import.
 *
 * The query builder's own message is the SQL it ran ("Failed query: INSERT
 * INTO …" and its parameters), which says nothing about why and would print
 * member data besides. The reason is on the database error it wraps: its
 * SQLSTATE, the table, the rule broken and the column. Those are reported, and
 * the row's values (Postgres's "Failing row contains …" detail) are not.
 */
function refusalMessage(err: unknown): string {
  const pg = findDatabaseError(err)
  if (pg) {
    const where = [pg.table_name && `table ${pg.table_name}`, pg.constraint_name && `rule ${pg.constraint_name}`, pg.column_name && `column ${pg.column_name}`]
      .filter(Boolean)
      .join(', ')
    return `The database refused the import (${pg.code ?? 'error'}${where ? `; ${where}` : ''}): ${pg.message}. Nothing was imported.`
  }
  const message = err instanceof Error ? err.message : ''
  // Never the SQL itself.
  return message && !/^failed query/i.test(message) ? message : 'The import could not be completed. Nothing was imported.'
}

type DatabaseError = { code?: string; message: string; table_name?: string; constraint_name?: string; column_name?: string }

function findDatabaseError(err: unknown): DatabaseError | null {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const candidate = e as Partial<DatabaseError>
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code) && typeof candidate.message === 'string') {
      return candidate as DatabaseError
    }
  }
  return null
}

/** The studio's most recent import, or null if it has never had one. */
export async function latestImport(tenantId: string): Promise<ImportJobView | null> {
  const tenant = await loadTenantById(tenantId)
  if (!tenant) throw new NotFoundError('not_found')
  return withTenant(tenantId, async () => {
    await expireStale(tenantId)
    const [row] = await db
      .select()
      .from(tenantImports)
      .where(eq(tenantImports.tenantId, tenantId))
      .orderBy(desc(tenantImports.createdAt))
      .limit(1)
    return row ? view(row) : null
  })
}

/**
 * Every studio's latest import that still has something to say: one running,
 * or one finished that the operator has not closed.
 *
 * One context per studio rather than a cross-tenant read — the super portal
 * holds no Tenant, and this table is fenced like any other. A studio list is
 * tens of rows, and this is read once per page load; the page then polls only
 * the studios with an import running.
 */
export async function openImports(): Promise<ImportJobView[]> {
  const ids = (await db.select({ id: tenants.id }).from(tenants)).map(r => r.id)
  const found: ImportJobView[] = []
  for (const tenantId of ids) {
    const row = await withTenant(tenantId, async () => {
      await expireStale(tenantId)
      const [latest] = await db
        .select()
        .from(tenantImports)
        .where(eq(tenantImports.tenantId, tenantId))
        .orderBy(desc(tenantImports.createdAt))
        .limit(1)
      return latest ?? null
    })
    if (row && (RUNNING.includes(row.status as ImportStatus) || !row.dismissedAt)) found.push(view(row))
  }
  return found
}

/** Close a finished job's notice. A running one cannot be dismissed. */
export async function dismissImport(tenantId: string, jobId: string): Promise<ImportJobView> {
  return withTenant(tenantId, async () => {
    const [row] = await db
      .update(tenantImports)
      .set({ dismissedAt: sql`now()` })
      .where(
        and(
          eq(tenantImports.tenantId, tenantId),
          eq(tenantImports.id, jobId),
          or(eq(tenantImports.status, 'succeeded'), eq(tenantImports.status, 'failed')),
          isNull(tenantImports.dismissedAt),
        ),
      )
      .returning()
    if (row) return view(row)
    const job = await loadJob(tenantId, jobId)
    if (!job) throw new NotFoundError('not_found')
    if (RUNNING.includes(job.status as ImportStatus)) {
      throw new ConflictError('import_refused', { message: 'This import is still running.' })
    }
    return view(job)
  })
}

/**
 * Progress, written back without slowing the import down.
 *
 * `set` is called synchronously from inside the import as often as once per
 * row; it only records the latest value, and a timer writes it at most every
 * `PROGRESS_EVERY_MS`. Writes are chained, so they land in order. `touch`
 * writes the heartbeat alone. `close` flushes the last value and waits for it,
 * so a final `succeeded`/`failed` never lands before a stale progress write.
 */
class ProgressWriter {
  private pending: Partial<typeof tenantImports.$inferInsert> | null = null
  private timer: NodeJS.Timeout | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private lastWrite = 0

  constructor(
    private readonly tenantId: string,
    private readonly jobId: string,
  ) {}

  set(patch: Partial<typeof tenantImports.$inferInsert>) {
    this.pending = { ...this.pending, ...patch }
    if (this.timer) return
    const wait = Math.max(0, this.lastWrite + PROGRESS_EVERY_MS - Date.now())
    this.timer = setTimeout(() => this.flush(), wait)
  }

  touch() {
    this.pending = { ...this.pending }
    this.flush()
  }

  private flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const patch = this.pending
    this.pending = null
    if (!patch) return
    this.lastWrite = Date.now()
    this.chain = this.chain
      .then(() => patchJob(this.tenantId, this.jobId, patch))
      .catch(err => logger.warn({ err, jobId: this.jobId }, 'tenant import: progress not written'))
  }

  async close() {
    this.flush()
    await this.chain
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} bytes`
}
