import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema'
import type { ClassPassEmailOutcome } from '../../db/enums'
import { AppError } from '../../shared/errors'
import { cancelBooking } from '../bookings/cancel'
import { textPieces } from './parse'

/**
 * Placing a ClassPass cancellation email (#412): `ClassPass reservation
 * canceled by user` names the reservation by its key, which is the booking's
 * Reservation ID (`docs/md/research-classpass-integration.md`):
 *
 * ```
 * The following ClassPass reservation has been cancelled by the user
 * Reservation key: 76ada2434e044c31b181fa605321a07f
 * ```
 *
 * The ClassPass booking with that key here is cancelled as ClassPass's cancel
 * (`source: 'classpass'`): `n_a`, never a Late cancel or toward the Cap, and a
 * freed seat promotes the Waitlist as any cancel does. A key with no live
 * booking here (never imported, already cancelled, or a cancellation that
 * overtook its booking email) changes nothing: `noop`. Runs in the caller's
 * Tenant transaction.
 */

const KEY = /^reservation key:?\s*([0-9a-f]{32})$/i
const RESERVATION_ID = /^[0-9a-f]{32}$/i

/** The Reservation key, lower-cased; null when the email has none to read. */
export function parseClassPassCancellation(message: { html: string | null; text: string | null }): string | null {
  const pieces = textPieces(message)
  for (const [i, piece] of pieces.entries()) {
    const inline = KEY.exec(piece)
    if (inline) return inline[1]!.toLowerCase()
    // A table puts the label and its value in pieces of their own.
    const next = pieces[i + 1]
    if (/^reservation key:?$/i.test(piece) && next && RESERVATION_ID.test(next)) return next.toLowerCase()
  }
  return null
}

export type PlacedCancellation = {
  outcome: Extract<ClassPassEmailOutcome, 'cancelled' | 'noop' | 'unparsed'>
  /** The booking the key names here, cancelled now or before; null when none. */
  bookingId: string | null
  clientId: string | null
}

export async function placeClassPassCancellation(tenantId: string, reservationId: string | null): Promise<PlacedCancellation> {
  if (!reservationId) return { outcome: 'unparsed', bookingId: null, clientId: null }
  const [held] = await db
    .select({ id: bookings.id, clientId: bookings.clientId, state: bookings.state })
    .from(bookings)
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.classpassReservationId, reservationId)))
  if (!held) return { outcome: 'noop', bookingId: null, clientId: null }
  const found = { bookingId: held.id, clientId: held.clientId }
  if (held.state !== 'confirmed') return { ...found, outcome: 'noop' }
  try {
    await cancelBooking(tenantId, { source: 'classpass', bookingId: held.id })
  } catch (err) {
    // Cancelled since it was read (the same cancellation, forwarded twice at
    // once), or the member was marked attended: nothing for ClassPass to undo.
    if (err instanceof AppError && (err.code === 'not_cancellable' || err.code === 'booking_attended')) {
      return { ...found, outcome: 'noop' }
    }
    throw err
  }
  return { ...found, outcome: 'cancelled' }
}
