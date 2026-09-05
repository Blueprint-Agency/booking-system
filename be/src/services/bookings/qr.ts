import { randomBytes } from 'node:crypto'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * The platform's booking-code prefix, and deliberately not a studio's.
 *
 * It was `YS-` — Yoga Sadhana's initials, minted for every studio on the
 * platform. A per-Tenant prefix is not the fix either: the code is what a
 * member reads down the phone to a front desk, and two studios choosing the
 * same initials would put the collision somewhere nobody is looking.
 *
 * Codes already issued keep the prefix they were issued with. Nothing parses
 * it — lookup matches the whole string — so old and new coexist indefinitely.
 */
const CODE_PREFIX = 'RT-'

/**
 * Generates booking QR token + human-typeable code.
 * Format: code = `RT-` + 6 Crockford-base32 chars (no I/L/O/U).
 * See backend-architecture.md §6 Per-booking codes.
 */
export function generateBookingCodes(): { qrToken: string; code: string } {
  const qrToken = randomBytes(32).toString('base64url')
  const bytes = randomBytes(6)
  let code = CODE_PREFIX
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
