import assert from 'node:assert'
import { isRetryableAbort } from './retryable-abort'

const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' })
const serialization = Object.assign(new Error('could not serialize access'), { code: '40001' })
const wrapped = (cause: unknown) => Object.assign(new Error('Failed query: select ...'), { cause })

assert.strictEqual(isRetryableAbort(wrapped(deadlock)), true)
assert.strictEqual(isRetryableAbort(wrapped(serialization)), true)
assert.strictEqual(isRetryableAbort(deadlock), true)

assert.strictEqual(isRetryableAbort(wrapped(Object.assign(new Error('dup'), { code: '23505' }))), false)
assert.strictEqual(isRetryableAbort(new Error('boom')), false)
assert.strictEqual(isRetryableAbort(undefined), false)

const loop: { cause?: unknown } = {}
loop.cause = loop
assert.strictEqual(isRetryableAbort(loop), false)

console.log('retryable-abort.test ok')
