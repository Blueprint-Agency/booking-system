import assert from 'node:assert'
import { describe, test } from 'node:test'
import { withProvisionedOrg, type ClerkOrgPort } from './provision'

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
    async createOrganization() {
      const id = `org_portal_${++next}`
      calls.push('create')
      live.add(id)
      return id
    },
    async deleteOrganization(id: string) {
      calls.push('delete')
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

describe('withProvisionedOrg', () => {
  test('creates the portal organization and leaves it in place on success', async () => {
    const clerk = fakeClerk()
    const portalOrgId = await withProvisionedOrg(clerk, INPUT, async id => id)

    // One organization, in the portal application. The client application gets
    // none — members are not organization members. See the ADR in provision.ts.
    assert.deepEqual(clerk.calls, ['create'])
    assert.equal(clerk.live.size, 1)
    assert.ok(portalOrgId)
  })

  test('a failing body deletes the organization', async () => {
    const clerk = fakeClerk()
    const boom = new Error('database said no')

    await assert.rejects(
      withProvisionedOrg(clerk, INPUT, async () => {
        throw boom
      }),
      // The caller must see the real failure, not a rollback artefact.
      (err: unknown) => err === boom,
    )

    assert.deepEqual(clerk.calls, ['create', 'delete'])
    // Nothing left behind holding the slug in Clerk.
    assert.equal(clerk.live.size, 0)
  })

  test('a failure creating the organization has nothing to undo', async () => {
    const boom = new Error('clerk said no')
    const clerk = fakeClerk({
      async createOrganization() {
        throw boom
      },
    })

    await assert.rejects(
      withProvisionedOrg(clerk, INPUT, async () => 'unreachable'),
      (err: unknown) => err === boom,
    )
    assert.deepEqual(clerk.calls, [])
  })

  test('a rollback that itself fails does not mask the original error', async () => {
    const boom = new Error('database said no')
    let attempted = 0
    const clerk = fakeClerk({
      async deleteOrganization() {
        attempted += 1
        throw new Error('clerk is down too')
      },
    })

    await assert.rejects(
      withProvisionedOrg(clerk, INPUT, async () => {
        throw boom
      }),
      (err: unknown) => err === boom,
    )
    assert.equal(attempted, 1, 'the delete was still attempted')
  })
})
