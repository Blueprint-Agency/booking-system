import assert from 'node:assert/strict'
import { after, afterEach, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import {
  frontendOrigin,
  HARNESS_PASSWORD,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * An admin changes a staff member's sign-in email — another's, or their own —
 * and the new address has to prove it receives mail before anything moves.
 *
 * Over the real sign-in, because the claim is about the door: after the change
 * the person gets in at the new address with the password they already had, and
 * the old address opens nothing. Each test runs in a studio of its own.
 */
describe('staff email change', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let discardedMail!: typeof import('../lib/mailer').discardedMail

  const run = Date.now().toString(36)
  let studios = 0

  type Studio = { id: string; slug: string }
  type StaffFixture = { headers: Record<string, string>; id: string; authUserId: string; email: string }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ;({ discardedMail } = await import('../lib/mailer'))
  })

  afterEach(() => harness.clock.reset())

  after(async () => {
    await harness?.close()
  })

  const send = (path: string, init: { body?: unknown; headers: Record<string, string>; method?: string }) =>
    harness.app.request(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })

  const expectStatus = async (res: Response, status: number, error?: string) => {
    const body = await res.text()
    assert.equal(res.status, status, body)
    const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {}
    if (error) assert.equal(parsed.error, error, body)
    return parsed
  }

  const freshStudio = async (): Promise<Studio> => {
    const slug = `staff-email-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Staff Email Studio', adminEmail: `owner@${slug}.test` })
    return { id: tenant.id, slug }
  }

  const staffAt = async (studio: Studio, name: string, role: 'admin' | 'instructor'): Promise<StaffFixture> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, studio.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    return { headers, id: row!.id, authUserId: user!.id, email }
  }

  /** A password sign-in on the studio's portal, as the login form sends it. */
  const signInStatus = async (studio: Studio, email: string) => {
    const res = await harness.app.request('/api/v1/auth/staff/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: frontendOrigin('staff', studio),
        'X-Tenant-Slug': studio.slug,
        'X-Forwarded-For': harnessAddress(),
      },
      body: JSON.stringify({ email, password: HARNESS_PASSWORD }),
    })
    return res.status
  }

  const emailPath = (id: string) => `/api/v1/portal/admin/staff/${id}/email`

  /** The last message the null transport dropped for this address. */
  const lastMailTo = (email: string) => [...discardedMail].reverse().find(m => m.to === email)
  const codeMailedTo = (email: string) => {
    const code = lastMailTo(email)?.html.match(/>(\d{6})</)?.[1]
    assert.ok(code, `no code was mailed to ${email}`)
    return code
  }
  /** A six-digit code that is not `code`. */
  const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

  const staffRow = async (id: string) => {
    const [row] = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, id))
    return row!
  }

  test('STF-24 an admin moves an instructor to a new address only once its code is entered, and the password comes along', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const newEmail = `teacher-new@${studio.slug}.test`

    const started = await expectStatus(
      await send(emailPath(instructor.id), { body: { email: `Teacher-New@${studio.slug}.test` }, headers: admin.headers }),
      200,
    )
    assert.equal(started.pending_email, newEmail)
    const code = codeMailedTo(newEmail)

    // A set-password link already mailed to the old address, as Better Auth stores one.
    const oldResetLink = `reset-password:${run}-${instructor.id}`
    await harness.db.insert(schema.staffAuthVerifications).values({
      id: crypto.randomUUID(),
      tenantId: studio.id,
      identifier: oldResetLink,
      value: instructor.authUserId,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    })

    // Nothing has moved yet: the old address still signs in, the new one does not.
    assert.equal((await staffRow(instructor.id)).email, instructor.email)
    assert.equal(await signInStatus(studio, instructor.email), 200)
    assert.notEqual(await signInStatus(studio, newEmail), 200)

    const wrong = await expectStatus(
      await send(`${emailPath(instructor.id)}/confirm`, { body: { code: wrongCode(code) }, headers: admin.headers }),
      400,
      'email_change_code_invalid',
    )
    assert.match(String(wrong.message), /4 tries left/)

    const confirmed = await expectStatus(
      await send(`${emailPath(instructor.id)}/confirm`, { body: { code }, headers: admin.headers }),
      200,
    )
    assert.equal(confirmed.email, newEmail)
    assert.equal(confirmed.role, 'instructor')

    const [login] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.id, instructor.authUserId))
    assert.equal(login!.email, newEmail, 'the same login is re-addressed, not replaced')
    const leftover = await harness.db
      .select()
      .from(schema.staffAuthVerifications)
      .where(eq(schema.staffAuthVerifications.identifier, oldResetLink))
    assert.equal(leftover.length, 0, 'a link mailed to the old address no longer opens the account')

    assert.equal(await signInStatus(studio, newEmail), 200, 'the new address signs in with the old password')
    assert.notEqual(await signInStatus(studio, instructor.email), 200, 'the old address signs in no one')
    await expectStatus(await send('/api/v1/portal/instructor/profile', { headers: instructor.headers }), 200)

    const notice = lastMailTo(instructor.email)
    assert.ok(notice, 'the old address is told')
    assert.match(notice.html, new RegExp(newEmail.replace(/[.]/g, '\\.')))

    // Used once: the same code cannot confirm again.
    await expectStatus(
      await send(`${emailPath(instructor.id)}/confirm`, { body: { code }, headers: admin.headers }),
      400,
      'email_change_not_requested',
    )
  })

  test('STF-24 an admin changes their own email and stays signed in', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const newEmail = `admin-new@${studio.slug}.test`

    await expectStatus(await send(emailPath(admin.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    await expectStatus(
      await send(`${emailPath(admin.id)}/confirm`, { body: { code: codeMailedTo(newEmail) }, headers: admin.headers }),
      200,
    )

    assert.equal((await staffRow(admin.id)).email, newEmail)
    await expectStatus(await send('/api/v1/portal/admin/staff', { headers: admin.headers }), 200)
    assert.equal(await signInStatus(studio, newEmail), 200)
  })

  test('STF-24 an admin changes another admin\'s email', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const peer = await staffAt(studio, 'peer', 'admin')
    const newEmail = `peer-new@${studio.slug}.test`

    await expectStatus(await send(emailPath(peer.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    await expectStatus(
      await send(`${emailPath(peer.id)}/confirm`, { body: { code: codeMailedTo(newEmail) }, headers: admin.headers }),
      200,
    )
    assert.equal((await staffRow(peer.id)).email, newEmail)
  })

  test('STF-24 an invitee\'s pending invitation moves to the new address with a new link', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const typo = `teacher@${studio.slug}.tset`
    const invited = await expectStatus(
      await send('/api/v1/portal/admin/staff/invite', { body: { email: typo, role: 'admin' }, headers: admin.headers }),
      201,
    )
    const [before] = await harness.db
      .select()
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.id, String(invited.id)))
    const newEmail = `teacher@${studio.slug}.test`

    await expectStatus(await send(emailPath(before!.staffUserId!), { body: { email: newEmail }, headers: admin.headers }), 200)
    await expectStatus(
      await send(`${emailPath(before!.staffUserId!)}/confirm`, { body: { code: codeMailedTo(newEmail) }, headers: admin.headers }),
      200,
    )

    const [after] = await harness.db
      .select()
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.id, before!.id))
    assert.equal(after!.email, newEmail)
    assert.equal(after!.status, 'pending')
    assert.notEqual(after!.token, before!.token, 'the link mailed to the mistyped address is dead')
  })

  test('STF-25 guesses sent at once still stop at five', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const newEmail = `teacher-new@${studio.slug}.test`

    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    const code = codeMailedTo(newEmail)
    const guesses = await Promise.all(
      Array.from({ length: 10 }, () =>
        send(`${emailPath(instructor.id)}/confirm`, { body: { code: wrongCode(code) }, headers: admin.headers }),
      ),
    )
    const errors = await Promise.all(guesses.map(async r => ((await r.json()) as { error: string }).error))
    assert.equal(errors.filter(e => e === 'email_change_code_invalid').length, 4, errors.join(', '))
    await expectStatus(
      await send(`${emailPath(instructor.id)}/confirm`, { body: { code }, headers: admin.headers }),
      400,
      'email_change_not_requested',
    )
  })

  test('STF-25 closing the dialog withdraws the code, and does not reset the wait for another', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const newEmail = `teacher-new@${studio.slug}.test`

    harness.clock.set(new Date())
    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    const code = codeMailedTo(newEmail)
    await expectStatus(await send(emailPath(instructor.id), { method: 'DELETE', headers: admin.headers }), 204)

    await expectStatus(
      await send(`${emailPath(instructor.id)}/confirm`, { body: { code }, headers: admin.headers }),
      400,
      'email_change_not_requested',
    )
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }),
      429,
      'too_many_requests',
    )
  })

  test('STF-25 five wrong codes, or ten minutes, and the change has to start again', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const newEmail = `teacher-new@${studio.slug}.test`

    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    const code = codeMailedTo(newEmail)
    for (let i = 0; i < 4; i++) {
      await expectStatus(
        await send(`${emailPath(instructor.id)}/confirm`, { body: { code: wrongCode(code) }, headers: admin.headers }),
        400,
        'email_change_code_invalid',
      )
    }
    await expectStatus(
      await send(`${emailPath(instructor.id)}/confirm`, { body: { code: wrongCode(code) }, headers: admin.headers }),
      400,
      'email_change_code_expired',
    )
    // The right code is no good now either.
    await expectStatus(
      await send(`${emailPath(instructor.id)}/confirm`, { body: { code }, headers: admin.headers }),
      400,
      'email_change_not_requested',
    )
    assert.equal((await staffRow(instructor.id)).email, instructor.email)

    // A second code inside 30 seconds is refused; after them, it is sent.
    harness.clock.set(new Date())
    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }),
      429,
      'too_many_requests',
    )
    harness.clock.advance(31_000)
    await expectStatus(await send(emailPath(instructor.id), { body: { email: newEmail }, headers: admin.headers }), 200)
    const fresh = codeMailedTo(newEmail)

    harness.clock.advance(10 * 60_000 + 1_000)
    await expectStatus(
      await send(`${emailPath(instructor.id)}/confirm`, { body: { code: fresh }, headers: admin.headers }),
      400,
      'email_change_code_expired',
    )
    assert.equal((await staffRow(instructor.id)).email, instructor.email)
  })

  test('STF-26 an address in use, the same address, a placeholder, or a blocked staff member is refused', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    const other = await staffAt(studio, 'other', 'instructor')
    const mailed = discardedMail.length

    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: other.email.toUpperCase() }, headers: admin.headers }),
      409,
      'email_in_use',
    )
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: instructor.email }, headers: admin.headers }),
      400,
      'email_unchanged',
    )
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: `teacher@${studio.slug}.invalid` }, headers: admin.headers }),
      400,
      'email_placeholder_not_allowed',
    )
    await expectStatus(await send(`/api/v1/portal/admin/staff/${instructor.id}/archive`, { body: {}, headers: admin.headers }), 200)
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: `teacher-new@${studio.slug}.test` }, headers: admin.headers }),
      409,
      'staff_archived',
    )
    assert.equal(discardedMail.length, mailed, 'no refusal mails anything')
  })

  test('STF-26 an instructor cannot change anyone\'s email', async () => {
    const studio = await freshStudio()
    await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'teacher', 'instructor')
    await expectStatus(
      await send(emailPath(instructor.id), { body: { email: `teacher-new@${studio.slug}.test` }, headers: instructor.headers }),
      403,
    )
  })
})
