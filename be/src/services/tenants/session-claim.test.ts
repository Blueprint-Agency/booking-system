import assert from 'node:assert'
import { describe, test } from 'node:test'
import { sessionClaimVerdict } from './session-claim'

const ONE = '10000000-0000-0000-0000-000000000001'
const TWO = '10000000-0000-0000-0000-000000000002'

describe('session tenant claim', () => {
  test('the session agreeing with the resolved tenant is the happy path', () => {
    assert.equal(sessionClaimVerdict({ requestTenantId: ONE, claimedTenantId: ONE }), 'ok')
  })

  test("a forged header is refused by the session's own tenant", () => {
    // Signed in on studio two's hostname, naming studio one in the header.
    assert.equal(sessionClaimVerdict({ requestTenantId: ONE, claimedTenantId: TWO }), 'tenant_mismatch')
  })

  test('a session that claims no tenant is refused, not waved through', () => {
    // There is no rollout seam here, unlike the Clerk organization claim: every
    // studio-pool session is stamped at creation, so a missing claim is a
    // session made outside a Tenant context, and it proves nothing.
    assert.equal(sessionClaimVerdict({ requestTenantId: ONE, claimedTenantId: null }), 'tenant_required')
  })
})
