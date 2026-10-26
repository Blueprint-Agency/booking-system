import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
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

  test('ACC-53 a picture of another type, an empty file or one over 5MB is refused with a sentence, and the picture before it stays', async () => {
    const mia = await member()
    const kept = await upload(mia.headers, '/me/photo', imageBytes(1000), 'image/png', 'kept.png')
    assert.equal(kept.status, 200, kept.text)
    const objects = [...bucket.keys()]

    const refusals = [
      { bytes: imageBytes(1000), type: 'image/gif', status: 400, error: 'image_type_not_allowed', says: /JPG, PNG or WebP/ },
      { bytes: imageBytes(1000), type: 'application/pdf', status: 400, error: 'image_type_not_allowed', says: /JPG, PNG or WebP/ },
      { bytes: new Uint8Array(0), type: 'image/jpeg', status: 400, error: 'image_empty', says: /empty/ },
      { bytes: imageBytes(5 * MB + 1), type: 'image/jpeg', status: 400, error: 'image_too_large', says: /5MB/ },
      { bytes: imageBytes(6 * MB), type: 'image/jpeg', status: 413, error: 'image_too_large', says: /5MB/ },
    ]
    for (const { bytes, type, status, error, says } of refusals) {
      const res = await upload(mia.headers, '/me/photo', bytes, type)
      assert.equal(res.status, status, `${type} of ${bytes.byteLength} bytes: ${res.text}`)
      assert.equal(res.body.error, error)
      assert.match(String(res.body.message), says, res.text)
    }

    assert.equal((await call(mia.headers, 'GET', '/me')).body.photo_url, kept.body.photo_url, 'the picture before stays')
    assert.deepEqual([...bucket.keys()], objects, 'nothing was written to the bucket')
  })

  test('ACC-54 a member replacing their picture gets a new key, and the old picture is deleted after the save, retried if the bucket fails', async () => {
    const mia = await member()
    const first = await upload(mia.headers, '/me/photo', imageBytes(1000, 1), 'image/jpeg')
    const firstKey = keyOf(first.body.photo_url)

    const second = await upload(mia.headers, '/me/photo', imageBytes(1000, 2), 'image/jpeg')

    assert.equal(second.status, 200, second.text)
    const secondKey = keyOf(second.body.photo_url)
    assert.notEqual(secondKey, firstKey, 'a new key, never the old one overwritten')
    assert.equal(bucket.has(firstKey), false, 'the old picture is deleted')
    assert.equal(bucket.get(secondKey)?.bytes[0], 2)

    failingDeletes = 1
    const third = await upload(mia.headers, '/me/photo', imageBytes(1000, 3), 'image/jpeg')
    assert.equal(third.status, 200, 'a failed delete does not fail the upload')
    assert.equal((await call(mia.headers, 'GET', '/me')).body.photo_url, third.body.photo_url)
    const deadline = Date.now() + 10_000
    while (bucket.has(secondKey)) {
      assert.ok(Date.now() < deadline, 'the failed delete was retried off the request')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  })

  test('ACC-55 a member removing their picture clears it and deletes the object, and their initials show', async () => {
    const mia = await member()
    const uploaded = await upload(mia.headers, '/me/photo', imageBytes(1000), 'image/webp', 'me.webp')
    const key = keyOf(uploaded.body.photo_url)

    const res = await call(mia.headers, 'DELETE', '/me/photo')

    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.photo_url, null)
    assert.equal((await call(mia.headers, 'GET', '/me')).body.photo_url, null)
    assert.equal(bucket.has(key), false)
  })

  test("ACC-56 an admin acting as a member cannot upload, replace or remove the member's picture", async () => {
    const mia = await member()
    const own = await upload(mia.headers, '/me/photo', imageBytes(1000, 7), 'image/jpeg')
    const minted = await call(admin.headers, 'POST', `/portal/admin/clients/${mia.clientId}/impersonate`, {})
    assert.equal(minted.status, 200, minted.text)
    const actingAs = {
      'X-Tenant-Slug': one.slug,
      Origin: frontendOrigin('client', one),
      'X-Forwarded-For': harnessAddress(),
      Authorization: `Bearer ${minted.body.token}`,
      'X-Impersonation-Grant': minted.body.grant,
    }
    assert.equal((await call(actingAs, 'GET', '/me')).status, 200, 'the admin is acting as the member')

    const uploaded = await upload(actingAs, '/me/photo', imageBytes(1000, 8), 'image/jpeg')
    const removed = await call(actingAs, 'DELETE', '/me/photo')

    for (const res of [uploaded, removed]) {
      assert.equal(res.status, 403, res.text)
      assert.match(String(res.body.message), /only the member/i)
    }
    assert.equal((await call(mia.headers, 'GET', '/me')).body.photo_url, own.body.photo_url)
    assert.equal(bucket.get(keyOf(own.body.photo_url))?.bytes[0], 7)
  })

  test("ACC-57 deleting a member's account deletes their picture", async () => {
    const mia = await member()
    const uploaded = await upload(mia.headers, '/me/photo', imageBytes(1000), 'image/jpeg')
    const key = keyOf(uploaded.body.photo_url)

    const res = await harness.app.request(`/api/v1/portal/admin/clients/${mia.clientId}/permanently`, {
      method: 'DELETE',
      headers: admin.headers,
    })

    assert.ok(res.status < 300, await res.text())
    assert.equal(bucket.has(key), false)
  })

  test('STF-47 an admin and an instructor each upload, replace and remove their own picture, which their own profile reads show', async () => {
    for (const who of [admin, instructor]) {
      const first = await upload(who.headers, '/portal/profile/photo', imageBytes(1000, 1), 'image/png', 'me.png')
      assert.equal(first.status, 200, first.text)
      const firstKey = keyOf(first.body.photo_url)
      assert.match(firstKey, new RegExp(`^t/${one.id}/avatars/[0-9a-f-]{36}\\.png$`))
      assert.equal((await call(who.headers, 'GET', '/portal/auth/me')).body.photo_url, urlOf(firstKey))

      const second = await upload(who.headers, '/portal/profile/photo', imageBytes(1000, 2), 'image/jpeg')
      assert.equal(second.status, 200, second.text)
      assert.notEqual(keyOf(second.body.photo_url), firstKey)
      assert.equal(bucket.has(firstKey), false, 'the replaced picture is deleted')
      assert.equal((await call(who.headers, 'GET', '/portal/auth/me')).body.photo_url, second.body.photo_url)

      const refused = await upload(who.headers, '/portal/profile/photo', imageBytes(1000), 'image/gif')
      assert.equal(refused.status, 400, refused.text)
      assert.match(String(refused.body.message), /JPG, PNG or WebP/)
      const tooLarge = await upload(who.headers, '/portal/profile/photo', imageBytes(6 * MB), 'image/jpeg')
      assert.equal(tooLarge.status, 413, tooLarge.text)
      assert.match(String(tooLarge.body.message), /5MB/)

      const removed = await call(who.headers, 'DELETE', '/portal/profile/photo')
      assert.equal(removed.status, 200, removed.text)
      assert.equal((await call(who.headers, 'GET', '/portal/auth/me')).body.photo_url, null)
      assert.equal(bucket.has(keyOf(second.body.photo_url)), false)
    }

    const own = await upload(instructor.headers, '/portal/profile/photo', imageBytes(1000, 3), 'image/webp', 'me.webp')
    const profile = await call(instructor.headers, 'GET', '/portal/instructor/profile')
    assert.equal(profile.body.photo_url, own.body.photo_url, "the instructor's profile page shows it")
    assert.equal('photo_r2_key' in profile.body, false, 'no object key is handed out')
  })

  test("STF-48 an admin has no route to change another person's picture: not by creating or editing them, nor acting as them", async () => {
    const own = await upload(instructor.headers, '/portal/profile/photo', imageBytes(1000, 4), 'image/jpeg')
    const theirs = own.body.photo_url
    const planted = `t/${one.id}/avatars/chosen-by-an-admin.jpg`

    const edited = await call(admin.headers, 'PATCH', `/portal/admin/staff/${instructor.row.id}`, { photo_r2_key: planted })
    const actingAs = await upload(
      { ...admin.headers, 'x-impersonate-staff-id': instructor.row.id },
      '/portal/profile/photo',
      imageBytes(1000, 5),
      'image/jpeg',
    )
    const removedAs = await call({ ...admin.headers, 'x-impersonate-staff-id': instructor.row.id }, 'DELETE', '/portal/profile/photo')

    assert.ok(edited.status < 500, edited.text)
    for (const res of [actingAs, removedAs]) {
      assert.equal(res.status, 403, res.text)
      assert.match(String(res.body.message), /only .* their own picture/i)
    }
    assert.equal((await call(instructor.headers, 'GET', '/portal/auth/me')).body.photo_url, theirs)

    const email = fixtures.at('created-with-photo')
    const created = await call(admin.headers, 'POST', '/portal/admin/instructors', { email, name: 'Created With Photo', photo_r2_key: planted })
    assert.equal(created.status, 201, created.text)
    const listed = await call(admin.headers, 'GET', '/portal/admin/instructors')
    const made = listed.body.instructors.find((i: { id: string }) => i.id === created.body.id)
    assert.equal(made.photo_url, null, 'the new instructor has no picture until they upload one')
    const [row] = await harness.db
      .select({ key: schema.staffUsers.photoR2Key })
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.id, created.body.id))
    assert.equal(row!.key, null)
  })

  test("STF-49 a picture key under another studio is never this studio's to delete", async () => {
    const elsewhere = `t/${two.id}/avatars/${crypto.randomUUID()}.jpg`
    bucket.set(elsewhere, { bytes: imageBytes(10, 9), contentType: 'image/jpeg' })
    await harness.db.update(schema.staffUsers).set({ photoR2Key: elsewhere }).where(eq(schema.staffUsers.id, instructor.row.id))

    const replaced = await upload(instructor.headers, '/portal/profile/photo', imageBytes(1000, 6), 'image/png', 'me.png')
    assert.equal(replaced.status, 200, replaced.text)
    await harness.db.update(schema.staffUsers).set({ photoR2Key: elsewhere }).where(eq(schema.staffUsers.id, instructor.row.id))
    const removed = await call(instructor.headers, 'DELETE', '/portal/profile/photo')
    assert.equal(removed.status, 200, removed.text)

    assert.equal(bucket.get(elsewhere)?.bytes[0], 9, "the other studio's object is left where it is")
    assert.ok(keyOf(replaced.body.photo_url).startsWith(`t/${one.id}/`), "the upload lands in this studio's own folder")
  })
})
