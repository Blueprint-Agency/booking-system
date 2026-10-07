import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { inArray, sql } from 'drizzle-orm'
import postgres from 'postgres'
import {
  appRoleUrl,
  frontendOrigin,
  HARNESS_PASSWORD,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  TEST_DATABASE_URL,
  type TestApp,
} from './harness'
import { memberFixtures, type Staff } from './member-fixtures'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const OPERATOR = `operator-${run}@maintenance.test`
const DEFAULT_MESSAGE = "Maintenance in progress. We'll be back shortly."

/**
 * Maintenance mode (docs/adr/0007-platform-settings.md): one platform-wide
 * switch, set in the super portal, that answers every tenant-facing request
 * `503 maintenance` while it is on — and leaves the super portal, the health
 * checks and the payment and mail webhooks running, so it can be switched off
 * and no payment is lost while it is on.
 */
describe('maintenance mode', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fixtures!: ReturnType<typeof memberFixtures>
  let operator!: Record<string, string>
  let admin!: Staff
  let member!: Record<string, string>
  const memberEmail = `member-${run}@maintenance.test`
  const adminEmail = `admin-${run}@maintenance.test`

  const platform = (method: 'GET' | 'PUT', headers: Record<string, string>, body?: unknown) =>
    harness.app.request('/api/v1/platform/maintenance', {
      method,
      headers: { Authorization: headers.Authorization!, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  const turn = async (enabled: boolean, message?: string) => {
    const res = await platform('PUT', operator, { enabled, ...(message === undefined ? {} : { message }) })
    assert.equal(res.status, 200, await res.clone().text())
    return (await res.json()) as { enabled: boolean; message: string; updated_by: string | null; updated_at: string | null }
  }

  /** Every tenant-facing call the switch must close: member, staff, public, and a studio sign-in. */
  const tenantCalls = () => {
    const one = harness.tenants.one
    const publicHeaders = { 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('client', one) }
    return {
      member: () => harness.app.request('/api/v1/me', { headers: member }),
      staff: () => harness.app.request('/api/v1/portal/auth/me', { headers: admin.headers }),
      public: () => harness.app.request('/api/v1/public/locations', { headers: publicHeaders }),
      // What the frontends' maintenance screen re-checks.
      status: () => harness.app.request('/api/v1/public/maintenance', { headers: publicHeaders }),
      memberSignIn: () =>
        harness.app.request('/api/v1/auth/client/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': harnessAddress(), ...publicHeaders },
          body: JSON.stringify({ email: memberEmail, password: HARNESS_PASSWORD }),
        }),
      staffSignIn: () =>
        harness.app.request('/api/v1/auth/staff/sign-in/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': harnessAddress(),
            'X-Tenant-Slug': one.slug,
            Origin: frontendOrigin('staff', one),
          },
          body: JSON.stringify({ email: adminEmail, password: HARNESS_PASSWORD }),
        }),
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    fixtures = memberFixtures(harness, schema, 'maintenance.test')
    operator = await harness.signInAs('platform', OPERATOR, null)
    admin = await fixtures.staffAt(harness.tenants.one, adminEmail, 'admin')
    member = (await fixtures.memberAt(harness.tenants.one, admin.headers, memberEmail)).headers
  })

  after(async () => {
    if (!harness) return
    // Never leave the platform closed for the next suite in this process.
    await turn(false).catch(() => {})
    await harness.db.delete(schema.platformAuthUsers).where(inArray(schema.platformAuthUsers.email, [OPERATOR]))
    await harness.close()
  })

  test('SUP-25 switched on, every tenant-facing call answers 503 maintenance with the message; switched off, they work again', async () => {
    const calls = tenantCalls()
    for (const [name, call] of Object.entries(calls)) {
      const res = await call()
      assert.notEqual(res.status, 503, `${name} is closed before maintenance is on`)
    }

    const on = await turn(true, 'Upgrading the booking system. Back by 10pm.')
    assert.equal(on.enabled, true)
    assert.equal(on.message, 'Upgrading the booking system. Back by 10pm.')
    assert.equal(on.updated_by, OPERATOR, 'who switched it is recorded')
    assert.ok(on.updated_at && Math.abs(Date.parse(on.updated_at) - Date.now()) < 60_000, 'and when')

    for (const [name, call] of Object.entries(calls)) {
      const res = await call()
      assert.equal(res.status, 503, `${name} is not closed by maintenance`)
      assert.ok(Number(res.headers.get('retry-after')) > 0, `${name} carries no Retry-After`)
      assert.deepEqual(await res.json(), {
        error: 'maintenance',
        message: 'Upgrading the booking system. Back by 10pm.',
      })
    }

    const read = (await (await platform('GET', operator)).json()) as typeof on
    assert.deepEqual(read, on, 'the super portal reads back what it set')

    const off = await turn(false)
    assert.equal(off.enabled, false)
    assert.equal(off.message, 'Upgrading the booking system. Back by 10pm.', 'the message is kept for next time')
    for (const [name, call] of Object.entries(calls)) {
      const res = await call()
      assert.notEqual(res.status, 503, `${name} is still closed after maintenance is off`)
    }
    assert.deepEqual(await (await calls.status()).json(), { maintenance: false })
  })

  test('SUP-26 while on, the super portal and its sign-in, the health checks, the webhooks and CORS preflight are still served', async () => {
    await turn(true)
    try {
      assert.equal((await platform('GET', operator)).status, 200, 'the super portal can read the switch')
      assert.equal(
        (await harness.app.request('/api/v1/platform/tenants', { headers: { Authorization: operator.Authorization! } })).status,
        200,
        'the super portal lists studios',
      )
      // A fresh platform sign-in — it is how the switch gets turned off.
      const again = await harness.signInAs('platform', OPERATOR, null)
      assert.ok(again.Authorization, 'the super portal signs in')

      assert.equal((await harness.app.request('/api/v1/healthz')).status, 200)
      assert.equal((await harness.app.request('/health')).status, 200)

      // Payments and mail outcomes still land: an unsigned event is refused for
      // being unsigned, never for maintenance.
      for (const path of [`/api/v1/webhooks/stripe/${harness.tenants.one.slug}`, '/api/v1/webhooks/resend']) {
        const res = await harness.app.request(path, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
        assert.notEqual(res.status, 503, `${path} is closed by maintenance`)
      }

      const preflight = await harness.app.request('/api/v1/me', {
        method: 'OPTIONS',
        headers: {
          Origin: frontendOrigin('client', harness.tenants.one),
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization,x-tenant-slug',
        },
      })
      assert.equal(preflight.status, 204, 'the preflight is answered')

      // The 503 itself has to be readable by the page that made the call.
      const refused = await tenantCalls().member()
      assert.equal(refused.status, 503)
      assert.equal(
        refused.headers.get('access-control-allow-origin'),
        frontendOrigin('client', harness.tenants.one),
        'the 503 carries CORS headers, so the frontend can read it',
      )
    } finally {
      await turn(false)
    }
  })

  test('SUP-27 only the super portal can read or set the switch; a studio admin or member session is answered 404', async () => {
    for (const headers of [admin.headers, member]) {
      assert.equal((await platform('GET', headers)).status, 404)
      assert.equal((await platform('PUT', headers, { enabled: true })).status, 404)
    }
    assert.equal((await harness.app.request('/api/v1/platform/maintenance')).status, 404, 'no session at all')
    const read = (await (await platform('GET', operator)).json()) as { enabled: boolean }
    assert.equal(read.enabled, false, 'nothing a studio sent switched it on')
  })

  test('SUP-28 the message defaults to the platform wording, and a blank one is refused', async () => {
    const res = await platform('PUT', operator, { enabled: false, message: '   ' })
    assert.equal(res.status, 400)
    // A database that has never had the switch set reads as off, in the platform's words.
    await harness.db.execute(sql`DELETE FROM platform_settings`)
    const fresh = (await (await platform('GET', operator)).json()) as { enabled: boolean; message: string }
    assert.deepEqual(fresh, { enabled: false, message: DEFAULT_MESSAGE, updated_by: null, updated_at: null })
  })

  test('TEN-33 platform_settings is readable inside a studio context, and writable only outside every one', async () => {
    const app = postgres(appRoleUrl(TEST_DATABASE_URL!), { max: 1 })
    try {
      await turn(false, 'Platform wording')
      const inside = async <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
        app.begin(async tx => {
          await tx`SELECT set_config('app.tenant_id', ${harness.tenants.one.id}, true)`
          return fn(tx)
        })

      const [seen] = await inside(tx => tx`SELECT maintenance_enabled FROM platform_settings`)
      assert.equal(seen?.maintenance_enabled, false, 'a studio context can read the switch the gate enforces')

      const updated = await inside(tx => tx`UPDATE platform_settings SET maintenance_enabled = true RETURNING 1`)
      assert.equal(updated.length, 0, 'a studio context cannot turn maintenance on')

      await assert.rejects(
        inside(tx => tx`INSERT INTO platform_settings (id, maintenance_enabled) VALUES (true, true) ON CONFLICT (id) DO UPDATE SET maintenance_enabled = true`),
        /row-level security/,
        'nor write the row by upsert',
      )

      const outside = await app`UPDATE platform_settings SET maintenance_message = 'Platform wording' RETURNING 1`
      assert.equal(outside.length, 1, 'outside every context — the super portal — it can')
    } finally {
      await app.end({ timeout: 5 })
    }
  })
})
