import assert from 'node:assert'
import { keyBelongsToTenant, tenantKey } from './object-key'

const ONE = '10000000-0000-0000-0000-000000000001'
const TWO = '10000000-0000-0000-0000-000000000002'

// Two studios uploading the same-named object never collide, and neither key is
// reachable by guessing from inside the other's prefix.
assert.strictEqual(tenantKey(ONE, 'merch/abc.jpg'), `t/${ONE}/merch/abc.jpg`)
assert.notStrictEqual(tenantKey(TWO, 'merch/abc.jpg'), tenantKey(ONE, 'merch/abc.jpg'))
// Deterministic — a re-upload replaces rather than orphans.
assert.strictEqual(tenantKey(ONE, 'merch/abc.jpg'), tenantKey(ONE, 'merch/abc.jpg'))
// A leading slash would produce `t/<id>//merch/…`, a second, different key for
// the same object.
assert.strictEqual(tenantKey(ONE, '/merch/abc.jpg'), `t/${ONE}/merch/abc.jpg`)

// Ownership, for the keys a caller names rather than uploads.
assert.strictEqual(keyBelongsToTenant(ONE, tenantKey(ONE, 'covers/1.jpg')), true)
assert.strictEqual(keyBelongsToTenant(ONE, tenantKey(TWO, 'covers/1.jpg')), false)
// A prefix that merely starts the same is not the same tenant.
assert.strictEqual(keyBelongsToTenant(ONE, `t/${ONE}-evil/covers/1.jpg`), false)
// Keys written before the prefix existed are still stored on live rows, so they
// stay editable.
assert.strictEqual(keyBelongsToTenant(ONE, 'workshops/legacy.jpg'), true)

console.log('object-key.test ok')
