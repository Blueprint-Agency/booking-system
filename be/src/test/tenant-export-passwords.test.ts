import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, like, sql } from 'drizzle-orm'
import JSZip from 'jszip'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const OPERATOR = `operator@passwords-${run}.test`
const DOMAIN = `passwords-${run}.test`
const MARK = `secret-${run}`

/**
 * An export asked to include passwords (`?include=passwords`): each member's
 * and staff member's password hash travels beside the studio's rows, and a
 * restore elsewhere gives it to the login made for them, so they sign in with
 * the password they already have. Nothing else a login holds travels, a login
 * that already has a password keeps it, and the export and the import are both
 * written to the studio's own audit log.
 *
 * Through the platform routes, as the super portal calls them, against a real
 * Postgres with Row-Level Security live.
 */
describe('exporting a studio with its passwords', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let operator!: Record<string, string>
  let schema!: typeof import('../db/schema')
  let archives!: typeof import('../services/tenants/transfer-archive')
  let hashPassword!: (password: string) => Promise<string>

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    archives = await import('../services/tenants/transfer-archive')
    ;({ hashPassword } = await import('better-auth/crypto'))
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  const platform = (method: string, path: string, body?: RequestInit['body']) =>
    harness.app.request(`/api/v1/platform${path}`, {
      method,
      headers: { Authorization: operator.Authorization! },
      body,
    })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return JSON.parse(text) as any
  }

  type Studio = { id: string; slug: string }

  async function studio(label: string): Promise<Studio> {
    const slug = `${label}-${run}-${randomUUID().slice(0, 6)}`
    const [row] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO tenants (slug, name, timezone, status)
      VALUES (${slug}, ${`Passwords ${label}`}, 'Asia/Singapore', 'active')
      RETURNING id
    `)
    return { id: row!.id, slug }
  }

  const email = (who: string) => `${who}-${randomUUID().slice(0, 6)}@${DOMAIN}`

  /** This studio's login for `address` in `pool`, with `password` as its only credential. */
  async function login(pool: 'client' | 'staff', tenant: Studio, address: string, password: string | null) {
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const userId = await ensureAuthUser(harness.db, pool, { tenantId: tenant.id, email: address, name: address })
    const accounts = pool === 'client' ? schema.clientAuthAccounts : schema.staffAuthAccounts
    await harness.db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    if (password) {
      await harness.db.insert(accounts).values({
        id: randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: await hashPassword(password),
        tenantId: tenant.id,
      })
    }
    return userId
  }

  async function member(tenant: Studio, address: string, password: string | null) {
    const authUserId = await login('client', tenant, address, password)
    await harness.db.insert(schema.clients).values({
      tenantId: tenant.id,
      authUserId,
      email: address,
      name: address.split('@')[0]!,
      phone: `+658${Math.floor(Math.random() * 1e7).toString().padStart(7, '0')}`,
    })
    return authUserId
  }

  async function admin(tenant: Studio, address: string, password: string | null) {
    const authUserId = await login('staff', tenant, address, password)
    await harness.db.insert(schema.staffUsers).values({
      tenantId: tenant.id,
      authUserId,
      email: address,
      name: address.split('@')[0]!,
      role: 'admin',
      status: 'active',
    })
    return authUserId
  }

  const exportZip = async (tenant: Studio, query = '') => {
    const res = await platform('GET', `/tenants/${tenant.id}/export${query}`)
    assert.equal(res.status, 200, await res.clone().text())
    return { res, zip: Buffer.from(await res.arrayBuffer()) }
  }

  const restore = (tenant: Studio, zip: Buffer, fields: Record<string, string> = {}) => {
    const form = new FormData()
    form.append('archive', new File([new Uint8Array(zip)], 'studio.zip', { type: 'application/zip' }))
    for (const [name, value] of Object.entries(fields)) form.append(name, value)
    return platform('POST', `/tenants/${tenant.id}/import`, form)
  }

  /** Sign in with a password, as each frontend does: the HTTP status. */
  const signIn = async (pool: 'client' | 'staff', tenant: Studio, address: string, password: string) => {
    const res = await harness.app.request(`/api/v1/auth/${pool}/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: frontendOrigin(pool, tenant),
        'X-Tenant-Slug': tenant.slug,
        'X-Forwarded-For': harnessAddress(),
      },
      body: JSON.stringify({ email: address, password }),
    })
    if (res.status === 200) assert.ok(res.headers.get('set-auth-token'), 'a signed-in response hands back a bearer token')
    return res.status
  }

  const auditActions = async (tenant: Studio, action: string) =>
    harness.db.execute<{ actor_type: string; payload: Record<string, any> }>(sql`
      SELECT actor_type, payload FROM audit_log WHERE tenant_id = ${tenant.id} AND action = ${action}
    `)

  test('SUP-21 an export asked for passwords carries each member’s and staff member’s hash and nothing else a login holds, names itself, and is written to the studio’s audit log; one not asked carries none', async () => {
    const source = await studio('export')
    const memberEmail = email('member')
    const staffEmail = email('owner')
    await member(source, memberEmail, 'member-password-1')
    const staffLogin = await admin(source, staffEmail, 'staff-password-1')
    // A login no member or staff row names: the archive restores nobody for it.
    const stray = email('stray')
    await login('client', source, stray, 'stray-password-1')
    // What must never travel: a second factor, a session, a verification.
    const in1h = new Date(Date.now() + 3_600_000)
    await harness.db.insert(schema.staffAuthTwoFactors).values({
      id: randomUUID(), secret: `${MARK}-2fa`, backupCodes: `${MARK}-backup`, userId: staffLogin, tenantId: source.id,
    })
    await harness.db.insert(schema.staffAuthSessions).values({
      id: randomUUID(), token: `${MARK}-session`, expiresAt: in1h, userId: staffLogin, claimedTenantId: source.id, tenantId: source.id,
    })
    await harness.db.insert(schema.staffAuthVerifications).values({
      id: randomUUID(), identifier: staffEmail, value: `${MARK}-verification`, expiresAt: in1h, tenantId: source.id,
    })

    const plain = await exportZip(source)
    assert.doesNotMatch(plain.res.headers.get('content-disposition') ?? '', /with-passwords/)
    const plainZip = await JSZip.loadAsync(plain.zip)
    assert.equal(plainZip.file('logins/passwords.json'), null, 'a routine export carries no passwords')
    assert.equal((await archives.unpackArchive(plain.zip)).passwords, undefined)
    assert.equal((await auditActions(source, 'tenant.exported_with_passwords')).length, 0)

    const withPasswords = await exportZip(source, '?include=passwords')
    assert.match(withPasswords.res.headers.get('content-disposition') ?? '', /-with-passwords\.zip"/)
    const archive = await archives.unpackArchive(withPasswords.zip)
    assert.deepEqual(archive.manifest.passwords, { client: 1, staff: 1 })
    assert.deepEqual(archive.passwords!.client.map(p => p.email), [memberEmail])
    assert.deepEqual(archive.passwords!.staff.map(p => p.email), [staffEmail])
    for (const { hash } of [...archive.passwords!.client, ...archive.passwords!.staff]) {
      assert.doesNotMatch(hash, /password-1/, 'a hash, never the password')
    }

    const everything = (
      await Promise.all(
        Object.values((await JSZip.loadAsync(withPasswords.zip)).files).map(f => (f.dir ? '' : f.async('string'))),
      )
    ).join('\n')
    assert.ok(!everything.includes(MARK), 'a second factor, session or verification reached the archive')
    assert.ok(!everything.includes(stray), 'a login no row names reached the archive')

    const [entry, ...more] = await auditActions(source, 'tenant.exported_with_passwords')
    assert.equal(more.length, 0)
    assert.equal(entry?.actor_type, 'system')
    assert.equal(entry?.payload.exportedBy, OPERATOR)
    assert.deepEqual(entry?.payload.passwords, { client: 1, staff: 1 })
  })

  test('SUP-22 restored into another studio, an export with passwords lets each member and staff member sign in with the password they had, and the import is written to the studio’s audit log', async () => {
    const source = await studio('from')
    const target = await studio('to')
    const memberEmail = email('member')
    const staffEmail = email('owner')
    await member(source, memberEmail, 'member-password-2')
    await admin(source, staffEmail, 'staff-password-2')

    const { zip } = await exportZip(source, '?include=passwords')
    const summary = await json(await restore(target, zip), 200)
    assert.deepEqual(summary.passwords_applied, { client: 1, staff: 1 })

    assert.equal(await signIn('client', target, memberEmail, 'member-password-2'), 200)
    assert.equal(await signIn('staff', target, staffEmail, 'staff-password-2'), 200)
    assert.notEqual(await signIn('client', target, memberEmail, 'not-the-password'), 200)

    const [entry, ...more] = await auditActions(target, 'tenant.passwords_imported')
    assert.equal(more.length, 0)
    assert.equal(entry?.actor_type, 'system')
    assert.equal(entry?.payload.importedBy, OPERATOR)
    assert.equal(entry?.payload.mode, 'restore')
    assert.equal(entry?.payload.source.slug, source.slug)
    assert.deepEqual(entry?.payload.applied, { client: 1, staff: 1 })
  })

  test('SUP-23 a replace from an export with passwords gives a password only to a login that has none: a person already signed up keeps theirs, a newcomer takes the archive’s', async () => {
    const source = await studio('build')
    const target = await studio('live')
    const kept = email('kept')
    const newcomer = email('new')
    await member(target, kept, 'target-password-3')
    await member(source, kept, 'source-password-3')
    await member(source, newcomer, 'newcomer-password-3')

    const { zip } = await exportZip(source, '?include=passwords')
    const summary = await json(await restore(target, zip, { mode: 'replace', confirm_slug: target.slug }), 200)
    assert.deepEqual(summary.passwords_applied, { client: 1, staff: 0 })

    assert.equal(await signIn('client', target, kept, 'target-password-3'), 200)
    assert.notEqual(await signIn('client', target, kept, 'source-password-3'), 200, 'the archive never overwrites a password')
    assert.equal(await signIn('client', target, newcomer, 'newcomer-password-3'), 200)

    const [entry] = await auditActions(target, 'tenant.passwords_imported')
    assert.equal(entry?.payload.mode, 'replace')
  })

  test('SUP-24 an archive whose passwords file is missing or short of the manifest’s count is refused as unreadable, and the studio is left empty', async () => {
    const source = await studio('short')
    await member(source, email('member'), 'member-password-4')
    await member(source, email('member'), 'member-password-4b')
    const { zip } = await exportZip(source, '?include=passwords')

    const without = await JSZip.loadAsync(zip)
    without.remove('logins/passwords.json')
    const short = await JSZip.loadAsync(zip)
    const passwords = JSON.parse(await short.file('logins/passwords.json')!.async('string'))
    short.file('logins/passwords.json', JSON.stringify({ ...passwords, client: passwords.client.slice(1) }))

    for (const broken of [without, short]) {
      const target = await studio('refused')
      const body = await json(await restore(target, await broken.generateAsync({ type: 'nodebuffer' })), 400)
      assert.equal(body.error, 'unreadable_archive')
      const [clients] = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM clients WHERE tenant_id = ${target.id}`,
      )
      assert.equal(clients?.n, 0)
    }
  })
})
