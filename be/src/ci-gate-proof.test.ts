import { test } from 'node:test'
import assert from 'node:assert/strict'

// Deliberately red, to prove the CI gate (#131). This branch is deleted after.
test('the CI gate stops a deploy when a backend test fails', () => {
  assert.fail('deliberate failure for #131')
})
