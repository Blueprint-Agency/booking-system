import { bookingCodesFrom } from '../services/bookings/qr'
import { secretBytes } from './ids'

/**
 * A booking's QR token and reference code, keyed by the config's secret — so
 * nobody can work a member's token out from the reports, and a rerun writes the
 * same ones.
 *
 * One coder per archive, not per table: a code is unique within a Tenant, and a
 * class seat and a workshop place are bookings in the same namespace. The rare
 * code that is already taken is salted again until it is free, which is why the
 * coder remembers what it has handed out.
 */
export type BookingCoder = (key: string) => { qrToken: string; code: string }

export function bookingCoder(secret: string, tenantId: string): BookingCoder {
  const taken = new Set<string>()
  return key => {
    const token = secretBytes(secret, `booking-token:${tenantId}:${key}`)
    let made = bookingCodesFrom(token, secretBytes(secret, `booking-code:${tenantId}:${key}`))
    for (let salt = 1; taken.has(made.code); salt++) {
      made = bookingCodesFrom(token, secretBytes(secret, `booking-code:${tenantId}:${key}:${salt}`))
    }
    taken.add(made.code)
    return made
  }
}
