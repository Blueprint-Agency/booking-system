import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, like, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  HARNESS_PASSWORD,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'
import { totp } from './totp'
import { withEnv } from './with-env'
import type { TenantArchive } from '../services/tenants/transfer-shape'

const run = Date.now().toString(36)
const OPERATOR = `operator@replace-${run}.test`
const DOMAIN = `replace-${run}.test`

/**
 * Replacing a studio from an archive (#339): every row the studio owns goes,
 * the archive's rows arrive in their place, and its people's logins stay.
 *
 * Through the platform routes, as the super portal and the runbook call them,
 * against a real Postgres with Row-Level Security live. The claim that matters
 * is the one a person notices: after a replace they sign in with the password
 * they set before it, and a session they had open still works.
 */
describe('replacing a studio from an archive', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let operator!: Record<string, string>
  let schema!: typeof import('../db/schema')
  let transfer!: typeof import('../services/tenants/transfer')
  let archives!: typeof import('../services/tenants/transfer-archive')

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    transfer = await import('../services/tenants/transfer')
    archives = await import('../services/tenants/transfer-archive')
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  const platform = (method: string, path: string, body?: RequestInit['body'], headers: Record<string, string> = {}) =>
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

  /** The one-request import, as the runbook calls it. */
  const importNow = (tenantId: string, zip: Buffer, fields: Record<string, string> = {}) => {
    const form = new FormData()
    form.append('archive', new File([new Uint8Array(zip)], 'studio.zip', { type: 'application/zip' }))
    for (const [name, value] of Object.entries(fields)) form.append(name, value)
    return platform('POST', `/tenants/${tenantId}/import`, form)
  }
  const replaceNow = (tenant: Studio, zip: Buffer, confirmSlug = tenant.slug) =>
    importNow(tenant.id, zip, { mode: 'replace', confirm_slug: confirmSlug })

  type Studio = { id: string; slug: string }

  async function studio(label: string, status: 'active' | 'suspended' = 'active'): Promise<Studio> {
    const slug = `${label}-${run}-${randomUUID().slice(0, 6)}`
    const [row] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO tenants (slug, name, timezone, status)
      VALUES (${slug}, ${`Replace ${label}`}, 'Asia/Singapore', ${status})
      RETURNING id
    `)
    return { id: row!.id, slug }
  }

  const email = (who: string, tenant: Studio) => `${who}-${tenant.slug}@${DOMAIN}`

  /** A member row at a studio, linked to the studio's login for that email (made if missing). */
  async function member(tenant: Studio, address: string, name: string) {
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const login = await ensureAuthUser(harness.db, 'client', { tenantId: tenant.id, email: address, name })
    await harness.db.insert(schema.clients).values({
      tenantId: tenant.id,
      authUserId: login,
      email: address,
      name,
      phone: `+658${Math.floor(Math.random() * 1e7).toString().padStart(7, '0')}`,
    })
    return login
  }

  async function admin(tenant: Studio, address: string, name: string) {
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const login = await ensureAuthUser(harness.db, 'staff', { tenantId: tenant.id, email: address, name })
    await harness.db.insert(schema.staffUsers).values({
      tenantId: tenant.id,
      authUserId: login,
      email: address,
      name,
      role: 'admin',
      status: 'active',
    })
    return login
  }

  const location = (tenant: Studio, name: string) =>
    harness.db.execute(sql`INSERT INTO locations (tenant_id, name) VALUES (${tenant.id}, ${name})`)

  const names = async (table: 'locations' | 'clients' | 'staff_users', tenant: Studio) =>
    (
      await harness.db.execute<{ name: string }>(
        sql`SELECT name FROM ${sql.identifier(table)} WHERE tenant_id = ${tenant.id} ORDER BY name`,
      )
    ).map(r => r.name)

  const exported = async (tenant: Studio) => transfer.exportTenant(tenant.id)
  /** Packed with the manifest's counts made to match rows a test edited. */
  const zipOf = (archive: TenantArchive) =>
    archives.packArchive({
      ...archive,
      manifest: {
        ...archive.manifest,
        counts: Object.fromEntries(Object.entries(archive.rows).map(([table, rows]) => [table, rows.length])),
      },
    })

  /** Every row of every studio table and login table a studio holds, for "untouched". */
  async function snapshot(tenant: Studio) {
    const { order } = await transfer.tenantTableOrder()
    const { LOGIN_TABLES } = await import('../services/tenants/transfer-tables')
    const out: Record<string, unknown[]> = {}
    for (const table of [...order, ...LOGIN_TABLES, 'tenant_settings', 'tenant_payment_credentials']) {
      out[table] = await harness.db.execute(
        sql`SELECT * FROM ${sql.identifier(table)} WHERE tenant_id = ${tenant.id} ORDER BY 1, 2`,
      )
    }
    const [row] = await harness.db.execute(sql`SELECT * FROM tenants WHERE id = ${tenant.id}`)
    out.tenants = [row]
    out.former_slugs = await harness.db.execute(
      sql`SELECT * FROM former_slugs WHERE renamed_tenant_id = ${tenant.id} ORDER BY slug`,
    )
    return JSON.parse(JSON.stringify(out)) as Record<string, unknown[]>
  }

  // ---- Signing in, as each frontend does ------------------------------------

  const auth = (pool: 'client' | 'staff', tenant: Studio, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    harness.app.request(`/api/v1/auth/${pool}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Origin: frontendOrigin(pool, tenant),
        'X-Tenant-Slug': tenant.slug,
        'X-Forwarded-For': harnessAddress(),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const headersFor = (pool: 'client' | 'staff', tenant: Studio, token: string) => ({
    Origin: frontendOrigin(pool, tenant),
    'X-Tenant-Slug': tenant.slug,
    'X-Forwarded-For': harnessAddress(),
    Authorization: `Bearer ${token}`,
  })

  const tokenOf = async (res: Response) => {
    assert.equal(res.status, 200, await res.clone().text())
    const token = res.headers.get('set-auth-token')
    assert.ok(token, 'a signed-in response hands back a bearer token')
    return token
  }

  /** Enrol an authenticator app for a signed-in staff member; the TOTP secret. */
  async function enrolTotp(tenant: Studio, token: string) {
    const enabled = await auth('staff', tenant, '/two-factor/enable', { password: HARNESS_PASSWORD }, { Authorization: `Bearer ${token}` })
    assert.equal(enabled.status, 200, await enabled.clone().text())
    const { totpURI } = (await enabled.json()) as { totpURI: string }
    const next = enabled.headers.get('set-auth-token') ?? token
    const secret = new URL(totpURI).searchParams.get('secret')!
    const verified = await auth('staff', tenant, '/two-factor/verify-totp', { code: totp(secret) }, { Authorization: `Bearer ${next}` })
    assert.equal(verified.status, 200, await verified.clone().text())
    return { secret, token: verified.headers.get('set-auth-token') ?? next }
  }

  /** Password, then the authenticator's code: a new staff session, or a failure. */
  async function signInWithTotp(tenant: Studio, address: string, secret: string) {
    const first = await auth('staff', tenant, '/sign-in/email', { email: address, password: HARNESS_PASSWORD })
    assert.equal(first.status, 200, await first.clone().text())
    assert.equal(((await first.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect, true, 'the second factor is still asked for')
    const cookie = first.headers.getSetCookie().map(c => c.split(';')[0]!).join('; ')
    return tokenOf(await auth('staff', tenant, '/two-factor/verify-totp', { code: totp(secret) }, { Cookie: cookie }))
  }

  // ---- The scenarios --------------------------------------------------------

  test('SUP-13 after a replace, members and staff sign in with the password they had, the second factor verifies, and open sessions still work', async () => {
    const target = await studio('keeps')
    const source = await studio('build')
    const staffEmail = email('owner', target)
    const memberEmail = email('member', target)

    await admin(target, staffEmail, 'Owner Before')
    await member(target, memberEmail, 'Member Before')
    await location(target, 'Old Room')
    // Their passwords, set before the replace, and a staff second factor.
    const staffSession = (await harness.signInAs('staff', staffEmail, target)).Authorization!.slice('Bearer '.length)
    const memberSession = (await harness.signInAs('client', memberEmail, target)).Authorization!.slice('Bearer '.length)
    const { secret, token: staffToken } = await enrolTotp(target, staffSession)

    // The new build: the same two people, under the rehearsal's rows.
    await admin(source, staffEmail, 'Owner After')
    await member(source, memberEmail, 'Member After')
    await location(source, 'New Room')
    const zip = await zipOf(await exported(source))

    const summary = await json(await replaceNow(target, zip), 200)
    assert.equal(summary.mode, 'replace')

    assert.deepEqual(await names('locations', target), ['New Room'])
    assert.deepEqual(await names('staff_users', target), ['Owner After'])
    assert.deepEqual(await names('clients', target), ['Member After'])

    // The session each had open during the replace is still good, and is now
    // the new row's.
    const me = await harness.app.request('/api/v1/me', { headers: headersFor('client', target, memberSession) })
    assert.equal(me.status, 200, await me.clone().text())
    assert.match(await me.text(), /Member After/)
    const portal = await harness.app.request('/api/v1/portal/auth/me', { headers: headersFor('staff', target, staffToken) })
    assert.equal(portal.status, 200, await portal.clone().text())
    assert.match(await portal.text(), /Owner After/)

    // And each signs in afresh with the password they set before it.
    await tokenOf(await auth('client', target, '/sign-in/email', { email: memberEmail, password: HARNESS_PASSWORD }))
    const fresh = await signInWithTotp(target, staffEmail, secret)
    const again = await harness.app.request('/api/v1/portal/auth/me', { headers: headersFor('staff', target, fresh) })
    assert.equal(again.status, 200, await again.clone().text())
  })

  test('SUP-14 rows not in the archive are gone; the archive’s people name the studio’s existing logins, a newcomer gets a fresh one with no password, and the login of anyone not in the archive is deleted with its password, sessions, second factor and verifications', async () => {
    const target = await studio('links')
    const source = await studio('links-src')
    const staying = email('staying', target)
    const leaving = email('leaving', target)
    const newcomer = email('newcomer', target)
    const leavingStaff = email('leaving-staff', target)

    const stayingLogin = await member(target, staying, 'Staying')
    // Registered on the new system since the build: a password, a session open,
    // a reset link outstanding. And a staff member with a second factor.
    const leavingLogin = await member(target, leaving, 'Leaving')
    const leavingSession = (await harness.signInAs('client', leaving, target)).Authorization!.slice('Bearer '.length)
    await harness.db.insert(schema.clientAuthVerifications).values({
      id: randomUUID(), identifier: leaving, value: 'pending-code', expiresAt: new Date(Date.now() + 3_600_000), tenantId: target.id,
    })
    const leavingStaffLogin = await admin(target, leavingStaff, 'Leaving Staff')
    await harness.signInAs('staff', leavingStaff, target)
    await harness.db.insert(schema.staffAuthTwoFactors).values({
      id: randomUUID(), secret: 'leaving-secret', backupCodes: 'leaving-backup', userId: leavingStaffLogin, tenantId: target.id,
    })
    await harness.db.insert(schema.staffAuthVerifications).values({
      id: randomUUID(), identifier: `reset-password:${randomUUID()}`, value: leavingStaffLogin, expiresAt: new Date(Date.now() + 3_600_000), tenantId: target.id,
    })
    await location(target, 'Old Room')

    await member(source, staying, 'Staying')
    await member(source, newcomer, 'Newcomer')
    await location(source, 'New Room')
    const zip = await zipOf(await exported(source))

    const summary = await json(await replaceNow(target, zip), 200)
    assert.equal(summary.remapped, true, 'an archive of another studio is given fresh ids')

    assert.deepEqual(await names('locations', target), ['New Room'])
    assert.deepEqual(await names('clients', target), ['Newcomer', 'Staying'])

    const rows = await harness.db
      .select({ email: schema.clients.email, login: schema.clients.authUserId })
      .from(schema.clients)
      .where(eq(schema.clients.tenantId, target.id))
    const loginOf = (address: string) => rows.find(r => r.email === address)!.login
    assert.equal(loginOf(staying), stayingLogin, 'the archive’s row names the studio’s existing login')

    const [fresh] = await harness.db
      .select({ id: schema.clientAuthUsers.id, tenantId: schema.clientAuthUsers.tenantId })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.id, loginOf(newcomer)))
    assert.equal(fresh?.tenantId, target.id, 'the newcomer has a login at this studio')
    const passwords = await harness.db
      .select({ id: schema.clientAuthAccounts.id })
      .from(schema.clientAuthAccounts)
      .where(and(eq(schema.clientAuthAccounts.userId, fresh!.id), eq(schema.clientAuthAccounts.providerId, 'credential')))
    assert.deepEqual(passwords, [], 'and it has no password yet')

    assert.deepEqual(summary.logins_removed, { client: 1, staff: 1 })

    // Every trace of the two logins at this studio is gone.
    const left = async (table: string, where: ReturnType<typeof sql>) =>
      (await harness.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${target.id} AND ${where}`))[0]!.n
    assert.equal(await left('client_auth_users', sql`id = ${leavingLogin}`), 0, 'the member’s login is deleted')
    assert.equal(await left('client_auth_accounts', sql`user_id = ${leavingLogin}`), 0, 'with their password')
    assert.equal(await left('client_auth_sessions', sql`user_id = ${leavingLogin}`), 0, 'and their sessions')
    assert.equal(await left('client_auth_verifications', sql`identifier = ${leaving}`), 0, 'and their pending codes')
    assert.equal(await left('staff_auth_users', sql`id = ${leavingStaffLogin}`), 0, 'the staff member’s login is deleted')
    assert.equal(await left('staff_auth_accounts', sql`user_id = ${leavingStaffLogin}`), 0)
    assert.equal(await left('staff_auth_sessions', sql`user_id = ${leavingStaffLogin}`), 0)
    assert.equal(await left('staff_auth_two_factors', sql`user_id = ${leavingStaffLogin}`), 0, 'with their second factor')
    assert.equal(await left('staff_auth_verifications', sql`value = ${leavingStaffLogin}`), 0, 'and their reset link')

    // The session they had open is refused, and their password no longer signs in.
    const me = await harness.app.request('/api/v1/me', { headers: headersFor('client', target, leavingSession) })
    assert.equal(me.status, 401, await me.text())
    const signIn = await auth('client', target, '/sign-in/email', { email: leaving, password: HARNESS_PASSWORD })
    assert.notEqual(signIn.status, 200, 'the old password signs nobody in')
    assert.equal(signIn.headers.get('set-auth-token'), null)

    // The person who stayed keeps their login.
    const [still] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.id, stayingLogin))
    assert.ok(still, 'a person in the archive keeps their login')
  })

  test('SUP-15 a replace leaves the studio’s settings, Slug, name, status, Term, payment credentials and former Slugs as they were, and a suspended studio stays suspended', async () => {
    const target = await studio('keeps-settings', 'suspended')
    const source = await studio('settings-src')
    await harness.db.execute(sql`INSERT INTO tenant_settings (tenant_id, display_name) VALUES (${target.id}, 'The Target Brand')`)
    await harness.db.execute(sql`INSERT INTO tenant_settings (tenant_id, display_name) VALUES (${source.id}, 'The Source Brand')`)
    for (const [tenant, account] of [[target, 'acct_target'], [source, 'acct_source']] as const) {
      await harness.db.insert(schema.tenantPaymentCredentials).values({
        tenantId: tenant.id,
        accountId: `${account}_${run}`,
        secretKeySealed: `sealed-${account}`,
        webhookSecretSealed: `sealed-hook-${account}`,
      })
    }
    await harness.db.insert(schema.formerSlugs).values({
      slug: `was-${target.slug}`,
      renamedTenantId: target.id,
      newSlug: target.slug,
      redirectUntil: new Date(Date.now() + 86_400_000),
      renamedBy: OPERATOR,
    })
    await admin(target, email('owner', target), 'Owner')
    // The archive brings staff: a restore would open the studio; a replace must not.
    await admin(source, email('owner', target), 'Owner')

    const before = await snapshot(target)
    await json(await replaceNow(target, await zipOf(await exported(source))), 200)
    const after = await snapshot(target)

    for (const table of ['tenants', 'tenant_settings', 'tenant_payment_credentials', 'former_slugs']) {
      assert.deepEqual(after[table], before[table], `${table} changed`)
    }
    assert.equal((after.tenants![0] as { status: string }).status, 'suspended')
  })

  test('SUP-16 a replace whose typed Slug is not the studio’s is refused, and one that fails part-way leaves the studio exactly as it was', async () => {
    const target = await studio('refused')
    const source = await studio('refused-src')
    await member(target, email('member', target), 'Member')
    await location(target, 'Old Room')
    await location(source, 'New Room')
    const archive = await exported(source)
    const before = await snapshot(target)

    const mismatch = await json(await replaceNow(target, await zipOf(archive), `${target.slug}-typo`), 400)
    assert.equal(mismatch.error, 'confirmation_mismatch')
    const jobMismatch = await json(
      await platform(
        'POST',
        `/tenants/${target.id}/imports`,
        JSON.stringify({ file_name: 'studio.zip', size: 10, mode: 'replace', confirm_slug: 'nope' }),
        { 'Content-Type': 'application/json' },
      ),
      400,
    )
    assert.equal(jobMismatch.error, 'confirmation_mismatch')
    assert.deepEqual(await snapshot(target), before, 'a refused replace changes nothing')

    // Restore mode still refuses a studio that has rows.
    const restore = await json(await importNow(target.id, await zipOf(archive)), 409)
    assert.equal(restore.error, 'import_refused')
    assert.match(restore.message, /import only into an empty studio/)

    // An archive the database refuses once the old rows are already deleted.
    const broken: TenantArchive = structuredClone(archive)
    broken.rows.locations = [...(broken.rows.locations ?? []), { ...broken.rows.locations![0]!, id: randomUUID(), name: null }]
    const failed = await json(await replaceNow(target, await zipOf(broken)), 409)
    assert.equal(failed.error, 'import_refused')
    assert.deepEqual(await snapshot(target), before, 'a replace that failed part-way left the studio as it was')
  })

  test('SUP-17 an archive built for this studio keeps its ids, and a Mindbody build replaces its own studio but no other', async () => {
    const target = await studio('rehearsal')
    const other = await studio('elsewhere')
    await location(target, 'Kept Room')
    const own = await exported(target)
    await location(target, 'Added Since')

    const inPlace = await json(await replaceNow(target, await zipOf(own)), 200)
    assert.equal(inPlace.remapped, false, 'the studio’s own archive keeps its ids')
    const [kept] = await harness.db.execute<{ id: string }>(sql`SELECT id FROM locations WHERE tenant_id = ${target.id}`)
    assert.equal(kept!.id, own.rows.locations![0]!.id)
    assert.deepEqual(await names('locations', target), ['Kept Room'])

    // What the transform writes: no login on any row, and the rehearsal's Slug.
    const build: TenantArchive = structuredClone(own)
    build.manifest.ensureAccounts = true
    build.manifest.tenant = { ...build.manifest.tenant, id: randomUUID(), slug: target.slug }
    build.rows.locations = [{ ...own.rows.locations![0]!, id: randomUUID(), name: 'Mindbody Room' }]
    build.rows.clients = [
      { id: randomUUID(), tenant_id: build.manifest.tenant.id, auth_user_id: null, email: email('mb', target), name: 'From Mindbody', phone: '+6580001111' },
    ]
    const zip = await zipOf(build)

    await json(await replaceNow(target, zip), 200)
    assert.deepEqual(await names('locations', target), ['Mindbody Room'])
    assert.deepEqual(await names('clients', target), ['From Mindbody'])

    await location(other, 'Other Room')
    const refused = await json(await replaceNow(other, zip), 409)
    assert.equal(refused.error, 'import_refused')
    assert.deepEqual(await names('locations', other), ['Other Room'])
  })

  test('SUP-18 replacing northwind leaves acme untouched, rows and logins alike', async () => {
    const northwind = await studio('northwind')
    const acme = await studio('acme')
    const source = await studio('northwind-build')
    // The same person at both studios: two logins, one each.
    const shared = email('both', northwind)
    await member(northwind, shared, 'At Northwind')
    await member(acme, shared, 'At Acme')
    await location(acme, 'Acme Room')
    await harness.signInAs('client', shared, acme)
    await member(source, shared, 'At Northwind Again')
    // Left out of northwind's build, and a member of acme too: only northwind's login goes.
    const dropped = email('dropped', northwind)
    await member(northwind, dropped, 'Dropped At Northwind')
    await member(acme, dropped, 'Still At Acme')
    await harness.signInAs('client', dropped, acme)

    const before = await snapshot(acme)
    const summary = await json(await replaceNow(northwind, await zipOf(await exported(source))), 200)
    assert.equal(summary.logins_removed.client, 1)
    assert.deepEqual(await snapshot(acme), before)
  })

  test('SUP-19 a replace is written to the studio’s own audit log: who, when, the archive’s source and its counts', async () => {
    const target = await studio('audited')
    const source = await studio('audited-src')
    await location(source, 'New Room')
    await member(source, email('m', target), 'Member')
    const archive = await exported(source)

    const summary = await json(await replaceNow(target, await zipOf(archive)), 200)
    const entries = await harness.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, target.id), eq(schema.auditLog.action, 'tenant.replaced_from_archive')))
    assert.equal(entries.length, 1)
    const [entry] = entries
    assert.equal(entry!.actorType, 'system')
    assert.equal(entry!.actorStaffId, null)
    assert.equal(entry!.targetTable, 'tenants')
    assert.equal(entry!.targetId, target.id)
    assert.ok(Date.now() - entry!.createdAt.getTime() < 60_000, 'written now')
    const payload = entry!.payload as any
    assert.equal(payload.replacedBy, OPERATOR)
    assert.equal(payload.source.slug, source.slug)
    assert.equal(payload.source.exportedAt, archive.manifest.exportedAt)
    assert.deepEqual(payload.counts, summary.tables)
    assert.equal(payload.counts.locations, 1)
    assert.equal(payload.counts.clients, 1)
  })

  test('SUP-20 a replace runs as a job with the same progress as a restore, one at a time per studio', async () => {
    const target = await studio('job')
    const source = await studio('job-src')
    await location(target, 'Old Room')
    await location(source, 'New Room')
    const zip = await zipOf(await exported(source))

    const startBody = (mode?: string) =>
      JSON.stringify({ file_name: 'build.zip', size: zip.length, mode, confirm_slug: target.slug })
    const started = (
      await json(await platform('POST', `/tenants/${target.id}/imports`, startBody('replace'), { 'Content-Type': 'application/json' }), 201)
    ).job
    assert.equal(started.mode, 'replace')

    // A second import or replace is refused while this one is running.
    const busy = await json(
      await platform('POST', `/tenants/${target.id}/imports`, startBody('replace'), { 'Content-Type': 'application/json' }),
      409,
    )
    assert.equal(busy.error, 'import_refused')

    await json(await platform('PUT', `/tenants/${target.id}/imports/${started.id}/archive`, new Uint8Array(zip), { 'Content-Type': 'application/zip' }), 202)

    const deadline = Date.now() + 60_000
    let job: any
    for (;;) {
      job = (await json(await platform('GET', `/tenants/${target.id}/imports/latest`), 200)).job
      if (job.status === 'succeeded' || job.status === 'failed') break
      assert.ok(Date.now() < deadline, `replace still ${job.status}/${job.phase}`)
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    assert.equal(job.status, 'succeeded', job.error)
    assert.equal(job.mode, 'replace')
    assert.equal(job.summary.mode, 'replace')
    assert.equal(job.processed, job.total)
    assert.equal(job.summary.opened, false, 'a replace never opens a studio')
    assert.deepEqual(await names('locations', target), ['New Room'])
  })
})
