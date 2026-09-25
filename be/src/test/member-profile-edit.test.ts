import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures, type Staff, type Tenant } from './member-fixtures'

/**
 * A Member's profile (#281): an admin edits name, gender and phone from the
 * customer page, and a Member sets their own gender.
 *
 * Over the real routes, like the email change (#176) beside it: the admin edit
 * is refused to an instructor by the role gate, to another studio's admin by
 * the Tenant scope, and for a blocked Member by the service — three different
 * layers, each of which only an HTTP request passes through.
 */
describe('member profile edit', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fixtures!: ReturnType<typeof memberFixtures>
  let one!: Tenant
  let two!: Tenant
  let adminOne!: Staff
  let adminTwo!: Staff
  let instructorOne!: Staff

  const run = Date.now().toString(36)
  const DOMAIN = `profile-edit-${run}.test`

  type Profile = { id: string; name: string; phone: string; gender: string | null; email: string }

  const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
    const res = await harness.app.request(`/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown>, text }
  }

  const editProfile = (clientId: string, body: unknown, admin: Staff = adminOne) =>
    call('PATCH', `/portal/admin/clients/${clientId}/profile`, admin.headers, body)

  const detail = async (clientId: string) => {
    const res = await call('GET', `/portal/admin/clients/${clientId}`, adminOne.headers)
    assert.equal(res.status, 200, res.text)
    return res.body as unknown as Profile
  }

  const edits = (clientId: string) =>
    harness.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.targetId, clientId), eq(schema.auditLog.action, 'client_profile_edited')))

  let n = 0
  const newMember = () => fixtures.memberAt(one, adminOne.headers, fixtures.at(`member-${++n}`))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    fixtures = memberFixtures(harness, schema, DOMAIN)
    ;({ one, two } = harness.tenants)
    adminOne = await fixtures.staffAt(one, fixtures.at('admin-one'), 'admin')
    adminTwo = await fixtures.staffAt(two, fixtures.at('admin-two'), 'admin')
    instructorOne = await fixtures.staffAt(one, fixtures.at('instructor-one'), 'instructor')
  })

  after(async () => {
    if (!harness) return
    await fixtures.cleanup()
    await harness.close()
  })

  test('CUS-16 an admin changes name, gender and phone in one save, and one audit entry holds each change', async () => {
    const member = await newMember()
    const saved = await editProfile(member.clientId, {
      name: '  Ada King  ',
      gender: 'female',
      phone: ' +65 9876 5432 ',
    })
    assert.equal(saved.status, 200, saved.text)
    assert.equal(saved.body.name, 'Ada King', 'trimmed')
    assert.equal(saved.body.phone, '+65 9876 5432', 'trimmed')
    assert.equal(saved.body.gender, 'female')

    const shown = await detail(member.clientId)
    assert.deepEqual(
      { name: shown.name, gender: shown.gender, phone: shown.phone },
      { name: 'Ada King', gender: 'female', phone: '+65 9876 5432' },
      'the customer page reads the new values',
    )

    const entries = await edits(member.clientId)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.actorStaffId, adminOne.row.id)
    assert.equal(entries[0]!.targetTable, 'clients')
    assert.deepEqual(entries[0]!.payload, {
      from: { name: 'Ada Lovelace', gender: null, phone: '+6591234567' },
      to: { name: 'Ada King', gender: 'female', phone: '+65 9876 5432' },
    })
  })

  test('CUS-16 the audit entry holds only the fields that changed', async () => {
    const member = await newMember()
    const saved = await editProfile(member.clientId, { name: 'Ada Lovelace', phone: '+65 8000 0000' })
    assert.equal(saved.status, 200, saved.text)

    const entries = await edits(member.clientId)
    assert.equal(entries.length, 1)
    assert.deepEqual(entries[0]!.payload, { from: { phone: '+6591234567' }, to: { phone: '+65 8000 0000' } })
  })

  test('CUS-17 a save that changes nothing writes no audit entry', async () => {
    const member = await newMember()
    const saved = await editProfile(member.clientId, { name: ' Ada Lovelace ', phone: '+6591234567', gender: null })
    assert.equal(saved.status, 200, saved.text)
    assert.equal(saved.body.name, 'Ada Lovelace')
    assert.deepEqual(await edits(member.clientId), [])
  })

  test('CUS-18 a blank name or phone is refused with a message, and nothing changes', async () => {
    const member = await newMember()
    for (const body of [{ name: '   ' }, { phone: '' }, { name: 'x'.repeat(161) }, { phone: '1'.repeat(41) }, {}]) {
      const res = await editProfile(member.clientId, body)
      assert.equal(res.status, 400, `${JSON.stringify(body)}: ${res.text}`)
      assert.equal(typeof res.body.message, 'string', `${JSON.stringify(body)} says why: ${res.text}`)
      assert.ok((res.body.message as string).length > 0)
    }
    const blankName = await editProfile(member.clientId, { name: ' ' })
    assert.match(blankName.body.message as string, /name/i)
    const blankPhone = await editProfile(member.clientId, { phone: ' ' })
    assert.match(blankPhone.body.message as string, /phone/i)

    const bad = await editProfile(member.clientId, { gender: 'unknown' })
    assert.equal(bad.status, 400, bad.text)

    const shown = await detail(member.clientId)
    assert.deepEqual({ name: shown.name, phone: shown.phone, gender: shown.gender }, { name: 'Ada Lovelace', phone: '+6591234567', gender: null })
    assert.deepEqual(await edits(member.clientId), [])
  })

  test('CUS-18 a blocked member, a member at another studio and an instructor are each refused', async () => {
    const blocked = await newMember()
    const block = await call('DELETE', `/portal/admin/clients/${blocked.clientId}`, adminOne.headers)
    assert.equal(block.status, 200, block.text)
    const refusedBlocked = await editProfile(blocked.clientId, { name: 'Changed' })
    assert.equal(refusedBlocked.status, 409, refusedBlocked.text)
    assert.equal(refusedBlocked.body.error, 'client_blocked')

    const member = await newMember()
    const elsewhere = await editProfile(member.clientId, { name: 'Changed' }, adminTwo)
    assert.equal(elsewhere.status, 404, elsewhere.text)
    assert.equal(elsewhere.body.error, 'client_not_found')

    const instructor = await editProfile(member.clientId, { name: 'Changed' }, instructorOne)
    assert.equal(instructor.status, 403, instructor.text)

    for (const id of [blocked.clientId, member.clientId]) {
      const [row] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, id))
      assert.equal(row!.name, 'Ada Lovelace')
      assert.deepEqual(await edits(id), [])
    }
  })

  test('CUS-19 an admin sets prefer not to say, and clears it again', async () => {
    const member = await newMember()
    assert.equal((await editProfile(member.clientId, { gender: 'prefer_not_to_say' })).status, 200)
    assert.equal((await detail(member.clientId)).gender, 'prefer_not_to_say')

    assert.equal((await editProfile(member.clientId, { gender: null })).status, 200)
    assert.equal((await detail(member.clientId)).gender, null)

    const entries = (await edits(member.clientId)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    assert.deepEqual(
      entries.map(e => e.payload),
      [
        { from: { gender: null }, to: { gender: 'prefer_not_to_say' } },
        { from: { gender: 'prefer_not_to_say' }, to: { gender: null } },
      ],
    )
  })

  test('ACC-14 a member sets, changes and clears their own gender, and an invalid one is refused', async () => {
    const member = await newMember()
    const me = (method: string, body?: unknown) => call(method, '/me', member.headers, body)

    const start = await me('GET')
    assert.equal(start.status, 200, start.text)
    assert.equal(start.body.gender, null, 'the profile carries gender')

    const set = await me('PATCH', { name: 'Ada Lovelace', gender: 'non_binary' })
    assert.equal(set.status, 200, set.text)
    assert.equal(set.body.gender, 'non_binary')
    assert.equal((await me('GET')).body.gender, 'non_binary', 'what was saved is shown on return')

    const changed = await me('PATCH', { gender: 'prefer_not_to_say' })
    assert.equal(changed.status, 200, changed.text)
    assert.equal((await me('GET')).body.gender, 'prefer_not_to_say')

    const cleared = await me('PATCH', { gender: null })
    assert.equal(cleared.status, 200, cleared.text)
    assert.equal((await me('GET')).body.gender, null)

    const invalid = await me('PATCH', { gender: 'other' })
    assert.equal(invalid.status, 400, invalid.text)
    assert.equal((await me('GET')).body.gender, null, 'an invalid value changes nothing')
  })
})
