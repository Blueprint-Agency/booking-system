import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { afterEach, before, beforeEach, describe, test } from 'node:test'

const KEY = randomBytes(32).toString('base64')
const OTHER_KEY = randomBytes(32).toString('base64')

// Set before `env` is read, which happens the moment `secret-box` is imported —
// so the module under test is pulled in dynamically, below.
process.env.PAYMENT_CREDENTIALS_KEY = KEY

let seal: typeof import('./secret-box').seal
let open: typeof import('./secret-box').open
let secretKeyProblem: typeof import('./secret-box').secretKeyProblem

/**
 * `env` is parsed once at import, so a test that needs a different key has to
 * put it there — this writes into the object the module actually reads.
 */
let useKey: (value: string | undefined) => void

before(async () => {
  const [box, environment] = await Promise.all([import('./secret-box'), import('../env')])
  ;({ seal, open, secretKeyProblem } = box)
  useKey = value => {
    ;(environment.env as { PAYMENT_CREDENTIALS_KEY?: string }).PAYMENT_CREDENTIALS_KEY = value
  }
})

beforeEach(() => useKey(KEY))
afterEach(() => useKey(KEY))

describe('sealing a secret the platform holds for somebody else', () => {
  test('what is sealed comes back exactly', () => {
    assert.equal(open(seal('sk_live_a_studios_own_key')), 'sk_live_a_studios_own_key')
  })

  test('the same secret seals differently every time — no repeated IV', () => {
    assert.notEqual(seal('sk_live_1'), seal('sk_live_1'))
  })

  test('the sealed value does not contain the secret', () => {
    assert.ok(!seal('sk_live_recognisable').includes('sk_live_recognisable'))
  })

  test('it says which version it is, so a rotation can recognise it', () => {
    assert.ok(seal('sk_live_1').startsWith('v1.'))
  })

  test('another key cannot open it', () => {
    const sealed = seal('sk_live_1')
    useKey(OTHER_KEY)
    assert.throws(() => open(sealed))
  })

  test('a tampered ciphertext fails to open rather than opening to something else', () => {
    const parts = seal('sk_live_1').split('.')
    const body = Buffer.from(parts[3]!, 'base64')
    body[0] = body[0]! ^ 0xff
    parts[3] = body.toString('base64')
    assert.throws(() => open(parts.join('.')))
  })

  test('a value of an unknown shape is refused, not guessed at', () => {
    assert.throws(() => open('sk_live_never_sealed'), /malformed|unknown/)
    assert.throws(() => open('v2.a.b.c'), /malformed|unknown/)
  })
})

describe('the key the environment has to supply', () => {
  test('unset is a problem, and it says how to make one', () => {
    const problem = secretKeyProblem(undefined)
    assert.ok(problem)
    assert.match(problem, /PAYMENT_CREDENTIALS_KEY/)
    assert.match(problem, /openssl rand -base64 32/)
  })

  test('a blank value is the same problem as an absent one', () => {
    assert.ok(secretKeyProblem('   '))
  })

  test('a key of the wrong length is a problem, and says what it decoded to', () => {
    const problem = secretKeyProblem(randomBytes(16).toString('base64'))
    assert.ok(problem)
    assert.match(problem, /16/)
  })

  test('a real 32-byte key is no problem', () => {
    assert.equal(secretKeyProblem(KEY), undefined)
  })

  test('sealing without a usable key refuses rather than storing plaintext', () => {
    useKey(undefined)
    assert.throws(() => seal('sk_live_1'), /PAYMENT_CREDENTIALS_KEY/)
  })
})
