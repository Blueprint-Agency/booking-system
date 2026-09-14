import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { eq, inArray } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { ClerkExportedUser } from '../services/auth/clerk-import'

/**
 * The one-off import of Clerk's users into the Better Auth pools (#120), run
 * against the harness database with a hand-made export in place of Clerk's API.
 *
 * What it has to prove is what the issue's acceptance list says: a migrated
 * staff member signs in with the password they already had, a migrated member
 * signs in by code as the same auth user the import made, every row with a Clerk
 * id gets an auth id, second-factor users are listed for re-enrolment, and a
 * second run changes nothing.
 */
describe('Clerk user import', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let importer!: typeof import('../services/auth/clerk-import')

  const run = Date.now().toString(36)
  const STAFF_EMAIL = `clerk-staff-${run}@import.test`
  const MEMBER_EMAIL = `clerk-member-${run}@import.test`
  const OPERATOR_EMAIL = `clerk-operator-${run}@import.test`
  const NO_DIGEST_EMAIL = `clerk-nodigest-${run}@import.test`
  const PASSWORD = 'the-password-from-clerk'
  const ids = {
    staff: `user_staff_${run}`,
    noDigest: `user_nodigest_${run}`,
    member: `user_member_${run}`,
    operator: `user_operator_${run}`,
    orphan: `user_orphan_${run}`,
  }
  const emails = [STAFF_EMAIL, MEMBER_EMAIL, OPERATOR_EMAIL, NO_DIGEST_EMAIL, `orphan-${run}@import.test`]

  let staffExport!: ClerkExportedUser[]
  let memberExport!: ClerkExportedUser[]
  let platformExport!: ClerkExportedUser[]

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    importer = await import('../services/auth/clerk-import')
    const tenantId = harness.tenants.one.id

    staffExport = [
      {
        clerkId: ids.staff,
        email: STAFF_EMAIL.toUpperCase(),
        name: 'Clerk Staff',
        passwordDigest: await bcrypt.hash(PASSWORD, 10),
        passwordEnabled: true,
        totpEnabled: true,
      },
      {
        clerkId: ids.noDigest,
        email: NO_DIGEST_EMAIL,
        name: 'No Digest',
        passwordDigest: null,
        passwordEnabled: true,
        totpEnabled: false,
      },
    ]
    memberExport = [
      { clerkId: ids.member, email: MEMBER_EMAIL, name: 'Clerk Member', passwordDigest: null, passwordEnabled: false, totpEnabled: false },
    ]
    platformExport = [
      {
        clerkId: ids.operator,
        email: OPERATOR_EMAIL,
        name: 'Clerk Operator',
        passwordDigest: await bcrypt.hash(PASSWORD, 10),
        passwordEnabled: true,
        totpEnabled: false,
      },
    ]

    await harness.db.insert(schema.staffUsers).values([
      { tenantId, email: STAFF_EMAIL, name: 'Clerk Staff', role: 'admin', status: 'active', clerkUserId: ids.staff },
      { tenantId, email: NO_DIGEST_EMAIL, name: 'No Digest', role: 'instructor', status: 'active', clerkUserId: ids.noDigest },
      // A row whose Clerk user is in no export: the one the report must name.
      { tenantId, email: emails[4]!, name: 'Orphan', role: 'instructor', status: 'active', clerkUserId: ids.orphan },
    ])
    await harness.db.insert(schema.clients).values({
      tenantId,
      email: MEMBER_EMAIL,
      name: 'Clerk Member',
      phone: '+6500000000',
      clerkUserId: ids.member,
    })
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.email, emails))
    await harness.db.delete(schema.clients).where(eq(schema.clients.email, MEMBER_EMAIL))
    await harness.db.delete(schema.staffAuthUsers).where(inArray(schema.staffAuthUsers.email, emails))
    await harness.db.delete(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, MEMBER_EMAIL))
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR_EMAIL))
    await harness.close()
  })

  const ours = (report: import('../services/auth/clerk-import').PoolReport) =>
    report.unmapped.filter(row => Object.values(ids).includes(row.clerkUserId))

  const signInWithPassword = (pool: 'staff' | 'platform', email: string, password: string) => {
    const origin = frontendOrigin(pool, pool === 'staff' ? harness.tenants.one : null)
    return harness.app.request(`/api/v1/auth/${pool}/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Forwarded-For': harnessAddress(),
        ...(pool === 'staff' ? { 'X-Tenant-Slug': harness.tenants.one.slug } : {}),
      },
      body: JSON.stringify({ email, password }),
    })
  }

  test('staff are imported with their Clerk password, mapped, and listed for 2FA re-enrolment', async () => {
    const report = await importer.importClerkPool(harness.db, 'staff', staffExport)

    assert.equal(report.exported, 2)
    assert.equal(report.inserted, 2)
    assert.equal(report.passwordsCopied, 1)
    assert.deepEqual(report.passwordsMissing, [NO_DIGEST_EMAIL], 'had a password in Clerk, but no digest came with the export')
    assert.deepEqual(report.totpReenrol, [STAFF_EMAIL])
    assert.equal(report.mapped, 2)
    assert.deepEqual(ours(report).map(row => row.clerkUserId), [ids.orphan], 'the row with no exported Clerk user is named')

    const rows = await harness.db
      .select({ clerkUserId: schema.staffUsers.clerkUserId, authUserId: schema.staffUsers.authUserId, email: schema.staffUsers.email })
      .from(schema.staffUsers)
      .where(inArray(schema.staffUsers.clerkUserId, [ids.staff, ids.noDigest]))
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, STAFF_EMAIL))
    assert.equal(rows.find(r => r.clerkUserId === ids.staff)!.authUserId, authUser!.id)
    assert.ok(rows.every(r => r.authUserId), 'every exported row is mapped')

    const signedIn = await signInWithPassword('staff', STAFF_EMAIL, PASSWORD)
    assert.equal(signedIn.status, 200, await signedIn.clone().text())
    assert.ok(signedIn.headers.get('set-auth-token'))

    const wrong = await signInWithPassword('staff', STAFF_EMAIL, 'not-the-password')
    assert.equal(wrong.status, 401)
  })

  test('members are imported by email and sign in by code as the same auth user', async () => {
    const report = await importer.importClerkPool(harness.db, 'client', memberExport)
    assert.equal(report.inserted, 1)
    assert.equal(report.mapped, 1)
    assert.deepEqual(ours(report), [])

    const [row] = await harness.db
      .select({ authUserId: schema.clients.authUserId })
      .from(schema.clients)
      .where(eq(schema.clients.clerkUserId, ids.member))
    assert.ok(row?.authUserId)

    const headers = await harness.signInAs('client', MEMBER_EMAIL, harness.tenants.one)
    const me = await harness.app.request('/api/v1/me', { headers })
    assert.equal(me.status, 200, await me.clone().text())

    const users = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, MEMBER_EMAIL))
    assert.deepEqual(users.map(u => u.id), [row.authUserId], 'the code signed in the imported user, not a new one')
  })

  test('platform operators are imported with their password; the pool has no rows to map', async () => {
    const report = await importer.importClerkPool(harness.db, 'platform', platformExport)
    assert.equal(report.inserted, 1)
    assert.equal(report.passwordsCopied, 1)
    assert.equal(report.mapped, 0)
    assert.deepEqual(report.unmapped, [])

    const signedIn = await signInWithPassword('platform', OPERATOR_EMAIL, PASSWORD)
    assert.equal(signedIn.status, 200, await signedIn.clone().text())
  })

  test('a second run inserts nothing, copies nothing, maps nothing, and says so', async () => {
    const pools = {
      client: await importer.importClerkPool(harness.db, 'client', memberExport),
      staff: await importer.importClerkPool(harness.db, 'staff', staffExport),
      platform: await importer.importClerkPool(harness.db, 'platform', platformExport),
    }
    for (const report of Object.values(pools)) {
      assert.equal(report.inserted, 0, report.pool)
      assert.equal(report.passwordsCopied, 0, report.pool)
      assert.equal(report.mapped, 0, report.pool)
      assert.equal(report.alreadyPresent, report.exported, report.pool)
    }
    assert.equal(importer.changedAnything({ appEnv: 'development', ranAt: '', pools }), false)
  })

  test("a password set since the swap is not overwritten by Clerk's old one", async () => {
    const changed = [{ ...staffExport[0]!, passwordDigest: await bcrypt.hash('an-older-password', 10) }]
    await importer.importClerkPool(harness.db, 'staff', changed)
    const stillWorks = await signInWithPassword('staff', STAFF_EMAIL, PASSWORD)
    assert.equal(stillWorks.status, 200)
  })
})
