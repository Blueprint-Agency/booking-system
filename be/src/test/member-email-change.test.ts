import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  inTenantContext,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * An admin changes a member's email (#176), over the real sign-in.
 *
 * The claim this suite exists to hold is one no unit test can make: after the
 * change the member signs in at the NEW address and finds everything they had,
 * and the old address reaches no member of this studio. That takes two rows
 * moving together — the `clients` row's email and the `client` pool account it
 * links to — and a real code emailed to each address to prove which one now
 * opens the door.
 */

describe('member email change', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let changeEmailSvc!: typeof import('../services/clients/change-email')
  let purchaseSvc!: typeof import('../services/packages/purchase')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')

  let tenantId!: string
  let staffId!: string
  let bundleCatalogId!: string

  const run = Date.now().toString(36)
  const DOMAIN = `email-change-${run}.test`
  const NAME_PREFIX = `email-change-${run}`
  const at = (name: string) => `${name}@${DOMAIN}`
  const clientIds: string[] = []

  const memberHeaders = (tenant: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('client', tenant),
    'X-Forwarded-For': harnessAddress(),
  })

  const send = (path: string, init: { body?: unknown; headers: Record<string, string> }) =>
    harness.app.request(path, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })

  const PASSWORD = 'member-password-1'

  /** The code a sign-up asks for, read back off the null mail transport. */
  const requestCode = async (email: string) => {
    const asked = await send('/api/v1/auth/client/email-otp/send-verification-otp', {
      body: { email, type: 'sign-in' },
      headers: memberHeaders(harness.tenants.one),
    })
    assert.equal(asked.status, 200, await asked.text())
    const otp = [...discardedMail].reverse().find(m => m.to === email)?.html.match(/>(\d{6})</)?.[1]
    assert.ok(otp, `no code was mailed to ${email}`)
    return otp
  }

  const bearer = (token: string) => ({
    ...memberHeaders(harness.tenants.one),
    Authorization: `Bearer ${token}`,
  })

  /** Sign in with the password (#173) and return the headers the app would send. */
  const signIn = async (email: string, password = PASSWORD) => {
    const res = await send('/api/v1/auth/client/sign-in/email', {
      body: { email, password },
      headers: memberHeaders(harness.tenants.one),
    })
    const token = res.headers.get('set-auth-token')
    assert.equal(res.status, 200, await res.text())
    assert.ok(token)
    return bearer(token)
  }

  /**
   * A member who joined this studio the way members do — account, row and
   * password written by the sign-up itself, so the change under test moves a
   * real sign-in rather than a fixture.
   */
  async function newMember(name: string): Promise<{ id: string; email: string }> {
    const email = at(name)
    const res = await send('/api/v1/public/members/register', {
      body: {
        email,
        otp: await requestCode(email),
        first_name: 'Ada',
        last_name: name,
        phone: '+6591234567',
        password: PASSWORD,
      },
      headers: memberHeaders(harness.tenants.one),
    })
    assert.equal(res.status, 200, await res.text())
    const [row] = await harness.db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, tenantId), eq(schema.clients.email, email)))
    assert.ok(row)
    clientIds.push(row.id)
    return { id: row.id, email }
  }

  /**
   * Set a password at an address whose account has none — the path a member
   * moved onto a fresh address takes, through the link their first sign-in
   * attempt mails them.
   */
  const setPasswordAt = async (email: string) => {
    const step = await send('/api/v1/public/members/sign-in-step', {
      body: { email },
      headers: memberHeaders(harness.tenants.one),
    })
    const stepBody = await step.text()
    assert.equal(step.status, 200, stepBody)
    assert.deepEqual(
      JSON.parse(stepBody),
      { next: 'link_sent' },
      'the new address has no password yet',
    )
    const link = new URL(
      [...discardedMail]
        .reverse()
        .find(m => m.to === email)!
        .html.match(/href="([^"]*\/reset-password\/[^"]+)"/)![1]!
        .replace(/&amp;/g, '&'),
    )
    const opened = await harness.app.request(link.pathname + link.search)
    const token = new URL(opened.headers.get('location')!).searchParams.get('token')
    const set = await send('/api/v1/public/members/set-password', {
      body: { token, password: PASSWORD },
      headers: memberHeaders(harness.tenants.one),
    })
    const body = await set.text()
    assert.equal(set.status, 200, body)
    return bearer((JSON.parse(body) as { token: string }).token)
  }

  before(async () => {
    harness = await startTestApp()
    tenantId = harness.tenants.one.id
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    changeEmailSvc = inTenantContext(await import('../services/clients/change-email'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))

    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId,
        email: at('admin'),
        name: 'Email Change Admin',
        role: 'admin',
        status: 'active',
        authUserId: `auth_${NAME_PREFIX}_admin`,
      })
      .returning()
    staffId = staff!.id

    bundleCatalogId = (
      await classPackagesSvc.createClassPackage(tenantId, {
        name: `${NAME_PREFIX} Bundle`,
        kind: 'credit_bundle',
        credits: 3,
        validityDays: 30,
        priceSgd: '150.00',
      })
    ).id
  })

  after(async () => {
    if (!harness) return
    if (clientIds.length > 0) {
      const clients = sql.join(clientIds.map(id => sql`${id}::uuid`), sql`, `)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE id IN (${clients})`)
    }
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id = ${staffId}::uuid`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${NAME_PREFIX + ' %'}`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}::uuid`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${'%@' + DOMAIN}`)
    await harness.close()
  })

  test('the member signs in at the new address and keeps everything, and the old one reaches nobody', async () => {
    const member = await newMember('mover')
    const { clientPackageId } = await purchaseSvc.grantPackage(tenantId, {
      clientId: member.id,
      purchaseId: null,
      amountSgd: '150.00',
      packageKind: 'class',
      packageId: bundleCatalogId,
    })

    // Signed in at the old address before the change, so there is a live
    // session for the change to end.
    const before = await signIn(member.email)
    assert.equal((await send('/api/v1/me', { headers: before })).status, 200)

    const moved = at('mover-new')
    const updated = await changeEmailSvc.changeClientEmail({
      tenantId,
      clientId: member.id,
      email: ` ${moved.toUpperCase()} `,
      actorStaffId: staffId,
    })
    assert.equal(updated.email, moved, 'trimmed and lower-cased')

    assert.equal(
      (await send('/api/v1/me', { headers: before })).status,
      401,
      'the session the old address held is gone',
    )

    // The new address is a fresh account, so it has no password of its own yet:
    // the member sets one through the link their first attempt mails them, and
    // is signed in at the end of it — exactly what an added member does (#173).
    const now = await setPasswordAt(moved)
    const profile = await send('/api/v1/me', { headers: now })
    assert.equal(profile.status, 200)
    assert.equal(((await profile.json()) as { email: string }).email, moved)

    const wallet = (await (
      await send('/api/v1/me/packages', { headers: now })
    ).json()) as { client_packages: { id: string }[] }
    assert.ok(
      wallet.client_packages.some(p => p.id === clientPackageId),
      'every package came with them',
    )

    // The old address still has an account — it may be this person at another
    // studio — but it is nobody's membership here any more.
    const orphan = await signIn(member.email)
    assert.equal(
      (await send('/api/v1/me', { headers: orphan })).status,
      404,
      'the old email reaches no member of this studio',
    )
  })

  test('an address another member of this studio uses is refused', async () => {
    const one = await newMember('taken-one')
    const two = await newMember('taken-two')

    await assert.rejects(
      () =>
        changeEmailSvc.changeClientEmail({
          tenantId,
          clientId: one.id,
          email: two.email.toUpperCase(),
          actorStaffId: staffId,
        }),
      (err: { code?: string }) => err.code === 'email_in_use',
      'two members of one studio never share a sign-in',
    )

    await assert.rejects(
      () =>
        changeEmailSvc.changeClientEmail({
          tenantId,
          clientId: one.id,
          email: one.email,
          actorStaffId: staffId,
        }),
      (err: { code?: string }) => err.code === 'email_unchanged',
      'a change to the address they already have is not a change',
    )
  })

  test('the change is audited with the old and the new address', async () => {
    const member = await newMember('audited')
    const moved = at('audited-new')
    await changeEmailSvc.changeClientEmail({
      tenantId,
      clientId: member.id,
      email: moved,
      actorStaffId: staffId,
    })

    const [entry] = await harness.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.targetId, member.id),
          eq(schema.auditLog.action, 'client_email_changed'),
        ),
      )
    assert.ok(entry)
    assert.equal(entry.actorStaffId, staffId)
    assert.deepEqual(entry.payload, { from: member.email, to: moved })
  })

  test("another studio cannot change this studio's member", async () => {
    const member = await newMember('across')
    await assert.rejects(
      () =>
        changeEmailSvc.changeClientEmail({
          tenantId: harness.tenants.two.id,
          clientId: member.id,
          email: at('across-new'),
          actorStaffId: staffId,
        }),
      (err: { code?: string }) => err.code === 'client_not_found',
    )
  })
})
