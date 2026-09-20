import { randomBytes } from 'node:crypto'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * The platform's booking-code prefix, and deliberately not a studio's.
 *
 * It was the first studio's initials, minted for every studio on the
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
  return bookingCodesFrom(randomBytes(32), randomBytes(6))
}

/**
 * The same two codes from bytes the caller supplies: 32 for the token, 6 for
 * the code. For a booking that must get the same codes every time it is
 * written — the Mindbody transform derives the bytes from a secret — and is
 * still spelled the one way a booking code is spelled.
 */
export function bookingCodesFrom(tokenBytes: Uint8Array, codeBytes: Uint8Array): { qrToken: string; code: string } {
  const qrToken = Buffer.from(tokenBytes).toString('base64url')
  let code = CODE_PREFIX
  for (let i = 0; i < 6; i++) {
    code += CROCKFORD[codeBytes[i]! % 32]
  }
  return { qrToken, code }
}
