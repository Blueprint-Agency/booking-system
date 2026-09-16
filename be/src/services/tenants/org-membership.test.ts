import assert from 'node:assert'
import { describe, test } from 'node:test'
import { isAlreadyMemberError, orgRoleFor } from './org-membership'
import { isClerkSlugTakenError } from './provision'

describe('clerk organization membership', () => {
  test('those who run the studio may administer its organization; instructors are members', () => {
    assert.equal(orgRoleFor('superadmin'), 'org:admin')
    assert.equal(orgRoleFor('admin'), 'org:admin')
    assert.equal(orgRoleFor('instructor'), 'org:member')
  })

  test('"already a member" is the success case, and only that one', () => {
    assert.equal(
      isAlreadyMemberError({ errors: [{ code: 'already_a_member_in_organization' }] }),
      true,
    )
    assert.equal(isAlreadyMemberError({ errors: [{ code: 'resource_not_found' }] }), false)
    assert.equal(isAlreadyMemberError(new Error('network')), false)
    assert.equal(isAlreadyMemberError(null), false)
  })
})

describe('clerk organization slug collision', () => {
  test('a slug an orphaned organization still holds reads as slug_taken', () => {
    assert.equal(
      isClerkSlugTakenError({
        errors: [{ code: 'form_identifier_exists', meta: { paramName: 'slug' } }],
      }),
      true,
    )
  })

  test('the same code on another parameter is not a slug collision', () => {
    assert.equal(
      isClerkSlugTakenError({
        errors: [{ code: 'form_identifier_exists', meta: { paramName: 'email_address' } }],
      }),
      false,
    )
    assert.equal(isClerkSlugTakenError(new Error('boom')), false)
  })
})
