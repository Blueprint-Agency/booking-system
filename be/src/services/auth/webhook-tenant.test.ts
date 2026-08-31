import assert from 'node:assert'
import { describe, test } from 'node:test'
import { tenantHints } from './webhook-tenant'

describe('clerk webhook tenant hints', () => {
  test('a membership event names its organization and its user', () => {
    const hints = tenantHints({
      type: 'organizationMembership.created',
      data: {
        organization: { id: 'org_acme', slug: 'acme' },
        public_user_data: { user_id: 'user_1', identifier: 'a@example.test' },
      },
    })
    assert.equal(hints.organizationId, 'org_acme')
    assert.equal(hints.clerkUserId, 'user_1')
    assert.equal(hints.metadataSlug, null)
  })

  test('an organization event names itself', () => {
    const hints = tenantHints({ type: 'organization.updated', data: { id: 'org_acme' } })
    assert.equal(hints.organizationId, 'org_acme')
  })

  test('a user event names no organization — which is the whole problem', () => {
    const hints = tenantHints({ type: 'user.created', data: { id: 'user_1' } })
    assert.equal(hints.organizationId, null)
    assert.equal(hints.metadataSlug, null)
    assert.equal(hints.clerkUserId, 'user_1')
  })

  test("a sign-up form's tenant_slug is read, from either metadata bag", () => {
    assert.equal(
      tenantHints({ type: 'user.created', data: { id: 'u', public_metadata: { tenant_slug: 'acme' } } })
        .metadataSlug,
      'acme',
    )
    assert.equal(
      tenantHints({ type: 'user.created', data: { id: 'u', unsafe_metadata: { tenant_slug: 'acme' } } })
        .metadataSlug,
      'acme',
    )
    // Public metadata is set by the backend and unsafe metadata by the browser,
    // so the trustworthy one wins when both are present.
    assert.equal(
      tenantHints({
        type: 'user.created',
        data: {
          id: 'u',
          public_metadata: { tenant_slug: 'acme' },
          unsafe_metadata: { tenant_slug: 'yogasadhana' },
        },
      }).metadataSlug,
      'acme',
    )
  })

  test('a slug from metadata is normalised before it is trusted', () => {
    assert.equal(
      tenantHints({ type: 'user.created', data: { id: 'u', public_metadata: { tenant_slug: '  ACME ' } } })
        .metadataSlug,
      'acme',
    )
  })

  test('empty and missing hints are the same answer: none', () => {
    const hints = tenantHints({
      type: 'user.updated',
      data: { id: '', public_metadata: { tenant_slug: '   ' } },
    })
    assert.equal(hints.organizationId, null)
    assert.equal(hints.metadataSlug, null)
    assert.equal(hints.clerkUserId, null)
    assert.deepEqual(tenantHints({ type: 'session.created', data: {} }), {
      organizationId: null,
      metadataSlug: null,
      clerkUserId: null,
    })
  })
})
