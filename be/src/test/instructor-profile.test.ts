import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

describe('instructor profile edit', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let headers!: Record<string, string>
  let adminHeaders!: Record<string, string>
  let instructorId!: string

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const DOMAIN = `instructor-profile-${run}.test`

  const request = async (path: string, method: string, as: Record<string, string>, body?: unknown) => {
    const res = await harness.app.request(path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...as },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    return { status: res.status, text, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
  }

  const profile = (method: 'GET' | 'PATCH', body?: unknown) =>
    request('/api/v1/portal/instructor/profile', method, headers, body)

  const editStaff = (body: unknown) =>
    request(`/api/v1/portal/admin/staff/${instructorId}`, 'PATCH', adminHeaders, body)

  const storedBio = async () => {
    const [row] = await harness.db
      .select({ bio: schema.staffUsers.bio })
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.id, instructorId))
    return row!.bio
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    const one = harness.tenants.one
    const email = `tara@${DOMAIN}`
    headers = await harness.signInAs('staff', email, one)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: one.id, email, name: `Tara ${run}`, role: 'instructor', status: 'active', authUserId: user!.id })
      .returning()
    await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: row!.id })
    instructorId = row!.id

    const adminEmail = `admin@${DOMAIN}`
    adminHeaders = await harness.signInAs('staff', adminEmail, one)
    const [adminUser] = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, adminEmail))
    await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: one.id, email: adminEmail, name: `Admin ${run}`, role: 'admin', status: 'active', authUserId: adminUser!.id })
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('STF-41 a bio past 2000 characters or a phone past 40 is refused with a sentence naming the field and its limit, and nothing changes', async () => {
    const saved = await profile('PATCH', { bio: 'Teaches Hatha.', phone: '+65 9123 4567' })
    assert.equal(saved.status, 200, saved.text)

    const refusals = [
      { body: { bio: 'x'.repeat(2001) }, says: [/bio/i, /2,?000/] },
      { body: { phone: '9'.repeat(41) }, says: [/phone/i, /40/] },
    ]
    for (const { body, says } of refusals) {
      const res = await profile('PATCH', body)
      assert.equal(res.status, 400, res.text)
      assert.equal(res.body.error, 'invalid_request', res.text)
      for (const pattern of says) assert.match(String(res.body.message), pattern, `says why: ${res.text}`)
    }
    const stored = await profile('GET')
    assert.deepEqual(
      { bio: stored.body.bio, phone: stored.body.phone },
      { bio: 'Teaches Hatha.', phone: '+65 9123 4567' },
      'a refused save changes nothing',
    )

    const longest = await profile('PATCH', { bio: 'y'.repeat(2000), phone: '9'.repeat(40) })
    assert.equal(longest.status, 200, longest.text)
    assert.equal(longest.body.bio, 'y'.repeat(2000))
  })

  test('STF-42 an Admin editing a staff bio or creating an Instructor is held to the same 2000-character bio as the Instructor, with the same sentence, and nothing is written', async () => {
    const before = await storedBio()

    const edited = await editStaff({ bio: 'z'.repeat(2001) })
    assert.equal(edited.status, 400, edited.text)
    assert.equal(edited.body.error, 'invalid_request', edited.text)
    assert.match(String(edited.body.message), /bio/i, edited.text)
    assert.match(String(edited.body.message), /2,?000/, edited.text)
    assert.equal(await storedBio(), before, 'a refused staff edit changes nothing')

    const email = `created@${DOMAIN}`
    const created = await request('/api/v1/portal/admin/instructors', 'POST', adminHeaders, {
      email,
      name: 'Created Instructor',
      bio: 'z'.repeat(2001),
    })
    assert.equal(created.status, 400, created.text)
    assert.equal(created.body.error, 'invalid_request', created.text)
    assert.match(String(created.body.message), /bio/i, created.text)
    assert.match(String(created.body.message), /2,?000/, created.text)
    const rows = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.email, email))
    assert.deepEqual(rows, [], 'a refused create writes no staff member')

    const longest = await editStaff({ bio: 'z'.repeat(2000) })
    assert.equal(longest.status, 200, longest.text)
    assert.equal(await storedBio(), 'z'.repeat(2000))
  })

  test('STF-43 a bio already stored past 2000 characters does not stop the Instructor or an Admin saving the rest of the profile, but cannot be replaced by another one past 2000', async () => {
    const legacy = 'w'.repeat(3000)
    await harness.db.update(schema.staffUsers).set({ bio: legacy }).where(eq(schema.staffUsers.id, instructorId))

    const own = await profile('PATCH', { bio: legacy, phone: '+65 8111 2222' })
    assert.equal(own.status, 200, own.text)
    assert.equal(own.body.phone, '+65 8111 2222')
    assert.equal(own.body.bio, legacy)

    const byAdmin = await editStaff({ bio: legacy, address: '1 Studio Lane' })
    assert.equal(byAdmin.status, 200, byAdmin.text)
    assert.equal(byAdmin.body.address, '1 Studio Lane')

    for (const res of [await profile('PATCH', { bio: 'v'.repeat(3000) }), await editStaff({ bio: 'v'.repeat(3000) })]) {
      assert.equal(res.status, 400, res.text)
      assert.match(String(res.body.message), /2,?000/, res.text)
    }
    assert.equal(await storedBio(), legacy, 'a refused change keeps the stored bio')
  })

  test('STF-44 an Admin staff edit past a field limit, an invitation or an email change to an address that is not one, is refused 400 invalid_request with a sentence naming the field, and nothing is written', async () => {
    const [before] = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, instructorId))
    const edits = [
      { body: { first_name: 'f'.repeat(121) }, says: /first name.*120/i },
      { body: { first_name: '   ' }, says: /first name/i },
      { body: { last_name: 'l'.repeat(121) }, says: /last name.*120/i },
      { body: { phone: '9'.repeat(41) }, says: /phone.*40/i },
      { body: { address: 'a'.repeat(501) }, says: /address.*500/i },
      { body: { languages: ['English', 'g'.repeat(61)] }, says: /language.*60/i },
      { body: { annual_leave_days: 366 }, says: /assigned days/i },
    ]
    for (const { body, says } of edits) {
      const res = await editStaff(body)
      assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 60)}: ${res.text}`)
      assert.equal(res.body.error, 'invalid_request', res.text)
      assert.match(String(res.body.message), says, res.text)
    }
    const [after] = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, instructorId))
    assert.deepEqual(after, before, 'a refused staff edit changes nothing')

    for (const email of ['owner@gmail', 'not an email']) {
      const invite = await request('/api/v1/portal/admin/staff/invite', 'POST', adminHeaders, { email, role: 'instructor' })
      assert.equal(invite.status, 400, `${email}: ${invite.text}`)
      assert.equal(invite.body.error, 'invalid_request', invite.text)
      assert.match(String(invite.body.message), /email address/i, invite.text)

      const change = await request(`/api/v1/portal/admin/staff/${instructorId}/email`, 'POST', adminHeaders, { email })
      assert.equal(change.status, 400, `${email}: ${change.text}`)
      assert.equal(change.body.error, 'invalid_request', change.text)
      assert.match(String(change.body.message), /email address/i, change.text)
    }
    const [unchanged] = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, instructorId))
    assert.equal(unchanged!.email, before!.email, 'a refused email change leaves the address')
  })

  test('STF-45 an Admin staff edit or invitation with a gender, role, permission or languages that is not one of the choices is refused 400 invalid_request with a sentence naming the field, and nothing is written', async () => {
    const [before] = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, instructorId))
    const edits = [
      { body: { gender: 'robot' }, says: /gender/i },
      { body: { role: 'owner' }, says: /role.*admin or instructor/i },
      { body: { permissions: ['fly'] }, says: /permission/i },
      { body: { permissions: 'all' }, says: /permission/i },
      { body: { languages: 'English' }, says: /languages.*list/i },
    ]
    for (const { body, says } of edits) {
      const res = await editStaff(body)
      assert.equal(res.status, 400, `${JSON.stringify(body)}: ${res.text}`)
      assert.equal(res.body.error, 'invalid_request', res.text)
      assert.match(String(res.body.message), says, res.text)
    }
    const [after] = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, instructorId))
    assert.deepEqual(after, before, 'a refused staff edit changes nothing')

    const invite = await request('/api/v1/portal/admin/staff/invite', 'POST', adminHeaders, {
      email: `stf45-${Date.now()}@example.com`,
      role: 'owner',
    })
    assert.equal(invite.status, 400, invite.text)
    assert.equal(invite.body.error, 'invalid_request', invite.text)
    assert.match(String(invite.body.message), /role.*admin or instructor/i, invite.text)
  })
})
