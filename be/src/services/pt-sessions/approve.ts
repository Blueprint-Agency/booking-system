/**
 * Approve a PT request: confirms session, decrements package balance,
 * creates booking(s) per client in pt_session_clients, generates QR/codes,
 * marks inbox row, sends email.
 * See be-portal.md §3c.
 */
import { assertRoomAvailable, assertRoomInLocation } from '../schedule/room-conflicts'

export interface ApprovePtInput {
  ptSessionId: string
  locationId: string
  // Room the session runs in. Must belong to locationId and be clash-free.
  roomId: string
  startsAt: Date
  endsAt: Date
  actorStaffId: string
}

export async function approvePtSession(input: ApprovePtInput): Promise<void> {
  // Room validation is live; the rest of the approve flow is still pending.
  await assertRoomInLocation(input.roomId, input.locationId)
  await assertRoomAvailable(input.roomId, input.startsAt, input.endsAt)
  throw new Error('not implemented')
}
