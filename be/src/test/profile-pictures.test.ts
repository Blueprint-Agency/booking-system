import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures, type Staff, type Tenant } from './member-fixtures'
import { withEnv } from './with-env'

const PUBLIC_HOST = 'https://pictures.cdn.test'
const MB = 1024 * 1024

/**
 * Profile pictures over HTTP (#471): a member, an instructor and an admin each
 * upload, replace and remove their own picture, and nobody can set anyone
 * else's.
 *
 * Real Postgres and real sign-in. Storage is the one third party, faked as an
 * in-memory bucket behind the R2 client's `send`, as the leave tests fake it.
 */
describe('profile pictures over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({
    R2_BUCKET_NAME: 'profile-pictures-test-bucket',
    R2_ACCOUNT_ID: 'profile-pictures-test-account',
    R2_ACCESS_KEY_ID: 'profile-pictures-test-key',
    R2_SECRET_ACCESS_KEY: 'profile-pictures-test-secret',
    R2_PUBLIC_URL: PUBLIC_HOST,
  })

  const DOMAIN = `profile-pictures-${Date.now().toString(36)}.test`

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fixtures!: ReturnType<typeof memberFixtures>
  let one!: Tenant
  let two!: Tenant
  let admin!: Staff
  let instructor!: Staff
  let adminAtTwo!: Staff

  type Member = { clientId: string; headers: Record<string, string> }

  const bucket = new Map<string, { bytes: Uint8Array; contentType: string }>()
  let failingDeletes = 0
  let restoreStorage: () => void = () => {}

  const urlOf = (key: string) => `${PUBLIC_HOST}/${key}`
  const keyOf = (url: string) => {
    assert.ok(url.startsWith(`${PUBLIC_HOST}/`), `a public URL: ${url}`)
    return url.slice(PUBLIC_HOST.length + 1)
  }

  /** `size` bytes, with `seed` in the first so two files of one size differ. */
  const imageBytes = (size: number, seed = 1) => {
    const bytes = new Uint8Array(size)
    bytes[0] = seed
    return bytes
  }

  const call = async (headers: Record<string, string>, method: string, path: string, body?: unknown) => {
    const res = await harness.app.request(`/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    return { status: res.status, text, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
  }

  const upload = async (headers: Record<string, string>, path: string, bytes: Uint8Array, type: string, name = 'me.jpg') => {
    const form = new FormData()
    form.set('file', new File([bytes], name, { type }))
    const res = await harness.app.request(`/api/v1${path}`, { method: 'POST', headers, body: form })
    const text = await res.text()
    return { status: res.status, text, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
  }

  let memberCount = 0
  const member = async (tenant: Tenant = one, by: Staff = admin): Promise<Member> => {
    const made = await fixtures.memberAt(tenant, by.headers, fixtures.at(`member-${++memberCount}`))
    return { clientId: made.clientId, headers: made.headers }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    fixtures = memberFixtures(harness, schema, DOMAIN)
    one = harness.tenants.one
    two = harness.tenants.two

    const r2Module = await import('../lib/r2')
    const originalSend = r2Module.r2.send
    r2Module.r2.send = (async (command: { constructor: { name: string }; input: any }) => {
      if (command.constructor.name === 'PutObjectCommand') {
        const { Key, Body, ContentType } = command.input
        bucket.set(Key, { bytes: new Uint8Array(Body), contentType: ContentType })
        return {}
      }
      if (command.constructor.name === 'DeleteObjectCommand') {
        if (failingDeletes > 0) {
          failingDeletes--
          throw Object.assign(new Error('fake storage: delete failed'), { $metadata: { httpStatusCode: 503 } })
        }
        bucket.delete(command.input.Key)
        return {}
      }
      throw new Error(`fake storage: unexpected ${command.constructor.name}`)
    }) as unknown as typeof r2Module.r2.send
    restoreStorage = () => {
      r2Module.r2.send = originalSend
    }

    admin = await fixtures.staffAt(one, fixtures.at('admin'), 'admin')
    instructor = await fixtures.staffAt(one, fixtures.at('instructor'), 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: instructor.row.id })
    adminAtTwo = await fixtures.staffAt(two, fixtures.at('admin-two'), 'admin')
  })

  after(async () => {
    restoreStorage()
    if (!harness) return
    await fixtures.cleanup()
    await harness.close()
  })

  test('ACC-52 a member uploads a JPG, PNG or WebP of 5MB or less as their picture, and their profile shows it', async () => {
    const mia = await member()
    for (const [type, ext] of [
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
    ] as const) {
      const bytes = imageBytes(ext === 'webp' ? 5 * MB : 2048, ext.length)

      const res = await upload(mia.headers, '/me/photo', bytes, type, `me.${ext}`)

      assert.equal(res.status, 200, res.text)
      const key = keyOf(res.body.photo_url)
      assert.match(key, new RegExp(`^t/${one.id}/avatars/[0-9a-f-]{36}\\.${ext}$`))
      assert.deepEqual(bucket.get(key)?.bytes, bytes, 'the picture is in the bucket')
      assert.equal(bucket.get(key)?.contentType, type)
      const profile = await call(mia.headers, 'GET', '/me')
      assert.equal(profile.body.photo_url, urlOf(key))
    }
  })
})
