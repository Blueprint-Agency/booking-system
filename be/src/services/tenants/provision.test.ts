import assert from 'node:assert'
import { describe, test } from 'node:test'
import { withProvisionedOrgs, type ClerkOrgPort, type ClerkApp } from './provision'

/**
 * A stand-in Clerk. Records every call so the tests can assert on the *order*
 * of the unwind, not merely that something was deleted.
 */
function fakeClerk(
  overrides: Partial<ClerkOrgPort> = {},
): ClerkOrgPort & { calls: string[]; live: Set<string> } {
  const calls: string[] = []
  const live = new Set<string>()
  let next = 0

  const port: ClerkOrgPort & { calls: string[]; live: Set<string> } = {
    calls,
    live,
    async createOrganization(app: ClerkApp) {
      const id = `org_${app}_${++next}`
      calls.push(`create:${app}`)
      live.add(id)
      return id
    },
    async deleteOrganization(app: ClerkApp, id: string) {
      calls.push(`delete:${app}`)
      live.delete(id)
    },
    async inviteOrgAdmin() {
      calls.push('invite')
    },
    ...overrides,
  }
  return port
}

const INPUT = { name: 'Acme Yoga', slug: 'acme' }

describe('withProvisionedOrgs', () => {
  test('creates both organizations and leaves them in place on success', async () => {
    const clerk = fakeClerk()
    const orgs = await withProvisionedOrgs(clerk, INPUT, async o => o)

    assert.deepEqual(clerk.calls, ['create:portal', 'create:client'])
    assert.equal(clerk.live.size, 2)
    assert.ok(orgs.portalOrgId)
    assert.ok(orgs.clientOrgId)
    assert.notEqual(orgs.portalOrgId, orgs.clientOrgId)
  })

  test('a failing body deletes both organizations, newest first', async () => {
    const clerk = fakeClerk()
    const boom = new Error('database said no')

    await assert.rejects(
      withProvisionedOrgs(clerk, INPUT, async () => {
        throw boom
      }),
      // The caller must see the real failure, not a rollback artefact.
      (err: unknown) => err === boom,
    )

    assert.deepEqual(clerk.calls, ['create:portal', 'create:client', 'delete:client', 'delete:portal'])
    // Nothing left behind holding the slug in Clerk.
    assert.equal(clerk.live.size, 0)
  })

  test('a failure creating the second organization still removes the first', async () => {
    const boom = new Error('clerk said no')
    let created = 0
    const clerk = fakeClerk({
      async createOrganization(app: ClerkApp) {
        if (++created === 2) throw boom
        return `org_${app}`
      },
    })

    await assert.rejects(
      withProvisionedOrgs(clerk, INPUT, async () => 'unreachable'),
      (err: unknown) => err === boom,
    )
    assert.deepEqual(clerk.calls, ['delete:portal'])
  })

  test('a failure creating the first organization has nothing to undo', async () => {
    const boom = new Error('clerk said no')
    const clerk = fakeClerk({
      async createOrganization() {
        throw boom
      },
    })

    await assert.rejects(
      withProvisionedOrgs(clerk, INPUT, async () => 'unreachable'),
      (err: unknown) => err === boom,
    )
    assert.deepEqual(clerk.calls, [])
  })

  test('a rollback that itself fails does not mask the original error', async () => {
    const boom = new Error('database said no')
    const attempted: ClerkApp[] = []
    const clerk = fakeClerk({
      async deleteOrganization(app: ClerkApp) {
        attempted.push(app)
        throw new Error('clerk is down too')
      },
    })

    await assert.rejects(
      withProvisionedOrgs(clerk, INPUT, async () => {
        throw boom
      }),
      (err: unknown) => err === boom,
    )
    // Both deletes were still attempted — one failing must not skip the other.
    assert.deepEqual(attempted, ['client', 'portal'])
  })
})
