import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const OPERATOR = `operator-${run}@studio-timezone.test`

/**
 * A studio's time zone is fixed when the super portal creates it: the create
 * route refuses a request that names none, and one that names something that
 * is not an IANA zone, in typed codes the portal's form can answer. A studio
 * that names a real zone is created on it, and the studio list and the public
 * lookup both read it back.
 *
 * Written from the TEN rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`), issue #506.
 */
describe('a studio’s time zone at creation', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let operator!: Record<string, string>

  let studios = 0
  const nextSlug = () => `tz-${run}-${studios++}`

  const create = (body: Record<string, unknown>) =>
    harness.app.request('/api/v1/platform/tenants', {
      method: 'POST',
      headers: { Authorization: operator.Authorization!, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const listed = async () => {
    const res = await harness.app.request('/api/v1/platform/tenants', { headers: { Authorization: operator.Authorization! } })
    assert.equal(res.status, 200)
    return ((await res.json()) as { tenants: { slug: string; timezone: string }[] }).tenants
  }

  const tenantRows = (slug: string) => harness.db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.close()
  })

  test('TEN-103 creating a studio with no time zone, a blank one or an all-space one is refused 400 timezone_required, and no studio is made', async () => {
    for (const extra of [{}, { timezone: '' }, { timezone: '   ' }, { timezone: null }]) {
      const slug = nextSlug()
      const res = await create({ slug, name: `Domain ${slug}`, ...extra })
      assert.equal(res.status, 400, JSON.stringify(extra))
      assert.equal(((await res.json()) as { error: string }).error, 'timezone_required', JSON.stringify(extra))
      assert.deepEqual(await tenantRows(slug), [], `no studio was made for ${JSON.stringify(extra)}`)
    }
  })

  test('TEN-104 creating a studio on a name that is not an IANA zone is refused 400 timezone_invalid, and no studio is made', async () => {
    // Names Intl reads but a zone is not: a bare Area, an offset, and the old
    // three-letter ids (AET, CTT, NET, ECT and SystemV/EST5 Postgres refuses
    // outright; IST, PST and the like it reads as another offset).
    const names: unknown[] = [
      'Mars/Base', 'Asia', 'Not a zone', 'GMT+8', '+08:00', '-05:00', 'Asia/Singapre', 'Singapore',
      'AET', 'IST', 'PST', 'CET', 'SystemV/EST5',
      // Not text at all.
      5, true, ['Asia/Singapore'], { zone: 'Asia/Singapore' },
    ]
    for (const timezone of names) {
      const slug = nextSlug()
      const label = JSON.stringify(timezone)
      const res = await create({ slug, name: `Domain ${slug}`, timezone })
      assert.equal(res.status, 400, label)
      assert.equal(((await res.json()) as { error: string }).error, 'timezone_invalid', label)
      assert.deepEqual(await tenantRows(slug), [], `no studio was made on ${label}`)
    }
  })

  test('TEN-105 a studio created on a real zone is on it, whichever zone it is, and the studio list and the public lookup both read it back', async () => {
    const sydney = nextSlug()
    const kolkata = nextSlug()
    const utc = nextSlug()
    for (const [slug, timezone] of [
      [sydney, 'Australia/Sydney'],
      [kolkata, 'Asia/Kolkata'],
      [utc, 'UTC'],
    ] as const) {
      const res = await create({ slug, name: `Domain ${slug}`, timezone })
      const text = await res.text()
      assert.equal(res.status, 201, text)
      assert.equal((JSON.parse(text) as { tenant: { timezone: string } }).tenant.timezone, timezone)
      assert.equal((await tenantRows(slug))[0]!.timezone, timezone)
    }

    const list = await listed()
    assert.equal(list.find(t => t.slug === sydney)!.timezone, 'Australia/Sydney')
    assert.equal(list.find(t => t.slug === kolkata)!.timezone, 'Asia/Kolkata')
    assert.equal(list.find(t => t.slug === utc)!.timezone, 'UTC')

    const lookup = await harness.app.request(`/api/v1/public/tenants/by-slug/${sydney}`)
    assert.equal(lookup.status, 200)
    assert.equal(((await lookup.json()) as { tenant: { timezone: string } }).tenant.timezone, 'Australia/Sydney')
  })

  test('TEN-105 a zone padded with spaces is stored trimmed, and one typed in the wrong case under the zone list’s own spelling', async () => {
    for (const [typed, stored] of [
      [' Australia/Sydney ', 'Australia/Sydney'],
      ['asia/singapore', 'Asia/Singapore'],
      ['AMERICA/NEW_YORK', 'America/New_York'],
      [' utc', 'UTC'],
    ] as const) {
      const slug = nextSlug()
      const res = await create({ slug, name: `Domain ${slug}`, timezone: typed })
      assert.equal(res.status, 201, `${typed}: ${await res.text()}`)
      assert.equal((await tenantRows(slug))[0]!.timezone, stored, typed)
    }
  })

  test('TEN-107 a legacy link name the runtime lists is stored under the name the tz database gives the zone today, and Postgres can read what was stored', async () => {
    const legacy: Record<string, string> = {
      'Africa/Asmera': 'Africa/Asmara',
      'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
      'America/Godthab': 'America/Nuuk',
      'Asia/Calcutta': 'Asia/Kolkata',
      'Asia/Katmandu': 'Asia/Kathmandu',
      'Asia/Rangoon': 'Asia/Yangon',
      'Asia/Saigon': 'Asia/Ho_Chi_Minh',
      'Europe/Kiev': 'Europe/Kyiv',
      'Pacific/Enderbury': 'Pacific/Kanton',
      'Pacific/Truk': 'Pacific/Chuuk',
    }
    for (const [typed, stored] of Object.entries(legacy)) {
      const slug = nextSlug()
      const res = await create({ slug, name: `Domain ${slug}`, timezone: typed })
      assert.equal(res.status, 201, `${typed}: ${await res.text()}`)
      const row = (await tenantRows(slug))[0]!
      assert.equal(row.timezone, stored, typed)
      // The sweep that ends Terms asks Postgres for this zone; it must know it.
      const read = await harness.db.execute(sql`select (now() at time zone ${row.timezone}) as local`)
      assert.equal(read.length, 1, `${row.timezone} is a zone Postgres reads`)
    }
  })
})
