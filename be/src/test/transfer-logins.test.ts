import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq, like, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * A studio archive never carries logins, and a restore makes fresh ones (#229).
 *
 * The secrets a login holds — a password hash, a 2FA secret, a session token, a
 * verification value — are written here with markers that could not appear by
 * accident, so "the archive holds none of them" is a search for the markers
 * rather than a list of columns that could fall out of date.
 *
 * The restore half is the case the shared login pools allow today: the studio's
 * logins are not on the platform it is restored onto. Its people then get logins
 * made from their emails, with no password, and the email-first sign-in step
 * mails each of them a Set-password link.
 */

let harness: TestApp
let schema: typeof import('../db/schema')
let transfer: typeof import('../services/tenants/transfer')
let discardedMail: typeof import('../lib/mailer').discardedMail

const run = Date.now().toString(36)
const DOMAIN = `logins-${run}.test`
const MARK = `secret-${run}`

before(async () => {
  if (!integrationTestsEnabled) return
  harness = await startTestApp()
  schema = await import('../db/schema')
  transfer = await import('../services/tenants/transfer')
  ;({ discardedMail } = await import('../lib/mailer'))
})

after(async () => {
  if (!harness) return
  await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
  await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
  await harness.close()
})

const options = { skip: integrationTestsEnabled ? false : SKIP_REASON }

async function emptyTenant(slug: string) {
  const [row] = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO tenants (slug, name, timezone, status)
    VALUES (${slug}, ${`Logins ${slug}`}, 'Asia/Singapore', 'active')
    RETURNING id
  `)
  return { id: row!.id, slug }
}

/**
 * A studio with one member and one staff member, each holding every secret a
 * login in their pool can hold.
 */
async function studioWithLogins(slug: string) {
  const tenant = await emptyTenant(slug)
  // Its own mail wording, which the archive carries: the restored studio mails
  // the Set-password link from it.
  const { seedEmailTemplates } = await import('../db/seed/email-templates')
  await seedEmailTemplates(harness.db, { ...tenant, name: `Logins ${slug}`, timezone: 'Asia/Singapore' })
  const memberEmail = `member-${slug}@${DOMAIN}`
  const staffEmail = `staff-${slug}@${DOMAIN}`
  const in1h = new Date(Date.now() + 3_600_000)
  // Session tokens are unique across the pool, so each studio marks its own.
  const mark = `${MARK}-${slug}`

  const memberLogin = randomUUID()
  await harness.db.insert(schema.clientAuthUsers).values({ id: memberLogin, email: memberEmail, name: 'Member', emailVerified: true })
  await harness.db.insert(schema.clientAuthAccounts).values({
    id: randomUUID(), accountId: memberLogin, providerId: 'credential', userId: memberLogin, password: `${mark}-member-hash`,
  })
  await harness.db.insert(schema.clientAuthSessions).values({
    id: randomUUID(), token: `${mark}-member-session`, expiresAt: in1h, userId: memberLogin, claimedTenantId: tenant.id,
  })
  await harness.db.insert(schema.clientAuthVerifications).values({
    id: randomUUID(), identifier: memberEmail, value: `${mark}-member-verification`, expiresAt: in1h,
  })

  const staffLogin = randomUUID()
  await harness.db.insert(schema.staffAuthUsers).values({ id: staffLogin, email: staffEmail, name: 'Staff', emailVerified: true, twoFactorEnabled: true })
  await harness.db.insert(schema.staffAuthAccounts).values({
    id: randomUUID(), accountId: staffLogin, providerId: 'credential', userId: staffLogin, password: `${mark}-staff-hash`,
  })
  await harness.db.insert(schema.staffAuthTwoFactors).values({
    id: randomUUID(), secret: `${mark}-staff-2fa`, backupCodes: `${mark}-staff-backup`, userId: staffLogin,
  })
  await harness.db.insert(schema.staffAuthSessions).values({
    id: randomUUID(), token: `${mark}-staff-session`, expiresAt: in1h, userId: staffLogin, claimedTenantId: tenant.id,
  })
  await harness.db.insert(schema.staffAuthVerifications).values({
    id: randomUUID(), identifier: staffEmail, value: `${mark}-staff-verification`, expiresAt: in1h,
  })

  await harness.db.insert(schema.clients).values({
    tenantId: tenant.id, authUserId: memberLogin, email: memberEmail, name: 'Member', phone: '+6580000011',
  })
  await harness.db.insert(schema.staffUsers).values({
    tenantId: tenant.id, authUserId: staffLogin, email: staffEmail, name: 'Staff', role: 'admin', status: 'active',
  })

  return { tenant, memberEmail, staffEmail, memberLogin, staffLogin }
}

const LOGIN_TABLE = /^(client|staff)_auth_/

test('SUP-04 an exported studio carries no logins: no password, 2FA secret, session or verification', options, async () => {
  const studio = await studioWithLogins(`export-${run}`)
  const archive = await transfer.exportTenant(studio.tenant.id)

  assert.deepEqual(archive.manifest.tables.filter(t => LOGIN_TABLE.test(t)), [])
  assert.deepEqual(Object.keys(archive.rows).filter(t => LOGIN_TABLE.test(t)), [])

  const written = JSON.stringify(archive)
  assert.ok(!written.includes(MARK), 'a login secret reached the archive')

  // The studio's people are in it — only their logins are not.
  assert.deepEqual(archive.rows.clients!.map(r => r.email), [studio.memberEmail])
  assert.deepEqual(archive.rows.staff_users!.map(r => r.email), [studio.staffEmail])
})

test('SUP-05 a restored studio gets fresh logins with no password, and the email step mails each person a link', options, async () => {
  const studio = await studioWithLogins(`restore-${run}`)
  const archive = await transfer.exportTenant(studio.tenant.id)

  // Restored onto a platform the old logins are not on.
  await harness.db.delete(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.id, studio.memberLogin))
  await harness.db.delete(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.id, studio.staffLogin))

  const target = await emptyTenant(`restored-${run}`)
  await transfer.importTenant(target.id, archive)

  const [member] = await harness.db
    .select({ authUserId: schema.clients.authUserId })
    .from(schema.clients)
    .where(eq(schema.clients.tenantId, target.id))
  const [staff] = await harness.db
    .select({ authUserId: schema.staffUsers.authUserId })
    .from(schema.staffUsers)
    .where(eq(schema.staffUsers.tenantId, target.id))

  assert.ok(member?.authUserId && member.authUserId !== studio.memberLogin, 'the member row names a new login')
  assert.ok(staff?.authUserId && staff.authUserId !== studio.staffLogin, 'the staff row names a new login')

  const [memberLogin] = await harness.db
    .select({ email: schema.clientAuthUsers.email })
    .from(schema.clientAuthUsers)
    .where(eq(schema.clientAuthUsers.id, member.authUserId))
  const [staffLogin] = await harness.db
    .select({ email: schema.staffAuthUsers.email })
    .from(schema.staffAuthUsers)
    .where(eq(schema.staffAuthUsers.id, staff.authUserId))
  assert.equal(memberLogin?.email, studio.memberEmail)
  assert.equal(staffLogin?.email, studio.staffEmail)

  const memberPasswords = await harness.db
    .select({ id: schema.clientAuthAccounts.id })
    .from(schema.clientAuthAccounts)
    .where(and(eq(schema.clientAuthAccounts.userId, member.authUserId), eq(schema.clientAuthAccounts.providerId, 'credential')))
  const staffPasswords = await harness.db
    .select({ id: schema.staffAuthAccounts.id })
    .from(schema.staffAuthAccounts)
    .where(and(eq(schema.staffAuthAccounts.userId, staff.authUserId), eq(schema.staffAuthAccounts.providerId, 'credential')))
  assert.deepEqual(memberPasswords, [], 'a restored member has no password')
  assert.deepEqual(staffPasswords, [], 'a restored staff member has no password')

  const step = async (path: string, pool: 'client' | 'staff', email: string) => {
    const res = await harness.app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Slug': target.slug,
        Origin: frontendOrigin(pool, target),
        'X-Forwarded-For': harnessAddress(),
      },
      body: JSON.stringify({ email }),
    })
    const body = await res.text()
    assert.equal(res.status, 200, body)
    return JSON.parse(body) as unknown
  }
  const linkMailedTo = (email: string) =>
    discardedMail.some(m => m.to === email && /\/reset-password\//.test(m.html))

  assert.deepEqual(await step('/api/v1/public/members/sign-in-step', 'client', studio.memberEmail), { next: 'link_sent' })
  assert.ok(linkMailedTo(studio.memberEmail), 'the member is mailed a Set-password link')

  assert.deepEqual(await step('/api/v1/public/staff/sign-in-step', 'staff', studio.staffEmail), { next: 'link_sent' })
  assert.ok(linkMailedTo(studio.staffEmail), 'the staff member is mailed a Set-password link')
})
