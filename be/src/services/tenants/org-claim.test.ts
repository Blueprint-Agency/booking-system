import assert from 'node:assert'
import { describe, test } from 'node:test'
import { orgClaimVerdict, orgIdFromClaims } from './org-claim'

const ONE = '10000000-0000-0000-0000-000000000001'
const TWO = '10000000-0000-0000-0000-000000000002'

describe('clerk organization claim', () => {
  test('reads the active organization from a v2 session token', () => {
    assert.equal(orgIdFromClaims({ sub: 'user_1', o: { id: 'org_a', rol: 'admin' } }), 'org_a')
  })

  test('reads it from a v1 session token too', () => {
    assert.equal(orgIdFromClaims({ sub: 'user_1', org_id: 'org_a' }), 'org_a')
  })

  test('a token signed into no organization claims none', () => {
    assert.equal(orgIdFromClaims({ sub: 'user_1' }), null)
    assert.equal(orgIdFromClaims({ sub: 'user_1', o: {} }), null)
    assert.equal(orgIdFromClaims({ sub: 'user_1', org_id: '' }), null)
    assert.equal(orgIdFromClaims(null), null)
  })

  test('the claim agreeing with the header is the happy path', () => {
    assert.equal(
      orgClaimVerdict({
        requestTenantId: ONE,
        configuredOrgId: 'org_one',
        claimedOrgId: 'org_one',
        claimedOrgTenantId: ONE,
      }),
      'ok',
    )
  })

  test("a forged header is refused by the token's own organization", () => {
    // The caller signed into studio two and named studio one in the header.
    assert.equal(
      orgClaimVerdict({
        requestTenantId: ONE,
        configuredOrgId: 'org_one',
        claimedOrgId: 'org_two',
        claimedOrgTenantId: TWO,
      }),
      'tenant_mismatch',
    )
  })

  test('an organization this platform has never heard of is refused, not ignored', () => {
    assert.equal(
      orgClaimVerdict({
        requestTenantId: ONE,
        configuredOrgId: 'org_one',
        claimedOrgId: 'org_elsewhere',
        claimedOrgTenantId: null,
      }),
      'tenant_mismatch',
    )
  })

  test('no claim is allowed only until the tenant has an organization', () => {
    // Rollout: nothing configured yet, so a token without the claim still works.
    assert.equal(
      orgClaimVerdict({
        requestTenantId: ONE,
        configuredOrgId: null,
        claimedOrgId: null,
        claimedOrgTenantId: null,
      }),
      'ok',
    )
    // …and the moment the id is written to the row, it stops.
    assert.equal(
      orgClaimVerdict({
        requestTenantId: ONE,
        configuredOrgId: 'org_one',
        claimedOrgId: null,
        claimedOrgTenantId: null,
      }),
      'organization_required',
    )
  })

  test('a claim is checked even when the tenant configured none', () => {
    // Half-provisioned: tenant one has no organization id yet, but the caller
    // is signed into tenant two's. The header must not win that argument.
    assert.equal(
      orgClaimVerdict({
        requestTenantId: ONE,
        configuredOrgId: null,
        claimedOrgId: 'org_two',
        claimedOrgTenantId: TWO,
      }),
      'tenant_mismatch',
    )
  })
})
