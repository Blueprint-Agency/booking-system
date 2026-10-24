import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

describe('instructor profile edit', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let headers!: Record<string, string>

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const DOMAIN = `instructor-profile-${run}.test`

  const profile = async (method: 'GET' | 'PATCH', body?: unknown) => {
    const res = await harness.app.request('/api/v1/portal/instructor/profile', {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    return { status: res.status, text, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
  }

  before(async () => {
    harness = await startTestApp()
    const schema = await import('../db/schema')
    const one = harness.tenants.one
    const email = `tara@${DOMAIN}`
    headers = await harness.signInAs('staff', email, one)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: one.id, email, name: `Tara ${run}`, role: 'instructor', status: 'active', authUserId: user!.id })
      .returning()
    await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: row!.id })
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
})
