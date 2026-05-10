import { randomBytes } from 'node:crypto'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Generates booking QR token + human-typeable code.
 * Format: code = "YS-" + 6 Crockford-base32 chars (no I/L/O/U).
 * See backend-architecture.md §6 Per-booking codes.
 */
export function generateBookingCodes(): { qrToken: string; code: string } {
  const qrToken = randomBytes(32).toString('base64url')
  const bytes = randomBytes(6)
  let code = 'YS-'
  for (let i = 0; i < 6; i++) {
    code += CROCKFORD[bytes[i]! % 32]
  }
  return { qrToken, code }
}

/** Normalize manual code entry: uppercase + map common misreads. */
export function normalizeCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/I|L/g, '1')
    .replace(/O/g, '0')
}
