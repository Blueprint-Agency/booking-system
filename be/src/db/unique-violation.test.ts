import assert from 'node:assert'
import { isUniqueViolation } from './unique-violation'

// Shape Drizzle actually throws: its own Error carrying the query text, with the
// postgres.js error (the one holding `code`) hung off `.cause`.
const driverError = Object.assign(new Error('duplicate key value violates unique constraint'), {
  code: '23505',
  constraint_name: 'client_packages_trial_unique_per_client',
})
const wrapped = Object.assign(new Error('Failed query: insert into "client_packages" ...'), {
  cause: driverError,
})

assert.strictEqual(isUniqueViolation(wrapped), true)
assert.strictEqual(isUniqueViolation(wrapped, 'client_packages_trial_unique_per_client'), true)
assert.strictEqual(isUniqueViolation(wrapped, 'promo_codes_code_unique'), false)

// Bare driver error (no Drizzle wrapper) still matches.
assert.strictEqual(isUniqueViolation(Object.assign(new Error('dup'), { code: '23505' })), true)
// A named check wants that name: a collision on some other index of the same
// table must not be dressed up as this domain rule's 409.
assert.strictEqual(isUniqueViolation(Object.assign(new Error('dup'), { code: '23505' }), 'x'), false)

// Anything else is not ours.
assert.strictEqual(isUniqueViolation(new Error('boom')), false)
assert.strictEqual(isUniqueViolation(Object.assign(new Error('fk'), { code: '23503' })), false)
assert.strictEqual(isUniqueViolation(undefined), false)

// Self-referential cause must terminate, not hang.
const loop: { cause?: unknown } = {}
loop.cause = loop
assert.strictEqual(isUniqueViolation(loop), false)

console.log('unique-violation.test ok')
