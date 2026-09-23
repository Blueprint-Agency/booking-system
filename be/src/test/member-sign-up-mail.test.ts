import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  HARNESS_PASSWORD,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.sign-up-mail.test`

/**
 * The member sign-up and sign-in rows no other file owns (#226), and the mail
 * they send, read back from the test mail capture and the send log.
 *
 * Written from the AUTH and NTF rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`).
 */
describe('member sign-up and its mail over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const at = (name: string) => `${name}@${DOMAIN}`
  const MEMBER_PASSWORD = 'member-password-1'

  const memberApp = (tenant: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('client', tenant),
    'X-Forwarded-For': harnessAddress(),
  })
  const portalApp = (tenant: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('staff', tenant),
    'X-Forwarded-For': harnessAddress(),
  })

  async function post(path: string, headers: Record<string, string>, body: unknown) {
    const res = await harness.app.request(path, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, text, token: res.headers.get('set-auth-token') }
  }

  const mailTo = (email: string) => discardedMail.filter(m => m.to === email)

  const logRows = (email: string) =>
    harness.db.select().from(schema.emailLog).where(eq(schema.emailLog.recipientEmail, email)).orderBy(schema.emailLog.queuedAt)

  /** Ask for a sign-up code on `tenant`'s member app; the code comes back from the mail capture. */
  async function requestCode(tenant: { slug: string }, email: string): Promise<string> {
    const res = await post('/api/v1/auth/client/email-otp/send-verification-otp', memberApp(tenant), { email, type: 'sign-in' })
    assert.equal(res.status, 200, res.text)
    const otp = mailTo(email).at(-1)?.html.match(/>(\d{6})</)?.[1]
    assert.ok(otp, `no code was mailed to ${email}`)
    return otp
  }

  const register = (tenant: { slug: string }, email: string, otp: string) =>
    post('/api/v1/public/members/register', memberApp(tenant), {
      email,
      otp,
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '+6591234567',
      password: MEMBER_PASSWORD,
    })

  const clientRow = async (tenantId: string, email: string) =>
    (await harness.db.select().from(schema.clients).where(and(eq(schema.clients.tenantId, tenantId), eq(schema.clients.email, email))))[0] ?? null
  const clientAuthUser = async (email: string) =>
    (await harness.db.select().from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email)))[0] ?? null
  const staffAuthUser = async (email: string) =>
    (await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email)))[0] ?? null

  /** A member of `tenant` with a password, as a finished sign-up leaves them. */
  async function memberOf(tenant: { id: string; slug: string }, email: string) {
    const headers = await harness.signInAs('client', email, tenant)
    const user = await clientAuthUser(email)
    await harness.db.insert(schema.clients).values({ tenantId: tenant.id, email, name: 'Grace Hopper', phone: '+6580000000', authUserId: user!.id })
    return headers
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    ;({ one, two } = harness.tenants)
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM auth_events WHERE actor_user_id IN (SELECT id FROM client_auth_users WHERE email LIKE ${ours}) OR actor_user_id IN (SELECT id FROM staff_auth_users WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('AUTH-02, NTF-01 a visitor who asked for a code is mailed it at that studio, and until it is entered no account or member record exists', async () => {
    const email = at('pending')
    const logged = (await logRows(email)).length
    const otp = await requestCode(one, email)

    const [mail] = mailTo(email)
    assert.equal(mailTo(email).length, 1, 'one code email')
    assert.match(mail!.html, new RegExp(`>${otp}<`))
    const [row] = (await logRows(email)).slice(logged)
    assert.equal(row?.templateSlug, 'sign_in_code')
    assert.equal(row?.tenantId, one.id, 'sent as the studio the visitor is signing up at')

    assert.equal(await clientAuthUser(email), null, 'no account before the code is proved')
    assert.equal(await clientRow(one.id, email), null, 'no member record before the code is proved')
    assert.equal(await clientRow(two.id, email), null)

    // And the code, once entered, is what creates them.
    const done = await register(one, email, otp)
    assert.equal(done.status, 200, done.text)
    assert.ok(await clientRow(one.id, email))
  })

  test('AUTH-15 one email as a member and as staff: two identities, two sessions, and neither signs in to the other app', async () => {
    const email = at('both')
    const registered = await register(one, email, await requestCode(one, email))
    assert.equal(registered.status, 200, registered.text)
    const memberBearer = { ...memberApp(one), Authorization: `Bearer ${registered.body.token}` }

    // The same address as an admin of the same studio, with the harness's own password.
    const staffBearer = await harness.signInAs('staff', email, one)
    const staffUser = await staffAuthUser(email)
    await harness.db.insert(schema.staffUsers).values({ tenantId: one.id, email, name: 'Both', role: 'admin', status: 'active', authUserId: staffUser!.id })

    const memberUser = await clientAuthUser(email)
    assert.ok(memberUser && staffUser)
    assert.notEqual(memberUser.id, staffUser.id, 'two separate identities')

    // Each session works in its own app…
    assert.equal((await harness.app.request('/api/v1/me', { headers: memberBearer })).status, 200)
    assert.equal((await harness.app.request('/api/v1/portal/admin/clients', { headers: staffBearer })).status, 200)

    // …and in neither of the other.
    const memberOnPortal = await harness.app.request('/api/v1/portal/admin/clients', { headers: { ...memberBearer, ...portalApp(one), Authorization: memberBearer.Authorization! } })
    assert.ok([401, 403].includes(memberOnPortal.status), `a member session opened the portal (${memberOnPortal.status})`)
    const staffOnMe = await harness.app.request('/api/v1/me', { headers: { ...staffBearer, ...memberApp(one), Authorization: staffBearer.Authorization! } })
    assert.ok([401, 403].includes(staffOnMe.status), `a staff session opened the member app (${staffOnMe.status})`)

    // One identity's password does not sign in the other.
    const memberPasswordAtPortal = await post('/api/v1/auth/staff/sign-in/email', portalApp(one), { email, password: MEMBER_PASSWORD })
    assert.equal(memberPasswordAtPortal.status, 401, memberPasswordAtPortal.text)
    assert.equal(memberPasswordAtPortal.token, null)
    const staffPasswordAtMemberApp = await post('/api/v1/auth/client/sign-in/email', memberApp(one), { email, password: HARNESS_PASSWORD })
    assert.equal(staffPasswordAtMemberApp.status, 401, staffPasswordAtMemberApp.text)
    assert.equal(staffPasswordAtMemberApp.token, null)
  })

  test('NTF-02, NTF-22 "forgot password" mails the member the studio\'s own password_reset template, logged under that studio', async () => {
    const [template] = await harness.db
      .select()
      .from(schema.emailTemplates)
      .where(and(eq(schema.emailTemplates.tenantId, one.id), eq(schema.emailTemplates.slug, 'password_reset')))
    assert.ok(template, 'the studio has a password_reset template')
    const studioSubject = `Your reset link ${run}`
    await harness.db.update(schema.emailTemplates).set({ subject: studioSubject }).where(eq(schema.emailTemplates.id, template.id))
    try {
      const email = at('forgot')
      await memberOf(one, email)
      const res = await post('/api/v1/public/members/password-link', memberApp(one), { email })
      assert.equal(res.status, 200, res.text)
      assert.deepEqual(res.body, { next: 'link_sent' })

      const mail = mailTo(email)
      assert.equal(mail.length, 1, 'one email')
      assert.equal(mail[0]!.subject, studioSubject, 'the studio\'s own saved subject')
      assert.match(mail[0]!.html, /set-password/)

      const [row] = await logRows(email)
      assert.equal(row?.tenantId, one.id)
      assert.equal(row?.templateSlug, 'password_reset')
      assert.equal(row?.recipientUserKind, 'client')
      assert.equal(row?.subjectRendered, studioSubject)
      assert.equal(row?.status, 'sent')
      assert.ok(row?.queuedAt && row.sentAt, 'the send is timed')

      // The other studio's member gets that studio's template, not this one's.
      const elsewhere = at('forgot-elsewhere')
      await memberOf(two, elsewhere)
      assert.equal((await post('/api/v1/public/members/password-link', memberApp(two), { email: elsewhere })).status, 200)
      const [theirs] = mailTo(elsewhere)
      assert.ok(theirs)
      assert.notEqual(theirs.subject, studioSubject)
      const [theirRow] = await logRows(elsewhere)
      assert.equal(theirRow?.tenantId, two.id)
    } finally {
      await harness.db.update(schema.emailTemplates).set({ subject: template.subject }).where(eq(schema.emailTemplates.id, template.id))
    }
  })
})
