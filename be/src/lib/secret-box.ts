import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../env'

/**
 * The platform's envelope for a secret it holds on somebody else's behalf.
 *
 * A Tenant's payment-provider key is not our secret. It moves that studio's
 * money, and the studio hands it over because the platform charges on its
 * behalf — which makes storing it in a column, in the clear, the wrong shape of
 * responsibility. A database backup, a `SELECT *` in a console, a dump pulled
 * into a dev environment: each of those is an ordinary event that must not also
 * be a disclosure of every studio's live payment key.
 *
 * So the column holds ciphertext and the key lives in the environment
 * (`PAYMENT_CREDENTIALS_KEY`), which means a stolen database is not a stolen
 * key and a leaked key is not a database.
 *
 * AES-256-GCM, because the thing being protected is a credential and a
 * credential that can be *altered* undetected is as bad as one that can be read:
 * GCM authenticates the ciphertext, so a tampered row fails to open rather than
 * decrypting to something else. A fresh random IV per encryption, never reused.
 */
const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const VERSION = 'v1'

/**
 * Why the environment cannot hold a secret, or undefined when it can.
 *
 * Split out so boot and the super portal can both say it in words rather than
 * discovering it at the moment a studio's key is being saved.
 */
export function secretKeyProblem(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return (
      'PAYMENT_CREDENTIALS_KEY is not set. A Tenant cannot supply its own ' +
      'payment-provider credentials until there is a key to seal them with — ' +
      'generate one with `openssl rand -base64 32`.'
    )
  }
  let decoded: Buffer
  try {
    decoded = Buffer.from(trimmed, 'base64')
  } catch {
    return 'PAYMENT_CREDENTIALS_KEY must be base64 — generate one with `openssl rand -base64 32`.'
  }
  if (decoded.length !== KEY_BYTES) {
    return (
      `PAYMENT_CREDENTIALS_KEY must decode to exactly ${KEY_BYTES} bytes (it decodes to ` +
      `${decoded.length}). Generate one with \`openssl rand -base64 32\`.`
    )
  }
  return undefined
}

function key(): Buffer {
  const problem = secretKeyProblem(env.PAYMENT_CREDENTIALS_KEY)
  if (problem) throw new Error(problem)
  return Buffer.from(env.PAYMENT_CREDENTIALS_KEY!.trim(), 'base64')
}

/**
 * Seal a secret. The result is `v1.<iv>.<tag>.<ciphertext>`, all base64 — self
 * describing, so a later key rotation or algorithm change can recognise what it
 * is looking at instead of guessing.
 */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.')
}

/**
 * Open a sealed secret.
 *
 * **Throws** on anything unexpected — a wrong key, a truncated value, a row
 * somebody edited. There is deliberately no "return null and carry on": the one
 * caller charges a member's card, and carrying on would mean taking the money
 * onto the platform's account instead of the studio's. A studio whose key
 * cannot be opened must fail loudly, not quietly sell on somebody else's
 * account.
 */
export function open(sealed: string): string {
  const parts = sealed.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('sealed secret is malformed or of an unknown version')
  }
  const [, ivB64, tagB64, bodyB64] = parts
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64!, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(bodyB64!, 'base64')), decipher.final()]).toString('utf8')
}
