import { createHash, createHmac } from 'node:crypto'

/**
 * Ids and secrets the transform derives rather than draws, so the same inputs
 * always give the same archive.
 */

function parseUuid(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** RFC 9562 UUID version 5: SHA-1 of a namespace and a name. */
export function uuidV5(name: string, namespace: string): string {
  const hash = createHash('sha1').update(parseUuid(namespace)).update(name, 'utf8').digest()
  const bytes = hash.subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return formatUuid(bytes)
}

/** The transform's own namespace. Fixed forever: changing it changes every id it has ever written. */
const MINDBODY_NAMESPACE = '6f0c2f7e-3b1d-5a52-9d0e-6a8f1c4b2e71'

/**
 * Row ids for one target Tenant, from stable Mindbody keys.
 *
 * Scoped to the Tenant because row ids are global primary keys: two studios —
 * or two rehearsals into two fresh Tenants on one database — must not derive the
 * same id from the same client barcode.
 */
export function idsFor(tenantId: string) {
  const namespace = uuidV5(tenantId, MINDBODY_NAMESPACE)
  return (kind: string, key: string) => uuidV5(`${kind}:${key}`, namespace)
}

/**
 * A secret token, reproducible from the config's secret and a stable key.
 *
 * Invitation tokens are the way into a staff account, so they cannot be
 * derived from anything in the reports alone; keyed by the config's secret they
 * are unguessable and still identical on a rerun.
 */
export function secretToken(secret: string, key: string): string {
  return secretBytes(secret, key).toString('base64url')
}

/** The same, as its 32 bytes: a booking's QR token and code are both cut from these. */
export function secretBytes(secret: string, key: string): Buffer {
  return createHmac('sha256', secret).update(key).digest()
}
