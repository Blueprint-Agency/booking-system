import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures, type Staff, type Tenant } from './member-fixtures'

/**
 * A member's Billing details (#399): up to three name-and-address sets they
 * keep at their studio, one of them the default, managed from their account.
 *
 * Over the member's own routes, as a member would use them: what each call
 * answers and what the list reads afterwards. The default, the cap of three,
 * ownership and the Tenant scope are each something only a request reaching
 * the service through `clientAuth` and the studio's transaction can show.
 */
describe('billing details', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fixtures!: ReturnType<typeof memberFixtures>
  let one!: Tenant
  let two!: Tenant
  let adminOne!: Staff
  let adminTwo!: Staff

  const run = Date.now().toString(36)
  const DOMAIN = `billing-details-${run}.test`

  type Set = {
    id: string
    name: string
    line1: string
    line2: string | null
    city: string
    state: string | null
    postcode: string
    country: string
    is_default: boolean
  }

  const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
    const res = await harness.app.request(`/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown>, text }
  }

  type Member = { clientId: string; headers: Record<string, string> }

  const list = async (member: Member) => {
    const res = await call('GET', '/me/billing-details', member.headers)
    assert.equal(res.status, 200, res.text)
    return res.body.billing_details as Set[]
  }

  const add = (member: Member, body: unknown) => call('POST', '/me/billing-details', member.headers, body)

  const addOk = async (member: Member, body: unknown) => {
    const res = await add(member, body)
    assert.equal(res.status, 201, res.text)
    return res.body.billing_details as Set
  }

  const home = {
    name: 'Ada Lovelace',
    line1: '1 Analytical Way',
    line2: '#04-01',
    city: 'Singapore',
    postcode: '049145',
  }
  const office = {
    name: 'Difference Engines Pte Ltd',
    line1: '10 Marina Boulevard',
    city: 'Singapore',
    state: 'Central',
    postcode: '018983',
    country: 'MY',
  }

  let n = 0
  const newMember = () => fixtures.memberAt(one, adminOne.headers, fixtures.at(`member-${++n}`))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    fixtures = memberFixtures(harness, schema, DOMAIN)
    ;({ one, two } = harness.tenants)
    adminOne = await fixtures.staffAt(one, fixtures.at('admin-one'), 'admin')
    adminTwo = await fixtures.staffAt(two, fixtures.at('admin-two'), 'admin')
  })

  after(async () => {
    if (!harness) return
    await fixtures.cleanup()
    await harness.close()
  })

  test('ACC-40 a member adds Billing details, the first becomes their default, and the list reads them back', async () => {
    const member = await newMember()
    assert.deepEqual(await list(member), [], 'a member starts with none')

    const first = await addOk(member, { ...home, name: '  Ada Lovelace  ' })
    assert.equal(first.name, 'Ada Lovelace', 'trimmed')
    assert.equal(first.country, 'SG', 'country defaults to Singapore')
    assert.equal(first.state, null)
    assert.equal(first.is_default, true, 'the first set is the default')

    const second = await addOk(member, office)
    assert.equal(second.is_default, false, 'a later set is not')
    assert.equal(second.country, 'MY')

    const sets = await list(member)
    assert.deepEqual(
      sets.map(s => [s.id, s.name, s.line1, s.line2, s.city, s.state, s.postcode, s.country, s.is_default]),
      [
        [first.id, 'Ada Lovelace', '1 Analytical Way', '#04-01', 'Singapore', null, '049145', 'SG', true],
        [second.id, 'Difference Engines Pte Ltd', '10 Marina Boulevard', null, 'Singapore', 'Central', '018983', 'MY', false],
      ],
    )

    const single = await call('GET', `/me/billing-details/${second.id}`, member.headers)
    assert.equal(single.status, 200, single.text)
    assert.deepEqual(single.body.billing_details, sets[1], 'one set reads as it does in the list')
  })

  const defaults = async (member: Member) =>
    (await list(member)).filter(s => s.is_default).map(s => s.id)

  test('ACC-41 making another set the default unsets the old one, and there is only ever one', async () => {
    const member = await newMember()
    const first = await addOk(member, home)
    const second = await addOk(member, office)
    const third = await addOk(member, { ...office, name: 'Third' })

    const made = await call('POST', `/me/billing-details/${third.id}/default`, member.headers)
    assert.equal(made.status, 200, made.text)
    assert.equal((made.body.billing_details as Set).is_default, true)
    assert.deepEqual(await defaults(member), [third.id])

    const again = await call('POST', `/me/billing-details/${second.id}/default`, member.headers)
    assert.equal(again.status, 200, again.text)
    assert.deepEqual(await defaults(member), [second.id])

    const same = await call('POST', `/me/billing-details/${second.id}/default`, member.headers)
    assert.equal(same.status, 200, 'making the default the default again is no change')
    assert.deepEqual(await defaults(member), [second.id])
    assert.ok(first.id)
  })

  test('ACC-42 deleting the default hands it to the most recently added set left; deleting another leaves it', async () => {
    const member = await newMember()
    const first = await addOk(member, home)
    const second = await addOk(member, office)
    const third = await addOk(member, { ...office, name: 'Third' })

    const removed = await call('DELETE', `/me/billing-details/${first.id}`, member.headers)
    assert.equal(removed.status, 200, removed.text)
    assert.deepEqual(
      (await list(member)).map(s => [s.id, s.is_default]),
      [
        [second.id, false],
        [third.id, true],
      ],
      'the most recently added set left is the default',
    )

    const other = await call('DELETE', `/me/billing-details/${second.id}`, member.headers)
    assert.equal(other.status, 200, other.text)
    assert.deepEqual(await defaults(member), [third.id], 'deleting a set that is not the default leaves the default')

    const last = await call('DELETE', `/me/billing-details/${third.id}`, member.headers)
    assert.equal(last.status, 200, last.text)
    assert.deepEqual(await list(member), [])

    const fresh = await addOk(member, home)
    assert.equal(fresh.is_default, true, 'with none left, the next set added is the default again')
  })

  test('ACC-43 a fourth set is refused billing_details_limit with a sentence to edit or delete one, and none is added', async () => {
    const member = await newMember()
    for (const name of ['One', 'Two', 'Three']) await addOk(member, { ...home, name })

    const fourth = await add(member, { ...home, name: 'Four' })
    assert.equal(fourth.status, 409, fourth.text)
    assert.equal(fourth.body.error, 'billing_details_limit')
    assert.match(String(fourth.body.message), /three/i)
    assert.match(String(fourth.body.message), /edit or delete/i)
    assert.deepEqual((await list(member)).map(s => s.name), ['One', 'Two', 'Three'])

    // Two adds at once, with room for one: one is added, the other refused.
    const racer = await newMember()
    for (const name of ['One', 'Two']) await addOk(racer, { ...home, name })
    const racing = await Promise.all(['A', 'B'].map(name => add(racer, { ...home, name })))
    assert.deepEqual(racing.map(r => r.status).sort(), [201, 409], racing.map(r => r.text).join('\n'))
    assert.equal((await list(racer)).length, 3)
  })

  test('ACC-44 a member edits a set: the fields sent change, those left out stay, and a blank optional field is cleared', async () => {
    const member = await newMember()
    const set = await addOk(member, { ...home, state: 'Central' })

    const edited = await call('PATCH', `/me/billing-details/${set.id}`, member.headers, {
      line1: ' 2 Engine Road ',
      line2: '',
      state: null,
      country: 'gb',
    })
    assert.equal(edited.status, 200, edited.text)
    const [shown] = await list(member)
    assert.deepEqual(
      [shown!.name, shown!.line1, shown!.line2, shown!.city, shown!.state, shown!.postcode, shown!.country, shown!.is_default],
      ['Ada Lovelace', '2 Engine Road', null, 'Singapore', null, '049145', 'GB', true],
    )
  })

  test('ACC-45 a missing, blank or over-long field, a country that is not one, or a body of the wrong shape is refused invalid_request with a readable sentence', async () => {
    const member = await newMember()
    const set = await addOk(member, home)

    const refusals: [string, string, unknown, RegExp][] = [
      ['POST', '/me/billing-details', { ...home, name: undefined }, /name is required/i],
      ['POST', '/me/billing-details', { ...home, line1: '   ' }, /address line 1 is required/i],
      ['POST', '/me/billing-details', { ...home, city: undefined }, /city is required/i],
      ['POST', '/me/billing-details', { ...home, postcode: '' }, /postcode is required/i],
      ['POST', '/me/billing-details', { ...home, name: 'x'.repeat(201) }, /name is at most 200 characters/i],
      ['POST', '/me/billing-details', { ...home, postcode: '1'.repeat(21) }, /postcode is at most 20 characters/i],
      ['POST', '/me/billing-details', { ...home, country: 'Singapore' }, /two-letter code/i],
      ['POST', '/me/billing-details', { ...home, country: 'ZZ' }, /two-letter code/i],
      ['POST', '/me/billing-details', { ...home, name: 42 }, /as text/i],
      ['PATCH', `/me/billing-details/${set.id}`, { name: ' ' }, /name is required/i],
      ['PATCH', `/me/billing-details/${set.id}`, { line2: 'x'.repeat(201) }, /address line 2 is at most 200 characters/i],
    ]
    for (const [method, path, body, sentence] of refusals) {
      const res = await call(method, path, member.headers, body)
      assert.equal(res.status, 400, `${method} ${JSON.stringify(body)}: ${res.text}`)
      assert.equal(res.body.error, 'invalid_request')
      assert.match(String(res.body.message), sentence, JSON.stringify(body))
    }
    assert.deepEqual(
      (await list(member)).map(s => [s.name, s.line2]),
      [['Ada Lovelace', '#04-01']],
      'nothing refused was saved',
    )
  })

  test('ACC-46 another member’s set reads as not found to read, edit, delete and make-default, and is left as it was', async () => {
    const owner = await newMember()
    const other = await newMember()
    const theirs = await addOk(owner, home)
    await addOk(owner, office)
    await addOk(other, home)

    const attempts: [string, string, unknown?][] = [
      ['GET', `/me/billing-details/${theirs.id}`],
      ['PATCH', `/me/billing-details/${theirs.id}`, { name: 'Hijacked' }],
      ['DELETE', `/me/billing-details/${theirs.id}`],
      ['POST', `/me/billing-details/${theirs.id}/default`],
    ]
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, other.headers, body)
      assert.equal(res.status, 404, `${method} ${path}: ${res.text}`)
      assert.equal(res.body.error, 'billing_details_not_found')
    }
    assert.ok(!(await list(other)).some(s => s.id === theirs.id), 'it is not in the other member’s list')
    assert.deepEqual(
      (await list(owner)).map(s => [s.id === theirs.id, s.name, s.is_default]),
      [
        [true, 'Ada Lovelace', true],
        [false, 'Difference Engines Pte Ltd', false],
      ],
      'the owner’s sets are untouched',
    )
  })

  test('ACC-47 a member of one studio cannot see or use a set saved at another, and each studio counts its own three', async () => {
    // One person, a member of both studios: a login, and a member record, at each.
    const email = fixtures.at(`member-${++n}`)
    const atOne = await fixtures.memberAt(one, adminOne.headers, email)
    const atTwo = await fixtures.memberAt(two, adminTwo.headers, email)
    const saved = await addOk(atOne, home)
    for (const name of ['One', 'Two']) await addOk(atOne, { ...home, name })

    assert.deepEqual(await list(atTwo), [], 'the other studio lists none of them')
    for (const [method, path, body] of [
      ['GET', `/me/billing-details/${saved.id}`],
      ['PATCH', `/me/billing-details/${saved.id}`, { name: 'Hijacked' }],
      ['DELETE', `/me/billing-details/${saved.id}`],
      ['POST', `/me/billing-details/${saved.id}/default`],
    ] as [string, string, unknown?][]) {
      const res = await call(method, path, atTwo.headers, body)
      assert.equal(res.status, 404, `${method} ${path}: ${res.text}`)
      assert.equal(res.body.error, 'billing_details_not_found')
    }

    const own = await addOk(atTwo, office)
    assert.equal(own.is_default, true, 'the first set at the second studio is its default there')
    assert.deepEqual(
      (await list(atOne)).map(s => [s.name, s.is_default]),
      [
        ['Ada Lovelace', true],
        ['One', false],
        ['Two', false],
      ],
    )
  })

  test('ACC-48 a country is one ISO 3166-1 assigns: EU, UN, EZ, SU, YU, XK and other codes that name no country are refused, and real ones like AX, BQ, CW, SS and GB are kept', async () => {
    const member = await newMember()
    const set = await addOk(member, home)
    for (const country of ['EU', 'UN', 'EZ', 'SU', 'YU', 'XK', 'QO', 'AC', 'TA', 'IC', 'DG', 'EA', 'CP', 'UK', 'FX']) {
      const res = await call('PATCH', `/me/billing-details/${set.id}`, member.headers, { country })
      assert.equal(res.status, 400, `${country}: ${res.text}`)
      assert.equal(res.body.error, 'invalid_request')
      assert.match(String(res.body.message), /two-letter code/i, country)
    }
    assert.equal((await list(member))[0]!.country, 'SG', 'nothing refused was saved')
    for (const country of ['AX', 'BQ', 'CW', 'SS', 'GB', 'MY', 'sg']) {
      const res = await call('PATCH', `/me/billing-details/${set.id}`, member.headers, { country })
      assert.equal(res.status, 200, `${country}: ${res.text}`)
      assert.equal((await list(member))[0]!.country, country.toUpperCase())
    }
  })

  test('ACC-49 a set edited while it is being deleted is either edited first or 404 billing_details_not_found, never a server error', async () => {
    for (let round = 0; round < 12; round++) {
      const member = await newMember()
      const set = await addOk(member, home)
      // Edits on either side of the delete, so some land in its window.
      const edit = (k: number) => call('PATCH', `/me/billing-details/${set.id}`, member.headers, { name: `Edited ${round}.${k}` })
      const [first, deleted, ...rest] = await Promise.all([
        edit(0),
        call('DELETE', `/me/billing-details/${set.id}`, member.headers),
        edit(1),
        edit(2),
        edit(3),
      ])
      assert.equal(deleted.status, 200, deleted.text)
      for (const edited of [first!, ...rest]) {
        assert.ok([200, 404].includes(edited.status), `round ${round}: ${edited.status} ${edited.text}`)
        if (edited.status === 404) assert.equal(edited.body.error, 'billing_details_not_found')
        else assert.match(String((edited.body.billing_details as Set).name), /^Edited /)
      }
      assert.deepEqual(await list(member), [], 'the set is gone')
    }
  })
})
